import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { SlackGateway, SlackSocketConfig } from "./types.js";
export declare function runCleanup(ctx: PluginContext, gateway: SlackGateway, cfg: SlackSocketConfig): Promise<void>;
