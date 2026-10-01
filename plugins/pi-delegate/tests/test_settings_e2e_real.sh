#!/usr/bin/env bash
set -euo pipefail
export TMPDIR=/tmp
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
export PATH="/opt/homebrew/bin:$PATH"
if ! command -v pi >/dev/null || [ ! -f "$HOME/.pi/agent/npm/node_modules/@maheidem/pi-delegate/package.json" ]; then echo 'SKIP: real pi/package missing'; exit 0; fi
PROFILE="$(make_scratch)"; export CLAUDE_CONFIG_DIR="$PROFILE"
for SCOPE in project user; do
 PROJ="$(make_scratch)"; mkdir -p "$PROJ/.claude"
 printf -- '---\nprovider: %s\nmodel: %s\n---\n' "${PI_E2E_PROVIDER:-mac-m3}" "${PI_E2E_MODEL:-qwen3.8-flash@adaptive}" > "$PROJ/.claude/pi-delegate.local.md"
 pi_sessions_dir "$PROJ" >/dev/null
 CLAUDE_PROJECT_DIR="$PROJ" node "$PLUGIN_ROOT/scripts/pi-companion.mjs" write-config --scope "$SCOPE" --questions-per-turn 1 --turn-timeout-minutes unlimited --question-wait-minutes 2 --max-live-children 2 --idle-park-minutes never --default-thinking minimal --json
 OUT="$(make_scratch)/settings-real.jsonl"
 PROMPT='Call ask_parent with kind question, topic blocked, text FIRST. After receiving its answer, call ask_parent again with kind question, topic blocked, text SECOND. Do not skip either call. After the second answer, print that second answer verbatim and finish. Do not use other tools.'
 ARGS="$(node -e 'console.log(JSON.stringify({name:"settingscheck",prompt:process.argv[1],run_in_background:false,turn_timeout_ms:240000}))' "$PROMPT")"
 CLAUDE_PROJECT_DIR="$PROJ" FEED_TIMEOUT=600 feed "$OUT" \
  "$(call 2 pi_list_agents '{"doctor":true}')" 'WAIT_FOR "id":2 30' \
  "$(call 3 pi_agent "$ARGS")" 'WAIT_FOR "id":3 240' \
  "$(call 4 pi_answer '{"to":"settingscheck","answer":"Continue with SECOND now."}')" 'WAIT_FOR "id":4 250' \
  "$(call 5 pi_read '{"name":"settingscheck","what":"transcript"}')" 'WAIT_FOR "id":5 20'
 DIR="$(child_dir "$PROJ" settingscheck)"
 node --input-type=module - "$DIR/events.jsonl" "$OUT" "$SCOPE" <<'JS'
import fs from 'node:fs'; import assert from 'node:assert/strict';
const events=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(JSON.parse);
assert.equal(events.filter(e=>e.type==='question').length,1);
assert.ok(events.some(e=>e.type==='question_expired' && e.data.reason==='budget'));
const output=fs.readFileSync(process.argv[3],'utf8');
assert.match(output,/Question budget exhausted/);
for (const [key,value] of Object.entries({question_wait_minutes:2,max_live_children:2,idle_park_minutes:'never',default_thinking:'minimal'})) {
 assert.ok(output.includes(`${key} ${value} (${process.argv[4]})`), `${key} is effective`);
}
const meta=JSON.parse(fs.readFileSync(process.argv[2].replace(/events.jsonl$/, 'meta.json'),'utf8'));
assert.equal(meta.launch.turnTimeoutMs,240000);
assert.equal(meta.launch.thinking,'minimal');
console.log(`real launch: turnTimeoutMs=${meta.launch.turnTimeoutMs}, thinking=${meta.launch.thinking}`);
assert.match(output,new RegExp(`questions_per_turn 1 \\(${process.argv[4]}\\)`));
assert.match(output,new RegExp(`turn_timeout_minutes unlimited \\(${process.argv[4]}\\)`));
console.log(`PASS real stdio ${process.argv[4]}: first question delivered, second refused; all six configured settings visible; explicit 240000ms call override`);
console.log(events.filter(e=>['question','question_expired','done'].includes(e.type)).map(e=>`${e.type}: ${JSON.stringify(e.data)}`).join('\n'));
JS
 DONE="$(make_scratch)/stop.jsonl"
 CLAUDE_PROJECT_DIR="$PROJ" feed "$DONE" "$(call 7 pi_stop '{"name":"settingscheck","forget":true}')" 'WAIT_FOR "id":7 20'
done
