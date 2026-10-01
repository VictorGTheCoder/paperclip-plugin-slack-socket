# TFT human review interactions

The Slack TFT plugin listens for the namespaced
`plugin.vgfx.tft-observer.human-review-interaction` event from the Observer.
Pending `ask_user_questions` interactions with `resolverPolicy=human_only` are
posted to the configured Human Escalations channel, falling back to the
default channel. The message is linked to the Paperclip interaction ID so
duplicate events do not create duplicate Slack messages.

A reply in that message's thread is sent to
`POST /api/issues/{issueId}/interactions/{interactionId}/respond` with the
interaction's free text question and option IDs. The interaction's
`continuationPolicy` remains `none`; the Observer receives a namespaced
answer event and re-evaluates the issue and planner. A resolution made in the
Paperclip UI is relayed by the Observer so the linked Slack message can be
marked resolved elsewhere.

Configure `Human Escalations Channel ID` to route messages to `#tft-escalations`.
If no value is configured, the plugin uses the default channel. In
authenticated Paperclip mode, configure the board API key secret reference so
Slack replies can resolve interactions. Notification and response failures
are logged and written to plugin metrics; a failed notification does not alter
the pending Paperclip interaction.
