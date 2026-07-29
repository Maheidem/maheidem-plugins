#!/usr/bin/env node
// pi-mcp-server.mjs -- hand-rolled stdio MCP facade over pi-companion (ADR-002).
// Stage 5.1 scope: initialize handshake, tools/list, pi_task, pi_setup.
// JSON-RPC 2.0 over stdio, strict-LF framing. Zero dependencies.

import { spawn } from "node:child_process";
import {
  runTaskRpc, runSetup, runConversationStatus, runConversationEnd,
  readConversation, detectErrorTurn, taskResult, resolveCwd,
  loadProjectConfig, isSafeArgValue, sanitizeSessionName,
  lockPathFor, acquireLock, releaseLock
} from "./pi-companion.mjs";

// MCP spec revision this server implements (ADR-002 §6: pinned in one constant).
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "pi-delegate", version: "0.9.1" };
const DEFAULT_TIMEOUT_MS = 600000;

const TOOLS = [
  {
    name: "pi_setup",
    description: "Readiness report: pi version, provider/model pin, project config state.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "pi_conversation_send",
    description:
      "Send a message to a named, persistent pi conversation (keep-alive RPC child, reused across " +
      "sends; TTL-reaped when idle; transparently respawned if dead). Blocks until the turn settles; " +
      "returns pi's answer. pi is often a smaller/local model: succeeds far better on narrowly-scoped " +
      "work than on open-ended multi-step asks. Keep for yourself: architecture decisions, irreversible " +
      "or externally-consequential choices, and anything a not-yet-dispatched step depends on. " +
      "Otherwise delegate the GOAL, not the diff: name the files/surface pi may touch and what's " +
      "explicitly off-limits, state invariants to preserve, give an acceptance check, and say whether " +
      "the approach is pi's call or a specific pattern to follow. Since this is a multi-turn " +
      "conversation, the initial goal doesn't need to anticipate everything -- use pi_conversation_steer " +
      "or pi_conversation_interrupt on later turns to adjust course as pi's approach becomes clear. If " +
      "pi isn't already familiar with this codebase, say so and grant it permission to explore first. " +
      "State scope explicitly at the top (bug-fix-scope vs feature-design-scope vs refactor-scope) " +
      "whenever it isn't obvious. Go fully literal only when nothing is left to decide.",
    inputSchema: {
      type: "object",
      required: ["name", "message"],
      properties: {
        name: { type: "string", description: "Conversation name (caller-chosen, project-scoped)." },
        message: { type: "string" },
        timeout_ms: { type: "integer", minimum: 1 }
      }
    }
  },
  {
    name: "pi_conversation_read",
    description: "Render the conversation's transcript tail (lock-free; works mid-turn; strict file order).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        last: { type: "integer", minimum: 1 }
      }
    }
  },
  {
    name: "pi_conversation_status",
    description: "Session state/stats plus registry info (child alive? idle ms? TTL remaining?).",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } }
  },
  {
    name: "pi_conversation_end",
    description: "Kill the conversation's live child (if any) and delete its session file(s) and lock.",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } }
  },
  {
    name: "pi_conversation_steer",
    description: "Queue a steering message into a turn currently in flight for this conversation (delivered at the next turn boundary). Fails if idle.",
    inputSchema: { type: "object", required: ["name", "message"], properties: { name: { type: "string" }, message: { type: "string" } } }
  },
  {
    name: "pi_conversation_interrupt",
    description: "Abort the in-flight turn and start a new one with this message on the same live child; the pending send's result reflects the new turn. Fails if idle.",
    inputSchema: { type: "object", required: ["name", "message"], properties: { name: { type: "string" }, message: { type: "string" } } }
  },
  {
    name: "pi_respond",
    description: "Answer a pending pi question (extension_ui_request) on a conversation -- fallback for clients without elicitation support. Provide value (select/input), confirmed (confirm), or cancelled:true.",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, value: { type: "string" }, confirmed: { type: "boolean" }, cancelled: { type: "boolean" } } }
  },
  {
    name: "pi_task",
    description:
      "Delegate a stateless, one-shot coding task to the local pi CLI (RPC completion). pi is often a " +
      "smaller/local model: succeeds far better on narrowly-scoped work than on open-ended multi-step " +
      "asks. Keep for yourself: architecture decisions, irreversible or externally-consequential choices " +
      "(migrations, destructive ops, security boundaries, public API shape), and anything a " +
      "not-yet-dispatched step depends on. Otherwise delegate the GOAL, not the diff: name the " +
      "files/surface pi may touch and what's explicitly off-limits, state invariants to preserve, give " +
      "an acceptance check (test command or expected behavior), and say whether the approach is pi's " +
      "call or a specific pattern to follow. If pi isn't already familiar with this codebase, say so and " +
      "grant it permission to explore first. State scope explicitly at the top (bug-fix-scope vs " +
      "feature-design-scope vs refactor-scope) whenever it isn't obvious -- ambiguity about decision " +
      "ownership is the most common way a task description fails pi. Go fully literal only when nothing " +
      "is left to decide: applying an already-written diff, a version bump, a command run purely to " +
      "gather evidence. Returns pi's final answer as JSON (ok, finalText, errorMessage, ...).",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "The task text for pi." },
        provider: { type: "string" },
        model: { type: "string" },
        thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh"] },
        tools: { type: "string", description: "Comma-separated pi tool list." },
        exclude_tools: { type: "string" },
        timeout_ms: { type: "integer", minimum: 1 }
      }
    }
  }
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyErr(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleToolCall(msg) {
  const params = msg.params || {};
  const name = params.name;
  const args = params.arguments || {};
  let result;
  if (name === "pi_task") {
    result = await runTaskRpc({
      text: typeof args.text === "string" ? args.text : null,
      provider: args.provider ?? null,
      model: args.model ?? null,
      thinking: args.thinking ?? null,
      tools: args.tools ?? null,
      excludeTools: args.exclude_tools ?? null,
      timeout: Number.isInteger(args.timeout_ms) && args.timeout_ms > 0 ? args.timeout_ms : DEFAULT_TIMEOUT_MS
    });
  } else if (name === "pi_setup") {
    result = await runSetup();
  } else if (name === "pi_conversation_send") {
    result = await channelSend(
      typeof args.name === "string" ? args.name : "",
      typeof args.message === "string" ? args.message : "",
      Number.isInteger(args.timeout_ms) && args.timeout_ms > 0 ? args.timeout_ms : DEFAULT_TIMEOUT_MS
    );
  } else if (name === "pi_conversation_read") {
    result = await readConversation(typeof args.name === "string" ? args.name : "", {
      last: Number.isInteger(args.last) && args.last > 0 ? args.last : null,
      json: true
    });
  } else if (name === "pi_conversation_status") {
    result = await runConversationStatus(typeof args.name === "string" ? args.name : "", {});
    const chInfo = registry.get(args.name);
    if (result && chInfo) {
      result.channel = {
        alive: chInfo.alive,
        idleMs: Date.now() - chInfo.lastUsedAt,
        ttlRemainingMs: Math.max(0, TTL_MS - (Date.now() - chInfo.lastUsedAt))
      };
    } else if (result) {
      result.channel = null;
    }
    if (result) result.pendingQuestion = (chInfo && chInfo.pendingQuestion) || null;
  } else if (name === "pi_conversation_end") {
    const chToEnd = registry.get(typeof args.name === "string" ? args.name : "");
    if (chToEnd) killChannel(chToEnd);
    result = await runConversationEnd(typeof args.name === "string" ? args.name : "", {});
  } else if (name === "pi_conversation_steer") {
    result = channelSteer(typeof args.name === "string" ? args.name : "", args.message);
  } else if (name === "pi_conversation_interrupt") {
    result = channelInterrupt(typeof args.name === "string" ? args.name : "", args.message);
  } else if (name === "pi_respond") {
    result = piRespond(typeof args.name === "string" ? args.name : "", args);
  } else {
    replyErr(msg.id, -32602, `unknown tool: ${name}`);
    return;
  }
  reply(msg.id, {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: result && result.ok === false
  });
}

function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // tolerate garbage lines, never crash the server
  }
  if (!msg || msg.jsonrpc !== "2.0") return;
  if (msg.id !== undefined && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
    const w = outgoingWaiters.get(msg.id);
    if (w) { outgoingWaiters.delete(msg.id); w(msg); }
    return;
  }
  if (msg.method === "initialize") {
    clientSupportsElicitation = !!(msg.params && msg.params.capabilities && msg.params.capabilities.elicitation);
    reply(msg.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
  } else if (msg.method === "notifications/initialized") {
    // notification: no reply
  } else if (msg.method === "tools/list") {
    reply(msg.id, { tools: TOOLS });
  } else if (msg.method === "tools/call") {
    pendingOps++;
    handleToolCall(msg).then(() => { pendingOps--; if (pendingOps <= 0 && _stdinEnded) { shutdownChannels(); process.exit(0); } }).catch((err) => {
      replyErr(msg.id, -32603, `tool call failed: ${err && err.message ? err.message : String(err)}`);
      pendingOps--; if (pendingOps <= 0 && _stdinEnded) { shutdownChannels(); process.exit(0); }
    });
  } else if (msg.id !== undefined && msg.method) {
    replyErr(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    let line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.trim()) handleLine(line);
  }
});
let pendingOps = 0;
let _stdinEnded = false;
let clientSupportsElicitation = false;
let nextOutgoingId = 1;
const outgoingWaiters = new Map();

