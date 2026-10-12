---
description: View pi agents and delegation settings in a native pane (or read-only text snapshot)
disable-model-invocation: true
allowed-tools: Bash(node *)
---

The native mod normally handles this command and opens the interactive pane.
If you are reading this body, plugin hooks modules are not on in this session.
Show the snapshot below exactly as it is. Then tell the user that the
interactive pane needs plugin hooks modules on. Do not call pi_list_agents or
pi_read (they consume events). Do not start pi, change settings or act on an agent.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/settings-view.mjs" fallback "${CLAUDE_PLUGIN_DATA}"`
