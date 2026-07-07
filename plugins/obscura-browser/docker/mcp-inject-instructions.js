#!/usr/bin/env node
// stdio MCP passthrough that injects server-level `instructions` into the
// initialize response, so EVERY MCP client (Claude Code + any other) receives
// Obscura browser usage guidance at connect time — not just projects that
// happen to have a CLAUDE.md note.
//
// Chain: supergateway --stdio "node /mcp-inject-instructions.js"
//          -> this shim spawns `/obscura mcp --stealth` as its own stdio child
//          -> forwards everything, rewriting only the `initialize` result.
//
// Obscura's MCP speaks newline-delimited JSON-RPC over stdio (verified), so a
// line-based rewrite is safe.

const { spawn } = require('child_process');
const readline = require('readline');

const INSTRUCTIONS = [
  "Obscura is a headless browser with NO paint/layout engine (DOM + JavaScript only). It cannot take screenshots or read canvas/visual state.",
  "It impersonates a real Chrome TLS fingerprint, so it can load Cloudflare-protected sites that plain HTTP clients cannot.",
  "Guidance for the browser_* tools:",
  "- browser_evaluate runs ONE synchronous JS expression and returns its value; it does NOT await Promises. Never use setTimeout/async there. To wait, use browser_wait_for or browser_wait_for_text.",
  "- Toggling JavaScript/React-driven controls (custom checkboxes, faceted filters) via clicks is unreliable here. To apply filters or paginate, navigate with URL query parameters instead of clicking.",
  "- No screenshots: read pages with browser_snapshot, browser_markdown, browser_links, browser_extract, or browser_evaluate (DOM text).",
  "- This server shares ONE browser context across all clients (cookies/tabs persist and are shared). Avoid driving it from two sessions at the same time.",
].join("\n");

const child = spawn('/obscura', ['mcp', '--stealth'], { stdio: ['pipe', 'pipe', 'inherit'] });

// client -> server: raw passthrough
process.stdin.pipe(child.stdin);

// server -> client: line-based, rewrite the initialize result to add instructions
const rl = readline.createInterface({ input: child.stdout });
rl.on('line', (line) => {
  let out = line;
  const s = line.trim();
  if (s.startsWith('{')) {
    try {
      const msg = JSON.parse(s);
      const r = msg && msg.result;
      // initialize response: carries protocolVersion + serverInfo and a request id
      if (r && r.serverInfo && r.protocolVersion && msg.id !== undefined && msg.id !== null) {
        r.instructions = r.instructions ? (r.instructions + "\n" + INSTRUCTIONS) : INSTRUCTIONS;
        out = JSON.stringify(msg);
      }
    } catch (_) { /* pass through anything that isn't the JSON we rewrite */ }
  }
  process.stdout.write(out + "\n");
});

child.on('exit', (code) => process.exit(code == null ? 0 : code));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
