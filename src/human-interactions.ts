import type { PluginContext } from "@paperclipai/plugin-sdk";
import { STATE_KEYS, stateScope } from "./constants.js";
import { escapeMrkdwn } from "./formatters.js";
import { errString } from "./redact.js";
import type { HumanInteractionMessageLink, InboundMessage, SlackGateway, SlackSocketConfig } from "./types.js";
import { updateIndex } from "./state-index.js";

const OBSERVER_INTERACTION_EVENT = "plugin.vgfx.tft-observer.human-review-interaction";
const ANSWER_OPTION_ID = "instruction";
const ANSWER_QUESTION_ID = "instruction";
const MAX_ANSWER_LENGTH = 4000;

interface HumanInteractionEvent {
  action?: "created" | "resolved" | "withdraw_requested";
  issue?: { id?: string; identifier?: string; title?: string };
  interaction?: {
    id?: string;
    issueId?: string;
    kind?: string;
    status?: string;
    resolverPolicy?: string;
    title?: string;
    summary?: string;
    payload?: {
      questions?: Array<{ id?: string; options?: Array<{ id?: string; freeText?: boolean }> }>;
    };
    result?: unknown;
  };
}

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

function interactionUrl(baseUrl: string, issueId: string, interactionId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(issueId)}/interactions/${encodeURIComponent(interactionId)}/respond`;
}

function issueUrl(baseUrl: string, issueId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(issueId)}`;
}