// Server-initiated JSON-RPC request to the client (e.g. elicitation/create).
function serverRequest(method, params, timeoutMs) {
  return new Promise((resolve) => {
    const id = nextOutgoingId++;
    const t = setTimeout(() => { outgoingWaiters.delete(id); resolve(null); }, timeoutMs);
    t.unref();
    outgoingWaiters.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    send({ jsonrpc: "2.0", id, method, params });
  });
}
process.stdin.on("end", () => {
  _stdinEnded = true;
  if (pendingOps > 0) return; // defer exit until async ops resolve
  shutdownChannels();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Stage 5.2 (ADR-002 §3, D5-B): keep-alive conversation channels.
// One live `pi --mode rpc --session-id <name>` child per name, reused across
// sends, reaped after idle TTL, respawned transparently when dead. Turns are
// serialized per channel; different names run fully parallel (ADR-002 §5).
// ---------------------------------------------------------------------------

const TTL_MS = Number(process.env.PI_MCP_TTL_MS) > 0 ? Number(process.env.PI_MCP_TTL_MS) : 300000;
const REGISTRY_CAP = Number(process.env.PI_MCP_REGISTRY_CAP) > 0 ? Number(process.env.PI_MCP_REGISTRY_CAP) : 4;
const REAP_INTERVAL_MS = Number(process.env.PI_MCP_REAP_INTERVAL_MS) > 0 ? Number(process.env.PI_MCP_REAP_INTERVAL_MS) : 60000;
const registry = new Map();
const sendQueues = new Map();

function chanName(raw) {
  const sanitized = sanitizeSessionName(raw);
  if (!sanitized.ok) return { error: sanitized.error || "invalid conversation name" };
  return { name: sanitized.name };
}

function spawnChannel(name) {
  const cwd = resolveCwd();
  const projectConfig = loadProjectConfig(cwd);
  const args = ["--mode", "rpc", "--session-id", name];
  if (projectConfig.provider && isSafeArgValue(projectConfig.provider)) args.push("--provider", projectConfig.provider);
  if (projectConfig.model && isSafeArgValue(projectConfig.model)) args.push("--model", projectConfig.model);
  const child = spawn("pi", args, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });
  const ch = {
    name, child, alive: true, lastUsedAt: Date.now(),
    buffer: "", events: [], steered: [], pendingInterrupt: null, turnInFlight: false,
    responseWaiters: [], settleWaiter: null, pendingQuestion: null
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    ch.buffer += chunk;
    let idx;
    while ((idx = ch.buffer.indexOf("\n")) !== -1) {
      const line = ch.buffer.slice(0, idx);
      ch.buffer = ch.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (evt && evt.type === "response") {
        const w = ch.responseWaiters.find((x) => x.command === evt.command && !x.done);
        if (w) { w.done = true; w.resolve(evt); continue; }
      }
      if (evt && evt.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(evt.method)) {
        handleUiRequest(ch, evt);
      }
      ch.events.push(evt);
      if (evt && evt.type === "agent_settled" && ch.settleWaiter) {
        const s = ch.settleWaiter; ch.settleWaiter = null; s();
      }
    }
  });
  child.on("close", () => {
    ch.alive = false;
    if (ch.settleWaiter) { const s = ch.settleWaiter; ch.settleWaiter = null; s(); }
    for (const w of ch.responseWaiters) { if (!w.done) { w.done = true; w.resolve(null); } }
    if (registry.get(name) === ch) registry.delete(name);
  });
  registry.set(name, ch);
  enforceCap();
  return ch;
}

