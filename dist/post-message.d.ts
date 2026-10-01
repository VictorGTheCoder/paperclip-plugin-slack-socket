import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { SlackGateway, SlackSocketConfig } from "./types.js";
export interface PostMessageDeps {
    ctx: PluginContext;
    gateway: SlackGateway;
    getConfig: () => Promise<SlackSocketConfig>;
}
export interface PostMessage {
    registerTool(): void;
}
export declare function createPostMessage({ ctx, gateway, getConfig }: PostMessageDeps): PostMessage;
