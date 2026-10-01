import type { PluginContext } from "@paperclipai/plugin-sdk";
import { extractReply, extractTaggedReply, filterRuntimeNoticeLines, HOST_WITHHELD_REPLY_NOTICE, reconstructStreamedAgentText, WITHHELD_REPLY_USER_NOTICE } from "./reply-extraction.js";
import { buildThreadContext, selectThreadMessages, type ThreadContextEntry } from "./thread-transcript.js";
export { extractReply, extractTaggedReply, filterRuntimeNoticeLines, HOST_WITHHELD_REPLY_NOTICE, reconstructStreamedAgentText, WITHHELD_REPLY_USER_NOTICE, buildThreadContext, selectThreadMessages, };
export type { ThreadContextEntry };
import type { DmSessionMode, InboundMessage, SlackGateway, SlackSocketConfig } from "./types.js";
export interface ChatDeps {
    ctx: PluginContext;
    gateway: SlackGateway;
    getConfig: () => Promise<SlackSocketConfig>;
    /** Minimum ms between streaming chat.update calls. Tests pass 0. */
    updateIntervalMs?: number;
    /**
     * Overrides the turn inactivity timeout, in ms. Tests pass small values so
     * they don't wait out a real timeout; production leaves it unset and the
     * duration derives from `cfg.turnTimeoutMinutes`. The notice posted on
     * expiry always names `cfg.turnTimeoutMinutes` — that is the number the
     * operator configured and the only one meaningful to a reader in Slack.
     */
    turnTimeoutMs?: number;
    /**
     * Overrides the thread-history seeding step's timeout, in ms. Tests pass
     * small values for the same reason as `turnTimeoutMs`; production leaves
     * it unset and SEED_FETCH_TIMEOUT_MS applies (see buildSeedBlock).
     */
    seedTimeoutMs?: number;
    /**
     * Overrides the placeholder heartbeat interval, in ms. Tests pass small
     * values; production leaves it unset and HEARTBEAT_INTERVAL_MS applies
     * (see the heartbeat in streamReply).
     */
    heartbeatIntervalMs?: number;
}
export interface Chat {
    handleMention(msg: InboundMessage): Promise<void>;
    handleMessage(msg: InboundMessage): Promise<void>;
}
export declare function buildChatPrompt(preamble: string, text: string, seed?: string): string;
export declare const MIN_TURN_TIMEOUT_MINUTES = 1;
export declare const MAX_TURN_TIMEOUT_MINUTES = 35000;
/** Clamps a possibly-invalid `turnTimeoutMinutes` to the safe [floor, ceiling] range. */
export declare function clampTurnTimeoutMinutes(minutes: number): number;
/** "45s" under a minute, "2m 03s" from one minute up. */
export declare function formatElapsed(ms: number): string;
export interface SessionScope {
    /** Plugin-state key holding the SessionEntry for this conversation. */
    key: string;
    scope: "channel" | "thread";
    /** `undefined` means "post the reply at the top level, not in a thread". */
    replyThreadTs: string | undefined;
}
/**
 * Decides which agent session a Slack message belongs to and where its reply
 * goes. Pure — two arguments, no `ctx`, no gateway, no clock — so the whole
 * scoping rule is unit-testable without any host plumbing.
 *
 * | Input                             | Key                               | Scope   | Reply                              |
 * |------------------------------------|-----------------------------------|---------|-------------------------------------|
 * | im, mode "channel"                 | `session:<channel>:main`          | channel | top-level, or threaded if the person wrote in a thread |
 * | im, mode "thread"                  | `session:<channel>:<threadTs∥ts>` | thread  | threaded                            |
 * | any non-im channel (any mode)      | `session:<channel>:<threadTs∥ts>` | thread  | threaded                            |
 *
 * Under "channel" mode (the default), a 1:1 DM is one continuous
 * conversation, not a thread list: EVERY message in it — top-level or inside
 * any thread, including a thread that formed under the bot's own reply —
 * shares the one channel-scoped session. Reply placement still tracks where
 * the person wrote (`replyThreadTs` mirrors `msg.threadTs`), so a reply
 * never jumps out of the context they're reading; only the session identity
 * is unconditionally shared. Only "thread" mode and every non-DM surface
 * give a thread its own session — that reproduces the pre-0.10.0 behavior
 * exactly.
 */
export declare function resolveSessionScope(msg: InboundMessage, mode: DmSessionMode): SessionScope;
/**
 * Clears the conversation stored at `key`: closes the agent session, deletes
 * the state entry, and drops the key from the session index. Returns whether
 * there was anything to clear, so callers can tell the user "reset" vs
 * "nothing to reset" truthfully.
 *
 * Lives here rather than in a new module because this is session-lifecycle
 * logic and chat.ts already owns the create/lookup half of it; `commands.ts`
 * imports it for `/paperclip reset` (no cycle — chat.ts imports nothing from
 * commands.ts).
 *
 * A failed `ctx.agents.sessions.close` still drops the local state: a stale
 * host-side session is strictly better than a Slack conversation wedged to a
 * session id the host has already forgotten. Everything else propagates, so
 * a caller never confirms a reset that did not happen.
 */
export declare function resetSession(ctx: PluginContext, cfg: SlackSocketConfig, key: string, surface: "command" | "mention"): Promise<boolean>;
export declare function createChat(deps: ChatDeps): Chat;