function withdrawUrl(baseUrl: string, issueId: string, interactionId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(issueId)}/interactions/${encodeURIComponent(interactionId)}/withdraw`;
}

function createdText(event: HumanInteractionEvent, baseUrl: string): string {
  const issue = event.issue ?? {};
  const interaction = event.interaction ?? {};
  const label = escapeMrkdwn(issue.identifier || issue.title || interaction.issueId || "TFT issue");
  const title = escapeMrkdwn(interaction.title || `${issue.identifier || "TFT issue"} requires human decision`);
  const summary = escapeMrkdwn(interaction.summary || "A review decision is required.");
  const issueLink = interaction.issueId
    ? `<${baseUrl.replace(/\/+$/, "")}/issues/${encodeURIComponent(interaction.issueId)}|${label}>`
    : `*${label}*`;
  return `:hand: *${title}*\n${issueLink}\n${summary}\nReply in this thread with the next instruction. The reply will resolve this Paperclip interaction.`;
}

function resolvedText(event: HumanInteractionEvent): string {
  const interaction = event.interaction ?? {};
  const issue = event.issue ?? {};
  const label = escapeMrkdwn(issue.identifier || issue.title || interaction.issueId || "TFT issue");
  const status = escapeMrkdwn(interaction.status || "resolved");
  return `:white_check_mark: *Human review interaction resolved elsewhere in Paperclip*\n${label} · ${status}`;
}

export function createHumanInteractions({ ctx, gateway, getConfig, companyId }: HumanInteractionsDeps): HumanInteractions {
  const posting = new Set<string>();
  const resolving = new Set<string>();
  const earlyResolutionEvents = new Map<string, HumanInteractionEvent>();

  async function handleCreated(event: HumanInteractionEvent): Promise<void> {
    const interaction = event.interaction;
    const issue = event.issue;
    const id = typeof interaction?.id === "string" ? interaction.id : "";
    const issueId = typeof interaction?.issueId === "string" ? interaction.issueId : "";
    if (!id || !issueId
        || interaction?.kind !== "ask_user_questions"
        || interaction?.resolverPolicy !== "human_only"
        || interaction?.status !== "pending") return;

    const key = STATE_KEYS.humanInteractionMessage(id);
    if (await ctx.state.get(stateScope(key)) || posting.has(id)) return;
    posting.add(id);
    try {
      const cfg = await getConfig();
      const channel = cfg.humanEscalationsChannelId || cfg.defaultChannelId;
      if (!channel) throw new Error("No human escalation Slack channel is configured");
      const posted = await gateway.postMessage({ channel, text: createdText(event, cfg.paperclipBaseUrl) });
      const question = interaction.payload?.questions?.find((entry) =>
        entry.options?.some((candidate) => candidate.freeText));
      const option = question?.options?.find((entry) => entry.freeText);
      const link: HumanInteractionMessageLink = {
        channel: posted.channel,
        ts: posted.ts,
        createdAt: new Date().toISOString(),
        interactionId: id,
        issueId,
        issueIdentifier: typeof issue?.identifier === "string" ? issue.identifier : issueId,
        questionId: question?.id || ANSWER_QUESTION_ID,
        optionId: option?.id || ANSWER_OPTION_ID,
        title: interaction.title || "Human review decision",
        summary: interaction.summary || "",
      };
      await ctx.state.set(stateScope(key), link);
      await updateIndex(ctx, STATE_KEYS.humanInteractionIndex, (current) =>
        current.includes(key) ? current : [...current, key]);
      await ctx.metrics.write("slack.notifications.sent", 1, { type: "human_interaction_created" }).catch(() => {});
      const resolvedBeforeLink = earlyResolutionEvents.get(id);
      if (resolvedBeforeLink) {
        earlyResolutionEvents.delete(id);
        await handleResolved(resolvedBeforeLink);
      }
    } catch (err) {
      ctx.logger.error("Slack human interaction notification failed", {
        err: errString(err),
        interactionId: id,
        issueId,
      });
      await ctx.metrics.write("slack.notifications.failed", 1, { type: "human_interaction_created" }).catch(() => {});
    } finally {
      posting.delete(id);
    }
  }

  async function handleResolved(event: HumanInteractionEvent): Promise<void> {
    const id = typeof event.interaction?.id === "string" ? event.interaction.id : "";
    if (!id) return;
    const key = STATE_KEYS.humanInteractionMessage(id);
    const link = await ctx.state.get(stateScope(key)) as HumanInteractionMessageLink | null;
    if (!link) {
      if (posting.has(id)) earlyResolutionEvents.set(id, event);
      return;
    }
    try {
      await gateway.updateMessage({ channel: link.channel, ts: link.ts, text: resolvedText(event) });
      await ctx.metrics.write("slack.notifications.sent", 1, { type: "human_interaction_resolved" }).catch(() => {});
      await ctx.state.delete(stateScope(key));
      await updateIndex(ctx, STATE_KEYS.humanInteractionIndex, (current) => current.filter((entry) => entry !== key));
    } catch (err) {
      ctx.logger.warn("Slack human interaction resolution sync failed", {
        err: errString(err),
        interactionId: id,
      });
      await ctx.metrics.write("slack.notifications.failed", 1, { type: "human_interaction_resolved" }).catch(() => {});
    }
  }

  async function handleWithdrawRequested(event: HumanInteractionEvent): Promise<void> {
    const interaction = event.interaction;
    const id = typeof interaction?.id === "string" ? interaction.id : "";
    const issueId = typeof interaction?.issueId === "string" ? interaction.issueId : "";
    if (!id || !issueId) return;
    const key = STATE_KEYS.humanInteractionMessage(id);
    const link = await ctx.state.get(stateScope(key)) as HumanInteractionMessageLink | null;
    if (link?.withdrawalStatus === "withdrawn" || link?.withdrawalStatus === "failed") {
      await ctx.events.emit("human-interaction-withdrawn", companyId, {
        issueId, withdrawalStatus: link.withdrawalStatus,
        interaction: { id, issueId, status: link.withdrawalStatus === "withdrawn" ? "expired" : "pending" },
      });
      return;
    }
    const cfg = await getConfig();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.paperclipApiKeyRef) {
      const apiKey = await ctx.secrets.resolve(cfg.paperclipApiKeyRef, { companyId: cfg.companyId });
      headers.Authorization = `Bearer ${apiKey}`;
    }
    let withdrawalStatus: "withdrawn" | "failed" = "withdrawn";
    let remoteStatus = "expired";
    try {
      const response = await ctx.http.fetch(withdrawUrl(cfg.paperclipBaseUrl, issueId, id), {
        method: "POST", headers, body: JSON.stringify({ reason: "The issue no longer has a pending human review stage." }),
      });
      if (response.status < 200 || response.status >= 300) {
        if (response.status !== 404 && response.status !== 409) throw new Error(`Paperclip interaction withdrawal returned HTTP ${response.status}`);
        const listResponse = await ctx.http.fetch(`${cfg.paperclipBaseUrl.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(issueId)}/interactions`, { headers });
        if (listResponse.status < 200 || listResponse.status >= 300) throw new Error(`Paperclip interaction read returned HTTP ${listResponse.status}`);
        const listPayload = await listResponse.json() as { interactions?: Array<{ id?: string; status?: string }> } | Array<{ id?: string; status?: string }>;
        const list = Array.isArray(listPayload) ? listPayload : listPayload.interactions || [];
        const current = list.find((entry) => entry.id === id);
        if (current?.status === "pending") throw new Error(`Paperclip interaction remains pending after HTTP ${response.status}`);
        remoteStatus = current?.status || "expired";
      }
    } catch (err) {
      withdrawalStatus = "failed";
      remoteStatus = "pending";
      ctx.logger.error("Paperclip human interaction withdrawal failed", { err: errString(err), interactionId: id });
      await ctx.metrics.write("slack.interactions.failed", 1, { source: "withdrawal" }).catch(() => {});
    }
    if (link) {
      const text = withdrawalStatus === "withdrawn"
        ? `:white_check_mark: *Human review request withdrawn in Paperclip*\n${escapeMrkdwn(link.issueIdentifier)}`
        : `:warning: *Paperclip could not withdraw this human review request*\n${escapeMrkdwn(link.issueIdentifier)}. Please resolve it in Paperclip.`;
      await gateway.updateMessage({ channel: link.channel, ts: link.ts, text }).catch(() => {});
      const tombstone = { ...link, withdrawalStatus };
      await ctx.state.set(stateScope(key), tombstone);
      await updateIndex(ctx, STATE_KEYS.humanInteractionIndex, (current) => current.filter((entry) => entry !== key));
    }
    await ctx.events.emit("human-interaction-withdrawn", companyId, {
      issueId, withdrawalStatus,
      interaction: { id, issueId, status: remoteStatus },
    });
  }

  ctx.events.on(OBSERVER_INTERACTION_EVENT, { companyId }, async (rawEvent) => {
    const payload = (rawEvent as { payload?: HumanInteractionEvent }).payload ?? {};
    if (payload.action === "created") await handleCreated(payload);
    else if (payload.action === "resolved") await handleResolved(payload);
    else if (payload.action === "withdraw_requested") await handleWithdrawRequested(payload);
  });

  return {
    async tryHandleReply(msg) {
      if (!msg.threadTs) return false;
      const index = await ctx.state.get(stateScope(STATE_KEYS.humanInteractionIndex)) as string[] | null;
      for (const key of index ?? []) {
        const link = await ctx.state.get(stateScope(key)) as HumanInteractionMessageLink | null;
        if (!link || link.channel !== msg.channel || link.ts !== msg.threadTs) continue;
        if (resolving.has(link.interactionId)) return true;
        resolving.add(link.interactionId);
        try {
          const cfg = await getConfig();
          if (!cfg.humanEscalationAllowedSlackUserIds.includes(msg.user)) {
            await gateway.postEphemeral({
              channel: msg.channel, user: msg.user,
              text: "You are not authorized to answer TFT human review escalations. Contact the configured review owner.",
            });
            return true;
          }
          const answer = msg.text.trim().slice(0, MAX_ANSWER_LENGTH);
          if (!answer) {
            await gateway.postEphemeral({
              channel: msg.channel,
              user: msg.user,
              text: "Please reply with a non-empty instruction for this TFT review interaction.",
            });
            return true;
          }
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (cfg.paperclipApiKeyRef) {
            const apiKey = await ctx.secrets.resolve(cfg.paperclipApiKeyRef, { companyId: cfg.companyId });
            headers.Authorization = `Bearer ${apiKey}`;
          }
          const savedAnswer = link.answerText || answer;
          const savedLink = { ...link, answerText: savedAnswer };
          await ctx.state.set(stateScope(key), savedLink);
          if (!savedLink.answerRecorded) {
            let alreadyAnswered = false;
            if (link.answerText) {
              const listResponse = await ctx.http.fetch(`${cfg.paperclipBaseUrl.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(link.issueId)}/interactions`, { headers });
              if (listResponse.status < 200 || listResponse.status >= 300) throw new Error(`Paperclip interaction read returned HTTP ${listResponse.status}`);
              const listPayload = await listResponse.json() as { interactions?: Array<{ id?: string; status?: string }> } | Array<{ id?: string; status?: string }>;
              const interactions = Array.isArray(listPayload) ? listPayload : listPayload.interactions || [];
              alreadyAnswered = interactions.some((entry) => entry.id === link.interactionId && entry.status !== "pending");
            }
            if (!alreadyAnswered) {
              const response = await ctx.http.fetch(interactionUrl(cfg.paperclipBaseUrl, link.issueId, link.interactionId), {
                method: "POST", headers,
                body: JSON.stringify({ answers: [{ questionId: link.questionId, optionIds: [link.optionId], otherText: savedAnswer }] }),
              });
              if (response.status < 200 || response.status >= 300) {
                throw new Error(`Paperclip interaction response returned HTTP ${response.status}`);
              }
            }
            savedLink.answerRecorded = true;
            await ctx.state.set(stateScope(key), savedLink);
          }

          let continued = savedLink.nativeReviewContinued === true;
          if (!continued) {
            const issueResponse = await ctx.http.fetch(issueUrl(cfg.paperclipBaseUrl, link.issueId), { headers });
            if (issueResponse.status < 200 || issueResponse.status >= 300) throw new Error(`Paperclip issue read returned HTTP ${issueResponse.status}`);
            const issue = await issueResponse.json() as { status?: string; executionState?: { status?: string; currentStageType?: string; currentParticipant?: { type?: string } } };
            const stage = issue.executionState;
            if (issue.status === "in_review" && stage?.status === "pending" && stage.currentStageType === "review" && stage.currentParticipant?.type === "user") {
              const transition = await ctx.http.fetch(issueUrl(cfg.paperclipBaseUrl, link.issueId), {
                method: "PATCH", headers,
                body: JSON.stringify({ status: "in_progress", comment: `Human review instruction: ${savedAnswer}` }),
              });
              if (transition.status < 200 || transition.status >= 300) throw new Error(`Paperclip native review continuation returned HTTP ${transition.status}`);
              continued = true;
            } else if (issue.status === "in_progress" && issue.executionState?.status === "changes_requested") {
              continued = true;
            }
            if (continued) {
              savedLink.nativeReviewContinued = true;
              await ctx.state.set(stateScope(key), savedLink);
            }
          }

          try {
            await gateway.updateMessage({
              channel: link.channel,
              ts: link.ts,
              text: `:white_check_mark: *Human review instruction recorded${continued ? "; native review returned to owner" : "; native review decision still pending"}*\n${escapeMrkdwn(link.issueIdentifier)}\n_${escapeMrkdwn(savedAnswer)}_`,
            });
            if (continued) {
              await ctx.state.delete(stateScope(key));
              await updateIndex(ctx, STATE_KEYS.humanInteractionIndex, (current) => current.filter((entry) => entry !== key));
            }
          } catch (err) {
            ctx.logger.warn("Paperclip interaction was answered but Slack message update failed", {
              err: errString(err),
              interactionId: link.interactionId,
            });
            await ctx.metrics.write("slack.notifications.failed", 1, { type: "human_interaction_resolved" }).catch(() => {});
          }

          try {
            await ctx.events.emit("human-interaction-answered", cfg.companyId, {
              issueId: link.issueId,
              interactionId: link.interactionId,
              answer: savedAnswer,
              responderUserId: msg.user,
            });
          } catch (err) {
            ctx.logger.warn("Paperclip interaction was answered but Observer handoff event failed", {
              err: errString(err),
              interactionId: link.interactionId,
            });
          }
          await ctx.metrics.write("slack.interactions.answered", 1, { source: "slack_thread", nativeReviewContinued: continued ? "true" : "false" }).catch(() => {});
          return true;
        } catch (err) {
          ctx.logger.warn("Failed to answer Paperclip human interaction from Slack", {
            err: errString(err),
            interactionId: link.interactionId,
          });
          await ctx.metrics.write("slack.interactions.failed", 1, { source: "slack_thread" }).catch(() => {});
          await gateway.postEphemeral({
            channel: msg.channel,
            user: msg.user,
            text: `Could not record this instruction in Paperclip: ${errString(err)}`,
          }).catch(() => {});
          return true;
        } finally {
          resolving.delete(link.interactionId);
        }
      }
      return false;
    },
  };
}
