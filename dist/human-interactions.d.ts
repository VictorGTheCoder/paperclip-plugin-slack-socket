import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { InboundMessage, SlackGateway, SlackSocketConfig } from "./types.js";
export interface HumanInteractions {
    /** Returns true when a reply belongs to a linked Paperclip interaction. */
    tryHandleReply(msg: InboundMessage): Promise<boolean>;
}
export interface HumanInteractionsDeps {
    ctx: PluginContext;
    gateway: SlackGateway;
    getConfig: () => Promise<SlackSocketConfig>;
    companyId: string;
}
export declare function createHumanInteractions({ ctx, gateway, getConfig, companyId }: HumanInteractionsDeps): HumanInteractions;