function killChannel(ch) {
  ch.alive = false;
  try { process.kill(-ch.child.pid, "SIGTERM"); } catch { try { ch.child.kill("SIGTERM"); } catch { /* ignore */ } }
  const hardKill = setTimeout(() => {
    try { process.kill(-ch.child.pid, "SIGKILL"); } catch { /* ignore */ }
  }, 5000);
  hardKill.unref();
  if (registry.get(ch.name) === ch) registry.delete(ch.name);
}

function enforceCap() {
  while (registry.size > REGISTRY_CAP) {
    let oldest = null;
    for (const ch of registry.values()) {
      if (!oldest || ch.lastUsedAt < oldest.lastUsedAt) oldest = ch;
    }
    if (!oldest) break;
    killChannel(oldest);
  }
}

function getChannel(name) {
  const existing = registry.get(name);
  if (existing && existing.alive) return existing;
  if (existing) registry.delete(name);
  return spawnChannel(name);
}

function rpcCommand(ch, cmd, timeoutMs) {
  return new Promise((resolve) => {
    const waiter = { command: cmd.type, done: false, resolve };
    ch.responseWaiters.push(waiter);
    const t = setTimeout(() => {
      if (!waiter.done) { waiter.done = true; resolve(null); }
    }, timeoutMs);
    t.unref();
    try { ch.child.stdin.write(JSON.stringify(cmd) + "\n"); } catch {
      if (!waiter.done) { waiter.done = true; resolve(null); }
    }
  });
}

