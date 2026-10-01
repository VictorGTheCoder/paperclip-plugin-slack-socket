import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { MessageLink } from "./types.js";
export type { MessageLink };
/**
 * Records that `posted` is the Slack message representing `key`'s entity and
 * adds `key` to `indexKey`'s membership list so the cleanup job can find it.
 */
export declare function linkMessage(ctx: PluginContext, indexKey: string, key: string, posted: {
    channel: string;
    ts: string;
}): Promise<void>;
/** The Slack message linked to `key`, or null when nothing is linked. */
export declare function getMessageLink(ctx: PluginContext, key: string): Promise<MessageLink | null>;
/** Drops the link for `key` and its index membership. */
export declare function unlinkMessage(ctx: PluginContext, indexKey: string, key: string): Promise<void>;
/**
 * Deletes links older than `maxAgeMs` and drops index keys whose link has
 * already vanished. `now` is injected so one cleanup pass shares a single
 * clock reading across every index it prunes.
 */
export declare function pruneMessageLinks(ctx: PluginContext, indexKey: string, maxAgeMs: number, now: number): Promise<void>;
