/**
 * Translate Paperclip's company-scope denials into something an operator can
 * act on.
 *
 * Both denials read like plugin bugs but are really ordering constraints in how
 * the host authorizes a plugin to act on a company:
 *
 * - Secret access is granted per *configured* company, seeded from the plugin's
 *   saved config rows — so a Test Connection run before the first Save can
 *   never resolve a secret.
 * - Background (non-invocation) work is authorized from the set of companies
 *   that had a saved configuration when the worker process started. Configuring
 *   a plugin for the first time therefore leaves a already-running worker with
 *   an empty authorized set until it is restarted.
 *
 * Anything else is passed through unchanged (token-redacted).
 */
export declare function describeHostError(err: unknown): string;
