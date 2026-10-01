#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
CLAUDE_CONFIG_DIR="$scratch/config" PI_MCP_TEST=0 node --input-type=module - "$scratch/project" <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { snapshot, validate, fallback } from './scripts/settings-view.mjs';
import { spawnSync } from 'node:child_process';
import { sessionSlugForCwd } from './scripts/pi-companion.mjs';
import { SETTINGS, parseSetting, writeSettings } from './scripts/question-settings.mjs';
const cwd = process.argv[2];
for (const [key, definition] of Object.entries(SETTINGS)) {
  for (const value of [String(definition.default), ...(definition.special || []), '0', '1', '16', '100', '1440', '1441', '-1', '1.5', 'bad', '1;echo x']) {
    assert.deepEqual(validate(key, value).ok, parseSetting(key, value) !== null, `${key}:${value}`);
  }
  assert.deepEqual(validate(key, 'inherit'), { ok: true, value: 'inherit' });
}
assert.equal(validate('unknown', 'inherit').ok, false);
assert.equal(writeSettings(cwd, 'user', { questions_per_turn: 9 }).ok, true);
assert.equal(writeSettings(cwd, 'project', { questions_per_turn: 2 }).ok, true);
let data = snapshot(cwd);
assert.deepEqual(data.settings.questions_per_turn, { value: 2, source: 'project', project: 2, user: 9 });
assert.equal(writeSettings(cwd, 'project', { questions_per_turn: 'inherit' }).ok, true);
assert.equal(snapshot(cwd).settings.questions_per_turn.source, 'user');
assert.equal(writeSettings(cwd, 'user', { questions_per_turn: 'inherit' }).ok, true);
assert.equal(snapshot(cwd).settings.questions_per_turn.source, 'default');
fs.writeFileSync(path.join(cwd, '.claude/pi-delegate.local.md'), '---\nprovider: local\nmodel: test-model\nmax_live_children: 99\n---\nbody\n');
data = snapshot(cwd);
assert.deepEqual(data.pin, { provider: 'local', model: 'test-model', source: 'project' });
assert.ok(data.warnings.some(w => w.includes('Invalid project max_live_children')));
const store = path.join(cwd, 'data');
const child = path.join(store, 'projects', sessionSlugForCwd(cwd), 'children/scout');
fs.mkdirSync(child, { recursive: true });
fs.writeFileSync(path.join(child, 'meta.json'), JSON.stringify({ name: 'scout', state: 'waiting', provider: 'local', model: 'test', gen: 2, turn: 3 }));
fs.writeFileSync(path.join(child, 'events.jsonl'), JSON.stringify({ type: 'question', gen: 2, turn: 3, data: { toolCallId: 'q' } }) + '\n{"torn');
assert.ok(fallback(cwd, store).includes('| scout | waiting | local/test | 2/3 | 1 |'));
assert.ok(fallback(cwd, store).includes('Model pin (read-only): local/test-model — source: project'));
const result = spawnSync(process.execPath, [path.resolve('scripts/settings-view.mjs'), 'fallback', store], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '/not-the-session-project' } });
assert.equal(result.status, 0);
assert.ok(result.stdout.includes('local/test-model — source: project'));
process.env.PI_MCP_TEST = '1';
process.env.PI_MCP_TTL_MS = '1000';
data = snapshot(cwd);
assert.equal(data.testMode, true);
assert.equal(data.overrides.PI_MCP_TTL_MS, 1000);
assert.equal(data.settings.idle_park_minutes.source, 'test-env');
console.log('settings-view: shared validation, scoped precedence/inherit, model pin, warnings, test overrides PASS');
NODE
