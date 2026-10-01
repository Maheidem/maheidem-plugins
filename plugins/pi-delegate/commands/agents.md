---
description: View pi children and delegation settings in a native pane (or read-only text snapshot)
disable-model-invocation: true
allowed-tools: Bash(node *)
---

The native mod normally handles this command and opens the interactive pane.
If you are reading this body, plugin hooks modules are not enabled in this
session. Display the following compact snapshot verbatim, and tell the user
that the interactive pane requires plugin hooks modules enabled. Do not call
pi_list_agents/pi_read (they consume events), start pi, change settings, or
perform any child actions.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/settings-view.mjs" fallback "${CLAUDE_PLUGIN_DATA}"`
