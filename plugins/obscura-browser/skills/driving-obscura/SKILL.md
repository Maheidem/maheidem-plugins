---
name: driving-obscura
description: How to drive the Obscura headless-browser MCP (the obscura server, browser_* tools) to scrape or automate Cloudflare-protected websites. Use when navigating pages, extracting data, applying site filters, or automating any site through the obscura MCP — especially sites that block plain HTTP clients or normal headless browsers (Cloudflare "you have been blocked" / managed challenge). Covers the non-obvious gotchas: browser_evaluate is synchronous, prefer URL params over clicking JS filters, no screenshots, shared browser state.
---

# Driving the Obscura browser MCP

Obscura is a lightweight headless browser exposed as an MCP server (`obscura`) with
~35 `browser_*` tools. It impersonates a real Chrome TLS fingerprint, so it reaches
**Cloudflare-protected sites** that plain HTTP clients and ordinary headless browsers
get blocked on (e.g. `olx.com.br`). These are the things that will trip you up if you
drive it like a normal Playwright/CDP browser.

> The same guidance is injected as MCP server-level `instructions` (so it appears in
> every client automatically). This skill is the fuller version with examples.

## The five gotchas (learned the hard way)

1. **`browser_evaluate` is synchronous — it does NOT await Promises.**
   Returning a `Promise` gives you `{}`. Never `setTimeout`/`async` inside it.
   To wait, use `browser_wait_for` (selector) or `browser_wait_for_text` (substring).
   ```
   // BAD  -> returns {}
   browser_evaluate: new Promise(r => setTimeout(() => r(document.title), 2000))
   // GOOD -> returns the value now
   browser_evaluate: document.title
   ```

2. **Don't click JS/React filter controls — drive them with URL parameters.**
   Toggling custom checkboxes / faceted filters via `browser_click` or a DOM
   `.click()` is unreliable (Obscura has no layout/paint engine, so pointer/visibility
   -gated React handlers often don't fire — the filter silently doesn't apply).
   Instead, discover the site's query params and `browser_navigate` to them.
   ```
   // Find facet params by reading the filter links, then navigate:
   //   OLX delivery filter = &opst=2 ; pagination = &o=2
   browser_navigate: https://www.olx.com.br/brasil?q=mini+pc+ryzen&opst=2&o=2
   ```

3. **No screenshots, no visual state.** Obscura has no paint engine. Read pages with
   `browser_snapshot` (plain text), `browser_markdown` (token-dense), `browser_links`,
   `browser_extract` (schema), or `browser_evaluate` (custom DOM JS). If a task truly
   needs pixels/canvas/OCR, Obscura can't do it — use a real Chromium for that leg.

4. **One shared browser context.** The server is stateful and shared across all
   clients — cookies and tabs persist and are shared. Great for staying logged in;
   but don't drive it from two sessions at the same instant (every `browser_navigate`
   replaces the single page).

5. **First navigation to a heavy/Cloudflare site is slow** (~10-15s: challenge +
   SPA). Subsequent `browser_evaluate` calls are fast. Budget for it; don't retry
   prematurely.

## Reliable extraction pattern

`browser_evaluate` with custom JS is the workhorse — token-dense and precise. Walk
from anchor links up to the card container, and cross-check the site's structured
fields against the title (sellers often leave structured fields blank):

```js
browser_evaluate: (() => {
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="olx.com.br"]')) {
    const href = a.href.split('?')[0];
    if (!/\d{7,}$/.test(href) || seen.has(href)) continue;
    let box = a;
    for (let i=0;i<6 && box.parentElement;i++){box=box.parentElement; if(/R\$/.test(box.innerText)) break;}
    if (!/R\$/.test(box.innerText)) continue;
    seen.add(href);
    out.push({ title: (a.innerText||'').trim().split('\n')[0], href });
  }
  return JSON.stringify(out);
})()
```

For a listing's detail page, read the spec table by matching label elements
(`Memória RAM`, `Modelo do Processador`, `Armazenamento`, ...) and taking the sibling
value — but if a field is blank, fall back to parsing the title text.

## Deployment (prerequisite)

The MCP is an HTTP server at `http://localhost:3000/mcp`, served by a Docker
container (`obscura-mcp`) built from `docker/` in this plugin. If tools aren't
available, the container isn't running — run **`/obscura:start`**, or:

```bash
cd <plugin>/docker
docker build -t obscura-stealth:local -f Dockerfile .
docker build -t obscura-mcp-gw:local -f Dockerfile.mcp-gateway .
docker run -d --name obscura-mcp --restart unless-stopped -p 127.0.0.1:3000:3000 obscura-mcp-gw:local
```

MCP loads at session start, so after first-time setup, start a new session to get the
`obscura` tools.

## Scope note

Obscura beats **passive** Cloudflare (TLS/fingerprint scoring), which covers many
sites. It does not solve **interactive** Turnstile/CAPTCHA challenges — those still
need a real browser (nodriver) plus IP reputation.
