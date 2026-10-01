/**
 * Converts Markdown text to Slack mrkdwn.
 *
 * The function is a sequence of passes over the text, and every pass that
 * PRODUCES mrkdwn syntax stashes its output behind a placeholder so no later
 * pass can re-interpret it — converted bold `*x*` must not be re-matched by
 * the single-star italic pass, a converted link's URL must not have its `__`
 * segments bolded, and code spans must survive byte-for-byte. Placeholders
 * are restored innermost-last (reverse stash order), so a stashed value that
 * itself contains an earlier placeholder — bold wrapping an inline code
 * span, a header wrapping a link — resolves fully.
 */
export declare function markdownToMrkdwn(text: string): string;
