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
//   - Never trust the process exit code alone: pi exits 0 even on internal
//     errors, so we always parse the NDJSON stream and look at the last
//     agent_end event's final message.
//   - Never throw an uncaught exception as the primary output. All failure
//     paths degrade to a structured `{ ok: false, ... }` object.

import { spawn, spawnSync } from "node:child_process";
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
      "  node pi-companion.mjs setup [--json]",
      "  node pi-companion.mjs list-models [--json]",
      '  node pi-companion.mjs write-config --provider <name> --model <name> [--json]',
      "  node pi-companion.mjs remove-config [--json]"
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

  // lines[0] is already confirmed "---" above, so everything from index 1
  // onward is frontmatter content until the closing "---" (a normal
  // 2-delimiter block, not 3 -- there is no separate "start" marker to wait
  // for).
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;

    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key === "provider" && value) config.provider = value;
    if (key === "model" && value) config.model = value;
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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      trackProgress(chunk);
    });
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: "",
        status: null,
        signal: null,
        error: { code: err.code, message: err.message }
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Clean up the progress log on any normal close (success or non-timeout
      // failure); leave it on disk when killed by our own timeout so the
      // caller can inspect the last-known state of a run that got stuck.
      if (progressLogInitialized && !timedOut) {
        try {
          fs.unlinkSync(progressLogPath);
        } catch {
          /* best-effort cleanup only */
        }
      }
      resolve({
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        status: code,
        signal,
        error: timedOut
          ? { code: "ETIMEDOUT", message: `Process was killed after ${timeout}ms` }
          : null
      });
    });
  });
}

async function runTask(opts) {
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

  // Three-tier precedence: explicit flag > project config > pi's global default
  const cwd = resolveCwd();
  const projectConfig = loadProjectConfig(cwd);
  const effectiveProvider = opts.provider || projectConfig.provider;
  const effectiveModel = opts.model || projectConfig.model;

  if (effectiveProvider) args.push("--provider", effectiveProvider);
  if (effectiveModel) args.push("--model", effectiveModel);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  if (opts.tools) args.push("--tools", opts.tools);
  if (opts.excludeTools) args.push("--exclude-tools", opts.excludeTools);
  args.push(opts.text);

  let result;
  try {
    result = await spawnPi("pi", args, { cwd, timeout: opts.timeout });
  } catch (err) {
    // Guard defensively against unexpected errors from spawnPi.
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

  const raw = (result.stdout || "").trim();
  const lines = raw.split("\n").filter((l) => l.trim());

  // Skip header line, parse remaining lines as whitespace-separated columns
  // Format: provider  model  context  max-out  thinking  images
  const models = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s{2,}/);
    if (parts.length >= 2) {
      models.push({
        provider: parts[0].trim(),
        model: parts[1].trim()
      });
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
    const opts = parseTaskArgs(rest);
    const json = rest.includes("--json");
    const result = runWriteConfig(opts.provider, opts.model);
    printWriteConfigResult(result, json);
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
});
