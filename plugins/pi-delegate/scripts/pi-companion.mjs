#!/usr/bin/env node
// pi-companion.mjs — thin, foreground-only, one-shot subprocess wrapper around
// the local `pi` CLI (pi.dev's pi-coding-agent).
//
// Design constraints (see skills/pi-cli-runtime/SKILL.md for the full contract):
//   - Foreground only. `task` uses an async `spawn` (awaited to completion,
//     never backgrounded) instead of `spawnSync`, specifically to avoid a
//     fixed maxBuffer ceiling on captured stdout -- see the comment on
//     spawnPi() below for why. `setup`/`list-models` still use `spawnSync`
//     since their outputs are small and fixed-size.
//   - No background/job-tracking subcommands. That is a v2 idea, not built here.
//   - Completion-marker contract: every task invocation instructs pi to write
//     a JSON completion-report file as its LAST action. The presence and
//     well-formedness of that file is the PRIMARY success signal. The NDJSON
//     stream supplies pi's actual final answer text, and can upgrade a
//     missing-marker run to a degraded success when the stream ended cleanly.
//   - Never throw an uncaught exception as the primary output. All failure
//     paths degrade to a structured `{ ok: false, ... }` object.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_TIMEOUT_MS = 600000; // 600s
const PI_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");
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
    degraded: false,
    markerMissing: false,
    markerExitMismatch: false,
    finalText: null,
    summary: null,
    nextSteps: [],
    errorMessage: null,
    warning: null,
    exitCode: null,
    willRetry: null,
    completionMarker: null,
    progressLogPath: null,
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
      default:
        positional.push(arg);
        break;
    }
  }

  opts.text = positional.join(" ").trim();
  return opts;
}

// Strict parser for write-config: only --provider/--model/--json allowed;
// anything else (unknown flag or positional) is a hard error.
function parseWriteConfigArgs(argv) {
  const opts = { provider: null, model: null, json: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
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
// NDJSON parsing per the documented pi --mode json contract
// ---------------------------------------------------------------------------

function parseNdjson(stdout) {
  const events = [];
  const unparseableLines = [];
  const lines = (stdout ?? "").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      unparseableLines.push(trimmed);
    }
  }

  return { events, unparseableLines };
}

function extractTextFromMessage(message) {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
}

// Interpret a parsed NDJSON event stream into a result object.
// Defensive: if agent_end is missing or truncated (e.g. process was killed
// mid-stream), this is treated as a hard failure, not a silent success.
function interpretEvents(events) {
  const agentEndEvents = events.filter((e) => e && e.type === "agent_end");

  if (agentEndEvents.length === 0) {
    return {
      ok: false,
      finalText: null,
      errorMessage: "pi output stream ended without an agent_end event (truncated or killed mid-stream)",
      willRetry: null
    };
  }

  const agentEnd = agentEndEvents[agentEndEvents.length - 1];
  const messages = Array.isArray(agentEnd.messages) ? agentEnd.messages : [];
  const lastMessage = messages[messages.length - 1] ?? null;

  if (!lastMessage) {
    return {
      ok: false,
      finalText: null,
      errorMessage: "agent_end event had no messages in its transcript",
      willRetry: agentEnd.willRetry ?? null
    };
  }

  if (lastMessage.stopReason === "error") {
    return {
      ok: false,
      finalText: null,
      errorMessage: lastMessage.errorMessage ?? "pi reported stopReason:error with no errorMessage",
      willRetry: agentEnd.willRetry ?? null
    };
  }

  return {
    ok: true,
    finalText: extractTextFromMessage(lastMessage),
    errorMessage: null,
    willRetry: agentEnd.willRetry ?? null
  };
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
    return { provider: null, model: null };
  }

  const lines = raw.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { provider: null, model: null };
  }

  const config = { provider: null, model: null };
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
  }

  // Unterminated frontmatter block => treat as no frontmatter at all.
  if (!closed) {
    return { provider: null, model: null };
  }

  return config;
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

