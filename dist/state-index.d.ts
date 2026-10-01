import type { PluginContext } from "@paperclipai/plugin-sdk";
/**
 * Atomically (within this process) reads the string[] index stored at
 * `indexKey`, applies `updater` to it, writes the result back, and returns
 * it. Concurrent calls for the same `indexKey` are serialized so none of
 * them observe a stale pre-update value.
 */
export declare function updateIndex(ctx: PluginContext, indexKey: string, updater: (current: string[]) => string[]): Promise<string[]>;
