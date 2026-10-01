import { STATE_KEYS, stateScope } from "./constants.js";
import { escapeMrkdwn } from "./formatters.js";
import { errString } from "./redact.js";
import { updateIndex } from "./state-index.js";
const OBSERVER_INTERACTION_EVENT = "plugin.vgfx.tft-observer.human-review-interaction";
const ANSWER_OPTION_ID = "instruction";
const ANSWER_QUESTION_ID = "instruction";
const MAX_ANSWER_LENGTH = 4000;
function interactionUrl(baseUrl, issueId, interactionId) {
    return `${baseUrl.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(issueId)}/interactions/${encodeURIComponent(interactionId)}/respond`;
}
function createdText(event, baseUrl) {
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
function resolvedText(event) {
    const interaction = event.interaction ?? {};
    const issue = event.issue ?? {};
    const label = escapeMrkdwn(issue.identifier || issue.title || interaction.issueId || "TFT issue");
    const status = escapeMrkdwn(interaction.status || "resolved");
    return `:white_check_mark: *Human review interaction resolved elsewhere in Paperclip*\n${label} · ${status}`;
}
export function createHumanInteractions({ ctx, gateway, getConfig, companyId }) {
    const posting = new Set();
    const resolving = new Set();
    const earlyResolutionEvents = new Map();
    async function handleCreated(event) {
        const interaction = event.interaction;
        const issue = event.issue;
        const id = typeof interaction?.id === "string" ? interaction.id : "";
        const issueId = typeof interaction?.issueId === "string" ? interaction.issueId : "";
        if (!id || !issueId
            || interaction?.kind !== "ask_user_questions"
            || interaction?.resolverPolicy !== "human_only"
            || interaction?.status !== "pending")
            return;
        const key = STATE_KEYS.humanInteractionMessage(id);
        if (await ctx.state.get(stateScope(key)) || posting.has(id))
            return;
        posting.add(id);
        try {
            const cfg = await getConfig();
            const channel = cfg.humanEscalationsChannelId || cfg.defaultChannelId;
            if (!channel)
                throw new Error("No human escalation Slack channel is configured");
            const posted = await gateway.postMessage({ channel, text: createdText(event, cfg.paperclipBaseUrl) });
            const question = interaction.payload?.questions?.find((entry) => entry.options?.some((candidate) => candidate.freeText));
            const option = question?.options?.find((entry) => entry.freeText);
            const link = {
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
            await updateIndex(ctx, STATE_KEYS.humanInteractionIndex, (current) => current.includes(key) ? current : [...current, key]);
            await ctx.metrics.write("slack.notifications.sent", 1, { type: "human_interaction_created" }).catch(() => { });
            const resolvedBeforeLink = earlyResolutionEvents.get(id);
            if (resolvedBeforeLink) {
                earlyResolutionEvents.delete(id);
                await handleResolved(resolvedBeforeLink);
            }
        }
        catch (err) {
            ctx.logger.error("Slack human interaction notification failed", {
                err: errString(err),
                interactionId: id,
                issueId,
            });
            await ctx.metrics.write("slack.notifications.failed", 1, { type: "human_interaction_created" }).catch(() => { });
        }
        finally {
            posting.delete(id);
        }
    }
    async function handleResolved(event) {
        const id = typeof event.interaction?.id === "string" ? event.interaction.id : "";
        if (!id)
            return;
        const key = STATE_KEYS.humanInteractionMessage(id);
        const link = await ctx.state.get(stateScope(key));
        if (!link) {
            if (posting.has(id))
                earlyResolutionEvents.set(id, event);
            return;
        }
        try {
            await gateway.updateMessage({ channel: link.channel, ts: link.ts, text: resolvedText(event) });
            await ctx.metrics.write("slack.notifications.sent", 1, { type: "human_interaction_resolved" }).catch(() => { });
            await ctx.state.delete(stateScope(key));
            await updateIndex(ctx, STATE_KEYS.humanInteractionIndex, (current) => current.filter((entry) => entry !== key));
        }
        catch (err) {
            ctx.logger.warn("Slack human interaction resolution sync failed", {
                err: errString(err),
                interactionId: id,
            });
            await ctx.metrics.write("slack.notifications.failed", 1, { type: "human_interaction_resolved" }).catch(() => { });
        }
    }
    ctx.events.on(OBSERVER_INTERACTION_EVENT, { companyId }, async (rawEvent) => {
        const payload = rawEvent.payload ?? {};
        if (payload.action === "created")
            await handleCreated(payload);
        else if (payload.action === "resolved")
            await handleResolved(payload);
    });
    return {
        async tryHandleReply(msg) {
            if (!msg.threadTs)
                return false;
            const index = await ctx.state.get(stateScope(STATE_KEYS.humanInteractionIndex));
            for (const key of index ?? []) {
                const link = await ctx.state.get(stateScope(key));
                if (!link || link.channel !== msg.channel || link.ts !== msg.threadTs)
                    continue;
                if (resolving.has(link.interactionId))
                    return true;
                resolving.add(link.interactionId);
                try {
                    const answer = msg.text.trim().slice(0, MAX_ANSWER_LENGTH);
                    if (!answer) {
                        await gateway.postEphemeral({
                            channel: msg.channel,
                            user: msg.user,
                            text: "Please reply with a non-empty instruction for this TFT review interaction.",
                        });
                        return true;
                    }
                    const cfg = await getConfig();
                    const headers = { "Content-Type": "application/json" };
                    if (cfg.paperclipApiKeyRef) {
                        const apiKey = await ctx.secrets.resolve(cfg.paperclipApiKeyRef, { companyId: cfg.companyId });
                        headers.Authorization = `Bearer ${apiKey}`;
                    }
                    const response = await ctx.http.fetch(interactionUrl(cfg.paperclipBaseUrl, link.issueId, link.interactionId), {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            answers: [{
                                    questionId: link.questionId,
                                    optionIds: [link.optionId],
                                    otherText: answer,
                                }],
                        }),
                    });
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`Paperclip interaction response returned HTTP ${response.status}`);
                    }
                    try {
                        await gateway.updateMessage({
                            channel: link.channel,
                            ts: link.ts,
                            text: `:white_check_mark: *Human review instruction recorded*\n${escapeMrkdwn(link.issueIdentifier)}\n_${escapeMrkdwn(answer)}_`,
                        });
                        await ctx.state.delete(stateScope(key));
                        await updateIndex(ctx, STATE_KEYS.humanInteractionIndex, (current) => current.filter((entry) => entry !== key));
                    }
                    catch (err) {
                        ctx.logger.warn("Paperclip interaction was answered but Slack message update failed", {
                            err: errString(err),
                            interactionId: link.interactionId,
                        });
                        await ctx.metrics.write("slack.notifications.failed", 1, { type: "human_interaction_resolved" }).catch(() => { });
                    }
                    try {
                        await ctx.events.emit("human-interaction-answered", cfg.companyId, {
                            issueId: link.issueId,
                            interactionId: link.interactionId,
                            answer,
                            responderUserId: msg.user,
                        });
                    }
                    catch (err) {
                        ctx.logger.warn("Paperclip interaction was answered but Observer handoff event failed", {
                            err: errString(err),
                            interactionId: link.interactionId,
                        });
                    }
                    await ctx.metrics.write("slack.interactions.answered", 1, { source: "slack_thread" }).catch(() => { });
                    return true;
                }
                catch (err) {
                    ctx.logger.warn("Failed to answer Paperclip human interaction from Slack", {
                        err: errString(err),
                        interactionId: link.interactionId,
                    });
                    await ctx.metrics.write("slack.interactions.failed", 1, { source: "slack_thread" }).catch(() => { });
                    await gateway.postEphemeral({
                        channel: msg.channel,
                        user: msg.user,
                        text: `Could not record this instruction in Paperclip: ${errString(err)}`,
                    }).catch(() => { });
                    return true;
                }
                finally {
                    resolving.delete(link.interactionId);
                }
            }
            return false;
        },
    };
}
