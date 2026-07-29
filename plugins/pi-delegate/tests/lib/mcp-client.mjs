#!/usr/bin/env node
// mcp-client.mjs -- minimal stdio MCP test client (ADR-002 §8).
// Spawns the real server, writes JSONL requests, collects JSONL responses.
// Module API: mcpSession(serverPath, requests, opts) -> { lines, byId }
// CLI: node mcp-client.mjs <serverPath> "<json>" "<json>" ...   (prints response lines)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export function mcpSession(serverPath, requests, { timeoutMs = 30000, env = process.env, expectedReplies = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [serverPath], { env, stdio: ["pipe", "pipe", "pipe"] });
    const lines = [];
    const byId = new Map();
    let buffer = "";
    let settled = false;
    const notifications = requests.filter((r) => r && r.id === undefined).length;
    const wanted = expectedReplies ?? requests.length - notifications;

    const timer = setTimeout(() => finish("timeout"), timeoutMs);

    function finish(reason) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* ignore */ }
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      resolve({ lines, byId, reason });
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        lines.push(line);
        try {
          const msg = JSON.parse(line);
          if (msg && msg.id !== undefined) byId.set(msg.id, msg);
        } catch { /* keep raw line only */ }
        if (byId.size >= wanted) finish("complete");
      }
    });
    child.on("close", () => finish("closed"));

    for (const req of requests) {
      child.stdin.write(JSON.stringify(req) + "\n");
    }
  });
}

const _isDirectRun = (() => {
  try {
    return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (_isDirectRun) {
  const [serverPath, ...jsonArgs] = process.argv.slice(2);
  const requests = jsonArgs.map((j) => JSON.parse(j));
  mcpSession(serverPath, requests, { timeoutMs: 60000 }).then(({ lines }) => {
    for (const l of lines) console.log(l);
    process.exit(0);
  });
}
