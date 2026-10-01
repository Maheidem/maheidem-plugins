#!/usr/bin/env node
// pi-companion.mjs — thin, foreground-only, one-shot subprocess wrapper around
// the local `pi` CLI (pi.dev's pi-coding-agent).
//
// Design constraints (see docs/adr-003-mcp-only.md for the full contract):
//   - Foreground only. `task` uses an async `spawn` (awaited to completion,
//     never backgrounded) instead of `spawnSync`, specifically to avoid a
//     fixed maxBuffer ceiling on captured stdout -- see the comment on
//     `spawnManaged()` below for why. `setup`/`list-models` still use `spawnSync`
//     since their outputs are small and fixed-size.
//   - No background/job-tracking subcommands. That is a v2 idea, not built here.
//   - One-shot RPC completion: every task invocation uses `rpcRoundtrip` with
//     `prompt` + `get_last_assistant_text` commands over the `--mode rpc`
//     protocol. Success is determined by stream settlement and a valid
//     response envelope -- no marker file or degraded fallback path exists.
//   - Never throw an uncaught exception as the primary output. All failure
//     paths degrade to a structured `{ ok: false, ... }` object.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveSettings, writeSettings, SETTINGS, settingsLabel } from "./question-settings.mjs";
export { resolveSettings } from "./question-settings.mjs";

const DEFAULT_TIMEOUT_MS = 600000; // 600s
// Resolved through piAgentDir() (hoisted) so PI_CODING_AGENT_DIR moves it, as it moves pi.
const PI_SETTINGS_PATH = path.join(piAgentDir(), "settings.json");
const STATUS_TIMEOUT_MS = 30000;
const RAW_TAIL_LIMIT = 10240; // last 10KB of raw stdout/stderr in results
const STEER_MESSAGE_MAX_BYTES = 4096; // cap for steer/interrupt envelope message
const FIFO_POLL_INTERVAL_MS = 200; // poll interval for the send-side control FIFO

function printUsage() {
  console.log(
    [
      "Usage:",
      '  node pi-companion.mjs task "<task text>" [--json] [--provider <name>] [--model <pattern>]',
      "                              [--thinking <off|minimal|low|medium|high|xhigh>]",
      "                              [--tools <t1,t2,...>] [--exclude-tools <t1,t2,...>]",
      "                              [--timeout <ms>]",
      "  node pi-companion.mjs setup [--json]",
      "  node pi-companion.mjs list-models [--json]",
      '  node pi-companion.mjs write-config --provider <name> --model <name> [--json]',
      "  node pi-companion.mjs remove-config [--json]",
      '  node pi-companion.mjs conversation start <name> [--message "<text>"] [--json]',
      "                                              [--provider <name>] [--model <pattern>]",
      "                                              [--thinking <level>] [--timeout <ms>]",
      '  node pi-companion.mjs conversation send <name> "<message text>" [--json] [--timeout <ms>]',
      "  node pi-companion.mjs conversation status <name> [--json]",
      "  node pi-companion.mjs conversation end <name> [--json]",
      '  node pi-companion.mjs conversation read <name> [--last <N>] [--json]',
      '  node pi-companion.mjs conversation steer <name> "<message text>" [--json]',
      '  node pi-companion.mjs conversation interrupt <name> "<message text>" [--json]'
    ].join("\n")
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Keep only the tail of a large string; used to bound rawStdout/rawStderr in
// every result payload (pi's NDJSON re-emission makes stdout quadratic).
function truncateTail(str, max = RAW_TAIL_LIMIT) {
  const text = str ?? "";
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(text.length - max), truncated: true };
}

// Conservative allowlist for provider/model values that end up in pi's argv or
// in the project config file: no whitespace, no leading '-', limited charset.
function isSafeArgValue(v) {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    !v.startsWith("-") &&
    /^[A-Za-z0-9._/:@-]+$/.test(v)
  );
}

// Build a task result with the full stable field set, then overlay specifics.
// Guarantees every runTask return path exposes the same JSON shape.
function taskResult(overrides) {
  const stdoutT = truncateTail(overrides.rawStdout ?? "");
  const stderrT = truncateTail(overrides.rawStderr ?? "");
  return {
    ok: false,
    finalText: null,
    summary: null,
    errorMessage: null,
    warning: null,
    exitCode: null,
    // Conversation-path fields (Phase 1). Always null/false on the `task`
    // path -- vestigial there until Phase 3 unifies the contract.
    sessionName: null,
    sessionId: null,
    turnCount: null,
    lockHeldByPid: null,
    // Steer/interrupt-path fields (Phase 4'). Always present/stable across
    // every conversation verb, not just send -- same pattern as the
    // conversation-field defaults above.
    steered: [],
    interrupted: false,
    ...overrides,
    rawStdout: stdoutT.text,
    rawStderr: stderrT.text,
    rawStdoutTruncated: stdoutT.truncated,
    rawStderrTruncated: stderrT.truncated
  };
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseTaskArgs(argv) {
  const opts = {
    text: null,
    json: false,
    provider: null,
    model: null,
    thinking: null,
    tools: null,
    excludeTools: null,
    timeout: DEFAULT_TIMEOUT_MS,
    invalidTimeout: null
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--json":
        opts.json = true;
        break;
      case "--provider":
        opts.provider = argv[++i] ?? null;
        break;
      case "--model":
        opts.model = argv[++i] ?? null;
        break;
      case "--thinking":
        opts.thinking = argv[++i] ?? null;
        break;
      case "--tools":
        opts.tools = argv[++i] ?? null;
        break;
      case "--exclude-tools":
        opts.excludeTools = argv[++i] ?? null;
        break;
      case "--timeout": {
        const raw = argv[++i];
        const n = Number(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          opts.invalidTimeout = raw ?? "(missing)";
        } else {
          opts.timeout = n;
        }
        break;
      }
      case "--marker":
        opts.removedMarkerFlag = true;
        break;
      default:
        positional.push(arg);
        break;
    }
  }

  opts.text = positional.join(" ").trim();
  return opts;
}

// Strict parser for write-config: pin flags and shared setting flags allowed;
// anything else (unknown flag or positional) is a hard error.
function parseWriteConfigArgs(argv) {
  const opts = { provider: null, model: null, json: false, error: null, scope: "project", settings: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--scope") {
      opts.scope = argv[++i];
    } else if (arg.startsWith("--") && Object.hasOwn(SETTINGS, arg.slice(2).replaceAll("-", "_"))) {
      opts.settings[arg.slice(2).replaceAll("-", "_")] = argv[++i] ?? "";
    } else if (arg === "--provider") {
      opts.provider = argv[++i] ?? null;
    } else if (arg === "--model") {
      opts.model = argv[++i] ?? null;
    } else {
      opts.error = `unknown argument: ${arg}`;
      return opts;
    }
  }
  return opts;
}

// Strict parser for `conversation <verb> <name> [...]`. Unknown flags are a
// hard error (exit 2), matching write-config's posture.
function parseConversationArgs(verb, argv) {
  const opts = {
    name: null,
    message: null,
    json: false,
    provider: null,
    model: null,
    thinking: null,
    timeout: DEFAULT_TIMEOUT_MS,
    invalidTimeout: null,
    last: null,
    invalidLast: null,
    error: null
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--json":
        opts.json = true;
        break;
      case "--message":
        opts.message = argv[++i] ?? null;
        break;
      case "--provider":
        opts.provider = argv[++i] ?? null;
        break;
      case "--model":
        opts.model = argv[++i] ?? null;
        break;
      case "--thinking":
        opts.thinking = argv[++i] ?? null;
        break;
      case "--timeout": {
        const raw = argv[++i];
        const n = Number(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          opts.invalidTimeout = raw ?? "(missing)";
        } else {
          opts.timeout = n;
        }
        break;
      }
      case "--last": {
        const raw = argv[++i];
        const n = Number(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          opts.invalidLast = raw ?? "(missing)";
        } else {
          opts.last = n;
        }
        break;
      }
      default:
        positional.push(arg);
        break;
    }
  }

  if (positional.length === 0) {
    opts.error = `conversation ${verb}: missing <name>`;
    return opts;
  }

  opts.name = positional[0];

  if (verb === "send" || verb === "steer" || verb === "interrupt") {
    const text = positional.slice(1).join(" ").trim();
    if (!text) {
      opts.error = `conversation ${verb}: missing <message text>`;
      return opts;
    }
    opts.message = text;
  } else if (positional.length > 1) {
    opts.error = `conversation ${verb}: unexpected extra argument(s): ${positional.slice(1).join(" ")}`;
    return opts;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// task subcommand
// ---------------------------------------------------------------------------

function resolveCwd() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

// ---------------------------------------------------------------------------
// Per-project config: .claude/pi-delegate.local.md (YAML frontmatter)
// ---------------------------------------------------------------------------

function loadProjectConfig(cwd) {
  const configPath = path.join(cwd, ".claude", "pi-delegate.local.md");
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return { provider: null, model: null, extensions: [] };
  }

  const lines = raw.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { provider: null, model: null, extensions: [] };
  }

  const config = { provider: null, model: null, extensions: [] };
  let closed = false;

  // lines[0] is already confirmed "---" above, so everything from index 1
  // onward is frontmatter content until the closing "---" (a normal
  // 2-delimiter block, not 3 -- there is no separate "start" marker to wait
  // for).
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") {
      closed = true;
      break;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    // Strip one pair of matching surrounding quotes ('...' or "...").
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (key === "provider" && value) config.provider = value;
    if (key === "model" && value) config.model = value;
    if (key === "extensions" && value) {
      config.extensions = value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  // Unterminated frontmatter block => treat as no frontmatter at all.
  if (!closed) {
    return { provider: null, model: null, extensions: [] };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Lean children: every spawned pi gets --no-extensions/--no-skills/
// --no-prompt-templates/--no-context-files, then explicit -e paths for
// (1) whatever extension supplies the provider it runs on (pi's providers can
// come from extensions, e.g. model-discovery -- dropping it breaks the pin),
// (2) the project pin's opt-in `extensions:` list, (3) the pi-side
// @maheidem/pi-delegate package for ask_parent (conversations only).
// ---------------------------------------------------------------------------

const LEAN_FLAGS = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"];

// Mirrors pi's getAgentDir(): $PI_CODING_AGENT_DIR (leading ~ expanded,
// resolved against the cwd) or ~/.pi/agent. Sessions, settings and packages
// all hang off it, so every path we derive must go through here.
function piAgentDir() {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (!env) return path.join(os.homedir(), ".pi", "agent");
  if (env === "~") return os.homedir();
  return path.resolve(env.startsWith("~/") ? path.join(os.homedir(), env.slice(2)) : env);
}

// ---------------------------------------------------------------------------
// Child env scrub (0.11 §6.3). A pi child is a worker, not a Claude session:
// none of Claude's messaging/session/plugin plumbing or its OAuth token may
// reach it. ANTHROPIC_* goes too unless the child may run on the anthropic
// provider (pi reads ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN itself --
// docs/providers.md). Besides the spec's five patterns, any secret-shaped
// CLAUDE_CODE_* name (refresh/gateway/API tokens, key passphrases, credential
// file descriptors -- names taken from the 2.1.286 binary) and Claude's
// remote/bridge/host session plumbing are dropped. Numeric knobs such as
// CLAUDE_CODE_MAX_OUTPUT_TOKENS don't match and still pass.
// ---------------------------------------------------------------------------

const CHILD_ENV_DENY = [
  /^CLAUDE_CODE_MESSAGING_/, /^CLAUDE_CODE_SESSION/, /^CLAUDECODE$/, /^CLAUDE_PLUGIN_/, /^CLAUDE_CODE_OAUTH_TOKEN$/,
  /^CLAUDE_CODE_\w*(_TOKEN|_KEY|_PASSPHRASE|_CREDS_FILE|_FILE_DESCRIPTOR)$/, /^CLAUDE_CODE_\w*SECRET/,
  /^CLAUDE_CODE_(REMOTE|BRIDGE|HOST)_/
];

function scrubChildEnv(env, { keepAnthropic = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (CHILD_ENV_DENY.some((re) => re.test(k))) continue;
    if (!keepAnthropic && k.startsWith("ANTHROPIC_")) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// pi version gate: the lean flags only disable pi's built-in extensions from
// 0.99.0 on, so an older pi would start non-lean children silently. Checked
// once per process: the in-flight/successful promise is shared (the MCP server
// warms it at startup), and a failure is re-checked on the next launch.
// ENOENT passes through so the spawn reports "pi CLI not found" as before.
// ---------------------------------------------------------------------------

const MIN_PI_VERSION = "0.99.0";
let piVersionGate = null;

function parsePiVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionAtLeast(v, min) {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
}

function checkPiVersion() {
  if (!piVersionGate) {
    piVersionGate = probePiVersion().then((r) => {
      if (!r.ok || r.skipped) piVersionGate = null;
      return r;
    });
  }
  return piVersionGate;
}

function probePiVersion() {
  return new Promise((resolve) => {
    let child;
    let out = "";
    let err = "";
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(r);
    };
    try {
      child = spawn("pi", ["--version"], { stdio: ["ignore", "pipe", "pipe"], env: scrubChildEnv(process.env, { keepAnthropic: true }) });
    } catch (e) {
      finish(e && e.code === "ENOENT" ? { ok: true, skipped: "ENOENT" } : { ok: false, error: `failed to run 'pi --version': ${e && e.message ? e.message : String(e)}` });
      return;
    }
    const t = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      finish({ ok: false, error: "'pi --version' did not answer within 15s" });
    }, 15000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", (e) => {
      // Not found: no gate to apply; the real spawn reports it the usual way.
      if (e && e.code === "ENOENT") finish({ ok: true, skipped: "ENOENT" });
      else finish({ ok: false, error: `failed to run 'pi --version': ${e && (e.code || e.message)}` });
    });
    child.on("close", (code) => {
      const text = out.trim();
      const v = parsePiVersion(text);
      if (code !== 0 || !v) {
        finish({ ok: false, error: `could not determine the pi version ('pi --version' exited ${code}: ${(text || err.trim()).slice(0, 200) || "no output"})` });
        return;
      }
      const version = v.join(".");
      if (!versionAtLeast(v, parsePiVersion(MIN_PI_VERSION))) {
        finish({ ok: false, version, error: `pi ${version} is too old: pi-delegate needs pi >= ${MIN_PI_VERSION} (lean children rely on it to switch off built-in extensions). Upgrade pi, then retry.` });
        return;
      }
      finish({ ok: true, version });
    });
  });
}

