import type { InboundAction, InboundCommand, InboundMessage, InboundReaction, OutboundMessage, SlackGateway, ThreadMessage } from "./types.js";
/**
 * True when an inbound Slack message event is a live human message that chat
 * routing should see. Pure and exported so the filter is testable without
 * standing up a Bolt app.
 */
export declare function shouldDispatchMessage(m: {
    subtype?: string;
    bot_id?: string;
    user?: string;
}): boolean;
interface GatewayLogger {
    warn(message: string, data?: Record<string, unknown>): void;
}
export declare class BoltGateway implements SlackGateway {
    private readonly app;
    private readonly logger;
    private connected;
    private botId;
    private messageHandlers;
    private mentionHandlers;
    private reactionHandlers;
    constructor(opts: {
        botToken: string;
        appToken: string;
        logger: GatewayLogger;
    });
    private dispatch;
    onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
    onMention(handler: (msg: InboundMessage) => Promise<void>): void;
    onReaction(handler: (r: InboundReaction) => Promise<void>): void;
    onAction(pattern: RegExp, handler: (action: InboundAction) => Promise<void>): void;
    onCommand(command: string, handler: (cmd: InboundCommand) => Promise<void>): void;
    private socketClient;
    private socketIsActive;
    start(): Promise<void>;
    stop(): Promise<void>;
    isConnected(): boolean;
    botUserId(): string | undefined;
    probe(): Promise<boolean>;
    postMessage(msg: OutboundMessage): Promise<{
        channel: string;
        ts: string;
    }>;
    updateMessage(msg: {
        channel: string;
        ts: string;
        text: string;
        blocks?: unknown[];
    }): Promise<void>;
    postEphemeral(msg: {
        channel: string;
        user: string;
        text: string;
    }): Promise<void>;
    openDm(userId: string): Promise<string>;
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
    fetchThreadReplies(channel: string, threadTs: string, limit: number, oldest?: string): Promise<ThreadMessage[]>;
    getUserDisplayName(userId: string): Promise<string>;
}
export {};