function waitSettle(ch, timeoutMs) {
  return new Promise((resolve) => {
    if (!ch.alive) { resolve(false); return; }
    // Check if already settled (stub outputs agent_settled synchronously with prompt response)
    const alreadySettled = ch.events.some(e => e && e.type === "agent_settled");
    if (alreadySettled) { resolve(true); return; }
    const t = setTimeout(() => {
      if (ch.settleWaiter) ch.settleWaiter = null;
      resolve(false);
    }, timeoutMs);
    t.unref();
    ch.settleWaiter = () => { clearTimeout(t); resolve(true); };
  });
}

async function channelSend(rawName, message, timeoutMs) {
  const named = chanName(rawName);
  if (named.error) return taskResult({ errorMessage: named.error });
  const name = named.name;
  const cwd = resolveCwd();
  const lockPath = lockPathFor(cwd, name);
  const run = async () => {
    const lock = acquireLock(lockPath);
    if (!lock.acquired) {
      return taskResult({
        sessionName: name,
        lockHeldByPid: lock.heldByPid,
        errorMessage: lock.heldByPid
          ? `conversation \"${name}\" is busy (held by pid ${lock.heldByPid}) -- another process is mid-turn`
          : `failed to acquire conversation lock: ${lock.error || "unknown error"}`
      });
    }
    try {
      const ch = getChannel(name);
      ch.lastUsedAt = Date.now();
      ch.events.length = 0; // per-turn event scope: turns are serialized per channel
      ch.steered = [];
      ch.pendingInterrupt = null;
      ch.turnInFlight = true;
      const turnStart = 0;
      const promptResp = await rpcCommand(ch, { type: "prompt", message }, 15000);
      if (!promptResp || promptResp.success === false) {
        return taskResult({ sessionName: name, errorMessage: promptResp ? (promptResp.error || "prompt rejected") : "prompt was not acknowledged (channel dead?)" });
      }
      let settled = await waitSettle(ch, timeoutMs);
      let interrupted = false;
      while (settled && ch.pendingInterrupt) {
        const nextMessage = ch.pendingInterrupt;
        ch.pendingInterrupt = null;
        ch.events.length = 0;
        const reResp = await rpcCommand(ch, { type: "prompt", message: nextMessage }, 15000);
        if (!reResp || reResp.success === false) {
          ch.turnInFlight = false;
          return taskResult({ sessionName: name, errorMessage: "interrupt reprompt was rejected" });
        }
        interrupted = true;
        settled = await waitSettle(ch, timeoutMs);
      }
      ch.lastUsedAt = Date.now();
      ch.turnInFlight = false;
      if (!settled) {
        killChannel(ch);
        return taskResult({ sessionName: name, errorMessage: `pi did not settle within ${timeoutMs}ms -- channel killed (will respawn on next send)`, steered: ch.steered, interrupted });
      }
      const turnEvents = ch.events.slice(0);
      const textResp = await rpcCommand(ch, { type: "get_last_assistant_text" }, 15000);
      const stateResp = await rpcCommand(ch, { type: "get_state" }, 15000);
      const statsResp = await rpcCommand(ch, { type: "get_session_stats" }, 15000);
      const turnError = detectErrorTurn(turnEvents);
      if (turnError) {
        return taskResult({ sessionName: name, errorMessage: turnError });
      }
      if (!textResp || textResp.success === false) {
        return taskResult({ sessionName: name, errorMessage: (textResp && textResp.error) || "get_last_assistant_text failed" });
      }
      return taskResult({
        ok: true,
        sessionName: name,
        sessionId: (stateResp && stateResp.data && stateResp.data.sessionId) ?? null,
        turnCount: (statsResp && statsResp.data && statsResp.data.userMessages) ?? null,
        finalText: (textResp.data && textResp.data.text) || "",
        steered: ch.steered.slice(),
        interrupted
      });
    } finally {
      const chx = registry.get(name);
      if (chx) chx.turnInFlight = false;
      releaseLock(lockPath);
    }
  };
  const prev = sendQueues.get(name) || Promise.resolve();
  const next = prev.then(run, run);
  sendQueues.set(name, next.catch(() => {}));
  return next;
}