function piNodeModulesDir() {
  return path.join(piAgentDir(), "npm", "node_modules");
}

// "npm:@scope/name@1.2.3" | "@scope/name" | "name@1" -> "@scope/name" | "name"
function packageNameOf(spec) {
  let s = spec.startsWith("npm:") ? spec.slice(4) : spec;
  const at = s.lastIndexOf("@");
  if (at > 0) s = s.slice(0, at);
  return s;
}

// One opt-in / configured extension spec -> an absolute path pi can -e, or
// "builtin:<name>". Returns { ok, value } | { ok:false, error }.
function resolveExtensionSpec(spec) {
  if (typeof spec !== "string" || !spec) return { ok: false, error: "empty extension spec" };
  if (spec.startsWith("builtin:")) {
    return /^builtin:[A-Za-z0-9._-]+$/.test(spec) ? { ok: true, value: spec } : { ok: false, error: `invalid builtin spec ${spec}` };
  }
  if (path.isAbsolute(spec)) {
    return fs.existsSync(spec) ? { ok: true, value: spec } : { ok: false, error: `extension path not found: ${spec}` };
  }
  if (!isSafeArgValue(spec)) return { ok: false, error: `invalid extension spec ${JSON.stringify(spec)}` };
  const dir = path.join(piNodeModulesDir(), packageNameOf(spec));
  return fs.existsSync(dir) ? { ok: true, value: dir } : { ok: false, error: `extension package not installed: ${spec} (looked in ${dir})` };
}

// The pi-side delegate package that registers ask_parent in child mode.
function piSidePackageDir() {
  const dir = process.env.PI_DELEGATE_PI_PACKAGE || path.join(piNodeModulesDir(), "@maheidem", "pi-delegate");
  return fs.existsSync(path.join(dir, "package.json")) ? dir : null;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function readPiSettings() {
  return readJsonFile(path.join(piAgentDir(), "settings.json"));
}

// Which provider(s) a child launched with this --provider/--model could run
// on, mirroring pi's resolveCliModel (dist/core/model-resolver.js):
//   - an explicit --provider wins;
//   - else a "prefix/id" model means provider <prefix> (pi matches it
//     case-insensitively);
//   - else a bare model pattern ("sonnet") is matched across EVERY provider,
//     so the provider is unknown until pi resolves it (ambiguous);
//   - else pi's default: defaultProvider from <cwd>/.pi/settings.json merged
//     over the global settings. Project settings only apply when pi trusts
//     the project, so both candidates are returned.
function childProviderCandidates({ provider, model, cwd }) {
  if (provider) return { providers: [String(provider).toLowerCase()], ambiguous: false };
  if (model) {
    const slash = String(model).indexOf("/");
    if (slash > 0) return { providers: [String(model).slice(0, slash).toLowerCase()], ambiguous: false };
  }
  const global = readPiSettings().defaultProvider;
  const project = cwd ? readJsonFile(path.join(cwd, ".pi", "settings.json")).defaultProvider : undefined;
  const providers = [...new Set([project, global].filter((p) => typeof p === "string" && p).map((p) => p.toLowerCase()))];
  return { providers, ambiguous: !!model };
}

// Settles on 'exit' (+ a short drain), not 'close': an extension that starts
// a daemon hands it our stdout pipe, and 'close' then never fires.
function listProviders(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let child;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already gone */ }
      const providers = new Set();
      for (const line of out.split("\n").slice(1)) {
        const first = line.trim().split(/\s+/)[0];
        if (first) providers.add(first);
      }
      resolve(providers);
    };
    try {
      child = spawn("pi", [...args, "--list-models"], { stdio: ["ignore", "pipe", "ignore"], detached: true, env: scrubChildEnv(process.env, { keepAnthropic: true }) });
    } catch {
      resolve(new Set());
      return;
    }
    const t = setTimeout(finish, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => { out += c; });
    child.on("error", finish);
    child.on("exit", () => setTimeout(finish, 200));
    child.on("close", finish);
  });
}

// provider -> [extension paths] (in-memory, per process: never persisted, so
// a stub pi in tests can't poison a real cache).
const providerExtensionCache = new Map();
let builtinProvidersPromise = null;

async function providerExtensions(provider) {
  // Explicit override (also the test harness's switch): "none" or a
  // comma-separated list of extension specs, instead of probing.
  const override = process.env.PI_DELEGATE_PROVIDER_EXTENSIONS;
  if (override !== undefined) {
    if (override.trim() === "" || override.trim() === "none") return { paths: [], warning: null };
    const resolved = override.split(",").map((s) => resolveExtensionSpec(s.trim()));
    return {
      paths: resolved.filter((r) => r.ok).map((r) => r.value),
      warning: resolved.filter((r) => !r.ok).map((r) => r.error).join("; ") || null
    };
  }
  if (!provider) return { paths: [], warning: null };
  if (providerExtensionCache.has(provider)) return providerExtensionCache.get(provider);
  if (!builtinProvidersPromise) builtinProvidersPromise = listProviders(["--no-extensions"]);
  const builtin = await builtinProvidersPromise;
  let entry;
  if (builtin.has(provider)) {
    entry = { paths: [], warning: null };
  } else {
    const specs = Array.isArray(readPiSettings().packages) ? readPiSettings().packages : [];
    const candidates = specs
      .map((s) => resolveExtensionSpec(s))
      .filter((r) => r.ok && !r.value.startsWith("builtin:"))
      .map((r) => r.value)
      .filter((p) => p !== piSidePackageDir());
    const probes = await Promise.all(candidates.map(async (p) => ((await listProviders(["--no-extensions", "-e", p])).has(provider) ? p : null)));
    const paths = probes.filter(Boolean);
    entry = {
      paths,
      warning: paths.length ? null : `provider "${provider}" is not built in and no installed pi package provides it -- the child may fail to resolve its model`
    };
  }
  providerExtensionCache.set(provider, entry);
  return entry;
}

// Builds the lean flag set + env for a child. `ask` = { dir, timeoutMs, max }
// enables the pi-side ask_parent channel (conversations only: a blocking
// one-shot task can't be answered mid-call, same rule as the pi-side package).
// Returns { error } instead of a launch when the pi version gate fails.
// `provider` / `model` are exactly what the caller puts on pi's argv (null
// when omitted); `cwd` is the child's cwd (for pi's project settings).
// `tools` / `excludeTools` (string arrays, or null) become -t / -xt, kept
// consistent with ask_parent (0.11 §2.1 step 5): -t applies to extension
// tools too, so ask_parent is appended to an explicit allowlist; excluding
// ask_parent switches ask off (with a warning). askEnabled reflects the
// effective tool set, not just whether the pi-side package exists.
async function buildChildLaunch({ provider = null, model = null, cwd = null, projectConfig, ask = null, tools = null, excludeTools = null }) {
  const gate = await checkPiVersion();
  if (!gate.ok) return { error: gate.error };
  const target = childProviderCandidates({ provider, model, cwd });
  const loaded = [];
  const warnings = [];
  const add = (p) => { if (!loaded.includes(p)) loaded.push(p); };

  for (const p of target.providers.length ? target.providers : [null]) {
    const prov = await providerExtensions(p);
    prov.paths.forEach(add);
    if (prov.warning) warnings.push(prov.warning);
  }

  for (const spec of projectConfig.extensions || []) {
    const r = resolveExtensionSpec(spec);
    if (r.ok) add(r.value);
    else warnings.push(r.error);
  }

  // An ambiguous bare model pattern may resolve to anthropic, and stripping
  // the key then breaks the child mid-turn; keep ANTHROPIC_* in that case.
  const env = scrubChildEnv(process.env, { keepAnthropic: target.ambiguous || target.providers.includes("anthropic") });
  let askEnabled = false;
  const excluded = Array.isArray(excludeTools) ? excludeTools.slice() : [];
  if (ask && excluded.includes("ask_parent")) {
    warnings.push("exclude_tools contains ask_parent: ask is off for this child");
    ask = null;
  }
  if (ask) {
    const pkg = piSidePackageDir();
    if (pkg) {
      add(pkg);
      fs.mkdirSync(ask.dir, { recursive: true, mode: 0o700 });
      Object.assign(env, {
        PI_DELEGATE_CHILD: "1",
        PI_DELEGATE_ASK_DIR: ask.dir,
        PI_DELEGATE_ASK_TIMEOUT_MS: String(ask.timeoutMs),
        PI_DELEGATE_ASK_MAX: String(ask.max)
      });
      askEnabled = true;
    } else {
      warnings.push("pi-side @maheidem/pi-delegate package not installed -- ask_parent unavailable");
    }
  }

  const args = [...LEAN_FLAGS];
  for (const p of loaded) args.push("-e", p);
  if (Array.isArray(tools)) {
    const allow = tools.slice();
    if (askEnabled && !allow.includes("ask_parent")) allow.push("ask_parent");
    args.push("--tools", allow.join(","));
  }
  // Child mode also registers the pi-side `handoff` tool, whose contract ends
  // the turn without a final message; our completion reads the last assistant
  // text, so keep it out. One -xt list: a repeated flag would not merge.
  if (askEnabled && !excluded.includes("handoff")) excluded.push("handoff");
  if (excluded.length) args.push("--exclude-tools", excluded.join(","));
  return { args, env, extensions: loaded, askEnabled, warnings };
}

