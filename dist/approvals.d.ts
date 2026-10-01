import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { InboundAction, SlackGateway, SlackSocketConfig } from "./types.js";
export interface ApprovalDeps {
    ctx: PluginContext;
    gateway: SlackGateway;
    getConfig: () => Promise<SlackSocketConfig>;
    /**
     * The single company this worker process is bound to — see the matching
     * comment on `NotificationDeps.companyId` in notifications.ts. The
     * `approval.created` and `approval.decided` subscriptions must both be
     * filtered to this company so a shared worker process never reacts to
     * another company's approvals.
     */
    companyId: string;
}
export interface Approvals {
    handleAction(action: InboundAction): Promise<void>;
}
export declare function createApprovals({ ctx, gateway, getConfig, companyId }: ApprovalDeps): Approvals;
