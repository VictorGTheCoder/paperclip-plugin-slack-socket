import { stateScope } from "./constants.js";
// Per-process chain of pending updates, keyed by the index's state key. Each
// call is appended to the chain for its key so updates run strictly in
// order: read current -> derive next -> write next, with no interleaving.
const chains = new Map();
/**
 * Atomically (within this process) reads the string[] index stored at
 * `indexKey`, applies `updater` to it, writes the result back, and returns
 * it. Concurrent calls for the same `indexKey` are serialized so none of
 * them observe a stale pre-update value.
 */
export async function updateIndex(ctx, indexKey, updater) {
    const previous = chains.get(indexKey) ?? Promise.resolve();
    let result;
    const next = previous.catch(() => { }).then(async () => {
        const current = (await ctx.state.get(stateScope(indexKey))) ?? [];
        result = updater(current);
        await ctx.state.set(stateScope(indexKey), result);
    });
    chains.set(indexKey, next);
    await next;
    return result;
}