function piSessionsDir(cwd) {
  return path.join(os.homedir(), ".pi", "agent", "sessions", sessionSlugForCwd(cwd));
}

function lockDir() {
  return path.join(os.tmpdir(), "pi-delegate-locks");
}

function lockPathFor(cwd, sessionName) {
  return path.join(lockDir(), `${sessionSlugForCwd(cwd)}__${sessionName}.lock`);
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
function findSessionFiles(dir, sessionName) {
  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((f) => f.endsWith(`_${sessionName}.jsonl`))
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

// PID-liveness-only lock: dead lock owner => reclaim (one retry); alive
// owner => fail loud, no wait, no wall-clock timeout (owner decision D-B).
function acquireLock(lockPath) {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch {
    /* best-effort -- openSync below will surface any real problem */
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return { acquired: true, heldByPid: null };
    } catch (err) {
      if (!err || err.code !== "EEXIST") {
        return { acquired: false, heldByPid: null, error: err && err.message ? err.message : String(err) };
      }

      let ownerPid = null;
      try {
        ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim());
      } catch {
        ownerPid = null;
      }

      if (ownerPid && Number.isFinite(ownerPid) && !isPidAlive(ownerPid)) {
        // Stale -- reclaim and retry once.
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* another caller may have already reclaimed it -- retry will tell */
        }
        continue;
      }

      return { acquired: false, heldByPid: ownerPid || null };
    }
  }

  return { acquired: false, heldByPid: null, error: "lock contention after stale-reclaim retry" };
}

