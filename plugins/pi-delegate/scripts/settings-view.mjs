#!/usr/bin/env node
// Read/validate adapter for the mods sandbox. Writes stay on pi-companion write-config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS, parseSetting, resolveSettings } from './question-settings.mjs';
import { loadProjectConfig, sessionSlugForCwd } from './pi-companion.mjs';

export function snapshot(cwd) {
  const pin = loadProjectConfig(cwd);
  return {
    ok: true,
    ...resolveSettings(cwd),
    definitions: SETTINGS,
    pin: { provider: pin.provider, model: pin.model, source: pin.provider || pin.model ? 'project' : 'none' },
  };
}

export function validate(key, raw) {
  const value = raw === 'inherit' && Object.hasOwn(SETTINGS, key) ? 'inherit' : parseSetting(key, raw);
  return value === null
    ? { ok: false, errorMessage: `Invalid ${key}: ${JSON.stringify(raw)}` }
    : { ok: true, value };
}

export function fallback(cwd, dataDir) {
  const data = snapshot(cwd);
  const viewCwd = process.env.PI_DELEGATE_VIEW_PROJECT || cwd;
  const store = process.env.PI_DELEGATE_VIEW_DATA || dataDir;
  const root = path.join(store, 'projects', sessionSlugForCwd(viewCwd), 'children');
  const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f|]/g, ' ');
  const lines = ['## Pi children (read-only disk snapshot)', '| Name | State | Model | Gen/turn | Pending questions |', '| --- | --- | --- | --- | --- |'];
  let count = 0;
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).slice(0, 200)) {
      if (!entry.isDirectory() || !/^[a-z][a-z0-9_-]{0,31}$/.test(entry.name)) continue;
      try {
        const dir = path.join(root, entry.name);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        if (meta.name !== entry.name) continue;
        let events = [];
        try { events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); } catch {}
        const closed = new Set(events.filter(e => ['answered', 'question_expired'].includes(e.type)).map(e => e.data?.toolCallId));
        const pending = events.filter(e => e.type === 'question' && e.gen === meta.gen && e.turn === meta.turn && !closed.has(e.data?.toolCallId)).length;
        lines.push(`| ${clean(meta.name)} | ${clean(meta.state)} | ${clean(meta.provider)}/${clean(meta.model)} | ${clean(meta.gen)}/${clean(meta.turn)} | ${pending} |`);
        count++;
      } catch { /* Deleted/malformed children are skipped. */ }
    }
  } catch (error) { if (error.code !== 'ENOENT') lines.push('Warning: cannot read child directory.'); }
  if (!count) lines.push('No children recorded in this project.');
  lines.push('', '## Settings', '| Setting | Effective | Source | Project | User |', '| --- | --- | --- | --- | --- |');
  for (const [key, setting] of Object.entries(data.settings)) lines.push(`| ${key} | ${clean(setting.value)} | ${clean(setting.source)} | ${clean(setting.project ?? 'inherit')} | ${clean(setting.user ?? 'inherit')} |`);
  lines.push('', `Model pin (read-only): ${clean(data.pin.provider || '(not pinned)')}/${clean(data.pin.model || '(not pinned)')} — source: ${data.pin.source}`);
  if (data.testMode) lines.push(`NOTICE: TEST MODE ACTIVE — overrides ${JSON.stringify(data.overrides)}`);
  for (const warning of data.warnings) lines.push(`Warning: ${clean(warning)}`);
  lines.push('', 'Interactive pane requires Claude Code plugin hooks modules enabled. This fallback does not invoke MCP or change any files.');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'fallback' && args.length <= 1) {
      console.log(fallback(process.cwd(), args[0] || process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins/data/pi-delegate')));
      process.exit(0);
    }
    const result = mode === 'snapshot' && args.length === 1 ? snapshot(path.resolve(args[0]))
      : mode === 'validate' && args.length === 2 ? validate(...args)
      : { ok: false, errorMessage: 'Usage: settings-view.mjs snapshot <cwd> | validate <key> <value>' };
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, errorMessage: error.message }));
    process.exitCode = 1;
  }
}
