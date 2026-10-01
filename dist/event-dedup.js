// Guards inbound Slack event dispatch against duplicate deliveries (Slack's
// at-least-once delivery under Socket Mode can redeliver the same event) and
// against acting on stale events replayed long after the fact (e.g. after a
// reconnect backlog). Callers key entries as `${channel}:${ts}` — the Slack
// `ts` is epoch seconds with a decimal fraction, so it doubles as the event's
// wall-clock time for the staleness check.
const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_MAX_AGE_MS = 5 * 60_000;
function parseTsSeconds(key) {
    const suffix = key.slice(key.lastIndexOf(":") + 1);
    const seconds = Number(suffix);
    return Number.isFinite(seconds) ? seconds : null;
}
export function createEventDeduper(opts = {}) {
    const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const now = opts.now ?? Date.now;
    // Insertion-ordered set of seen keys, bounded to maxEntries with
    // oldest-first eviction (Set preserves insertion order in JS).
    const seen = new Set();
    return {
        shouldProcess(key) {
            if (seen.has(key))
                return false;
            const tsSeconds = parseTsSeconds(key);
            if (tsSeconds !== null && now() - tsSeconds * 1000 > maxAgeMs)
                return false;
            seen.add(key);
            if (seen.size > maxEntries) {
                const oldest = seen.values().next().value;
                if (oldest !== undefined)
                    seen.delete(oldest);
            }
            return true;
        },
    };
}
