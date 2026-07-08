#!/usr/bin/env node
// pi-companion.mjs — thin, foreground-only, one-shot subprocess wrapper around
// the local `pi` CLI (pi.dev's pi-coding-agent).
//
// Design constraints (see skills/pi-cli-runtime/SKILL.md for the full contract):
//   - Foreground only. Uses spawnSync, not async spawn.
//   - No background/job-tracking subcommands. That is a v2 idea, not built here.
//   - Never trust the process exit code alone: pi exits 0 even on internal
//     errors, so we always parse the NDJSON stream and look at the last
//     agent_end event's final message.
//   - Never throw an uncaught exception as the primary output. All failure
//     paths degrade to a structured `{ ok: false, ... }` object.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_TIMEOUT_MS = 600000; // 600s
const PI_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");

function printUsage() {
  console.log(
    [
      "Usage:",
      '  node pi-companion.mjs task "<task text>" [--json] [--provider <name>] [--model <pattern>]',
      "                              [--thinking <off|minimal|low|medium|high|xhigh>]",
      "                              [--tools <t1,t2,...>] [--exclude-tools <t1,t2,...>]",
      "                              [--timeout <ms>]",
      "  node pi-companion.mjs setup [--json]"
    ].join("\n")
  );
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
    timeout: DEFAULT_TIMEOUT_MS
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
      case "--timeout":
        opts.timeout = Number(argv[++i]) || DEFAULT_TIMEOUT_MS;
        break;
      default:
        positional.push(arg);
        break;
    }
  }

  opts.text = positional.join(" ").trim();
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

function runTask(opts) {
  if (!opts.text) {
    return {
      ok: false,
      finalText: null,
      errorMessage: "no task text provided",
      rawStdout: "",
      rawStderr: "",
      exitCode: null,
      willRetry: null
    };
  }

  const args = ["-p", "--mode", "json", "--no-session"];
  if (opts.provider) args.push("--provider", opts.provider);
  if (opts.model) args.push("--model", opts.model);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  if (opts.tools) args.push("--tools", opts.tools);
  if (opts.excludeTools) args.push("--exclude-tools", opts.excludeTools);
  args.push(opts.text);

  const cwd = resolveCwd();

  let result;
  try {
    result = spawnSync("pi", args, {
      cwd,
      timeout: opts.timeout,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8"
    });
  } catch (err) {
    // spawnSync itself should not throw for normal ENOENT/timeout cases (those
    // come back via result.error), but guard defensively anyway.
    return {
      ok: false,
      finalText: null,
      errorMessage: `unexpected error invoking pi: ${err && err.message ? err.message : String(err)}`,
      rawStdout: "",
      rawStderr: "",
      exitCode: null,
      willRetry: null
    };
  }

  const rawStdout = result.stdout ?? "";
  const rawStderr = result.stderr ?? "";
  const exitCode = typeof result.status === "number" ? result.status : null;

  if (result.error) {
    if (result.error.code === "ENOENT") {
      return {
        ok: false,
        finalText: null,
        errorMessage: "pi CLI not found on PATH — run /pi-delegate:setup",
        rawStdout,
        rawStderr,
        exitCode,
        willRetry: null
      };
    }
    if (result.error.code === "ETIMEDOUT") {
      return {
        ok: false,
        finalText: null,
        errorMessage: `pi did not finish within ${opts.timeout}ms and was killed (timeout)`,
        rawStdout,
        rawStderr,
        exitCode,
        willRetry: null
      };
    }
    return {
      ok: false,
      finalText: null,
      errorMessage: `pi invocation failed: ${result.error.code || result.error.message || String(result.error)}`,
      rawStdout,
      rawStderr,
      exitCode,
      willRetry: null
    };
  }

  const { events, unparseableLines } = parseNdjson(rawStdout);
  const interpreted = interpretEvents(events);

  if (unparseableLines.length > 0 && !interpreted.ok) {
    // Surface a hint that some stdout lines weren't valid JSON — helpful for
    // diagnosing a truly broken/foreign output stream without ever throwing.
    interpreted.errorMessage = `${interpreted.errorMessage} (also saw ${unparseableLines.length} non-JSON line(s) in stdout)`;
  }

  return {
    ok: interpreted.ok,
    finalText: interpreted.finalText,
    errorMessage: interpreted.errorMessage,
    rawStdout,
    rawStderr,
    exitCode,
    willRetry: interpreted.willRetry
  };
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
// setup subcommand — readiness check, runnable standalone (no Claude Code)
// ---------------------------------------------------------------------------

function runSetup() {
  const summary = {
    ok: false,
    piInstalled: false,
    piVersion: null,
    settingsPath: PI_SETTINGS_PATH,
    settingsFound: false,
    defaultProvider: null,
    defaultModel: null,
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

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Entry point — never let an uncaught exception become the primary output.
// ---------------------------------------------------------------------------

function main() {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === "task") {
    const opts = parseTaskArgs(rest);
    const result = runTask(opts);
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

  printUsage();
  process.exit(subcommand ? 1 : 0);
}

try {
  main();
} catch (err) {
  // Last-resort guard: degrade to clean JSON on stdout, never a raw stack trace.
  console.log(
    JSON.stringify(
      {
        ok: false,
        finalText: null,
        errorMessage: `unexpected pi-companion error: ${err && err.message ? err.message : String(err)}`,
        rawStdout: "",
        rawStderr: "",
        exitCode: null,
        willRetry: null
      },
      null,
      2
    )
  );
  process.exit(1);
}
