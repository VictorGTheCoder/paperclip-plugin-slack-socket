import type { SlackGateway } from "./types.js";
export interface GatewayProxyLogger {
    warn(message: string, data?: Record<string, unknown>): void;
}
/**
 * A `SlackGateway`-shaped proxy that delegates every call to whatever
 * gateway `getGateway()` currently returns, and safely no-ops (logging a
 * warning) when there isn't one yet — e.g. before the plugin's first
 * `onConfigChanged` call, or while it's degraded after a bad config change.
 *
 * This exists so modules that need a `SlackGateway` at construction time
 * (notifications, the `ask_human` tool, approvals, commands) can be built
 * exactly once in `setup()` — before any concrete gateway exists — instead
 * of being torn down and rebuilt on every config change. In particular, the
 * `ask_human` tool is registered once and must keep working (posting
 * questions, resolving answers) against the *same* module instance across
 * gateway swaps.
 *
 * `postMessage` is the one method that doesn't just no-op: every caller
 * uses its return value (e.g. to record the posted message's channel/ts),
 * so a silent no-op would surface as a confusing downstream crash instead
 * of a clear error. It throws instead — callers already handle that, e.g.
 * the `ask_human` tool's handler returns `{ error }` when its post throws.
 */
export declare function createGatewayProxy(getGateway: () => SlackGateway | null, logger: GatewayProxyLogger): SlackGateway;