function writeUiResponse(ch, id, fields) {
  try { ch.child.stdin.write(JSON.stringify({ type: "extension_ui_response", id, ...fields }) + "\n"); } catch { /* ignore */ }
  ch.pendingQuestion = null;
}

// ADR-002 §7: pi question -> MCP elicitation/create when the client supports
// it; otherwise parked as pendingQuestion for pi_respond. pi's own dialog
// auto-cancel timeout remains the terminal fallback.
async function handleUiRequest(ch, evt) {
  ch.pendingQuestion = { id: evt.id, method: evt.method, title: evt.title ?? null, options: evt.options ?? null };
  if (!clientSupportsElicitation) return;
  const requestedSchema = evt.method === "confirm"
    ? { type: "object", properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] }
    : { type: "object", properties: { value: { type: "string" } }, required: ["value"] };
  const message = [evt.method, evt.title].filter(Boolean).join(": ") + (Array.isArray(evt.options) ? ` [${evt.options.join(", ")}]` : "");
  const resp = await serverRequest("elicitation/create", { message, requestedSchema }, 120000);
  if (!ch.pendingQuestion || ch.pendingQuestion.id !== evt.id) return;
  if (resp && resp.result && resp.result.action === "accept" && resp.result.content) {
    const fields = {};
    if (resp.result.content.value !== undefined) fields.value = resp.result.content.value;
    if (resp.result.content.confirmed !== undefined) fields.confirmed = resp.result.content.confirmed;
    writeUiResponse(ch, evt.id, fields);
  } else if (resp && resp.result) {
    writeUiResponse(ch, evt.id, { cancelled: true });
  }
}

