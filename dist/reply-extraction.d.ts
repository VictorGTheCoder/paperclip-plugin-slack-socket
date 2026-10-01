export declare function filterRuntimeNoticeLines(text: string): string;
export declare function extractReply(text: string): string;
export declare function extractTaggedReply(text: string): string | null;
export declare function reconstructStreamedAgentText(buffer: string): string | null;
export declare const HOST_WITHHELD_REPLY_NOTICE = "Run completed. Agent did not post a summary comment this run (transcript withheld \u2014 see run log).";
export declare const WITHHELD_REPLY_USER_NOTICE = ":information_source: The run finished, but the host withheld the agent's reply text from this conversation (transcript withheld \u2014 see the run log in Paperclip). Mention me again to retry.";