// ---------------------------------------------------------------------------
// Conversation support — session naming, cwd slug, per-conversation locks.
// ---------------------------------------------------------------------------

const MAX_SESSION_NAME_LENGTH = 128;

// Session names flow into pi's --session-id argv, into lockfile paths, and
// (for `end`) into a filesystem glob -- validate them as strictly as
// provider/model values, plus a length cap.
function sanitizeSessionName(name) {
  if (!isSafeArgValue(name)) {
    return { ok: false, error: `invalid conversation name ${JSON.stringify(name)}: must match [A-Za-z0-9._/:@-]+, no leading '-'` };
  }
  if (name.length > MAX_SESSION_NAME_LENGTH) {
    return { ok: false, error: `conversation name too long (max ${MAX_SESSION_NAME_LENGTH} chars)` };
  }
  return { ok: true, name };
}

// Port of pi's dist/core/session-manager.js getDefaultSessionDirPath encoding:
// `--${cwd with leading slash stripped, then / and : -> -}--`
// pi resolves the cwd to its PHYSICAL path (fs.realpathSync) before deriving
// the session slug -- on macOS /tmp, /var, etc. are symlinks into /private/...,
// so a lexical path.resolve() here would compute a directory pi never uses.
function resolvePhysicalCwd(cwd) {
  const resolved = path.resolve(cwd);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function sessionSlugForCwd(cwd) {
  const resolved = resolvePhysicalCwd(cwd);
  const stripped = resolved.replace(/^[/\\]/, "");
  const replaced = stripped.replace(/[/\\:]/g, "-");
  return `--${replaced}--`;
}

// pi's getDefaultSessionDirPath: <agentDir>/sessions/<slug>, where agentDir
// honours PI_CODING_AGENT_DIR (the children inherit it, so they write there).
function piSessionsDir(cwd) {
  return path.join(piAgentDir(), "sessions", sessionSlugForCwd(cwd));
}

function lockDir() {
  return path.join(os.tmpdir(), "pi-delegate-locks");
}

// A session name as one path component: encodes "/", ":", "." so a name can
// never leave its parent dir, and uppercase ("Foo" -> "%5Efoo") so two names
// that differ only in case never share a file on a case-insensitive
// filesystem (APFS). Identity for [a-z0-9_-] names.
function fsSafeName(name) {
  return encodeURIComponent(String(name).replace(/[A-Z]/g, (c) => `^${c.toLowerCase()}`)).replace(/\./g, "%2E");
}

function lockPathFor(cwd, sessionName) {
  return path.join(lockDir(), `${sessionSlugForCwd(cwd)}__${fsSafeName(sessionName)}.lock`);
}

// Turn-scoped control FIFO, colocated with the lockfile so a single
// lockDir()/mkdirSync covers both -- and so the lockfile's PID is a ready-made
// liveness oracle for steer/interrupt (existence of the FIFO path is NOT
// liveness; see runConversationSteer).
function fifoPathFor(cwd, sessionName) {
  return `${lockPathFor(cwd, sessionName)}.fifo`;
}

// Shared by runConversationEnd and readConversation -- do not duplicate the
// glob logic. Returns absolute paths, in readdirSync's (unspecified) order.
// pi names a session file "<timestamp>_<sessionId>.jsonl" and the timestamp
// has no "_", so the id is everything after the FIRST "_" and must equal
// sessionName exactly: a suffix match would hand "x-g1" the files of "y_x-g1"
// (names may contain "_"), and pi_stop {forget:true} would delete them.
function findSessionFiles(dir, sessionName) {
  const want = `${sessionName}.jsonl`;
  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((f) => {
        const i = f.indexOf("_");
        return i > 0 && f.slice(i + 1) === want;
      })
      .map((f) => path.join(dir, f));
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "ESRCH") return false;
    if (err && err.code === "EPERM") return true; // alive, different user
    return true; // unknown errno -- assume alive, fail loud rather than steal
  }
}

// A lockfile holds either a bare pid (per-turn CLI/legacy locks) or, for an
// MCP server's lifetime lock (0.11 §4.3), a JSON stamp
// {serverPid, serverStart, ...}. Returns { pid, start, stamp } (pid null when
// unreadable).
function readLockOwner(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, "utf8").trim();
  } catch {
    return { pid: null, start: null, stamp: null, missing: true };
  }
  if (raw.startsWith("{")) {
    try {
      const stamp = JSON.parse(raw);
      const pid = Number(stamp.serverPid);
      return { pid: Number.isInteger(pid) && pid > 0 ? pid : null, start: typeof stamp.serverStart === "string" ? stamp.serverStart : null, stamp };
    } catch {
      return { pid: null, start: null, stamp: null };
    }
  }
  const pid = Number(raw);
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : null, start: null, stamp: null };
}

function procStartOf(pid) {
  try {
    // LC_ALL=C: ps prints lstart in the user's locale otherwise.
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
  } catch {
    return "";
  }
}

// The lock's owner is gone: pid dead, or (stamped locks) pid reused, i.e. its
// start time differs from the stamp.
function lockOwnerGone(owner) {
  if (!owner.pid) return false;
  if (!isPidAlive(owner.pid)) return true;
  return !!owner.start && procStartOf(owner.pid) !== owner.start;
}

// A lock is reclaimed (deleted because its owner is dead) only under a short
// reclaim mutex, and only while the file still holds exactly the dead owner's
// content that was read: a plain read-unlink-create lets two callers both see
// the same dead owner, the first unlink and create its own lock, and the
// second unlink that live lock (then both hold it, or nobody does). mkdir is
// atomic, so `${lockPath}.reclaim` admits one reclaimer at a time; one left by
// a crashed reclaimer is broken after RECLAIM_MUTEX_STALE_MS. Creating a lock
// (open wx) needs no mutex: only a delete can steal one.
const RECLAIM_MUTEX_STALE_MS = 5000;

function readLockRaw(lockPath) {
  try {
    return fs.readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
}

// Deletes the lock only if it still reads `seenRaw` (a dead owner's content).
// Returns true when the path is free afterwards (deleted here, or already
// gone), false when it changed or another reclaimer is at work.
function reclaimStaleLock(lockPath, seenRaw) {
  const mutex = `${lockPath}.reclaim`;
  try {
    fs.mkdirSync(mutex);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      try {
        if (Date.now() - fs.statSync(mutex).mtimeMs > RECLAIM_MUTEX_STALE_MS) fs.rmdirSync(mutex);
      } catch {
        /* someone else broke or released it */
      }
    }
    return false;
  }
  try {
    const raw = readLockRaw(lockPath);
    if (raw === null) return true;
    if (raw !== seenRaw) return false;
    try {
      fs.unlinkSync(lockPath);
    } catch (err) {
      if (!err || err.code !== "ENOENT") return false;
    }
    return true;
  } finally {
    try {
      fs.rmdirSync(mutex);
    } catch {
      /* best-effort */
    }
  }
}

// Releases a lock whose owner is dead (a dead server's lifetime lock, a dead
// CLI's turn lock), atomically against a live caller taking the path at the
// same moment. Never touches a live owner's lock. Returns true when it was
// released.
function reclaimIfDead(lockPath) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = readLockRaw(lockPath);
    if (raw === null) return false;
    const owner = readLockOwner(lockPath);
    if (owner.missing || readLockRaw(lockPath) !== raw) continue;
    if (!lockOwnerGone(owner)) return false;
    if (reclaimStaleLock(lockPath, raw)) return true;
    if (readLockRaw(lockPath) !== raw) return false; // changed hands: not ours to judge again
    sleepSync(5);
  }
  return false;
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* no Atomics.wait: spin is not worth it, just retry */
  }
}

// PID-liveness-only lock: dead lock owner => reclaim (compare-and-swap, see
// reclaimStaleLock); alive owner => fail loud, no wait, no wall-clock timeout
// (owner decision D-B).
// `stamp` (an object) is written as JSON instead of the bare pid: the MCP
// server's lifetime lock records {serverPid, serverStart} so a reused pid is
// recognised as stale too. heldBy carries the holder's stamp, when it has one.
function acquireLock(lockPath, stamp = null) {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch {
    /* best-effort -- openSync below will surface any real problem */
  }

  const content = stamp ? JSON.stringify(stamp) : String(process.pid);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, content);
      fs.closeSync(fd);
      return { acquired: true, heldByPid: null };
    } catch (err) {
      if (!err || err.code !== "EEXIST") {
        return { acquired: false, heldByPid: null, error: err && err.message ? err.message : String(err) };
      }

      const raw = readLockRaw(lockPath);
      if (raw === null) continue; // released between our open and read
      const owner = readLockOwner(lockPath);
      // A creator writes after open: an empty/partial file is a live
      // acquirer mid-write, never a dead owner. Re-read until it settles.
      if (owner.missing || readLockRaw(lockPath) !== raw || (!owner.pid && raw.trim() === "")) {
        sleepSync(2);
        continue;
      }
      if (lockOwnerGone(owner)) {
        // Stale: reclaim only if it still holds what we judged dead, then retry.
        if (!reclaimStaleLock(lockPath, raw)) sleepSync(5);
        continue;
      }

      return { acquired: false, heldByPid: owner.pid || null, heldBy: owner.stamp };
    }
  }

  return { acquired: false, heldByPid: null, error: "lock contention after stale-reclaim retry" };
}

// `stamp` given: unlink only while the file still holds exactly that stamp
// (a takeover or another server may own the path now). Without it, the
// caller's own per-turn lock is released unconditionally, as before.
function releaseLock(lockPath, stamp = null) {
  if (!lockPath) return;
  if (stamp && readLockRaw(lockPath) !== JSON.stringify(stamp)) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* best-effort only */
  }
}

