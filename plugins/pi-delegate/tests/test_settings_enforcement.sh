#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
export CLAUDE_CONFIG_DIR="$(make_scratch)"
FAKE_PKG="$(make_scratch)/pkg"; mkdir -p "$FAKE_PKG"; printf '{"name":"@maheidem/pi-delegate"}' > "$FAKE_PKG/package.json"
export PI_DELEGATE_PI_PACKAGE="$FAKE_PKG"
use_stub pi-rpc-lab
for LIMIT in 0 unlimited; do
 PROJ="$(make_scratch)"; mkdir -p "$PROJ/.claude"
 printf -- '---\nquestions_per_turn: %s\nturn_timeout_minutes: unlimited\ndefault_thinking: high\n---\n' "$LIMIT" > "$PROJ/.claude/pi-delegate.local.md"
 OUT="$(make_scratch)/out.jsonl"
 if [ "$LIMIT" = 0 ]; then
  CLAUDE_PROJECT_DIR="$PROJ" PI_STUB_ASKS=2 feed "$OUT" "$(call 2 pi_agent '{"name":"budget","prompt":"go","run_in_background":false,"thinking":"low"}')" 'WAIT_FOR "id":2 15'
 else
  CLAUDE_PROJECT_DIR="$PROJ" PI_STUB_ASKS=2 PI_STUB_ASK_SEQ=1 feed "$OUT" "$(call 2 pi_agent '{"name":"budget","prompt":"go","run_in_background":false,"thinking":"low"}')" 'WAIT_FOR "id":2 10' "$(call 3 pi_answer '{"to":"budget","answer":"one"}')" 'WAIT_FOR "id":3 10' "$(call 4 pi_answer '{"to":"budget","answer":"two"}')" 'WAIT_FOR "id":4 15'
 fi
 node --input-type=module - "$(child_dir "$PROJ" budget)" "$LIMIT" <<'JS'
import fs from 'node:fs'; import assert from 'node:assert/strict';
const dir=process.argv[2], limit=process.argv[3];
const events=fs.readFileSync(`${dir}/events.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
assert.equal(events.filter(e=>e.type==='question_expired'&&e.data.reason==='budget').length,limit==='0'?2:0);
assert.equal(events.filter(e=>e.type==='question').length,limit==='0'?0:2);
assert.ok(events.some(e=>e.type==='done'));
assert.equal(JSON.parse(fs.readFileSync(`${dir}/meta.json`,'utf8')).launch.thinking,'low');
console.log(`PASS enforcement: ${limit} question limit, unlimited turn timeout, explicit thinking wins`);
JS
done
