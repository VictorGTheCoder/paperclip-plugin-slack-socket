import { type PluginContext, type PluginHealthDiagnostics } from "@paperclipai/plugin-sdk";
import type { SlackGateway, SlackSocketConfig } from "./types.js";
export type GatewayFactory = (opts: {
    botToken: string;
    appToken: string;
}) => SlackGateway;
type Health = PluginHealthDiagnostics & {
    message?: string;
};
/** The most recently applied config, or DEFAULT_CONFIG before any has arrived. */
export declare function getLiveConfig(): SlackSocketConfig;
/** Parse the deterministic no-LLM smoke command carried by an @mention. */
export declare function parseSlackSmokePing(text: string, botUserId?: string): string | null;
/**
 * One watchdog poll. Exported as a test seam (same precedent as
 * `startRuntime`) so tests can drive ticks deterministically with an
 * injected clock instead of waiting out a 60s interval.
 */
export declare function socketWatchdogTick(ctx: PluginContext, now?: number): Promise<void>;
/**
 * Starts the single, process-lifetime Socket Mode watchdog. Must be called
 * exactly once, from `setup()` — the same clean-ALS-store reasoning as
 * `startConfigPump`. Guarded by `watchdogStarted` for idempotency, and the
 * interval is unref'd so a 60s poll can never hold the process (or a test
 * run) open.
 */
export declare function startSocketWatchdog(ctx: PluginContext): void;
/**
 * Apply a fully-merged config: validate the required fields, resolve the
 * Slack secrets scoped to `cfg.companyId` (required outside an invocation —
 * this is the fix for the bug where `secrets.resolve` failed with "company
 * context is required"), and only then — once validation has fully
 * succeeded — tear down any existing gateway, commit `cfg` as the live
 * config, stand up a new gateway via the injected `makeGateway` factory, and
 * wire the socket handlers to the modules built by `ensureCoreModules` /
 * `ensureCompanyModules`.
 *
 * Validating before tearing down matters because this worker process is
 * shared by every company that has this plugin installed: a bad config
 * (typo'd secret ref, revoked token, etc.) must never take down a
 * previously-working connection. On failure the previous `liveConfig` and
 * `currentGateway` are left completely untouched. One consequence worth
 * naming: this also means a *revoked* posting permission (e.g. narrowing
 * `agentPostChannelIds` or turning `agentPostMessageEnabled` off) does not
 * take effect if the save fails — for example during a brief secrets-backend
 * outage — the previous, more permissive `liveConfig` stays live until a
 * save succeeds.
 *
 * This also enforces single-tenant binding: the host runs one worker
 * process per installed plugin, shared by every company that configures it,
 * and drops the RPC-level companyId, so the operator-typed `companyId`
 * field inside the config is the only company identifier available. The
 * first config to successfully apply binds this process to that company for
 * its lifetime; a config for any other company is refused outright so it
 * can never tear down company A's socket or leak company A's notifications
 * into company B's workspace.
 *
 * The binding itself is claimed synchronously (before any `await`), not
 * after the async validation/setup work completes — see the "claim-then-
 * verify" comment inline below for why: without it, two overlapping calls
 * for different companies can both observe an unclaimed process and race.
 *
 * This is the seam worker tests use to drive the full lifecycle with a
 * `FakeGateway`, without a real Bolt App. `onConfigChanged` (the real,
 * host-facing hook) and `startRuntime` (kept for tests) are both thin
 * wrappers around this.
 */
export declare function applyConfig(ctx: PluginContext, cfg: SlackSocketConfig, makeGateway: GatewayFactory): Promise<Health>;
/** Test seam kept for back-compat: applies an explicit config via `applyConfig`. */
export declare function startRuntime(ctx: PluginContext, makeGateway: GatewayFactory, cfg: SlackSocketConfig): Promise<Health>;
declare const plugin: import("@paperclipai/plugin-sdk").PaperclipPlugin;
export default plugin;