// ---------------------------------------------------------------------------
// Async spawn wrapper — replaces spawnSync to avoid the 64 MB maxBuffer cap.
// pi's --mode json NDJSON protocol re-emits the full accumulated message on
// every text_delta event, so total stdout grows quadratically with response
// length. An async spawn with chunk accumulation has no Node-imposed ceiling.
//
// stdio is explicitly ["ignore", "pipe", "pipe"] -- this is load-bearing, not
// stylistic. child_process.spawn() leaves stdin as an open, unfed, never-closed
// pipe by default; `pi` reads/checks stdin at startup, and an open-but-silent
// pipe makes it block forever (confirmed empirically: identical invocation
// hangs 20s+ with default stdio, completes in ~7s with stdin ignored). This is
// the actual fix for a real bug, not a preference -- do not revert it to plain
// `spawn(cmd, args, { cwd })` or the hang comes back on every single task, not
// just large ones.
//
// The child is spawned detached (its own process group) so that on timeout we
// can SIGTERM the whole group (pi plus any grandchildren), escalating to
// SIGKILL after 5s if the group ignores SIGTERM. We settle on 'close' in the
// common path, but also on 'exit' + a short grace timer so the promise still
// resolves if a grandchild keeps the stdio pipes open forever.
// ---------------------------------------------------------------------------

// Shared group-kill + timeout-escalation + settle-on-close-or-exit-grace
// machinery, extracted so both the task path (spawnManaged) and rpcRoundtrip
// (conversation path) get identical hygiene without duplicating it.
// `onStdoutChunk(chunk, ctx)` is called for every raw stdout chunk; `ctx`
// exposes `.child` (so a caller can write to stdin) and `.settleEarly(extra)`
// to resolve before the child exits (used by rpcRoundtrip once its expected
// responses have all arrived). If onStdoutChunk never calls settleEarly, the
// promise resolves the same way spawnManaged always has: on 'close', or on an
// 'exit' + ~1s drain grace if 'close' never fires (open grandchild pipes).
async function spawnManaged(cmd, args, { cwd, timeout, stdio, env, onStdoutChunk, onStderrChunk, onSpawn }) {
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let exitGraceTimer = null;

    function killGroup(sig) {
      try {
        process.kill(-child.pid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* already gone */
        }
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
      killTimer.unref?.();
    }, timeout);

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (exitGraceTimer) clearTimeout(exitGraceTimer);
      resolve(result);
    }

    function buildExitResult(code, signal, extra) {
      return {
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        status: code,
        signal,
        error: timedOut
          ? { code: "ETIMEDOUT", message: `Process was killed after ${timeout}ms` }
          : null,
        ...extra
      };
    }

    const child = spawn(cmd, args, {
      cwd,
      env: env || scrubChildEnv(process.env, { keepAnthropic: true }),
      stdio: stdio || ["ignore", "pipe", "pipe"],
      detached: true
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const ctx = {
      child,
      settleEarly(extra) {
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
        killTimer.unref?.();
        settle(buildExitResult(null, null, { earlySettle: true, ...extra }));
      }
    };

    if (onSpawn) onSpawn(ctx);

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      if (onStdoutChunk) onStdoutChunk(chunk, ctx);
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
      if (onStderrChunk) onStderrChunk(chunk, ctx);
    });

    child.on("error", (err) => {
      settle({
        stdout: "",
        stderr: "",
        status: null,
        signal: null,
        error: { code: err.code, message: err.message }
      });
    });

    child.on("close", (code, signal) => {
      settle(buildExitResult(code, signal));
    });

    // Guarantee resolution even if grandchildren keep the stdio pipes open
    // ('close' never fires): after 'exit', give the streams ~1s to drain,
    // then settle with whatever we have.
    child.on("exit", (code, signal) => {
      exitGraceTimer = setTimeout(() => {
        settle(buildExitResult(code, signal));
      }, 1000);
      exitGraceTimer.unref?.();
    });
  });
}

