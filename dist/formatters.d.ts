import type { QuestionMode } from "./types.js";
export interface SlackContent {
    text: string;
    blocks: unknown[];
}
type Payload = Record<string, unknown> | null | undefined;
/**
 * Escapes Slack mrkdwn's three special characters in a string that comes
 * from plugin/event payload data or a Slack user profile — i.e. anything we
 * didn't author ourselves. Must NOT be applied to our own literal markup
 * (section/context text templates, emoji codes, link syntax we construct).
 * See https://api.slack.com/reference/surfaces/formatting#escaping
 *
 * Idempotent: already-escaped entities are unescaped FIRST, in a single
 * regex pass, then everything is re-escaped — so `&amp;` stays `&amp;`
 * instead of double-escaping to `&amp;amp;` (which Slack renders as the
 * literal text "&amp;"). The unescape must be one pass, not sequential
 * replaces: a sequential decode re-scans its own output, letting
 * "&amp;lt;" decode twice into a live "<". The security property is
 * unchanged — the output still contains no unescaped `&`, `<`, or `>`.
 */
export declare function escapeMrkdwn(s: string): string;
export declare function formatIssueCreated(payload: Payload, issueId: string, baseUrl: string): SlackContent;
export declare function formatIssueDone(payload: Payload, issueId: string, baseUrl: string): SlackContent;
export declare function formatAgentRunFailed(payload: Payload): SlackContent;
export declare function formatApprovalCreated(approvalId: string, payload: Payload, baseUrl: string): SlackContent;
export declare function formatApprovalDecided(approvalId: string, decision: "approve" | "reject", deciderName: string): SlackContent;
/**
 * The decided state of an approval that was decided somewhere other than
 * this Slack message — the Paperclip web UI, the API, another integration.
 *
 * Carries no action buttons, which is the entire point: rendering this over
 * the original message is what retires the live Approve/Reject buttons.
 * Decider attribution appears only when the payload actually carries one.
 */
export declare function formatApprovalDecidedElsewhere(approvalId: string, payload: Payload): SlackContent;
export declare function formatQuestion(question: string, mode: QuestionMode): SlackContent;
export declare function formatQuestionResolved(question: string, response: string, responderName: string): SlackContent;
export declare function formatQuestionExpired(question: string): SlackContent;
export {};
