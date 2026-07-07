# obscura-stealth

Obscura headless browser compiled **with the `stealth` Cargo feature** so it
gets past Cloudflare (e.g. `olx.com.br`). The published `h4ckf0r0day/obscura`
image is NOT built with this feature and gets blocked.

## What's here

- `Dockerfile` — self-contained (clones the source, needs no build context).
- `search-olx.sh` — quick CLI search wrapper.

## Build

```bash
docker build -t obscura-stealth:local .
# reproducible pin:
# docker build --build-arg OBSCURA_REF=v0.1.9 -t obscura-stealth:local .
```

Needs BoringSSL/wreq build deps (git, cmake, clang, build-essential, golang) —
all handled inside the Dockerfile.

## Run as a permanent CDP server

Replaces the plain `obscura` container. Serves the DevTools protocol on
`127.0.0.1:9222` in stealth mode, and restarts with Docker.

```bash
docker rm -f obscura 2>/dev/null || true
docker run -d --name obscura \
  --restart unless-stopped \
  -p 127.0.0.1:9222:9222 \
  obscura-stealth:local \
  serve --port 9222 --host 0.0.0.0 --stealth
```

Drive it over CDP exactly like the plain image (browser websocket at
`ws://127.0.0.1:9222/devtools/browser`), or use one-shot `fetch`:

```bash
docker run --rm obscura-stealth:local fetch --stealth --dump text \
  "https://www.olx.com.br/brasil?q=mini%20pc%20ryzen"
```

## Quick search

```bash
./search-olx.sh "mini pc ryzen"
```

## System-wide MCP browser tool (Claude Code, all projects)

Expose stealth Obscura as a **Claude-Code-compatible MCP server** — 35 browser
tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`,
`browser_extract`, `browser_markdown`, tabs, cookies, ...) available in every
project at user scope.

Obscura's own `mcp --http` mode does **not** work with Claude Code (it omits the
`Mcp-Session-Id` header, so the client times out on `tools/list`). The fix is
`Dockerfile.mcp-gateway`: one container that wraps Obscura's working stdio MCP
with `supergateway --stateful`, which re-exposes spec-compliant Streamable-HTTP.

```bash
# 1) build the gateway image (needs obscura-stealth:local first)
docker build -f Dockerfile.mcp-gateway -t obscura-mcp-gw:local .

# 2) one persistent container, loopback-bound, restarts with Docker
docker run -d --name obscura-mcp --restart unless-stopped \
  -p 127.0.0.1:3000:3000 obscura-mcp-gw:local

# 3) register system-wide (all projects)
claude mcp add --scope user --transport http obscura http://localhost:3000/mcp

# 4) verify
claude mcp get obscura        # Status: ✔ Connected
```

Verified end-to-end: from an unrelated directory, a headless
`claude -p` drove `browser_navigate` to OLX through this MCP and got
`1 - 50 de 175 resultados` (past Cloudflare, no block). Transport MUST be `http`
and path MUST be `/mcp`. It's a shared server, so all clients share one browser
state (cookies/tabs) — a feature for persistent logins, just don't drive it from
two sessions at the exact same instant.

## Why the stealth build matters (evidence)

TLS fingerprint at `tls.peet.ws`, same query, three clients:

| Build | Protocol | JA4 | Result on OLX |
|-------|----------|-----|---------------|
| plain (rustls)   | HTTP/1.1 | `t13d1011h1_61a7ad8aa9b6_…` | ❌ "you have been blocked" |
| stealth (wreq)   | h2       | `t13d1516h2_8daaf6152771_…` | ✅ `1 - 50 de 171 resultados` |
| real Chrome      | h2       | `t13d1516h2_8daaf6152771_…` | — |

The stealth build's cipher-suite hash `8daaf6152771` is byte-identical to real
Chrome. For OLX (passive TLS/HTTP fingerprint scoring) that one layer is the
whole fix — no full Chrome needed. Harder sites with interactive Turnstile
challenges may still need a real browser (nodriver) + good IP reputation.
