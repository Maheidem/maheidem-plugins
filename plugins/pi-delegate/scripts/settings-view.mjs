#!/usr/bin/env node
// Read/validate adapter for the mods sandbox. Writes stay on pi-companion write-config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS, parseSetting, resolveSettings } from './question-settings.mjs';
import { loadProjectConfig, sessionSlugForCwd } from './pi-companion.mjs';
import { dataPathFor, installedIdentity, loadedInline, settingLabel, settingValue, sourceWord } from '../hooks/shared.mjs';

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

const STATE_WORDS = { waiting: 'asking', running: 'working', spawning: 'starting', idle: 'done', parked: 'parked', stopped: 'stopped', failed: 'failed' };
const GROUP_OF = { waiting: 'Needs input', running: 'Working', spawning: 'Working', idle: 'Idle', parked: 'Idle' };
const GROUPS = ['Needs input', 'Working', 'Idle', 'Ended'];

// The data folder of this plugin's MCP server, by the rule Claude Code uses (hooks/shared.mjs).
// The command passes ${CLAUDE_PLUGIN_DATA}, which Claude Code fills with that folder. When it is
// empty, the folder comes from the plugin registry, as the pane finds it.
export function dataDirFor(given, env = process.env) {
  if (env.PI_DELEGATE_VIEW_DATA) return env.PI_DELEGATE_VIEW_DATA;
  if (given && path.isAbsolute(given) && !given.includes('${')) return given;
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  if (loadedInline(pluginRoot, '', env.CLAUDE_CODE_PLUGIN_DIRS || '', process.cwd())) return dataPathFor(configDir, '');
  const installed = read(path.join(configDir, 'plugins/installed_plugins.json'));
  const marketplaces = read(path.join(configDir, 'plugins/known_marketplaces.json'));
  const manifests = {};
  for (const id of Object.keys(installed.plugins || {})) {
    const name = id.slice('pi-delegate@'.length);
    const base = marketplaces[name]?.source?.source === 'directory' ? marketplaces[name].source.path || marketplaces[name].installLocation : undefined;
    if (id.startsWith('pi-delegate@') && typeof base === 'string') manifests[name] = read(path.join(base, '.claude-plugin/marketplace.json'));
  }
  return dataPathFor(configDir, installedIdentity(pluginRoot, installed, marketplaces, manifests));
}

// A read-only text snapshot in plain lines: no tables, no internal keys, no JSON.
export function fallback(cwd, dataDir) {
  const data = snapshot(cwd);
  const viewCwd = process.env.PI_DELEGATE_VIEW_PROJECT || cwd;
  const root = path.join(dataDirFor(dataDir), 'projects', sessionSlugForCwd(viewCwd), 'children');
  const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  const groups = Object.fromEntries(GROUPS.map(g => [g, []]));
  let unreadable = false;
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
        const parts = [clean(meta.name), STATE_WORDS[meta.state] || 'state not known'];
        if (pending) parts.push(`${pending} question${pending === 1 ? '' : 's'} waiting`);
        if (meta.turn) parts.push(`turn ${clean(meta.turn)}`);
        if (meta.model) parts.push(clean(String(meta.model).split('/').pop()));
        if (meta.description) parts.push(clean(meta.description).slice(0, 80));
        groups[GROUP_OF[meta.state] || 'Ended'].push(`  ${parts.join(' · ')}`);
      } catch { /* A deleted or broken agent folder is left out. */ }
    }
  } catch (error) { if (error.code !== 'ENOENT') unreadable = true; }
  const lines = ['pi agents (a read-only snapshot)', ''];
  const total = GROUPS.reduce((n, g) => n + groups[g].length, 0);
  if (unreadable) lines.push('The agents of this project could not be read.');
  else if (!total) lines.push('No pi agents in this project.');
  for (const g of GROUPS) if (groups[g].length) lines.push(g, ...groups[g]);
  lines.push('', 'Settings');
  for (const [key, setting] of Object.entries(data.settings)) {
    lines.push(`  ${settingLabel(key)}: ${settingValue(key, setting.value)} (${sourceWord(setting.source)})`);
  }
  lines.push('', data.pin.model ? `pi model: ${clean(String(data.pin.model).split('/').pop())} (from the project pin)` : 'pi model: not pinned');
  if (data.testMode) lines.push('Test mode: environment overrides are active.');
  for (const warning of data.warnings) lines.push(`Warning: ${clean(warning)}`);
  lines.push('', 'The interactive pane needs plugin hooks modules on. This snapshot changes no files and calls no tools.');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'fallback' && args.length <= 1) {
      console.log(fallback(process.cwd(), args[0] || ''));
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
