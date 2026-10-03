#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { ensureInit } from './hooks/agents.js';
const calls = { root: 0, session: 0, timer: 0 };
const api = {
  env: { get: async key => ({ CLAUDE_PLUGIN_ROOT: '/plugin', CLAUDE_PLUGIN_DATA: '/data', HOME: '/home' })[key] },
  session: { root: async () => { calls.root++; return '/project'; }, id: async () => { calls.session++; return 'session'; } },
  clock: { every: async () => { calls.timer++; return { cancel() {} }; } },
};
// Regular JS assertions avoid the native kit's repeated stub evaluation.
await Promise.all([ensureInit(api), ensureInit(api), ensureInit(api)]);
for (let i = 0; i < 10; i++) await ensureInit(api);
// The pane no longer reads $.session.id(): ownership is the server's call (spec 8.1).
assert.deepEqual(calls, { root: 1, session: 0, timer: 1 });
const { ensureInit: retryInit } = await import('./hooks/agents.js?retry');
let unavailable = true;
let retryTimers = 0;
const retryApi = {
  ...api,
  session: { ...api.session, root: async () => { if (unavailable) throw new Error('root not ready'); return '/project'; } },
  clock: { every: async () => { retryTimers++; return { cancel() {} }; } },
};
await assert.rejects(retryInit(retryApi), /root not ready/);
unavailable = false;
await Promise.all([retryInit(retryApi), retryInit(retryApi)]);
await retryInit(retryApi);
assert.equal(retryTimers, 1);
console.log('agents-init: concurrent/repeated initialization and retry start exactly one timer PASS');
NODE
