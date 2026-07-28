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

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_TIMEOUT_MS = 600000; // 600s
const PI_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");
const RAW_TAIL_LIMIT = 10240; // last 10KB of raw stdout/stderr in results

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
      "  node pi-companion.mjs remove-config [--json]"
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

async function spawnPi(cmd, args, { cwd, timeout }) {
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    let lastLoggedType = null;
    let pendingLine = "";

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
              `${new Date().toISOString()} pid=${child.pid} event=${type}\n`
            );
          } catch {
            /* best-effort only -- never let logging failure affect the task */
          }
        }
      }
    }

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
      // Clean up the progress log on any normal exit (success or non-timeout
      // failure); leave it on disk when killed by our own timeout so the
      // caller can inspect the last-known state of a run that got stuck.
      if (progressLogInitialized && !timedOut) {
        try {
          fs.unlinkSync(progressLogPath);
        } catch {
          /* best-effort cleanup only */
        }
      }
      resolve(result);
    }

    function buildExitResult(code, signal) {
      return {
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        status: code,
        signal,
        error: timedOut
          ? { code: "ETIMEDOUT", message: `Process was killed after ${timeout}ms` }
          : null,
        progressLogPath: timedOut && progressLogInitialized ? progressLogPath : null
      };
    }

    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      trackProgress(chunk);
    });
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("error", (err) => {
      settle({
        stdout: "",
        stderr: "",
        status: null,
        signal: null,
        error: { code: err.code, message: err.message },
        progressLogPath: null
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
  // Last-resort guard: degrade to clean JSON on stdout, never a raw stack trace.
  console.log(
    JSON.stringify(
      {
        ok: false,
        degraded: false,
        markerMissing: false,
        markerExitMismatch: false,
        finalText: null,
        summary: null,
        nextSteps: [],
        errorMessage: `unexpected pi-companion error: ${err && err.message ? err.message : String(err)}`,
        warning: null,
        exitCode: null,
        willRetry: null,
        completionMarker: null,
        progressLogPath: null,
        rawStdout: "",
        rawStderr: "",
        rawStdoutTruncated: false,
        rawStderrTruncated: false
      },
      null,
      2
    )
  );
  process.exit(1);
});
