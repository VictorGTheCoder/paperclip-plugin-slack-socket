import { describe, expect, it, vi } from "vitest";
import { createHumanInteractions } from "../src/human-interactions.js";
import { STATE_KEYS } from "../src/constants.js";
import { FakeGateway, makeCtx, TEST_CONFIG } from "./helpers.js";

const eventName = "plugin.vgfx.tft-observer.human-review-interaction";

function setup(configOverrides = {}) {
  const bundle = makeCtx(configOverrides);
  const gateway = new FakeGateway();
  const humanInteractions = createHumanInteractions({
    ctx: bundle.ctx,
    gateway,
    getConfig: async () => ({ ...TEST_CONFIG, ...configOverrides }),
    companyId: TEST_CONFIG.companyId,
  });
  return { ...bundle, gateway, humanInteractions };
}

const created = {
  action: "created" as const,
  issue: { id: "issue-1", identifier: "TFT-215", title: "Review escalation" },
  interaction: {
    id: "interaction-1",
    issueId: "issue-1",
    kind: "ask_user_questions",
    status: "pending",
    resolverPolicy: "human_only",
    title: "TFT-215 requires human decision",
    summary: "PR #305; head abc123. Latest blocker: structural legality.",
    payload: {
      questions: [{
        id: "instruction",
        options: [{ id: "instruction", freeText: true }],
      }],
    },
  },
};

describe("TFT Paperclip human interactions", () => {
  it("subscribes to Observer interaction events for the configured company", () => {
    const { ctx } = setup();
    expect(ctx.events.on).toHaveBeenCalledWith(eventName, { companyId: TEST_CONFIG.companyId }, expect.any(Function));
  });

  it("posts one linked Slack message when repeated create events are delivered", async () => {
    const { emitEvent, gateway, stateStore } = setup({ humanEscalationsChannelId: "C-TFT-ESCALATIONS" });
    for (let i = 0; i < 10; i += 1) {
      await emitEvent(eventName, { payload: created });
    }
    expect(gateway.posts).toHaveLength(1);
    expect(gateway.posts[0]!.channel).toBe("C-TFT-ESCALATIONS");
    expect(gateway.posts[0]!.text).toContain("TFT-215 requires human decision");
    expect(gateway.posts[0]!.text).toContain("Reply in this thread");
    expect(stateStore.get(STATE_KEYS.humanInteractionMessage("interaction-1"))).toMatchObject({
      channel: "C-TFT-ESCALATIONS",
      interactionId: "interaction-1",
      issueId: "issue-1",
      ts: gateway.posts[0]!.ts,
    });
  });

  it("records notification failures and retries on a later create event", async () => {
    const { ctx, emitEvent, gateway } = setup();
    gateway.postMessage = vi.fn().mockRejectedValueOnce(new Error("Slack is unavailable"))
      .mockResolvedValueOnce({ channel: "C-DEFAULT", ts: "1700000000.000001" });

    await emitEvent(eventName, { payload: created });
    expect(ctx.metrics.write).toHaveBeenCalledWith("slack.notifications.failed", 1, { type: "human_interaction_created" });
    expect(gateway.posts).toHaveLength(0);

    await emitEvent(eventName, { payload: created });
    expect(gateway.postMessage).toHaveBeenCalledTimes(2);
  });

  it("marks a linked Slack message resolved elsewhere and removes its index entry", async () => {
    const { emitEvent, gateway, stateStore } = setup();
    await emitEvent(eventName, { payload: created });
    await emitEvent(eventName, { payload: {
      ...created,
      action: "resolved",
      interaction: { ...created.interaction, status: "answered" },
    } });

    expect(gateway.updates[0]!.text).toContain("resolved");
    expect(stateStore.has(STATE_KEYS.humanInteractionMessage("interaction-1"))).toBe(false);
    expect(stateStore.get(STATE_KEYS.humanInteractionIndex)).toEqual([]);
  });

  it("answers the same Paperclip interaction from its Slack thread and emits a handoff event", async () => {
    const { ctx, emitEvent, gateway, humanInteractions, stateStore } = setup({ paperclipApiKeyRef: "board-key" });
    await emitEvent(eventName, { payload: created });
    const parentTs = gateway.posts[0]!.ts;

    const handled = await humanInteractions.tryHandleReply({
      channel: gateway.posts[0]!.channel,
      channelType: "channel",
      user: "U-VICTOR",
      text: "Make the legality rule structural and rerun review.",
      ts: "1700000001.000001",
      threadTs: parentTs,
    });

    expect(handled).toBe(true);
    expect(ctx.secrets.resolve).toHaveBeenCalledWith("board-key", { companyId: TEST_CONFIG.companyId });
    expect(ctx.http.fetch).toHaveBeenCalledWith(
      "https://pc.example/api/issues/issue-1/interactions/interaction-1/respond",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer secret-board-key" }) }),
    );
    const request = (ctx.http.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      answers: [{
        questionId: "instruction",
        optionIds: ["instruction"],
        otherText: "Make the legality rule structural and rerun review.",
      }],
    });
    expect(gateway.updates[0]!.text).toContain("Human review instruction recorded");
    expect(stateStore.has(STATE_KEYS.humanInteractionMessage("interaction-1"))).toBe(false);
    expect(ctx.events.emit).toHaveBeenCalledWith("human-interaction-answered", TEST_CONFIG.companyId, expect.objectContaining({
      issueId: "issue-1",
      interactionId: "interaction-1",
      answer: "Make the legality rule structural and rerun review.",
    }));
  });

  it("retains the Slack mapping after a failed Paperclip response so the user can retry", async () => {
    const { ctx, emitEvent, gateway, humanInteractions, stateStore } = setup();
    await emitEvent(eventName, { payload: created });
    (ctx.http.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 500, json: async () => ({}) });
    const parentTs = gateway.posts[0]!.ts;

    await humanInteractions.tryHandleReply({
      channel: gateway.posts[0]!.channel,
      channelType: "channel",
      user: "U-VICTOR",
      text: "Continue",
      ts: "1700000001.000001",
      threadTs: parentTs,
    });

    expect(stateStore.has(STATE_KEYS.humanInteractionMessage("interaction-1"))).toBe(true);
    expect(gateway.ephemerals[0]!.text).toContain("Could not record this instruction in Paperclip");
    expect(ctx.metrics.write).toHaveBeenCalledWith("slack.interactions.failed", 1, { source: "slack_thread" });
  });
});
