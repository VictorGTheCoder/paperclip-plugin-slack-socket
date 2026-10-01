import type { ThreadMessage } from "./types.js";
/**
 * Picks which messages of a Slack thread to put in front of the agent, and
 * how many were left out. Pure — four arguments, no `ctx`, no gateway, no
 * clock — so the whole bounds rule is unit-testable without host plumbing.
 *
 * `messages` is chronological, oldest first (the order
 * `conversations.replies` returns).
 *
 * - Every ts in `excludeTs` is dropped before anything else runs. This is a
 *   SET, not a single scalar, deliberately: the triggering message's own ts
 *   always belongs in it (it arrives as the prompt proper — see
 *   buildChatPrompt — and keeping it here would double it), and so does the
 *   "_Thinking…_" placeholder's ts (see buildSeedBlock) — Slack really did
 *   post that message into this same thread, BEFORE the fetch that reads it
 *   back, so a naive single-ts exclusion would seed the bot's own
 *   placeholder into its own transcript, labelled "[you]" — the highest-
 *   trust attribution in the format. A set means a third exclusion, if one
 *   is ever needed, is a caller-side change, not another signature change
 *   here.
 * - The oldest remaining message — the thread parent — is always kept,
 *   whatever the bounds say. It is what "this issue here above" points at,
 *   and it is the message this whole feature exists to show the agent. Its
 *   own text is separately capped at THREAD_CONTEXT_MAX_PARENT_CHARS with a
 *   visible marker (see truncateParentText) — a single Slack message can
 *   carry ~40,000 characters, and without this cap the parent alone could
 *   blow past the overall budget several times over before a single reply
 *   is even considered. The (possibly truncated) parent length is what
 *   seeds the budget below, so unlike its presence in `kept`, its length is
 *   NOT exempt from `maxChars`.
 * - The rest are taken most-recent-first and stop at the first message that
 *   would breach either bound, then go back into chronological order.
 *   Stopping rather than skipping-and-continuing keeps the kept replies
 *   contiguous, so the agent reads an unbroken tail of the conversation
 *   instead of a sampled one it cannot tell has holes in it.
 * - `omitted` is what was dropped, so the caller can say so in-band.
 *   Silent truncation would let the agent answer confidently from a
 *   partial thread.
 */
export declare function selectThreadMessages(messages: ThreadMessage[], excludeTs: ReadonlySet<string>, maxChars: number, maxMessages: number): {
    kept: ThreadMessage[];
    omitted: number;
};
/**
 * Delta counterpart of selectThreadMessages: nothing is privileged the way
 * a seed's thread root is — `messages[0]` here is merely the oldest unseen
 * reply, not the message the feature exists to show. Every message is
 * individually capped at the parent cap (with the same visible marker) so a
 * lone oversized reply is delivered truncated rather than either starving
 * the whole budget or being dropped; then messages are admitted
 * newest-first until either bound and returned in chronological order. The
 * walk breaks at the first overflow, so `omitted` is always a contiguous
 * run of the OLDEST candidates — which is what the "earlier replies
 * omitted" notice describes. Pure.
 */
export declare function selectDeltaMessages(messages: ThreadMessage[], maxChars: number, maxMessages: number): {
    kept: ThreadMessage[];
    omitted: number;
};
/**
 * One rendered line of the seeded transcript. `label` is who spoke — "you"
 * for the bot's own messages, otherwise a display name.
 *
 * Rendering is split from selection because resolving a Slack user id to a
 * display name is async (`gateway.getUserDisplayName`), and this half has to
 * stay pure and synchronously testable. The caller resolves the labels; this
 * function only lays them out.
 */
export interface ThreadContextEntry {
    label: string;
    text: string;
}
export declare const THREAD_DELTA_FRAMING: string;
export declare const UNKNOWN_SPEAKER_LABEL = "unknown";
/**
 * Renders selected thread messages as the fenced, framed block that gets
 * prepended to a new session's first prompt. Pure.
 *
 * Returns "" for an empty entry list, so a thread with nothing to seed
 * leaves the prompt byte-identical to today's.
 *
 * `omitted > 0` produces an in-band truncation notice, placed between the
 * parent line and the kept replies — which is where the dropped messages
 * actually were. Truncating silently would let the agent answer confidently
 * from a partial thread.
 *
 * One line per entry is a readability convention, not a parse boundary: a
 * multi-line Slack message stays multi-line, because the alert this feature
 * exists to show the agent is usually formatted — every line after the
 * first is prefixed with CONTINUATION_MARKER (see markContinuationLines)
 * so it can never be mistaken for a line-initial "[label] ..." attribution.
 */
export declare function buildThreadContext(entries: ThreadContextEntry[], omitted: number, framing?: string, noticePlacement?: "after-first" | "before-all"): string;
