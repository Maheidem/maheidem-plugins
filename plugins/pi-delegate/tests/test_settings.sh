#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d /tmp/pi-delegate-settings.XXXXXX)"
trap 'rm -rf "$ROOT"' EXIT
export CLAUDE_CONFIG_DIR="$ROOT/profile" CLAUDE_PROJECT_DIR="$ROOT/project"
mkdir -p "$CLAUDE_CONFIG_DIR" "$CLAUDE_PROJECT_DIR/.claude"
node --input-type=module - "$HERE/../scripts/question-settings.mjs" <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {SETTINGS, resolveSettings, resolveTurnTimeout, writeSettings, parseSetting} = await import(process.argv[2]);
const cwd = process.env.CLAUDE_PROJECT_DIR;
const userValues = {questions_per_turn: 2, turn_timeout_minutes: 3, question_wait_minutes: 4, max_live_children: 2, idle_park_minutes: 7, default_thinking: 'low'};
const projectValues = {questions_per_turn: 1, turn_timeout_minutes: 'unlimited', question_wait_minutes: 8, max_live_children: 3, idle_park_minutes: 'never', default_thinking: 'high'};
for (const [key,spec] of Object.entries(SETTINGS)) assert.equal(resolveSettings(cwd).settings[key].value, spec.default);
assert.equal(writeSettings(cwd,'user',userValues).ok,true);
for (const [key,v] of Object.entries(userValues)) { const s=resolveSettings(cwd).settings[key]; assert.equal(s.value,v); assert.equal(s.source,'user'); }
fs.writeFileSync(`${cwd}/.claude/pi-delegate.local.md`, '---\nprovider: keep\nextensions: keep-too\n---\nbody retained\n');
assert.equal(writeSettings(cwd,'project',projectValues).ok,true);
for (const [key,v] of Object.entries(projectValues)) { const s=resolveSettings(cwd).settings[key]; assert.equal(s.value,v); assert.equal(s.source,'project'); }
assert.deepEqual(resolveTurnTimeout(cwd,1234),{value:1234,source:'call'});
assert.equal(resolveTurnTimeout(cwd).value,null);
assert.equal(writeSettings(cwd,'project',Object.fromEntries(Object.keys(SETTINGS).map(k=>[k,'inherit']))).ok,true);
assert.equal(resolveTurnTimeout(cwd).value,180000);
assert.match(fs.readFileSync(`${cwd}/.claude/pi-delegate.local.md`,'utf8'),/extensions: keep-too/);
assert.match(fs.readFileSync(`${cwd}/.claude/pi-delegate.local.md`,'utf8'),/body retained/);
for (const key of Object.keys(SETTINGS)) {
 assert.equal(parseSetting(key,-1),null); assert.equal(parseSetting(key,1.5),null); assert.equal(parseSetting(key,'bad'),null);
 assert.equal(writeSettings(cwd,'project',{[key]:'bad'}).ok,false);
 fs.writeFileSync(`${cwd}/.claude/pi-delegate.local.md`,`---\n${key}: bad\n---\n`);
 const s=resolveSettings(cwd); assert.equal(s.settings[key].value,userValues[key]); assert.ok(s.warnings.length);
}
assert.equal(parseSetting('questions_per_turn',0),0);
assert.equal(parseSetting('questions_per_turn','unlimited'),'unlimited');
process.env.PI_MCP_REGISTRY_CAP='1'; assert.equal(resolveSettings(cwd).settings.max_live_children.value,2);
process.env.PI_MCP_TEST='1'; assert.equal(resolveSettings(cwd).settings.max_live_children.value,1);
assert.equal(resolveSettings(cwd).testMode,true);
console.log('PASS: six-setting default/user/project precedence, call timeout override, validation, inherit/preservation, test-only env');
JS
node "$HERE/../scripts/pi-companion.mjs" write-config --scope user --questions-per-turn 0 --turn-timeout-minutes unlimited --json
node "$HERE/../scripts/pi-companion.mjs" write-config --scope project --questions-per-turn 1 --default-thinking minimal --json
