# TFT human review interactions

The Slack TFT plugin listens for the namespaced
`plugin.vgfx.tft-observer.human-review-interaction` event from the Observer.
Pending `ask_user_questions` interactions with `resolverPolicy=human_only` are
posted to the configured Human Escalations channel, falling back to the
default channel. The message is linked to the Paperclip interaction ID so
duplicate events do not create duplicate Slack messages.

A reply in that message's thread is accepted only from
`humanEscalationAllowedSlackUserIds`, a dedicated fail-closed Slack user
allowlist. The workspace-wide `allowedSlackUserIds` setting does not grant
permission to make review decisions. The answer is sent to
`POST /api/issues/{issueId}/interactions/{interactionId}/respond`. The plugin
then reads the issue and, while the native human review stage is still
pending, submits its ordinary decision using `PATCH /api/issues/{issueId}`
with `status: "in_progress"` and the instruction as a comment. Paperclip
records `changes_requested` and routes to the saved `returnAssignee`; the
plugin never changes `assigneeAgentId`. This is the native review transition
and continues to honor the review cap. The interaction uses
`continuationPolicy: "wake_assignee"`; for a user-assigned stage the normal
review decision PATCH is still required.

If answering succeeds but the native transition fails, the plugin retains the
Slack mapping and the recorded answer so a retry attempts only the native
transition. A resolution made in Paperclip UI is relayed by the Observer so
the linked Slack message can be marked resolved elsewhere.

When an issue leaves the pending human review stage, the plugin handles the
Observer's withdrawal request through Paperclip's canonical
`POST /api/issues/{issueId}/interactions/{interactionId}/withdraw` route. A
failed withdrawal remains visible and is never represented as a locally
cancelled Paperclip interaction.

Before canary, configure `Human Escalations Channel ID` to `C0C1C1FGFDL`
(`#tft-escalations`) and `Human Escalation Allowed Slack User IDs` to
`["U0C1FQW0GSD"]`. Configure `Paperclip Board API Key` with the API key of the
Paperclip user who owns the native human review stage. Keep in mind that an
empty global `allowedSlackUserIds` currently permits any workspace member to
use ordinary bot features; the dedicated decision allowlist remains fail
closed independently. Do not enable the canary until these settings are
reviewed and configured. No live settings are changed by this code change.

Notification, response, native-transition, and withdrawal failures are logged
and written to plugin metrics. A notification failure does not change the
pending Paperclip interaction or stop other project planning.
