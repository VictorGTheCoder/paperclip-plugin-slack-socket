import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { SlackGateway, SlackSocketConfig } from "./types.js";
export interface NotificationDeps {
    ctx: PluginContext;
    gateway: SlackGateway;
    getConfig: () => Promise<SlackSocketConfig>;
    /**
     * The single company this worker process is bound to. The host runs one
     * worker per installed plugin shared across every company that configures
     * it, so every `ctx.events.on` subscription must be filtered server-side
     * to this company — otherwise this process would receive (and act on)
     * every other company's events too.
     */
    companyId: string;
}
export declare function registerNotifications({ ctx, gateway, getConfig, companyId }: NotificationDeps): void;
