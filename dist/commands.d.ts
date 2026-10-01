import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { InboundCommand, SlackGateway, SlackSocketConfig } from "./types.js";
export interface CommandDeps {
    ctx: PluginContext;
    gateway: SlackGateway;
    getConfig: () => Promise<SlackSocketConfig>;
}
export interface Commands {
    handleCommand(cmd: InboundCommand): Promise<void>;
}
export declare function createCommands({ ctx, gateway, getConfig }: CommandDeps): Commands;
