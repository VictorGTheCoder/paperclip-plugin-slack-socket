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

  it("withdraws the Paperclip interaction through its canonical API and acknowledges Observer", async () => {
    const { ctx, emitEvent, gateway, stateStore } = setup({ paperclipApiKeyRef: "board-key" });
    await emitEvent(eventName, { payload: created });
    await emitEvent(eventName, { payload: { ...created, action: "withdraw_requested" } });
    expect(ctx.http.fetch).toHaveBeenCalledWith(
      "https://pc.example/api/issues/issue-1/interactions/interaction-1/withdraw",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer secret-board-key" }) }),
    );
    expect(gateway.updates.at(-1)!.text).toContain("withdrawn in Paperclip");
    expect(stateStore.get(STATE_KEYS.humanInteractionMessage("interaction-1"))).toMatchObject({ withdrawalStatus: "withdrawn" });
    expect(ctx.events.emit).toHaveBeenCalledWith("human-interaction-withdrawn", TEST_CONFIG.companyId, expect.objectContaining({
      issueId: "issue-1", withdrawalStatus: "withdrawn", interaction: expect.objectContaining({ status: "expired" }),
    }));
    await emitEvent(eventName, { payload: { ...created, action: "withdraw_requested" } });
    expect(ctx.http.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed remote withdrawal observable without claiming the interaction was closed", async () => {
    const { ctx, emitEvent, gateway, stateStore } = setup({ paperclipApiKeyRef: "board-key" });
    await emitEvent(eventName, { payload: created });
    (ctx.http.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 403, json: async () => ({}) });
    await emitEvent(eventName, { payload: { ...created, action: "withdraw_requested" } });
    expect(stateStore.get(STATE_KEYS.humanInteractionMessage("interaction-1"))).toMatchObject({ withdrawalStatus: "failed" });
    expect(gateway.updates.at(-1)!.text).toContain("could not withdraw");
    expect(ctx.events.emit).toHaveBeenCalledWith("human-interaction-withdrawn", TEST_CONFIG.companyId, expect.objectContaining({
      withdrawalStatus: "failed", interaction: expect.objectContaining({ status: "pending" }),
    }));
  });

  it("answers the same Paperclip interaction from its Slack thread and emits a handoff event", async () => {
    const { ctx, emitEvent, gateway, humanInteractions, stateStore } = setup({
      paperclipApiKeyRef: "board-key",
      humanEscalationAllowedSlackUserIds: ["U-VICTOR"],
    });
    const durableIssue: {
      status: string;
      assigneeUserId: string | null;
      assigneeAgentId: string | null;
      executionState: {
        status: string;
        currentStageType: string;
        currentParticipant: { type: string; userId?: string; agentId?: string };
        returnAssignee: { type: string; agentId: string };
        changesRequestedCount: number;
      };
    } = {
      status: "in_review",
      assigneeUserId: "U-VICTOR",
      assigneeAgentId: null as string | null,
      executionState: {
        status: "pending", currentStageType: "review",
        currentParticipant: { type: "user", userId: "U-VICTOR" },
        returnAssignee: { type: "agent", agentId: "engineer-a" },
        changesRequestedCount: 6,
      },
    };
    (ctx.http.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/respond")) return { status: 200, json: async () => ({}) };
      if (init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({ status: "in_progress", comment: "Human review instruction: Make the legality rule structural and rerun review." });
        durableIssue.status = "in_progress";
        durableIssue.assigneeAgentId = "engineer-a";
        durableIssue.assigneeUserId = null;
        durableIssue.executionState = {
          ...durableIssue.executionState,
          status: "changes_requested",
          currentParticipant: { type: "agent", agentId: "engineer-a" },
          changesRequestedCount: 7,
        };
        return { status: 200, json: async () => ({ ...durableIssue }) };
      }
      return { status: 200, json: async () => ({ ...durableIssue }) };
    });
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
    expect(ctx.http.fetch).toHaveBeenNthCalledWith(1,
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
    expect(ctx.http.fetch).toHaveBeenNthCalledWith(3,
      "https://pc.example/api/issues/issue-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(durableIssue).toMatchObject({
      status: "in_progress", assigneeAgentId: "engineer-a", assigneeUserId: null,
      executionState: { status: "changes_requested", changesRequestedCount: 7, currentParticipant: { agentId: "engineer-a" } },
    });
    expect(stateStore.has(STATE_KEYS.humanInteractionMessage("interaction-1"))).toBe(false);
    expect(ctx.events.emit).toHaveBeenCalledWith("human-interaction-answered", TEST_CONFIG.companyId, expect.objectContaining({
      issueId: "issue-1",
      interactionId: "interaction-1",
      answer: "Make the legality rule structural and rerun review.",
    }));
  });

  it("fails closed for human decisions when the dedicated allowlist is empty", async () => {
    const { ctx, emitEvent, gateway, humanInteractions, stateStore } = setup();
    await emitEvent(eventName, { payload: created });
    await humanInteractions.tryHandleReply({
      channel: gateway.posts[0]!.channel, channelType: "channel", user: "U-VICTOR",
      text: "Continue", ts: "1700000001.000001", threadTs: gateway.posts[0]!.ts,
    });
    expect(gateway.ephemerals[0]!.text).toContain("not authorized");
    expect(ctx.http.fetch).not.toHaveBeenCalled();
    expect(stateStore.has(STATE_KEYS.humanInteractionMessage("interaction-1"))).toBe(true);
  });

  it("retains the Slack mapping after a failed Paperclip response so the user can retry", async () => {
    const { ctx, emitEvent, gateway, humanInteractions, stateStore } = setup({ humanEscalationAllowedSlackUserIds: ["U-VICTOR"] });
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

  it("recovers a response whose HTTP acknowledgement was lost without answering twice", async () => {
    const { ctx, emitEvent, gateway, humanInteractions, stateStore } = setup({
      humanEscalationAllowedSlackUserIds: ["U-VICTOR"],
    });
    await emitEvent(eventName, { payload: created });
    (ctx.http.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ interactions: [{ id: "interaction-1", status: "answered" }] }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({
        status: "in_review", executionState: { status: "pending", currentStageType: "review", currentParticipant: { type: "user" } },
      }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({}) });
    const reply = {
      channel: gateway.posts[0]!.channel, channelType: "channel" as const, user: "U-VICTOR",
      text: "Continue", ts: "1700000001.000001", threadTs: gateway.posts[0]!.ts,
    };
    await humanInteractions.tryHandleReply(reply);
    const saved = stateStore.get(STATE_KEYS.humanInteractionMessage("interaction-1")) as { answerText?: string; answerRecorded?: boolean };
    expect(saved.answerText).toBe("Continue");
    expect(saved.answerRecorded).toBeUndefined();
    await humanInteractions.tryHandleReply({ ...reply, text: "a different retry message" });
    expect(ctx.http.fetch).toHaveBeenCalledTimes(4);
    expect(ctx.http.fetch).toHaveBeenNthCalledWith(1, expect.stringContaining("/respond"), expect.anything());
    expect(ctx.http.fetch).toHaveBeenNthCalledWith(4, "https://pc.example/api/issues/issue-1", expect.objectContaining({ method: "PATCH" }));
    expect(stateStore.has(STATE_KEYS.humanInteractionMessage("interaction-1"))).toBe(false);
  });
});
