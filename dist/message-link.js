import { stateScope } from "./constants.js";
import { updateIndex } from "./state-index.js";
/**
 * Records that `posted` is the Slack message representing `key`'s entity and
 * adds `key` to `indexKey`'s membership list so the cleanup job can find it.
 */
export async function linkMessage(ctx, indexKey, key, posted) {
    const entry = {
        channel: posted.channel,
        ts: posted.ts,
        createdAt: new Date().toISOString(),
    };
    await ctx.state.set(stateScope(key), entry);
    await updateIndex(ctx, indexKey, (current) => (current.includes(key) ? current : [...current, key]));
}
/** The Slack message linked to `key`, or null when nothing is linked. */
export async function getMessageLink(ctx, key) {
    return (await ctx.state.get(stateScope(key))) ?? null;
}
/** Drops the link for `key` and its index membership. */
export async function unlinkMessage(ctx, indexKey, key) {
    await ctx.state.delete(stateScope(key));
    await updateIndex(ctx, indexKey, (current) => current.filter((k) => k !== key));
}
/**
 * Deletes links older than `maxAgeMs` and drops index keys whose link has
 * already vanished. `now` is injected so one cleanup pass shares a single
 * clock reading across every index it prunes.
 */
export async function pruneMessageLinks(ctx, indexKey, maxAgeMs, now) {
    const index = (await ctx.state.get(stateScope(indexKey))) ?? [];
    const removed = [];
    for (const key of index) {
        const entry = (await ctx.state.get(stateScope(key)));
        if (!entry) {
            removed.push(key);
            continue;
        }
        if (now - Date.parse(entry.createdAt) > maxAgeMs) {
            await ctx.state.delete(stateScope(key));
            removed.push(key);
        }
    }
    // Filter the freshly-read index rather than writing `index` back, so a key
    // appended while we were iterating survives.
    await updateIndex(ctx, indexKey, (current) => current.filter((k) => !removed.includes(k)));
}