function releaseLock(lockPath) {
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
// machinery, extracted so both spawnPi (task path) and rpcRoundtrip
// (conversation path) get identical hygiene without duplicating it.
// `onStdoutChunk(chunk, ctx)` is called for every raw stdout chunk; `ctx`
// exposes `.child` (so a caller can write to stdin) and `.settleEarly(extra)`
// to resolve before the child exits (used by rpcRoundtrip once its expected
// responses have all arrived). If onStdoutChunk never calls settleEarly, the
// promise resolves the same way spawnPi always has: on 'close', or on an
// 'exit' + ~1s drain grace if 'close' never fires (open grandchild pipes).
async function spawnManaged(cmd, args, { cwd, timeout, stdio, onStdoutChunk, onStderrChunk, onSpawn }) {
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

async function spawnPi(cmd, args, { cwd, timeout }) {
  let lastLoggedType = null;
  let pendingLine = "";
  let childPid = null;

  const progressLogPath = path.join(os.tmpdir(), `pi-companion-progress-${process.pid}.log`);
  let progressLogInitialized = false;

  function ensureProgressLog() {
    if (progressLogInitialized) return;
    progressLogInitialized = true;
    console.error(`[pi-companion] progress log: ${progressLogPath}`);
  }

  // Log only when the newest COMPLETE NDJSON line's "type" differs from the
  // last one logged -- cheap and low-volume, not once-per-raw-chunk.
  function trackProgress(textChunk) {
    pendingLine += textChunk;
    let newlineIndex;
    while ((newlineIndex = pendingLine.indexOf("\n")) !== -1) {
      const line = pendingLine.slice(0, newlineIndex).trim();
      pendingLine = pendingLine.slice(newlineIndex + 1);
      if (!line) continue;
      let type;
      try {
        type = JSON.parse(line).type;
      } catch {
        continue;
      }
      if (type && type !== lastLoggedType) {
        lastLoggedType = type;
        ensureProgressLog();
        try {
          fs.appendFileSync(
            progressLogPath,
            `${new Date().toISOString()} pid=${childPid} event=${type}\n`
          );
        } catch {
          /* best-effort only -- never let logging failure affect the task */
        }
      }
    }
  }

  const result = await spawnManaged(cmd, args, {
    cwd,
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
    onStdoutChunk: (chunk, ctx) => {
      childPid = ctx.child.pid;
      trackProgress(chunk);
    }
  });

  const timedOut = result.error && result.error.code === "ETIMEDOUT";

  // Clean up the progress log on any normal exit (success or non-timeout
  // failure); leave it on disk when killed by our own timeout so the caller
  // can inspect the last-known state of a run that got stuck.
  if (progressLogInitialized && !timedOut) {
    try {
      fs.unlinkSync(progressLogPath);
    } catch {
      /* best-effort cleanup only */
    }
  }

  return {
    ...result,
    progressLogPath: timedOut && progressLogInitialized ? progressLogPath : null
  };
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
//     trailing fragment to the next chunk (same technique as spawnPi's
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
async function rpcRoundtrip(sessionArgs, initialCommands, { cwd, timeout, onReady }) {
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
      // never leave it open-but-unfed (see spawnPi's stdio comment for the
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

function buildSessionArgs(opts, projectConfig) {
  const args = [];
  let configProvider = projectConfig.provider;
  let configModel = projectConfig.model;
  if (configProvider && !isSafeArgValue(configProvider)) configProvider = null;
  if (configModel && !isSafeArgValue(configModel)) configModel = null;

  const effectiveProvider = opts.provider || configProvider;
  const effectiveModel = opts.model || configModel;

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
    const sessionArgs = ["--session-id", sessionName, ...buildSessionArgs(opts, projectConfig)];
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
      const sessionArgs = ["--session-id", sessionName, ...buildSessionArgs(opts, projectConfig)];
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
  const sessionArgs = ["--session-id", sessionName];
  const roundtrip = await rpcRoundtrip(
    sessionArgs,
    [{ type: "get_state" }, { type: "get_session_stats" }],
    { cwd, timeout: opts.timeout }
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
  let ownerPid = null;
  try {
    ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim());
  } catch {
    return false; // no lockfile -- idle
  }
  return Number.isFinite(ownerPid) && ownerPid > 0 && isPidAlive(ownerPid);
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

// Read + validate + always unlink the completion marker file.
function readAndCleanupMarker(markerPath) {
  let markerResult = null;
  let markerError = null;
  try {
    if (fs.existsSync(markerPath)) {
      const raw = fs.readFileSync(markerPath, "utf8");
      const parsed = JSON.parse(raw);

      // Validate schema: status must be "ok" or "error", summary must be a string.
      if (
        parsed &&
        (parsed.status === "ok" || parsed.status === "error") &&
        typeof parsed.summary === "string"
      ) {
        markerResult = parsed;
      } else {
        markerError = "Completion marker file exists but has invalid schema (missing or wrong status/summary fields)";
      }
    } else {
      markerError = "Completion marker file was not found at expected path";
    }
  } catch (err) {
    markerError = `Completion marker file could not be read/parsed: ${err && err.message ? err.message : String(err)}`;
  } finally {
    // Always clean up the marker file so we don't leave artifacts in tmp.
    try {
      fs.unlinkSync(markerPath);
    } catch {
      /* best-effort cleanup */
    }
  }
  return { markerResult, markerError };
}

async function runTask(opts) {
  if (!opts.text) {
    return taskResult({ errorMessage: "no task text provided" });
  }

  const args = ["-p", "--mode", "json", "--no-session"];

  // Three-tier precedence: explicit flag > project config > pi's global default
  const cwd = resolveCwd();
  const projectConfig = loadProjectConfig(cwd);

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

  if (effectiveProvider) args.push("--provider", effectiveProvider);
  if (effectiveModel) args.push("--model", effectiveModel);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  if (opts.tools) args.push("--tools", opts.tools);
  if (opts.excludeTools) args.push("--exclude-tools", opts.excludeTools);

  // --- Completion-marker setup ---
  // Generate a unique, absolute marker file path for this invocation.
  const markerPath = path.join(os.tmpdir(), `pi-delegate-result-${crypto.randomUUID()}.json`);

  // Defensive: unlink if a stale file somehow already exists at this fresh path.
  try {
    fs.unlinkSync(markerPath);
  } catch {
    // Expected — path is freshly generated so this should be a no-op.
  }

  // Append the completion-marker instruction to the task text. This is
  // injected automatically for every task so callers never have to remember.
  const completionMarkerInstruction = `

--- COMPLETION MARKER (REQUIRED) ---
As your ABSOLUTE LAST action before finishing, use a write-file tool to write a JSON completion report to this exact path: ${markerPath}

The file MUST contain valid JSON with this exact schema:
{
  "status": "ok" | "error",
  "summary": "one or two sentence description of what was done, or why it failed",
  "nextSteps": ["optional", "array", "of", "recommended", "follow-ups"]
}

Use "status": "ok" if the task completed successfully, or "status": "error" if it failed.
This is a required protocol step — do not skip it.`;

  args.push(opts.text + completionMarkerInstruction);

  let result;
  try {
    result = await spawnPi("pi", args, { cwd, timeout: opts.timeout });
  } catch (err) {
    // Guard defensively against unexpected errors from spawnPi.
    readAndCleanupMarker(markerPath); // unlink any partial marker
    return taskResult({
      errorMessage: `unexpected error invoking pi: ${err && err.message ? err.message : String(err)}`
    });
  }

  const rawStdout = result.stdout ?? "";
  const rawStderr = result.stderr ?? "";
  const exitCode = typeof result.status === "number" ? result.status : null;

  if (result.error) {
    // Every error path still reads (and unlinks) the marker — on timeout pi
    // may have written it before the group kill landed.
    const { markerResult } = readAndCleanupMarker(markerPath);

    if (result.error.code === "ENOENT") {
      return taskResult({
        errorMessage: "pi CLI not found on PATH — run /pi-delegate:setup",
        rawStdout,
        rawStderr,
        exitCode
      });
    }
    if (result.error.code === "ETIMEDOUT") {
      let errorMessage = `pi did not finish within ${opts.timeout}ms and was killed (timeout)`;
      let summary = null;
      let completionMarker = null;
      if (markerResult) {
        summary = markerResult.summary;
        completionMarker = markerResult;
        errorMessage = `pi timed out after ${opts.timeout}ms, but a completion marker was found (status: ${markerResult.status}) — treat with caution: ${markerResult.summary}`;
      }
      if (result.progressLogPath) {
        errorMessage += ` — progress log: ${result.progressLogPath}`;
      }
      return taskResult({
        errorMessage,
        summary,
        completionMarker,
        nextSteps: markerResult && Array.isArray(markerResult.nextSteps) ? markerResult.nextSteps : [],
        progressLogPath: result.progressLogPath ?? null,
        rawStdout,
        rawStderr,
        exitCode
      });
    }
    return taskResult({
      errorMessage: `pi invocation failed: ${result.error.code || result.error.message || String(result.error)}`,
      rawStdout,
      rawStderr,
      exitCode
    });
  }

  const { events, unparseableLines } = parseNdjson(rawStdout);

  // --- Completion-marker resolution (primary success signal) ---
  const { markerResult, markerError } = readAndCleanupMarker(markerPath);

  // NDJSON interpretation always runs: it supplies pi's actual final answer
  // text on marker success, and the fallback signal when the marker is absent.
  const interpreted = interpretEvents(events);

  if (markerResult) {
    const nextSteps = Array.isArray(markerResult.nextSteps) ? markerResult.nextSteps : [];

    if (markerResult.status === "ok" && exitCode !== 0) {
      // M1: an "ok" marker cannot override a nonzero exit — treat as failure.
      return taskResult({
        ok: false,
        markerExitMismatch: true,
        finalText: interpreted.ok && interpreted.finalText ? interpreted.finalText : markerResult.summary,
        summary: markerResult.summary,
        nextSteps,
        errorMessage: `completion marker reported ok but pi exited with status ${exitCode} — treating as failure`,
        completionMarker: markerResult,
        rawStdout,
        rawStderr,
        exitCode,
        willRetry: interpreted.willRetry
      });
    }

    if (markerResult.status === "ok") {
      return taskResult({
        ok: true,
        finalText: interpreted.ok && interpreted.finalText ? interpreted.finalText : markerResult.summary,
        summary: markerResult.summary,
        nextSteps,
        completionMarker: markerResult,
        rawStdout,
        rawStderr,
        exitCode,
        willRetry: interpreted.willRetry
      });
    }

    // Marker explicitly reported an error.
    return taskResult({
      ok: false,
      finalText: interpreted.ok && interpreted.finalText ? interpreted.finalText : null,
      summary: markerResult.summary,
      nextSteps,
      errorMessage: markerResult.summary,
      completionMarker: markerResult,
      rawStdout,
      rawStderr,
      exitCode,
      willRetry: interpreted.willRetry
    });
  }

  // Marker missing/malformed. If the NDJSON stream ended cleanly AND pi exited
  // 0, treat as a degraded success (M2) rather than a hard failure.
  if (interpreted.ok && exitCode === 0) {
    return taskResult({
      ok: true,
      degraded: true,
      markerMissing: true,
      finalText: interpreted.finalText,
      warning: `${markerError} — success inferred from clean NDJSON stream; verify the work`,
      rawStdout,
      rawStderr,
      exitCode,
      willRetry: interpreted.willRetry
    });
  }

  // Marker missing and NDJSON not clean (or nonzero exit) — hard failure.
  let fallbackMessage = markerError;
  if (!interpreted.ok && interpreted.errorMessage) {
    fallbackMessage = `${markerError}; NDJSON fallback: ${interpreted.errorMessage}`;
  } else if (interpreted.ok) {
    fallbackMessage = `${markerError} (NDJSON stream appeared normal but pi exited with status ${exitCode})`;
  }

  if (unparseableLines.length > 0) {
    fallbackMessage += ` (also saw ${unparseableLines.length} non-JSON line(s) in stdout)`;
  }

  return taskResult({
    ok: false,
    markerMissing: true,
    finalText: interpreted.finalText ?? null,
    errorMessage: fallbackMessage,
    rawStdout,
    rawStderr,
    exitCode,
    willRetry: interpreted.willRetry
  });
}

function printTaskResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.ok) {
    console.log(result.finalText ?? "");
    if (result.degraded) {
      console.log("note: completion marker missing — result inferred from output stream, verify the work");
    }
  } else {
    console.log(`pi task failed: ${result.errorMessage}`);
    if (result.markerExitMismatch) {
      console.log(`exit code: ${result.exitCode}`);
    }
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

    let frontmatter = "---\n";
    if (provider) frontmatter += `provider: ${provider}\n`;
    if (model) frontmatter += `model: ${model}\n`;
    frontmatter += "---\n";

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
    console.log(`Wrote project config: ${result.configPath}`);
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
      fs.unlinkSync(configPath);
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
    errorMessage: null
  };

  let versionResult;
  try {
    versionResult = spawnSync("pi", ["--version"], { encoding: "utf8", timeout: 15000 });
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

  summary.ok = summary.piInstalled;

  // Load project config (only meaningful when pi is installed)
  if (summary.piInstalled) {
    const pc = loadProjectConfig(cwd);
    if (pc.provider || pc.model) {
      summary.projectConfigFound = true;
      summary.projectConfigProvider = pc.provider;
      summary.projectConfigModel = pc.model;
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
    const result = await runTask(opts);
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
    const result = runWriteConfig(opts.provider, opts.model);
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

main().catch((err) => {
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
