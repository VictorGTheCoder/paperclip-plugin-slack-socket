import type { PluginToolDeclaration, ScopeKey } from "@paperclipai/plugin-sdk";
import type { SlackSocketConfig } from "./types.js";
export declare const PLUGIN_ID = "cvh.slack-socket";
export declare const PLUGIN_VERSION = "0.11.4-tft.3";
export declare const ACTION_IDS: {
    readonly approvalApprove: "approval_approve";
    readonly approvalReject: "approval_reject";
};
export declare const JOB_KEYS: {
    readonly cleanup: "cleanup";
};
export declare const TOOL_NAMES: {
    readonly askHuman: "ask_human";
    readonly postMessage: "slack_post_message";
};
export declare const SLASH_COMMAND = "/paperclip";
export declare const RESET_KEYWORD = "reset";
export declare const STATE_NAMESPACE = "slack-socket";
export declare const CHANNEL_SESSION_TS = "main";
export declare const STATE_KEYS: {
    readonly sessionIndex: "session-index";
    readonly session: (channel: string, threadTs: string) => string;
    readonly questionIndex: "question-index";
    readonly question: (channel: string, ts: string) => string;
    readonly issueThreadIndex: "issue-thread-index";
    readonly issueThread: (issueId: string) => string;
    readonly approvalMessageIndex: "approval-message-index";
    readonly approvalMessage: (approvalId: string) => string;
};
export declare function stateScope(stateKey: string): ScopeKey;
export declare const ASK_HUMAN_TOOL_DECLARATION: PluginToolDeclaration;
export declare const POST_MESSAGE_TOOL_DECLARATION: PluginToolDeclaration;
export declare const REPLY_OPEN_TAG = "<slack_reply>";
export declare const REPLY_CLOSE_TAG = "</slack_reply>";
export declare const THREAD_CONTEXT_OPEN_TAG = "<thread_context>";
export declare const THREAD_CONTEXT_CLOSE_TAG = "</thread_context>";
export declare const THREAD_CONTEXT_MAX_CHARS = 12000;
export declare const THREAD_CONTEXT_MAX_MESSAGES = 50;
export declare const THREAD_FETCH_PAGE_SIZE = 1000;
export declare const THREAD_CONTEXT_MAX_PARENT_CHARS = 4000;
export declare const DEFAULT_CHAT_PROMPT_PREAMBLE = "You are replying to a person in a Slack thread. Answer them directly and conversationally, in your own voice, and keep it concise and readable as a chat message. Put your entire reply between <slack_reply> and </slack_reply>, and put nothing else inside those tags \u2014 no reasoning, no restating the wake payload or execution contract, no notes about what you're about to do. Any thinking must go outside the tags; only what's inside them will be shown to the person.";
export declare const DEFAULT_CONFIG: SlackSocketConfig;
