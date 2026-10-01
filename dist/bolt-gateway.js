import boltPkg from "@slack/bolt";
import { errString } from "./redact.js";
import { isDmChannelId } from "./slack-ids.js";
const { App } = boltPkg;
// Slack stamps a subtype on some genuinely human messages. `thread_broadcast`
// is a thread reply the author also sent to the channel; `file_share` is a
// message carrying an attachment, and it still holds whatever the human typed
// alongside the file. Both must reach chat routing like any other message.
// Every other subtype (message_changed, message_deleted, channel_join,
// bot_message, …) is not a live human message and stays filtered.
const PASSTHROUGH_SUBTYPES = new Set(["thread_broadcast", "file_share"]);
// conversations.replies returns the parent plus one page of replies per
// call. Paging past the first page is bounded by a hard request count, not
// just Slack's has_more/next_cursor signals, so a runaway thread (or a
// pathological cursor loop) cannot hang a turn indefinitely.
const THREAD_REPLIES_MAX_PAGES = 5;
/**
 * True when an inbound Slack message event is a live human message that chat
 * routing should see. Pure and exported so the filter is testable without
 * standing up a Bolt app.
 */
export function shouldDispatchMessage(m) {
    if (m.subtype && !PASSTHROUGH_SUBTYPES.has(m.subtype))
        return false;
    if (m.bot_id)
        return false;
    if (!m.user)
        return false;
    return true;
}
export class BoltGateway {
    app;
    logger;
    connected = false;
    botId;
    messageHandlers = [];
    mentionHandlers = [];
    reactionHandlers = [];
    constructor(opts) {
        this.logger = opts.logger;
        this.app = new App({
            token: opts.botToken,
            appToken: opts.appToken,
            socketMode: true,
            // Defense in depth, not a substitute for the socket watchdog's own
            // bound (see probeWithTimeout in worker.ts): with no clientOptions at
            // all, the underlying WebClient uses timeout: 0 (no per-request abort)
            // plus Slack's default ~10-retries-over-~30-minutes policy, so any
            // call through `this.app.client` — including the `auth.test()` used by
            // both `start()` and `probe()` — could otherwise hang far longer than
            // this plugin's 60s watchdog tick interval.
            //
            // retries: 0 is the necessary complement of that timeout. A client-
            // side abort proves nothing about the server: a chat.postMessage that
            // merely responded slowly DID land, and the default retry policy would
            // re-send it — a duplicate message in the channel, and for an approval
            // prompt a second set of live Approve/Reject buttons of which only the
            // retry's copy gets linked for later retirement. No call this gateway
            // makes is safe to blind-retry, so the retry layer is off; transient
            // failures surface to callers (which already handle and report them)
            // and to the watchdog. Slack's 429 rate-limit queueing is a separate
            // WebClient mechanism that only re-queues requests Slack REJECTED —
            // that one is duplicate-safe and stays on.
            clientOptions: { timeout: 10_000, retryConfig: { retries: 0 } },
        });
        this.app.event("app_mention", async ({ event }) => {
            const e = event;
            await this.dispatch(this.mentionHandlers, {
                channel: e.channel,
                // Unlike `message`, app_mention carries no channel_type field, so
                // the conversation kind has to be inferred from the id shape (see
                // isDmChannelId). Slack fires app_mention inside 1:1 DMs too — a
                // hardcoded "channel" here made "@bot hi" in a DM start a fresh,
                // thread-scoped session while a plain "hi" in the same DM kept the
                // remembered channel-scoped one.
                channelType: isDmChannelId(e.channel) ? "im" : "channel",
                user: e.user ?? "",
                text: e.text ?? "",
                ts: e.ts,
                threadTs: e.thread_ts,
            });
        });
        this.app.message(async ({ message }) => {
            const m = message;
            if (!shouldDispatchMessage(m))
                return;
            const channelType = m.channel_type === "im" ? "im" : m.channel_type === "group" ? "group" : "channel";
            await this.dispatch(this.messageHandlers, {
                channel: m.channel,
                channelType,
                // shouldDispatchMessage already rejected a missing user; the `?? ""`
                // only restores the narrowing TypeScript loses across the call, and
                // matches the app_mention handler above.
                user: m.user ?? "",
                text: m.text ?? "",
                ts: m.ts,
                threadTs: m.thread_ts,
            });
        });
        this.app.event("reaction_added", async ({ event }) => {
            const e = event;
            if (e.item.type !== "message" || !e.item.channel || !e.item.ts)
                return;
            await this.dispatch(this.reactionHandlers, {
                channel: e.item.channel,
                messageTs: e.item.ts,
                user: e.user,
                reaction: e.reaction,
            });
        });
    }
    async dispatch(handlers, payload) {
        for (const handler of handlers) {
            try {
                await handler(payload);
            }
            catch (err) {
                this.logger.warn("Slack handler failed", { err: errString(err) });
            }
        }
    }
    onMessage(handler) { this.messageHandlers.push(handler); }
    onMention(handler) { this.mentionHandlers.push(handler); }
    onReaction(handler) { this.reactionHandlers.push(handler); }
    onAction(pattern, handler) {
        this.app.action(pattern, async ({ ack, body, action }) => {
            await ack();
            const b = body;
            const a = action;
            try {
                await handler({
                    actionId: a.action_id ?? "",
                    value: a.value ?? "",
                    user: b.user?.id ?? "",
                    userName: b.user?.name ?? b.user?.username ?? b.user?.id ?? "unknown",
                    channel: b.channel?.id ?? "",
                    messageTs: b.message?.ts ?? "",
                });
            }
            catch (err) {
                this.logger.warn("Slack action handler failed", { err: errString(err) });
            }
        });
    }
    onCommand(command, handler) {
        this.app.command(command, async ({ ack, command: cmd }) => {
            await ack();
            try {
                await handler({ command: cmd.command, text: cmd.text ?? "", user: cmd.user_id, channel: cmd.channel_id });
            }
            catch (err) {
                this.logger.warn("Slack command handler failed", { err: errString(err) });
            }
        });
    }
    socketClient() {
        return this.app.receiver?.client;
    }
    socketIsActive() {
        const websocket = this.socketClient()?.websocket;
        if (!websocket?.isActive)
            return this.connected;
        try {
            return websocket.isActive();
        }
        catch {
            return false;
        }
    }
    async start() {
        // Verify the bot token (and capture the bot's user id) before opening
        // the socket at all. auth.test is a plain HTTP call against
        // `this.app.client`, which doesn't require the socket to be started.
        // Doing this first means a bad token fails fast with no socket to unwind.
        const auth = await this.app.client.auth.test();
        this.botId = auth.user_id;
        const socketClient = this.socketClient();
        socketClient?.on?.("connected", () => { this.connected = true; });
        socketClient?.on?.("disconnected", () => { this.connected = false; });
        await this.app.start();
        this.connected = true;
    }
    async stop() {
        await this.app.stop();
        this.connected = false;
    }
    isConnected() { return this.connected && this.socketIsActive(); }
    botUserId() { return this.botId; }
    async probe() {
        // Plain HTTP against the same client `start()` uses, so it does not need
        // the socket to be up. Any failure at all — network, revoked token,
        // rotated token — reads as "not alive"; the watchdog's job is to re-apply
        // the config, which re-resolves both secret refs.
        try {
            const auth = await this.app.client.auth.test();
            return auth.ok === true;
        }
        catch {
            return false;
        }
    }
    async postMessage(msg) {
        const res = await this.app.client.chat.postMessage({
            channel: msg.channel,
            text: msg.text,
            blocks: msg.blocks,
            thread_ts: msg.threadTs,
        });
        return { channel: res.channel ?? msg.channel, ts: res.ts ?? "" };
    }
    async updateMessage(msg) {
        await this.app.client.chat.update({
            channel: msg.channel,
            ts: msg.ts,
            text: msg.text,
            blocks: (msg.blocks ?? []),
        });
    }
    async postEphemeral(msg) {
        await this.app.client.chat.postEphemeral({ channel: msg.channel, user: msg.user, text: msg.text });
    }
    async openDm(userId) {
        const res = await this.app.client.conversations.open({ users: userId });
        return res.channel?.id ?? userId;
    }
    /**
     * Reads a thread back from Slack, oldest first. A single
     * conversations.replies call returns only the oldest page, which on a
     * long thread would seed the opening and miss the recent discussion — the
     * opposite of useful for "raise a ticket for this issue above". So this
     * pages on `response_metadata.next_cursor` until `has_more` is false, no
     * cursor comes back, or THREAD_REPLIES_MAX_PAGES requests have been made,
     * then concatenates the pages in order. `limit` is the page size sent on
     * each request, not a cap on the total transcript returned — trimming the
     * transcript to what a chat turn can use is the caller's job.
     *
     * Needs channels:history, groups:history or im:history (already granted),
     * so this works in public channels, private channels and 1:1 DMs. In a
     * multi-person group DM the required mpim:history scope is not granted,
     * so the call rejects with a missing_scope error instead; this method does
     * not swallow that, so callers should treat a rejection as "no history
     * available" and proceed rather than fail the turn.
     *
     * `isBot` means specifically "this app posted it", not "some bot posted
     * it". Per @slack/types' GenericMessageEvent (the shape of an ordinary,
     * non-`bot_message`-subtype message — what a chat.postMessage call from
     * this app's bot token always produces), `user` is a required field and
     * is set to the posting bot user's id, while `bot_id` is merely optional
     * metadata present on every bot-authored message, ours or anyone else's.
     * So the only safe test is `user` matching this gateway's own captured
     * bot id; `bot_id` is not read here at all. A foreign bot's message (e.g.
     * a GitHub/Zapier/workflow-bot post) still carries its own `user` id in
     * the returned ThreadMessage, so a consumer can resolve and label it via
     * getUserDisplayName exactly like a human author — Slack bot users have
     * real profiles. The one shape this deliberately does not special-case is
     * a legacy `bot_message`-subtype event (old-style incoming-webhook
     * integrations with no associated bot user, where `user` is absent and
     * only a display-only `username` is provided): that message comes back
     * with `user: ""`, `isBot: false`, and no name to resolve — the caller's
     * existing fallback label for an unresolvable author covers it, so no
     * extra field was added here for it.
     */
    async fetchThreadReplies(channel, threadTs, limit, oldest) {
        const collected = [];
        let cursor;
        for (let page = 0; page < THREAD_REPLIES_MAX_PAGES; page++) {
            // `oldest` rides on every page, cursor pages included — it is an
            // efficiency hint (see the SlackGateway declaration), and callers
            // re-filter by their own watermark, so boundary inclusivity here is
            // deliberately not load-bearing.
            const base = oldest === undefined ? { channel, ts: threadTs, limit } : { channel, ts: threadTs, limit, oldest };
            const res = await this.app.client.conversations.replies(cursor ? { ...base, cursor } : base);
            const messages = res.messages;
            if (Array.isArray(messages)) {
                for (const m of messages) {
                    collected.push({
                        user: m.user ?? "",
                        text: m.text ?? "",
                        ts: m.ts ?? "",
                        // Strictly "this app's own bot user", not "any bot". A message
                        // this app posts through chat.postMessage always comes back as
                        // a plain message event with `user` set to this gateway's own
                        // bot user id (see the round-1 fix note above the method for
                        // the evidence). `bot_id` alone is not a safe signal: it is set
                        // on every bot-authored message, including a GitHub/Zapier/
                        // workflow-bot post, and treating any bot_id as "self" would
                        // present a third party's words to the agent as its own.
                        isBot: this.botId !== undefined && m.user === this.botId,
                    });
                }
            }
            const nextCursor = res.response_metadata?.next_cursor;
            if (!res.has_more || !nextCursor)
                return collected;
            cursor = nextCursor;
        }
        // Fell out of the loop with the cursor still live: the thread is longer
        // than THREAD_REPLIES_MAX_PAGES × limit, so pages oldest-first means the
        // NEWEST messages were never read. The caller keeps the most recent of
        // what it was given (selectThreadMessages), so it would silently present
        // a stale mid-thread window as the recent discussion. This is not silent:
        // warn so a truncated seed is diagnosable. With THREAD_FETCH_PAGE_SIZE
        // (1000) that cap is ~5000 messages — a pathological thread in practice.
        this.logger.warn("Slack thread exceeded the fetch page cap; its most recent messages were not read", {
            channel,
            threadTs,
            pagesFetched: THREAD_REPLIES_MAX_PAGES,
            messagesFetched: collected.length,
        });
        return collected;
    }
    async getUserDisplayName(userId) {
        try {
            const res = await this.app.client.users.info({ user: userId });
            const user = res.user;
            return user?.profile?.display_name || user?.profile?.real_name || user?.real_name || userId;
        }
        catch {
            return userId;
        }
    }
}
