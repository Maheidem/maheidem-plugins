---
name: start
description: "Build (if needed) and start the Obscura stealth browser MCP container on localhost:3000"
allowed-tools: Bash
---

# /obscura:start — bring up the Obscura browser MCP

Ensure the `obscura-mcp` Docker container is built and running so the `obscura`
MCP server (35 `browser_*` tools) is reachable at `http://localhost:3000/mcp`.

Do this:

1. Check if it's already up: `docker ps --filter name=^/obscura-mcp$ --format '{{.Names}} {{.Status}}'` and `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3000/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}'`. If it returns 200, report "already running" and stop.

2. Build the images if missing (`docker image inspect obscura-stealth:local` / `obscura-mcp-gw:local`). Build context is this plugin's `docker/` directory (`${CLAUDE_PLUGIN_ROOT}/docker`):
   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}/docker"
   docker build -t obscura-stealth:local -f Dockerfile .            # stealth Obscura (compiles from source, ~10-20 min first time; needs BoringSSL build deps handled in the Dockerfile)
   docker build -t obscura-mcp-gw:local -f Dockerfile.mcp-gateway . # supergateway + instruction-injection shim
   ```

3. Run the container (loopback-bound, restarts with Docker):
   ```bash
   docker rm -f obscura-mcp 2>/dev/null
   docker run -d --name obscura-mcp --restart unless-stopped -p 127.0.0.1:3000:3000 obscura-mcp-gw:local
   ```

4. Verify: `curl` the initialize (expect HTTP 200, an `mcp-session-id` header, and `result.instructions` present). Report the status.

Note: the `obscura` MCP is registered by this plugin's `.mcp.json`, but Claude Code
loads MCP servers at session start — so after a first-time build, tell the user to
start a new session to get the `obscura` tools.
