import type { PluginContext } from "@paperclipai/plugin-sdk";
import { STATE_KEYS, stateScope } from "./constants.js";
import { formatAgentRunFailed, formatIssueCreated, formatIssueDone, type SlackContent } from "./formatters.js";
import { getMessageLink, linkMessage, unlinkMessage } from "./message-link.js";
import { errString } from "./redact.js";
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

interface EventLike {
  entityId?: string;
  payload: unknown;
}

type NotificationType = "issue_created" | "issue_done" | "agent_run_failed";

interface IssueNotificationState {
  title?: string;
  identifier?: string;
  doneNotified: boolean;
}

const issueNotificationKey = (issueId: string) => `issue-notification:${issueId}`;

async function getIssueNotificationState(ctx: PluginContext, issueId: string): Promise<IssueNotificationState | null> {
  return ((await ctx.state.get(stateScope(issueNotificationKey(issueId)))) as IssueNotificationState | null) ?? null;
}

async function setIssueNotificationState(ctx: PluginContext, issueId: string, value: IssueNotificationState): Promise<void> {
  await ctx.state.set(stateScope(issueNotificationKey(issueId)), value);
}


export function registerNotifications({ ctx, gateway, getConfig, companyId }: NotificationDeps): void {
  const post = async (
    channel: string,
    content: SlackContent,
    type: NotificationType,
    threadTs?: string,
  ): Promise<{ channel: string; ts: string } | null> => {
    try {
      const posted = await gateway.postMessage({ channel, ...content, threadTs });
      await ctx.metrics.write("slack.notifications.sent", 1, { type }).catch(() => {});
      return posted;
    } catch (err) {
      ctx.logger.warn("Slack notification failed", { err: errString(err), channel });
      await ctx.metrics.write("slack.notifications.failed", 1, { type }).catch(() => {});
      return null;
    }
  };

  ctx.events.on("issue.created", { companyId }, async (event) => {
    const e = event as EventLike;
    const cfg = await getConfig();
    if (!cfg.notifyOnIssueCreated) return;
    const channel = cfg.issuesChannelId || cfg.defaultChannelId;
    if (!channel) return;
    const issueId = e.entityId ?? "";
    const posted = await post(
      channel,
      formatIssueCreated(e.payload as Record<string, unknown>, issueId, cfg.paperclipBaseUrl),
      "issue_created",
    );
    if (issueId) {
      const payload = e.payload as Record<string, unknown> | null;
      await setIssueNotificationState(ctx, issueId, {
        title: typeof payload?.title === "string" ? payload.title : undefined,
        identifier: typeof payload?.identifier === "string" ? payload.identifier : undefined,
        doneNotified: false,
      });
    }
    if (posted && issueId) {
      await linkMessage(ctx, STATE_KEYS.issueThreadIndex, STATE_KEYS.issueThread(issueId), posted);
    }
  });

  ctx.events.on("issue.updated", { companyId }, async (event) => {
    const e = event as EventLike;
    const cfg = await getConfig();
    if (!cfg.notifyOnIssueDone) return;
    const payload = e.payload as Record<string, unknown> | null;
    const issueId = e.entityId ?? "";
    if (!issueId) return;

    const previous = await getIssueNotificationState(ctx, issueId);
    let title = typeof payload?.title === "string" ? payload.title : previous?.title;
    let identifier = typeof payload?.identifier === "string" ? payload.identifier : previous?.identifier;
    // Existing issues may predate this plugin version/state entry and Paperclip's
    // issue.updated payload can be sparse. Enrich from the authoritative issue
    // before falling back to a UUID in Slack.
    if (!title || !identifier) {
      try {
        const current = await ctx.issues.get(issueId, companyId);
        title ||= current?.title || undefined;
        identifier ||= current?.identifier || undefined;
      } catch {
        // Notification remains best-effort; formatter still has safe fallbacks.
      }
    }

    // A real transition away from done arms the next completion notification.
    if (payload?.status !== "done") {
      if (typeof payload?.status === "string" && previous?.doneNotified) {
        await setIssueNotificationState(ctx, issueId, { title, identifier, doneNotified: false });
      } else if ((title || identifier) && (!previous || title !== previous.title || identifier !== previous.identifier)) {
        await setIssueNotificationState(ctx, issueId, { title, identifier, doneNotified: previous?.doneNotified ?? false });
      }
      return;
    }

    // issue.updated can be emitted repeatedly while the issue remains done.
    // Notify only once per actual done transition.
    if (previous?.doneNotified) return;

    const channel = cfg.issuesChannelId || cfg.defaultChannelId;
    if (!channel) return;
    const enrichedPayload = { ...(payload ?? {}), ...(title ? { title } : {}), ...(identifier ? { identifier } : {}) };
    const key = STATE_KEYS.issueThread(issueId);
    const entry = await getMessageLink(ctx, key);
    let posted = null;

    if (entry && entry.channel === channel) {
      posted = await post(channel, formatIssueDone(enrichedPayload, issueId, cfg.paperclipBaseUrl), "issue_done", entry.ts);
      if (posted) await unlinkMessage(ctx, STATE_KEYS.issueThreadIndex, key);
    } else {
      posted = await post(channel, formatIssueDone(enrichedPayload, issueId, cfg.paperclipBaseUrl), "issue_done");
    }
    if (posted) {
      await setIssueNotificationState(ctx, issueId, { title, identifier, doneNotified: true });
    }
  });

  ctx.events.on("agent.run.failed", { companyId }, async (event) => {
    const e = event as EventLike;
    const cfg = await getConfig();
    if (!cfg.notifyOnAgentRunFailed) return;
    const channel = cfg.errorsChannelId || cfg.defaultChannelId;
    if (!channel) return;
    await post(channel, formatAgentRunFailed(e.payload as Record<string, unknown>), "agent_run_failed");
  });
}
