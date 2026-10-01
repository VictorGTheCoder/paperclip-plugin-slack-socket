import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { InboundMessage, InboundReaction, SlackGateway, SlackSocketConfig } from "./types.js";
export interface AskHumanDeps {
    ctx: PluginContext;
    gateway: SlackGateway;
    getConfig: () => Promise<SlackSocketConfig>;
}
export interface AskHuman {
    registerTool(): void;
    /** Returns true when the message was an answer to a pending question (callers must stop routing it). */
    tryHandleAnswer(msg: InboundMessage): Promise<boolean>;
    handleReaction(reaction: InboundReaction): Promise<void>;
}
export declare function createAskHuman({ ctx, gateway, getConfig }: AskHumanDeps): AskHuman;
