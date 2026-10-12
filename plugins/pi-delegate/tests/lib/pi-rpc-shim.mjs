#!/usr/bin/env node
// pi-rpc-shim.mjs <stub> [args...] -- runs a stub `pi --mode rpc` behind a
// proxy that speaks the parts of pi's RPC protocol the stubs leave out, and
// injects faults real pi can produce. Used by test_mcp_engine_fixes.sh.
//   always: a response repeats the id of its command (pi docs/rpc.md: "A
//     matching response repeats it"); ids are matched per command type, in
//     order.
// Env knobs:
//   PI_SHIM_STRAY_STATE=1     before each get_state response, write a response
//                             to a command nobody sent (id "stray-1", model
//                             stray/wrong): a client that matches by command
//                             type takes it
//   PI_SHIM_COMPACT_REJECTS=N refuse the first N prompts as pi does while a
//                             compaction runs (the stub never sees them)
//   PI_SHIM_LATE_REJECT_MS=T  refuse every prompt after the first, T ms late
//                             (the stub never sees it)
//   PI_SHIM_DIALOG_CONFIRM=1  turn each select dialog into a confirm dialog
//                             with a title and a message
import { spawn } from "node:child_process";

const [stub, ...args] = process.argv.slice(2);
const child = spawn(stub, args, { stdio: ["pipe", "pipe", "inherit"] });
child.on("exit", (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
process.stdout.on("error", () => {});

const ids = new Map(); // command type -> FIFO of ids
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let compactRejects = Number(process.env.PI_SHIM_COMPACT_REJECTS) || 0;
let prompts = 0;

function fromParent(line) {
  let cmd;
  try { cmd = JSON.parse(line); } catch { child.stdin.write(line + "\n"); return; }
  if (cmd && cmd.type === "prompt") {
    prompts++;
    if (compactRejects > 0) {
      compactRejects--;
      out({ id: cmd.id, type: "response", command: "prompt", success: false, error: "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry." });
      return;
    }
    const late = Number(process.env.PI_SHIM_LATE_REJECT_MS) || 0;
    if (late && prompts > 1) {
      setTimeout(() => out({ id: cmd.id, type: "response", command: "prompt", success: false, error: "shim refused the prompt late" }), late);
      return;
    }
  }
  if (cmd && typeof cmd.type === "string" && cmd.id !== undefined && cmd.type !== "extension_ui_response") {
    if (!ids.has(cmd.type)) ids.set(cmd.type, []);
    ids.get(cmd.type).push(cmd.id);
  }
  child.stdin.write(line + "\n");
}

function fromStub(line) {
  let evt;
  try { evt = JSON.parse(line); } catch { process.stdout.write(line + "\n"); return; }
  if (evt && evt.type === "response") {
    const q = ids.get(evt.command);
    if (q && q.length && evt.id === undefined) evt = { id: q.shift(), ...evt };
    if (evt.command === "get_state" && process.env.PI_SHIM_STRAY_STATE === "1") {
      out({ id: "stray-1", type: "response", command: "get_state", success: true, data: { sessionId: "stray", model: { provider: "stray", id: "wrong" }, isStreaming: false } });
    }
  }
  if (evt && evt.type === "extension_ui_request" && evt.method === "select" && process.env.PI_SHIM_DIALOG_CONFIRM === "1") {
    evt = { ...evt, method: "confirm", title: "Clear session?", message: "All messages will be lost.", options: undefined };
  }
  out(evt);
}

const lines = (stream, fn) => {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) fn(l); }
  });
};
lines(process.stdin, fromParent);
lines(child.stdout, fromStub);
process.stdin.on("end", () => child.stdin.end());