// Scans a completed RPC event stream for evidence the final turn actually
// failed (LLM/backend error) even though the stream settled cleanly.
// Returns an errorMessage string, or null if the turn looks healthy.
function detectErrorTurn(events) {
  let retryFailure = null;
  let lastStopReason = null;
  for (const evt of events) {
    if (evt && evt.type === "auto_retry_end" && evt.success === false) {
      retryFailure = evt.finalError || "auto-retry exhausted with a provider error";
    }
    if (evt && evt.type === "agent_end" && Array.isArray(evt.messages)) {
      for (const m of evt.messages) {
        if (m && m.role === "assistant" && m.stopReason) lastStopReason = m.stopReason;
      }
    }
  }
  if (lastStopReason === "error") {
    return retryFailure
      ? `pi turn failed: ${retryFailure}`
      : "pi turn ended with stopReason \"error\"";
  }
  if (retryFailure && lastStopReason === null) {
    return `pi turn failed: ${retryFailure}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// RPC roundtrip — `pi --mode rpc --session-id <name>` conversation primitive.
//
// Protocol grounding (verified live against pi 0.82.1, see docs/architecture.md):
//   - Command envelope: {"id"?, "type": "<verb>", ...}. `id` is optional --
//     we correlate purely on the `command` field of the response, sent
//     strictly sequentially (no pipelining), so a FIFO queue is sufficient.
//   - Response envelope: {"type":"response","command":"<verb>","success":bool,
//     "data"?, "error"?}.
//   - extension_ui_request events fire continuously as UI noise and do NOT
//     block agent_settled -- we still auto-reply {"cancelled":true} to each,
//     defensively, in case a future extension's dialog does block.
//   - Strict LF framing: buffer raw chunks, split on "\n", carry any partial
//     trailing fragment to the next chunk (same technique as spawnManaged's
//     trackProgress).
// ---------------------------------------------------------------------------

function newlineFramed(buffer, chunk) {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const pending = lines.pop() ?? "";
  return { lines: lines.map((l) => l.trim()).filter(Boolean), pending };
}

// Spawns `pi --mode rpc --session-id <name> [...sessionArgs]`, writes queued
// `commands` one JSONL line at a time (only advancing once that command's
// response arrives, or -- for "prompt" -- once agent_settled fires for the
// current turn generation), auto-cancels any extension_ui_request, and
// resolves once the queue drains and the final "prompt" (if any) has settled.
//
// The command list is a *mutable FIFO queue*, not a fixed array walked by a
// cursor -- `ctx.inject(cmd)` (exposed via the optional `onReady` hook) lets a
// caller push a command to the FRONT of the queue mid-flight, which is what
// steer/interrupt need: interrupt injects {type:"abort"} then a fresh
// {type:"prompt", message}, and must not resolve on the *aborted* turn's
// agent_settled -- only on the one that follows the reprompt. This is tracked
// with a `turnGeneration` counter, bumped each time a fresh prompt is injected
// via interrupt, and a `settledGeneration` compared against it.
async function rpcRoundtrip(sessionArgs, initialCommands, { cwd, timeout, onReady, env }) {
  let pendingLine = "";
  const events = [];
  const responsesByCommand = new Map();
  let settledFlag = false;
  let stdinClosed = false;

  const pendingCommands = [...initialCommands];
  let awaitingResponseFor = null; // type of the command currently in flight
  let awaitingSettle = false; // true once a prompt's response arrived, waiting on agent_settled
  let awaitingAbortSettle = false; // true once abort was written, waiting on the ABORTED turn's agent_settled
  let turnGeneration = 0;
  let settledGeneration = -1;
  const steered = [];
  let interrupted = false;
  let interruptPendingReprompt = null; // holds the {message} to send once the aborted turn settles

  function maybeClose(ctx) {
    if (
      pendingCommands.length === 0 &&
      awaitingResponseFor === null &&
      !awaitingSettle &&
      !awaitingAbortSettle &&
      !stdinClosed
    ) {
      stdinClosed = true;
      try {
        ctx.child.stdin.end();
      } catch {
        /* best-effort */
      }
    }
  }

  function sendNext(ctx) {
    if (awaitingResponseFor !== null || awaitingSettle) return;
    if (pendingCommands.length === 0) {
      maybeClose(ctx);
      return;
    }
    const cmd = pendingCommands.shift();
    awaitingResponseFor = cmd.type;
    try {
      ctx.child.stdin.write(JSON.stringify(cmd) + "\n");
    } catch {
      /* if this fails the roundtrip will time out and surface as a failure */
    }
  }

  // Pushes `cmd` to the FRONT of the queue and, if stdin is currently idle,
  // sends it immediately; otherwise sendNext() picks it up once the in-flight
  // command resolves.
  function inject(ctx, cmd) {
    pendingCommands.unshift(cmd);
    if (awaitingResponseFor === null && !awaitingSettle) {
      sendNext(ctx);
    }
  }

  const result = await spawnManaged("pi", ["--mode", "rpc", ...sessionArgs], {
    cwd,
    timeout,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    onSpawn: (ctx) => {
      ctx.inject = (cmd) => inject(ctx, cmd);
      // steer: fire-and-forget envelope, does not touch awaitingSettle/
      // turnGeneration -- it doesn't end the current turn.
      ctx.injectSteer = (message) => {
        try {
          ctx.child.stdin.write(JSON.stringify({ type: "steer", message }) + "\n");
          steered.push(message);
        } catch {
          /* best-effort -- caller already returned ok:true/queued to its own caller */
        }
      };
      // interrupt: write {type:"abort"} directly (bypassing the normal queue
      // -- it must cut in immediately even mid-turn, not wait for the current
      // hold on awaitingSettle). The reprompt is deferred until the ABORTED
      // turn's own agent_settled is observed (see that handler below); only
      // then is turnGeneration bumped and the new prompt sent -- this is the
      // ordering that keeps the aborted turn's agent_settled from being
      // mistaken for the new turn's completion.
      ctx.injectInterrupt = (message) => {
        interrupted = true;
        interruptPendingReprompt = { message };
        awaitingAbortSettle = true;
        try {
          ctx.child.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
        } catch {
          /* best-effort -- roundtrip will time out and surface as a failure */
        }
      };
      // Prime the pipe immediately: pi reads stdin at startup, and we must
      // never leave it open-but-unfed (see spawnManaged's stdio comment for the
      // documented hang hazard this avoids).
      sendNext(ctx);
      if (onReady) onReady(ctx);
    },
    onStdoutChunk: (chunk, ctx) => {
      const framed = newlineFramed(pendingLine, chunk);
      pendingLine = framed.pending;
      for (const line of framed.lines) {
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        events.push(evt);

        if (evt.type === "extension_ui_request" && evt.id) {
          try {
            ctx.child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: evt.id, cancelled: true }) + "\n");
          } catch {
            /* best-effort */
          }
          continue;
        }

        // response(abort) is written out-of-band by injectInterrupt (not via
        // the normal queue), so it never matches awaitingResponseFor -- it's
        // simply recorded in responsesByCommand above and otherwise ignored;
        // the reprompt is triggered by the aborted turn's agent_settled below.
        if (evt.type === "response" && evt.command) {
          responsesByCommand.set(evt.command, evt);
          if (evt.command === awaitingResponseFor) {
            const wasPrompt = evt.command === "prompt";
            awaitingResponseFor = null;

            if (wasPrompt) {
              // Response(prompt) only confirms enqueue, not completion --
              // hold until agent_settled fires for this turn generation.
              awaitingSettle = true;
            } else {
              sendNext(ctx);
            }
          }
        }

        if (evt.type === "agent_settled") {
          settledGeneration = turnGeneration;
          settledFlag = true;
          if (awaitingAbortSettle) {
            // This settle belongs to the ABORTED turn. Consume it here,
            // THEN bump turnGeneration and send the reprompt -- so the new
            // turn's own (later) agent_settled is the only one that can
            // match the bumped generation.
            awaitingAbortSettle = false;
            awaitingSettle = false;
            const reprompt = interruptPendingReprompt;
            interruptPendingReprompt = null;
            turnGeneration++;
            if (reprompt) inject(ctx, { type: "prompt", message: reprompt.message });
          } else if (awaitingSettle) {
            awaitingSettle = false;
            sendNext(ctx);
          }
        }
      }

      maybeClose(ctx);
      if (
        stdinClosed &&
        pendingCommands.length === 0 &&
        awaitingResponseFor === null &&
        !awaitingSettle &&
        !awaitingAbortSettle
      ) {
        ctx.settleEarly({ settled: settledFlag });
      }
    }
  });

  return {
    ok: !result.error,
    events,
    responsesByCommand,
    settled: settledFlag,
    settledGeneration,
    steered,
    interrupted,
    rawStdout: result.stdout ?? "",
    rawStderr: result.stderr ?? "",
    exitCode: typeof result.status === "number" ? result.status : null,
    error: result.error ?? null
  };
}

// ---------------------------------------------------------------------------
// Conversation subcommands: start | send | status | end
// ---------------------------------------------------------------------------

// The --provider / --model a session child gets: explicit opts, else the
// project pin (validated before it enters argv).
function sessionProviderModel(opts, projectConfig) {
  let configProvider = projectConfig.provider;
  let configModel = projectConfig.model;
  if (configProvider && !isSafeArgValue(configProvider)) configProvider = null;
  if (configModel && !isSafeArgValue(configModel)) configModel = null;
  return { provider: opts.provider || configProvider || null, model: opts.model || configModel || null };
}

function buildSessionArgs(opts, projectConfig) {
  const args = [];
  const { provider: effectiveProvider, model: effectiveModel } = sessionProviderModel(opts, projectConfig);

  if (effectiveProvider) args.push("--provider", effectiveProvider);
  if (effectiveModel) args.push("--model", effectiveModel);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  return args;
}

// FIFO control-channel lifecycle for a `send` invocation. Creates the FIFO,
// opens the read end non-blocking (r+ trick -- see module notes below), polls
// it on a timer, and dispatches complete JSON lines to the roundtrip's
// ctx.injectSteer/ctx.injectInterrupt. Returns a `stop()` cleanup that MUST be
// called from the same `finally` that releases the lock, unconditionally
// (every exit path, including the timeout/group-kill path) -- do not gate it
// on a "clean settle" boolean.
function startFifoRelay(fifoPath, ctx) {
  try {
    fs.unlinkSync(fifoPath);
  } catch {
    /* clear any stale leftover from a crash -- expected to usually be a no-op */
  }

  try {
    execFileSync("mkfifo", [fifoPath]);
  } catch (err) {
    // Can't create the control channel -- steer/interrupt simply won't be
    // available for this turn; the turn itself proceeds normally.
    console.error(`[pi-companion] failed to create control fifo at ${fifoPath}: ${err && err.message ? err.message : String(err)}`);
    return { stop() {} };
  }

  let fd = null;
  try {
    // Opening read-write (O_RDWR) never blocks waiting for a writer, unlike a
    // plain read-only open on a FIFO -- the standard trick to avoid the
    // reader-blocks-until-writer-opens problem. This fd stays open across the
    // whole turn regardless of whether steer/interrupt writers ever connect.
    //
    // O_NONBLOCK is load-bearing here, not optional: it governs *reads* on
    // this fd, not just the open() call. Without it, fs.readSync() below
    // blocks synchronously -- and since Node is single-threaded, a blocking
    // read freezes the ENTIRE event loop (including the roundtrip's own
    // --timeout, which is just a setTimeout that never gets a chance to
    // fire) the moment the poll timer's first tick finds no data waiting.
    // That happens on every real turn slower than one poll interval, i.e.
    // effectively always -- confirmed empirically: fs.openSync(fifoPath,
    // "r+") plus a blocking fs.readSync() hung for minutes on an idle FIFO
    // with no O_NONBLOCK set.
    fd = fs.openSync(fifoPath, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
  } catch (err) {
    console.error(`[pi-companion] failed to open control fifo at ${fifoPath}: ${err && err.message ? err.message : String(err)}`);
    try {
      fs.unlinkSync(fifoPath);
    } catch {
      /* best-effort */
    }
    return { stop() {} };
  }

  let buffer = "";
  const readBuf = Buffer.alloc(65536);

  function poll() {
    for (;;) {
      let n;
      try {
        n = fs.readSync(fd, readBuf, 0, readBuf.length, null);
      } catch (err) {
        // EAGAIN: no data ready right now -- expected, not an error.
        if (err && (err.code === "EAGAIN" || err.code === "EWOULDBLOCK")) break;
        // Any other error (e.g. fd went bad): stop trying this poll cycle.
        break;
      }
      if (!n) break;
      buffer += readBuf.toString("utf8", 0, n);
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let envelope;
        try {
          envelope = JSON.parse(line);
        } catch {
          continue; // malformed control line -- ignore, don't crash the turn
        }
        if (!envelope || typeof envelope.message !== "string") continue;
        if (envelope.kind === "steer") {
          ctx.injectSteer(envelope.message);
        } else if (envelope.kind === "interrupt") {
          ctx.injectInterrupt(envelope.message);
        }
      }
    }
  }

  const timer = setInterval(poll, FIFO_POLL_INTERVAL_MS);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
      try {
        fs.closeSync(fd);
      } catch {
        /* best-effort */
      }
      try {
        fs.unlinkSync(fifoPath);
      } catch {
        /* best-effort */
      }
    }
  };
}

async function runConversationSend(sessionName, messageText, opts) {
  const cwd = resolveCwd();
  const lockPath = lockPathFor(cwd, sessionName);
  const lock = acquireLock(lockPath);
  if (!lock.acquired) {
    return taskResult({
      sessionName,
      lockHeldByPid: lock.heldByPid,
      errorMessage: lock.heldByPid
        ? `conversation "${sessionName}" is busy (held by pid ${lock.heldByPid}) -- another process is mid-turn`
        : `failed to acquire conversation lock: ${lock.error || "unknown error"}`
    });
  }

  const fifoPath = fifoPathFor(cwd, sessionName);
  let fifoRelay = { stop() {} };

  try {
    const projectConfig = loadProjectConfig(cwd);
    const launch = await buildChildLaunch({ ...sessionProviderModel(opts, projectConfig), cwd, projectConfig });
    if (launch.error) return taskResult({ sessionName, errorMessage: launch.error });
    const sessionArgs = ["--session-id", sessionName, ...launch.args, ...buildSessionArgs(opts, projectConfig)];
    const roundtrip = await rpcRoundtrip(
      sessionArgs,
      [
        { type: "prompt", message: messageText },
        { type: "get_last_assistant_text" },
        { type: "get_state" },
        { type: "get_session_stats" }
      ],
      {
        cwd,
        timeout: opts.timeout,
        env: launch.env,
        onReady: (ctx) => {
          fifoRelay = startFifoRelay(fifoPath, ctx);
        }
      }
    );

    if (roundtrip.error) {
      const code = roundtrip.error.code;
      return taskResult({
        sessionName,
        steered: roundtrip.steered,
        interrupted: roundtrip.interrupted,
        errorMessage:
          code === "ENOENT"
            ? "pi CLI not found on PATH — run /pi-delegate:setup"
            : code === "ETIMEDOUT"
              ? `pi did not settle within ${opts.timeout}ms and was killed (timeout)`
              : `pi rpc invocation failed: ${code || roundtrip.error.message || String(roundtrip.error)}`,
        rawStdout: roundtrip.rawStdout,
        rawStderr: roundtrip.rawStderr,
        exitCode: roundtrip.exitCode
      });
    }

    const textResponse = roundtrip.responsesByCommand.get("get_last_assistant_text");
    if (!roundtrip.settled || !textResponse) {
      return taskResult({
        sessionName,
        steered: roundtrip.steered,
        interrupted: roundtrip.interrupted,
        errorMessage: "pi rpc stream ended without agent_settled + get_last_assistant_text response",
        rawStdout: roundtrip.rawStdout,
        rawStderr: roundtrip.rawStderr,
        exitCode: roundtrip.exitCode
      });
    }

    if (textResponse.success === false) {
      return taskResult({
        sessionName,
        steered: roundtrip.steered,
        interrupted: roundtrip.interrupted,
        errorMessage: textResponse.error || "get_last_assistant_text reported failure",
        rawStdout: roundtrip.rawStdout,
        rawStderr: roundtrip.rawStderr,
        exitCode: roundtrip.exitCode
      });
    }

    const stateResponse = roundtrip.responsesByCommand.get("get_state");
    const statsResponse = roundtrip.responsesByCommand.get("get_session_stats");
    const stateData = (stateResponse && stateResponse.data) || {};
    const statsData = (statsResponse && statsResponse.data) || {};

    const turnError = detectErrorTurn(roundtrip.events);
    if (turnError) {
      return taskResult({
        sessionName,
        steered: roundtrip.steered,
        interrupted: roundtrip.interrupted,
        errorMessage: turnError,
        rawStdout: roundtrip.rawStdout,
        rawStderr: roundtrip.rawStderr,
        exitCode: roundtrip.exitCode
      });
    }

    return taskResult({
      ok: true,
      sessionName,
      sessionId: stateData.sessionId ?? null,
      turnCount: statsData.userMessages ?? null,
      steered: roundtrip.steered,
      interrupted: roundtrip.interrupted,
      finalText: (textResponse.data && textResponse.data.text) || "",
      rawStdout: roundtrip.rawStdout,
      rawStderr: roundtrip.rawStderr,
      exitCode: roundtrip.exitCode
    });
  } finally {
    // FIFO cleanup is unconditional, alongside the lock release, on every
    // exit path -- including the timeout/group-kill path (spawnManaged's own
    // timeout already fires killGroup independently of this).
    fifoRelay.stop();
    releaseLock(lockPath);
  }
}

async function runConversationStart(sessionName, opts) {
  if (!opts.message) {
    // No first message: just validate/create the session with a cheap
    // get_state roundtrip (also acquires + releases the lock).
    const cwd = resolveCwd();
    const lockPath = lockPathFor(cwd, sessionName);
    const lock = acquireLock(lockPath);
    if (!lock.acquired) {
      return taskResult({
        sessionName,
        lockHeldByPid: lock.heldByPid,
        errorMessage: lock.heldByPid
          ? `conversation "${sessionName}" is busy (held by pid ${lock.heldByPid})`
          : `failed to acquire conversation lock: ${lock.error || "unknown error"}`
      });
    }
    try {
      const projectConfig = loadProjectConfig(cwd);
      const sessionArgs = ["--session-id", sessionName, ...LEAN_FLAGS, ...buildSessionArgs(opts, projectConfig)];
      const roundtrip = await rpcRoundtrip(sessionArgs, [{ type: "get_state" }], { cwd, timeout: opts.timeout });
      if (roundtrip.error) {
        return taskResult({
          sessionName,
          errorMessage: `failed to start conversation: ${roundtrip.error.code || roundtrip.error.message}`,
          rawStdout: roundtrip.rawStdout,
          rawStderr: roundtrip.rawStderr,
          exitCode: roundtrip.exitCode
        });
      }
      const stateResponse = roundtrip.responsesByCommand.get("get_state");
      const sessionId = stateResponse && stateResponse.data ? stateResponse.data.sessionId : null;
      return taskResult({
        ok: true,
        sessionName,
        sessionId,
        rawStdout: roundtrip.rawStdout,
        rawStderr: roundtrip.rawStderr,
        exitCode: roundtrip.exitCode
      });
    } finally {
      releaseLock(lockPath);
    }
  }

  // With a first message, `start` is just `send` against a fresh/reused name.
  return runConversationSend(sessionName, opts.message, opts);
}

async function runConversationStatus(sessionName, opts) {
  // Read-only: deliberately does NOT acquire the lock (see architecture.md
  // D-B follow-up) -- safe to run concurrently with an in-flight send.
  const cwd = resolveCwd();
  // State/stats need no model or extensions: lean spawn, and a real default
  // timeout (an undefined one armed a ~1ms kill timer -- every status failed).
  const sessionArgs = ["--session-id", sessionName, ...LEAN_FLAGS];
  const timeout = Number.isInteger(opts.timeout) && opts.timeout > 0 ? opts.timeout : STATUS_TIMEOUT_MS;
  const roundtrip = await rpcRoundtrip(
    sessionArgs,
    [{ type: "get_state" }, { type: "get_session_stats" }],
    { cwd, timeout }
  );

  if (roundtrip.error) {
    return taskResult({
      sessionName,
      errorMessage: `failed to query conversation status: ${roundtrip.error.code || roundtrip.error.message}`,
      rawStdout: roundtrip.rawStdout,
      rawStderr: roundtrip.rawStderr,
      exitCode: roundtrip.exitCode
    });
  }

  const stateResponse = roundtrip.responsesByCommand.get("get_state");
  const statsResponse = roundtrip.responsesByCommand.get("get_session_stats");
  const stateData = (stateResponse && stateResponse.data) || {};
  const statsData = (statsResponse && statsResponse.data) || {};

  return taskResult({
    ok: true,
    sessionName,
    sessionId: stateData.sessionId ?? null,
    // pi's get_session_stats has no `turnCount` field -- one user message
    // per turn in this protocol, so userMessages is the correct mapping.
    // (messageCount from get_state counts user+assistant together and is a
    // different metric -- do not fall back to it.)
    turnCount: statsData.userMessages ?? null,
    summary: JSON.stringify({ state: stateData, stats: statsData }),
    rawStdout: roundtrip.rawStdout,
    rawStderr: roundtrip.rawStderr,
    exitCode: roundtrip.exitCode
  });
}

async function runConversationEnd(sessionName, opts) {
  const cwd = resolveCwd();
  const lockPath = lockPathFor(cwd, sessionName);
  const lock = acquireLock(lockPath);
  if (!lock.acquired) {
    return taskResult({
      sessionName,
      lockHeldByPid: lock.heldByPid,
      errorMessage: lock.heldByPid
        ? `conversation "${sessionName}" is busy (held by pid ${lock.heldByPid}) -- cannot end it right now`
        : `failed to acquire conversation lock: ${lock.error || "unknown error"}`
    });
  }

  const deletedFiles = [];
  try {
    const dir = piSessionsDir(cwd);
    let matches;
    try {
      matches = findSessionFiles(dir, sessionName);
    } catch (err) {
      return taskResult({
        sessionName,
        errorMessage: `failed to list session directory: ${err && err.message ? err.message : String(err)}`
      });
    }

    // Delete EVERY matching file, not just the first -- more than one file
    // can match after a crash/stale-lock-reclaim recovery (a killed `send`
    // can leave pi starting a fresh timestamped file rather than resuming a
    // partially-flushed one). Silently dropping orphans is the bug; surface
    // all of them in the summary instead.
    for (const fullPath of matches) {
      try {
        fs.unlinkSync(fullPath);
        deletedFiles.push(fullPath);
      } catch (err) {
        if (!err || err.code !== "ENOENT") {
          return taskResult({
            sessionName,
            errorMessage: `failed to remove session file ${fullPath}: ${err && err.message ? err.message : String(err)}`
          });
        }
      }
    }
  } finally {
    // `end`'s lock release IS the cleanup step (deleting the lockfile), not a
    // generic finally-then-unlink -- release exactly once here.
    releaseLock(lockPath);
  }

  return taskResult({
    ok: true,
    sessionName,
    summary: deletedFiles.length
      ? `removed session file(s): ${deletedFiles.join(", ")}`
      : "no session file found (already ended, or never started)"
  });
}

// ---------------------------------------------------------------------------
// Conversation subcommand: read — render a session jsonl tail, lock-free.
// ---------------------------------------------------------------------------

function gistText(text, max = 80) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function gistJson(value, max = 80) {
  let s;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  return gistText(s, max);
}

// Render one parsed jsonl line into { timestamp, role, gist } or null if the
// line doesn't carry a renderable message. Never throws -- a tool call with
// no result yet (mid-turn state) renders as "(pending)", not an exception.
function renderEntry(parsed) {
  const message = parsed && parsed.message;
  if (!message || !message.role) return null;

  const ts = typeof message.timestamp === "number" ? message.timestamp : null;
  const role = message.role;
  const content = Array.isArray(message.content) ? message.content : [];

  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(gistText(item.text));
    } else if (item.type === "toolCall") {
      const name = item.name ?? item.toolName ?? "unknown";
      parts.push(`[tool:${name} ${gistJson(item.arguments ?? item.args ?? {})}]`);
    } else if (item.type === "toolResult") {
      const hasOutput = item.output !== undefined || item.result !== undefined || item.content !== undefined;
      parts.push(hasOutput ? `-> ${gistJson(item.output ?? item.result ?? item.content)}` : "-> (pending)");
    }
  }

  return {
    timestamp: ts,
    role,
    gist: parts.join(" ") || "(no content)"
  };
}

// Shared by --json and text-mode output. Builds { entries, truncatedLines }
// from raw jsonl lines. Renders STRICTLY in file order -- never sort by
// timestamp; steer-injected messages are stamped at enqueue time but
// positioned in the file at their actual delivery point, so file order is the
// only order that reflects what really happened.
function renderSessionEntries(rawLines) {
  const entries = [];
  let truncatedLines = 0;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      truncatedLines++;
      continue;
    }
    const rendered = renderEntry(parsed);
    if (!rendered) continue;
    entries.push({ ...rendered, raw: parsed });
  }

  return { entries, truncatedLines };
}

function formatEntryLine(entry) {
  const hhmmss = entry.timestamp != null ? new Date(entry.timestamp).toTimeString().slice(0, 8) : "??:??:??";
  return `${hhmmss} ${entry.role}: ${entry.gist}`;
}

async function readConversation(sessionName, opts) {
  const cwd = resolveCwd();
  const dir = piSessionsDir(cwd);

  let matches;
  try {
    matches = findSessionFiles(dir, sessionName);
  } catch (err) {
    return taskResult({
      sessionName,
      errorMessage: `failed to list session directory: ${err && err.message ? err.message : String(err)}`
    });
  }

  if (matches.length === 0) {
    return taskResult({
      sessionName,
      errorMessage: `no session found for "${sessionName}"`
    });
  }

  let chosen = matches[0];
  let warning = null;
  if (matches.length > 1) {
    // Ambiguous -- pick the most recently modified, don't silently take
    // readdirSync's unspecified [0] ordering.
    let bestMtime = -Infinity;
    for (const f of matches) {
      let mtimeMs;
      try {
        mtimeMs = fs.statSync(f).mtimeMs;
      } catch {
        continue;
      }
      if (mtimeMs > bestMtime) {
        bestMtime = mtimeMs;
        chosen = f;
      }
    }
    warning = `${matches.length} session files matched "${sessionName}"; using the most recently modified: ${chosen}`;
  }

  let raw;
  try {
    raw = fs.readFileSync(chosen, "utf8");
  } catch (err) {
    return taskResult({
      sessionName,
      errorMessage: `failed to read session file ${chosen}: ${err && err.message ? err.message : String(err)}`
    });
  }

  const { entries, truncatedLines } = renderSessionEntries(raw.split("\n"));
  const sliced = opts.last != null ? entries.slice(-opts.last) : entries;

  if (opts.json) {
    return taskResult({
      ok: true,
      sessionName,
      warning,
      summary: JSON.stringify({
        entries: sliced.map((e) => ({ timestamp: e.timestamp, role: e.role, gist: e.gist, raw: e.raw })),
        truncatedLines,
        sessionFile: chosen
      })
    });
  }

  const text = sliced.map(formatEntryLine).join("\n");
  return taskResult({
    ok: true,
    sessionName,
    warning,
    finalText: text,
    summary: `${sliced.length} entr${sliced.length === 1 ? "y" : "ies"} from ${chosen}${truncatedLines ? ` (${truncatedLines} unparseable line(s) skipped)` : ""}`
  });
}

// ---------------------------------------------------------------------------
// Conversation subcommands: steer | interrupt — write into the turn-scoped
// control FIFO created by an in-flight `send`. Both are pure client-side
// writers: they validate, check liveness, write one envelope line, and return
// immediately (ok:true, queued:true) without waiting for delivery or settle.
// ---------------------------------------------------------------------------

function validateSteerMessage(message) {
  const trimmed = (message ?? "").trim();
  if (!trimmed) return { ok: false, error: "message must not be empty" };
  if (Buffer.byteLength(trimmed, "utf8") > STEER_MESSAGE_MAX_BYTES) {
    return { ok: false, error: `message exceeds ${STEER_MESSAGE_MAX_BYTES} byte limit` };
  }
  return { ok: true, message: trimmed };
}

// Liveness check shared by steer/interrupt: existence of the FIFO path is NOT
// liveness -- a crashed `send` can leave an orphaned FIFO with no reader. The
// lockfile's PID (the same file acquireLock/isPidAlive already parse) is the
// actual liveness oracle.
function isConversationLive(lockPath) {
  const owner = readLockOwner(lockPath);
  if (owner.missing) return false; // no lockfile -- idle
  return !!owner.pid && isPidAlive(owner.pid);
}

async function writeToFifo(sessionName, kind, messageText) {
  const cwd = resolveCwd();
  const lockPath = lockPathFor(cwd, sessionName);
  const fifoPath = fifoPathFor(cwd, sessionName);

  const validated = validateSteerMessage(messageText);
  if (!validated.ok) {
    return taskResult({ sessionName, errorMessage: validated.error });
  }

  if (!isConversationLive(lockPath)) {
    return taskResult({ sessionName, errorMessage: "conversation is idle — use send" });
  }

  let fd;
  try {
    // Non-blocking open of the write end: if there's no reader present
    // (send closed its read end between our liveness check and here -- a
    // real TOCTOU race), this throws ENXIO. Treat that the same as idle,
    // rather than letting an unhandled exception through -- a deliberate
    // second layer beyond the lockfile-PID check above, not redundant with it.
    fd = fs.openSync(fifoPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
  } catch (err) {
    if (err && err.code === "ENXIO") {
      return taskResult({ sessionName, errorMessage: "conversation is idle — use send" });
    }
    return taskResult({ sessionName, errorMessage: `failed to open control channel: ${err && err.message ? err.message : String(err)}` });
  }

  try {
    fs.writeSync(fd, JSON.stringify({ kind, message: validated.message }) + "\n");
  } catch (err) {
    return taskResult({ sessionName, errorMessage: `failed to write to control channel: ${err && err.message ? err.message : String(err)}` });
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* best-effort */
    }
  }

  return taskResult({
    ok: true,
    sessionName,
    queued: true,
    summary: `${kind} queued`,
    steered: kind === "steer" ? [validated.message] : [],
    interrupted: kind === "interrupt"
  });
}

async function runConversationSteer(sessionName, messageText) {
  return writeToFifo(sessionName, "steer", messageText);
}

async function runConversationInterrupt(sessionName, messageText) {
  return writeToFifo(sessionName, "interrupt", messageText);
}

// pi get_session_stats -> the numbers worth surfacing (tokens drive the
// lean-children before/after measurement).
function usageFrom(statsResponse) {
  const d = statsResponse && statsResponse.success !== false ? statsResponse.data : null;
  if (!d) return null;
  const t = d.tokens || {};
  return {
    inputTokens: t.input ?? null,
    outputTokens: t.output ?? null,
    cacheReadTokens: t.cacheRead ?? null,
    totalTokens: t.total ?? null,
    contextTokens: (d.contextUsage && d.contextUsage.tokens) ?? null,
    cost: d.cost ?? null
  };
}

// One-shot RPC completion for the task verb (sole contract since 0.7.0; the legacy marker path was removed in Phase 3, ADR §3).
// The project pin (.claude/pi-delegate.local.md) wins over a caller's
// provider/model (0.11 §2.1 step 2, §6.2): with a pin, an explicit value that
// differs from it is refused (same rule as orchestrator-mode's pi-mode hook:
// a key the pin leaves unset may not be given either). Returns the refusal
// text, or null.
// Pin values that fail isSafeArgValue are ignored everywhere (they never
// reach argv), so they don't count as a pin here either.
function validPin(projectConfig) {
  const pc = projectConfig || {};
  const pin = {
    provider: pc.provider && isSafeArgValue(pc.provider) ? pc.provider : null,
    model: pc.model && isSafeArgValue(pc.model) ? pc.model : null
  };
  return pin.provider || pin.model ? pin : null;
}
function pinLabel(projectConfig) {
  const pin = validPin(projectConfig);
  return pin ? [pin.provider, pin.model].filter(Boolean).join("/") : null;
}
function pinConflict(projectConfig, provider, model) {
  const pin = validPin(projectConfig);
  if (!pin) return null;
  const asked = { provider: provider || null, model: model || null };
  const bad = Object.keys(asked).filter((k) => asked[k] && asked[k] !== pin[k]);
  if (!bad.length) return null;
  return `model is pinned to ${pinLabel(projectConfig)} for this project; omit provider/model (asked for ${bad.map((k) => `${k}=${asked[k]}`).join(", ")})`;
}

async function runTaskRpc(opts) {
  if (!opts.text) {
    return taskResult({ errorMessage: "no task text provided" });
  }

  const cwd = resolveCwd();
  const projectConfig = loadProjectConfig(cwd);
  const pinned = pinConflict(projectConfig, opts.provider, opts.model);
  if (pinned) return taskResult({ errorMessage: pinned });

  // Values loaded from project config are validated before entering pi's argv
  // (a leading '-' could be interpreted as a flag). Explicit CLI flags are the
  // caller's responsibility.
  let configProvider = projectConfig.provider;
  let configModel = projectConfig.model;
  if (configProvider && !isSafeArgValue(configProvider)) {
    console.error(`[pi-companion] ignoring invalid provider from project config: ${configProvider}`);
    configProvider = null;
  }
  if (configModel && !isSafeArgValue(configModel)) {
    console.error(`[pi-companion] ignoring invalid model from project config: ${configModel}`);
    configModel = null;
  }

  const effectiveProvider = opts.provider || configProvider;
  const effectiveModel = opts.model || configModel;

  const launch = await buildChildLaunch({ provider: effectiveProvider, model: effectiveModel, cwd, projectConfig });
  if (launch.error) return taskResult({ errorMessage: launch.error });
  const args = ["--no-session", ...launch.args];
  if (effectiveProvider) args.push("--provider", effectiveProvider);
  if (effectiveModel) args.push("--model", effectiveModel);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  if (opts.tools) args.push("--tools", opts.tools);
  if (opts.excludeTools) args.push("--exclude-tools", opts.excludeTools);

  const roundtrip = await rpcRoundtrip(
    args,
    [
      { type: "prompt", message: opts.text },
      { type: "get_last_assistant_text" },
      { type: "get_session_stats" }
    ],
    { cwd, timeout: opts.timeout, env: launch.env }
  );
  const childInfo = {
    childExtensions: launch.extensions,
    warning: launch.warnings.length ? launch.warnings.join("; ") : null,
    usage: usageFrom(roundtrip.responsesByCommand.get("get_session_stats"))
  };

  if (roundtrip.error) {
    const code = roundtrip.error.code;
    return taskResult({
      ...childInfo,
      errorMessage:
        code === "ENOENT"
          ? "pi CLI not found on PATH — run /pi-delegate:setup"
          : code === "ETIMEDOUT"
            ? `pi did not settle within ${opts.timeout}ms and was killed (timeout)`
            : `pi rpc invocation failed: ${code || roundtrip.error.message || String(roundtrip.error)}`,
      rawStdout: roundtrip.rawStdout,
      rawStderr: roundtrip.rawStderr,
      exitCode: roundtrip.exitCode
    });
  }

  const textResponse = roundtrip.responsesByCommand.get("get_last_assistant_text");
  if (!roundtrip.settled || !textResponse) {
    return taskResult({
      ...childInfo,
      errorMessage: "pi rpc stream ended without agent_settled + get_last_assistant_text response",
      rawStdout: roundtrip.rawStdout,
      rawStderr: roundtrip.rawStderr,
      exitCode: roundtrip.exitCode
    });
  }

  if (textResponse.success === false) {
    return taskResult({
      ...childInfo,
      errorMessage: textResponse.error || "get_last_assistant_text reported failure",
      rawStdout: roundtrip.rawStdout,
      rawStderr: roundtrip.rawStderr,
      exitCode: roundtrip.exitCode
    });
  }

  const turnError = detectErrorTurn(roundtrip.events);
  if (turnError) {
    return taskResult({
      ...childInfo,
      errorMessage: turnError,
      rawStdout: roundtrip.rawStdout,
      rawStderr: roundtrip.rawStderr,
      exitCode: roundtrip.exitCode
    });
  }

  return taskResult({
      ...childInfo,
    ok: true,
    finalText: (textResponse.data && textResponse.data.text) || "",
    rawStdout: roundtrip.rawStdout,
    rawStderr: roundtrip.rawStderr,
    exitCode: roundtrip.exitCode
  });
}



function printTaskResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.ok) {
    console.log(result.finalText ?? "");
  } else {
    console.log(`pi task failed: ${result.errorMessage}`);
    if (result.rawStderr) {
      console.log("--- stderr ---");
      console.log(result.rawStderr);
    }
  }
}

// ---------------------------------------------------------------------------
// list-models subcommand — enumerate available provider/model combinations
// ---------------------------------------------------------------------------

function runListModels() {
  let result;
  try {
    result = spawnSync("pi", ["--list-models"], {
      env: scrubChildEnv(process.env, { keepAnthropic: true }),
      encoding: "utf8",
      timeout: 15000
    });
  } catch (err) {
    result = { error: err };
  }

  if (!result || result.error) {
    const code = result && result.error ? result.error.code : null;
    return {
      ok: false,
      models: [],
      rawOutput: "",
      errorMessage:
        code === "ENOENT"
          ? "pi CLI not found on PATH — run: npm install -g @earendil-works/pi-coding-agent"
          : `failed to run 'pi --list-models': ${code || (result && result.error && result.error.message) || "unknown error"}`
    };
  }

  if (typeof result.status === "number" && result.status !== 0) {
    let msg = `'pi --list-models' exited with status ${result.status}`;
    if (result.stderr && result.stderr.trim()) msg += `: ${result.stderr.trim().slice(-500)}`;
    return {
      ok: false,
      models: [],
      rawOutput: (result.stdout || "").trim(),
      errorMessage: msg
    };
  }

  const raw = (result.stdout || "").trim();
  const lines = raw.split("\n").filter((l) => l.trim());

  // Format: provider  model  context  max-out  thinking  images
  // Detect the header by content instead of blindly skipping line 0.
  const models = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i === 0 && /provider\s+model/i.test(line)) continue;
    const parts = line.split(/\s{2,}/);
    if (parts.length >= 2) {
      models.push({
        provider: parts[0].trim(),
        model: parts[1].trim()
      });
    } else {
      console.error(`[pi-companion] list-models: could not parse line: ${line}`);
    }
  }

  return {
    ok: true,
    models,
    rawOutput: raw,
    errorMessage: null
  };
}

function printListModelsResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    console.log(`list-models failed: ${result.errorMessage}`);
    return;
  }

  console.log(result.rawOutput);
}

// ---------------------------------------------------------------------------
// write-config subcommand — write/overwrite project config file
// ---------------------------------------------------------------------------

function runWriteConfig(provider, model) {
  const cwd = resolveCwd();
  const configDir = path.join(cwd, ".claude");
  const configPath = path.join(configDir, "pi-delegate.local.md");

  if (!provider && !model) {
    return {
      ok: false,
      configPath,
      errorMessage: "at least one of --provider or --model is required"
    };
  }

  // Reject values that could break the frontmatter or smuggle flags:
  // newlines, '---', leading '-', or chars outside [A-Za-z0-9._/:@-].
  for (const [label, value] of [["provider", provider], ["model", model]]) {
    if (value != null && (!isSafeArgValue(value) || value.includes("---"))) {
      return {
        ok: false,
        configPath,
        errorMessage: `invalid ${label} value ${JSON.stringify(value)}: must match [A-Za-z0-9._/:@-]+, no leading '-', no newlines, no '---'`
      };
    }
  }

  try {
    // Ensure .claude directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    let raw = "";
    try { raw = fs.readFileSync(configPath, "utf8"); } catch (err) { if (err.code !== "ENOENT") throw err; }
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (raw.startsWith("---") && !fm) throw new Error("invalid project frontmatter");
    const lines = fm ? fm[1].split(/\r?\n/).filter(line => !/^(provider|model)\s*:/.test(line)) : [];
    if (provider) lines.push(`provider: ${provider}`);
    if (model) lines.push(`model: ${model}`);
    const frontmatter = `---\n${lines.join("\n")}\n---\n` + (fm ? raw.slice(fm[0].length) : raw);

    fs.writeFileSync(configPath, frontmatter, "utf8");

    return {
      ok: true,
      configPath,
      provider,
      model,
      errorMessage: null
    };
  } catch (err) {
    return {
      ok: false,
      configPath,
      errorMessage: `failed to write config: ${err && err.message ? err.message : String(err)}`
    };
  }
}

function printWriteConfigResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.ok) {
    console.log(`Wrote ${result.scope || "project"} config: ${result.configPath}`);
    if (result.settings) for (const [key, value] of Object.entries(result.settings)) console.log(`  ${key}: ${value}`);
    if (result.provider) console.log(`  provider: ${result.provider}`);
    if (result.model) console.log(`  model: ${result.model}`);
  } else {
    console.log(`write-config failed: ${result.errorMessage}`);
  }
}

// ---------------------------------------------------------------------------
// remove-config subcommand — delete project config file
// ---------------------------------------------------------------------------

function runRemoveConfig() {
  const cwd = resolveCwd();
  const configPath = path.join(cwd, ".claude", "pi-delegate.local.md");

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      const lines = fm ? fm[1].split(/\r?\n/).filter(line => !/^(provider|model)\s*:/.test(line)) : [];
      const body = fm ? raw.slice(fm[0].length) : raw;
      if (lines.some(line => line.trim()) || body.trim()) fs.writeFileSync(configPath, `---\n${lines.join("\n")}\n---\n${body}`, "utf8");
      else fs.unlinkSync(configPath);
    }
    return {
      ok: true,
      configPath,
      errorMessage: null
    };
  } catch (err) {
    return {
      ok: false,
      configPath,
      errorMessage: `failed to remove config: ${err && err.message ? err.message : String(err)}`
    };
  }
}

function printRemoveConfigResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.ok) {
    console.log(`Removed project config: ${result.configPath}`);
  } else {
    console.log(`remove-config failed: ${result.errorMessage}`);
  }
}

// ---------------------------------------------------------------------------
// setup subcommand — readiness check, runnable standalone (no Claude Code)
// ---------------------------------------------------------------------------

function runSetup() {
  const cwd = resolveCwd();
  const summary = {
    ok: false,
    piInstalled: false,
    piVersion: null,
    settingsPath: PI_SETTINGS_PATH,
    settingsFound: false,
    defaultProvider: null,
    defaultModel: null,
    projectConfigPath: path.join(cwd, ".claude", "pi-delegate.local.md"),
    projectConfigFound: false,
    projectConfigProvider: null,
    projectConfigModel: null,
    projectConfigExtensions: [],
    delegateSettings: resolveSettings(cwd),
    extensionWarnings: [],
    leanChildren: true,
    askParentPackage: piSidePackageDir(),
    askParentAvailable: piSidePackageDir() !== null,
    errorMessage: null
  };

  let versionResult;
  try {
    versionResult = spawnSync("pi", ["--version"], { encoding: "utf8", timeout: 15000, env: scrubChildEnv(process.env, { keepAnthropic: true }) });
  } catch (err) {
    versionResult = { error: err };
  }

  if (!versionResult || versionResult.error) {
    const code = versionResult && versionResult.error ? versionResult.error.code : null;
    summary.errorMessage =
      code === "ENOENT"
        ? "pi CLI not found on PATH — run: npm install -g @earendil-works/pi-coding-agent"
        : `failed to run 'pi --version': ${code || (versionResult && versionResult.error && versionResult.error.message) || "unknown error"}`;
  } else if (typeof versionResult.status === "number" && versionResult.status !== 0) {
    summary.errorMessage = `'pi --version' exited with status ${versionResult.status}`;
    if (versionResult.stderr) summary.errorMessage += `: ${versionResult.stderr.trim()}`;
  } else {
    summary.piInstalled = true;
    summary.piVersion = (versionResult.stdout || "").trim() || null;
    const v = parsePiVersion(summary.piVersion);
    summary.minPiVersion = MIN_PI_VERSION;
    summary.piVersionOk = !!(v && versionAtLeast(v, parsePiVersion(MIN_PI_VERSION)));
    if (!summary.piVersionOk) {
      summary.errorMessage = `pi ${summary.piVersion || "(unknown version)"} is too old: pi-delegate needs pi >= ${MIN_PI_VERSION}`;
    }
  }

  try {
    const raw = fs.readFileSync(PI_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    summary.settingsFound = true;
    summary.defaultProvider = parsed.defaultProvider ?? null;
    summary.defaultModel = parsed.defaultModel ?? null;
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      const extra = `could not read/parse ${PI_SETTINGS_PATH}: ${err && err.message ? err.message : String(err)}`;
      summary.errorMessage = summary.errorMessage ? `${summary.errorMessage}; ${extra}` : extra;
    }
  }

  summary.ok = summary.piInstalled && summary.piVersionOk !== false;

  // Load project config (only meaningful when pi is installed)
  if (summary.piInstalled) {
    const pc = loadProjectConfig(cwd);
    if (pc.provider || pc.model || pc.extensions.length) {
      summary.projectConfigFound = true;
      summary.projectConfigProvider = pc.provider;
      summary.projectConfigModel = pc.model;
      summary.projectConfigExtensions = pc.extensions;
      summary.extensionWarnings = pc.extensions.map((e) => resolveExtensionSpec(e)).filter((r) => !r.ok).map((r) => r.error);
    }
  }

  return summary;
}

function printSetupResult(summary, json) {
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const lines = [];
  if (summary.piInstalled) {
    lines.push(`pi CLI: installed (${summary.piVersion})`);
  } else {
    lines.push(`pi CLI: NOT installed — ${summary.errorMessage}`);
  }

  if (summary.settingsFound) {
    lines.push(`Settings: ${summary.settingsPath}`);
    lines.push(`  defaultProvider: ${summary.defaultProvider ?? "(unset)"}`);
    lines.push(`  defaultModel: ${summary.defaultModel ?? "(unset)"}`);
  } else {
    lines.push(`Settings: not found at ${summary.settingsPath}`);
  }

  if (summary.piInstalled) {
    if (summary.projectConfigFound) {
      lines.push(`Project pin: ${summary.projectConfigPath}`);
      lines.push(`  provider: ${summary.projectConfigProvider ?? "(unset)"}`);
      lines.push(`  model: ${summary.projectConfigModel ?? "(unset)"}`);
    } else {
      lines.push(`Project pin: no project pin set (using pi's global default)`);
    }
  }

  lines.push(settingsLabel(summary.delegateSettings));
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Entry point — never let an uncaught exception become the primary output.
// ---------------------------------------------------------------------------

async function main() {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === "task") {
    const opts = parseTaskArgs(rest);
    if (opts.invalidTimeout !== null) {
      console.log(`--timeout must be a positive integer (ms), got: ${opts.invalidTimeout}`);
      printUsage();
      process.exit(2);
      return;
    }
    if (opts.removedMarkerFlag) {
      console.error("error: --marker was removed in 0.7.0 -- the RPC completion path is now the only task contract");
      printUsage();
      process.exit(2);
    }
    const result = await runTaskRpc(opts);
    printTaskResult(result, opts.json);
    process.exit(result.ok ? 0 : 1);
    return;
  }

  if (subcommand === "setup") {
    const json = rest.includes("--json");
    const summary = runSetup();
    printSetupResult(summary, json);
    process.exit(summary.ok ? 0 : 1);
    return;
  }

  if (subcommand === "list-models") {
    const json = rest.includes("--json");
    const result = runListModels();
    printListModelsResult(result, json);
    process.exit(result.ok ? 0 : 1);
    return;
  }

  if (subcommand === "write-config") {
    const opts = parseWriteConfigArgs(rest);
    if (opts.error) {
      console.log(`write-config: ${opts.error}`);
      printUsage();
      process.exit(2);
      return;
    }
    const result = Object.keys(opts.settings).length
      ? (opts.provider || opts.model ? { ok: false, errorMessage: "write settings separately from provider/model" } : writeSettings(resolveCwd(), opts.scope, opts.settings))
      : opts.scope !== "project" ? { ok: false, errorMessage: "provider/model config is project-only" } : runWriteConfig(opts.provider, opts.model);
    printWriteConfigResult(result, opts.json);
    process.exit(result.ok ? 0 : 1);
    return;
  }

  if (subcommand === "conversation") {
    const [verb, ...verbRest] = rest;
    const knownVerbs = ["start", "send", "status", "end", "read", "steer", "interrupt"];
    if (!knownVerbs.includes(verb)) {
      console.log(`conversation: unknown or missing verb (expected ${knownVerbs.join("|")}), got: ${verb ?? "(none)"}`);
      printUsage();
      process.exit(2);
      return;
    }

    const opts = parseConversationArgs(verb, verbRest);
    if (opts.invalidTimeout !== null) {
      console.log(`--timeout must be a positive integer (ms), got: ${opts.invalidTimeout}`);
      printUsage();
      process.exit(2);
      return;
    }
    if (opts.invalidLast !== null) {
      console.log(`--last must be a positive integer, got: ${opts.invalidLast}`);
      printUsage();
      process.exit(2);
      return;
    }
    if (opts.error) {
      console.log(`conversation ${verb}: ${opts.error}`);
      printUsage();
      process.exit(2);
      return;
    }

    const sanitized = sanitizeSessionName(opts.name);
    if (!sanitized.ok) {
      console.log(`conversation ${verb}: ${sanitized.error}`);
      printUsage();
      process.exit(2);
      return;
    }

    let result;
    if (verb === "start") result = await runConversationStart(sanitized.name, opts);
    else if (verb === "send") result = await runConversationSend(sanitized.name, opts.message, opts);
    else if (verb === "status") result = await runConversationStatus(sanitized.name, opts);
    else if (verb === "read") result = await readConversation(sanitized.name, opts);
    else if (verb === "steer") result = await runConversationSteer(sanitized.name, opts.message);
    else if (verb === "interrupt") result = await runConversationInterrupt(sanitized.name, opts.message);
    else result = await runConversationEnd(sanitized.name, opts);

    printTaskResult(result, opts.json);
    process.exit(result.ok ? 0 : 1);
    return;
  }

  if (subcommand === "remove-config") {
    const json = rest.includes("--json");
    const result = runRemoveConfig();
    printRemoveConfigResult(result, json);
    process.exit(result.ok ? 0 : 1);
    return;
  }

  printUsage();
  process.exit(subcommand ? 1 : 0);
}

