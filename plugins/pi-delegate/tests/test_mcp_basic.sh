#!/usr/bin/env bash
# MCP protocol smoke tests against the real pi-mcp-server.mjs.
# Covers: handshake, tools/list, tools/call (happy + unknown tool), unknown method, garbage tolerance.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SERVER="$PLUGIN_ROOT/scripts/pi-mcp-server.mjs"
CLIENT="$TESTS_DIR/lib/mcp-client.mjs"

# ---------------------------------------------------------------------------
# 1. Handshake — initialize request should return protocolVersion and server name.
# ---------------------------------------------------------------------------
out1="$(make_scratch)/handshake.json"
timeout 60 node "$CLIENT" "$SERVER" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' > "$out1" 2>&1
check "handshake: protocolVersion present" grep -q '"protocolVersion":"2025-06-18"' "$out1"
check "handshake: server name pi-delegate" grep -q '"name":"pi-delegate"' "$out1"

# ---------------------------------------------------------------------------
# 2. tools/list — initialize + tools/list should return pi_task and pi_setup.
# ---------------------------------------------------------------------------
out2="$(make_scratch)/toolslist.json"
timeout 60 node "$CLIENT" "$SERVER" \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' > "$out2" 2>&1
check "tools/list: contains pi_task" grep -q '"pi_task"' "$out2"
check "tools/list: contains pi_setup" grep -q '"pi_setup"' "$out2"

# ---------------------------------------------------------------------------
# 3. tools/call happy path — pi_task with a simple message.
# ---------------------------------------------------------------------------
use_stub pi-conv-send-happy
out3="$(make_scratch)/call_happy.json"
timeout 60 node "$CLIENT" "$SERVER" \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_task","arguments":{"text":"say ok","timeout_ms":15000}}}' > "$out3" 2>&1
check "tools/call happy: isError:false in response" grep -q '"isError":false' "$out3"
check "tools/call happy: ok:true in response" node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
  const msg = JSON.parse(lines[lines.length - 1]);
  const resultText = msg.result.content[0].text;
  const inner = JSON.parse(resultText);
  process.exit(inner.ok === true ? 0 : 1);
' "$out3"

# ---------------------------------------------------------------------------
# 4. Unknown tool — tools/call with a non-existent tool name should return -32602.
# ---------------------------------------------------------------------------
out4="$(make_scratch)/unknown_tool.json"
timeout 60 node "$CLIENT" "$SERVER" \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_nope","arguments":{}}}' > "$out4" 2>&1
check "unknown tool: error code -32602" grep -q -- '-32602' "$out4"

# ---------------------------------------------------------------------------
# 5. Unknown method — any unrecognized method should return -32601.
# ---------------------------------------------------------------------------
out5="$(make_scratch)/unknown_method.json"
timeout 60 node "$CLIENT" "$SERVER" \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":9,"method":"bogus/thing","params":{}}' > "$out5" 2>&1
check "unknown method: error code -32601" grep -q -- '-32601' "$out5"

# ---------------------------------------------------------------------------
# 6. Garbage tolerance — a non-JSON line between initialize and tools/list
#    should not crash the server; the tools/list response must still arrive.
# ---------------------------------------------------------------------------
out6="$(make_scratch)/garbage.json"
timeout 60 bash -c "printf '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\nTHIS IS GARBAGE LINE\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}\n' | node '$SERVER'" > "$out6" 2>&1
check "garbage tolerance: tools/list response present" grep -q '"tools"' "$out6"

finish