function channelSteer(rawName, message) {
  const named = chanName(rawName);
  if (named.error) return taskResult({ errorMessage: named.error });
  const name = named.name;
  if (typeof message !== "string" || !message.trim() || message.length > 4096) {
    return taskResult({ sessionName: name, errorMessage: "steer message must be a non-empty string under 4096 chars" });
  }
  const ch = registry.get(name);
  if (!ch || !ch.alive || !ch.turnInFlight) {
    return taskResult({ sessionName: name, errorMessage: "conversation is idle -- use pi_conversation_send" });
  }
  try { ch.child.stdin.write(JSON.stringify({ type: "steer", message }) + "\n"); } catch {
    return taskResult({ sessionName: name, errorMessage: "steer write failed (channel dead?)" });
  }
  ch.steered.push(message);
  return taskResult({ ok: true, sessionName: name, summary: "steer queued -- delivered at the next turn boundary" });
}

function channelInterrupt(rawName, message) {
  const named = chanName(rawName);
  if (named.error) return taskResult({ errorMessage: named.error });
  const name = named.name;
  if (typeof message !== "string" || !message.trim() || message.length > 4096) {
    return taskResult({ sessionName: name, errorMessage: "interrupt message must be a non-empty string under 4096 chars" });
  }
  const ch = registry.get(name);
  if (!ch || !ch.alive || !ch.turnInFlight) {
    return taskResult({ sessionName: name, errorMessage: "conversation is idle -- use pi_conversation_send" });
  }
  ch.pendingInterrupt = message;
  try { ch.child.stdin.write(JSON.stringify({ type: "abort" }) + "\n"); } catch {
    ch.pendingInterrupt = null;
    return taskResult({ sessionName: name, errorMessage: "abort write failed (channel dead?)" });
  }
  return taskResult({ ok: true, sessionName: name, summary: "interrupt queued -- the in-flight send's result will reflect the new turn" });
}

function piRespond(rawName, args) {
  const named = chanName(rawName);
  if (named.error) return taskResult({ errorMessage: named.error });
  const name = named.name;
  const ch = registry.get(name);
  if (!ch || !ch.alive || !ch.pendingQuestion) {
    return taskResult({ sessionName: name, errorMessage: "no pending question for this conversation" });
  }
  const fields = {};
  if (args.cancelled === true) fields.cancelled = true;
  else if (typeof args.confirmed === "boolean") fields.confirmed = args.confirmed;
  else if (typeof args.value === "string") fields.value = args.value;
  else return taskResult({ sessionName: name, errorMessage: "provide value, confirmed, or cancelled:true" });
  writeUiResponse(ch, ch.pendingQuestion.id, fields);
  return taskResult({ ok: true, sessionName: name, summary: "response delivered to pi" });
}

function shutdownChannels() {
  for (const ch of [...registry.values()]) killChannel(ch);
}
const reaper = setInterval(() => {
  const now = Date.now();
  for (const ch of [...registry.values()]) {
    if (ch.alive && now - ch.lastUsedAt > TTL_MS) killChannel(ch);
  }
}, REAP_INTERVAL_MS);
reaper.unref();
process.on("SIGTERM", () => { shutdownChannels(); process.exit(0); });