const _isDirectRun = (() => {
  try {
    return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (_isDirectRun) main().catch((err) => {
  // Last-resort guard: degrade to clean JSON on stdout, never a raw stack
  // trace. Routed through taskResult() (not a hand-written literal) so this
  // fallback shape can never drift from the one stable contract.
  console.log(
    JSON.stringify(
      taskResult({
        errorMessage: `unexpected pi-companion error: ${err && err.message ? err.message : String(err)}`
      }),
      null,
      2
    )
  );
  process.exit(1);
});

export {
  buildChildLaunch,
  pinConflict,
  pinLabel,
  validPin,
  readLockOwner,
  checkPiVersion,
  scrubChildEnv,
  piAgentDir,
  piSidePackageDir,
  resolveExtensionSpec,
  usageFrom,
  sessionSlugForCwd,
  readConversation,
  taskResult,
  detectErrorTurn,
  rpcRoundtrip,
  spawnManaged,
  runTaskRpc,
  runConversationSend,
  runConversationStart,
  runConversationStatus,
  runConversationEnd,
  runConversationSteer,
  runConversationInterrupt,
  runSetup,
  runListModels,
  resolveCwd,
  loadProjectConfig,
  isSafeArgValue,
  sanitizeSessionName,
  lockPathFor,
  fsSafeName,
  acquireLock,
  releaseLock,
  reclaimIfDead,
  isPidAlive,
  findSessionFiles,
  piSessionsDir,
  renderSessionEntries,
  writeToFifo
};
