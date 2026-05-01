---
description: "Deep research with citation tracking, dedup preflight, and a deterministic validation gate. Produces a dated artifact under .documentation/ and refreshes research-index.md."
argument-hint: "<topic> [--scope broad|narrow] [--update]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch, Agent, AskUserQuestion
---

# Deep Research

Launch the deep-research-agent with a structured 5-phase workflow:

1. **SCOPE** — research plan + topic slug + dedup check against existing
   `research-index.md`.
2. **SEARCH + CAPTURE** — claim/URL/timestamp/snippet log built in real time.
3. **SYNTHESIZE** — draft artifact at `.documentation/{slug}-YYYY-MM-DD.md`.
4. **VALIDATE** — run `${CLAUDE_PLUGIN_ROOT}/scripts/validate-citations.sh`
   on the draft. Hard failures block return; warnings surface in the report.
5. **HANDOFF** — refresh `research-index.md` via
   `${CLAUDE_PLUGIN_ROOT}/scripts/build-research-index.sh` and emit the
   standard `agent-handoff` document.

## Arguments

- `<topic>` — required. The subject to research. Free-text; the agent
  derives a stable slug.
- `--scope broad|narrow` — optional. `broad` (default) explores landscape +
  authoritative sources. `narrow` zooms into one specific question.
- `--update` — optional. Treat the most recent matching artifact as the
  base; produce an additive update with a bumped `version:` and a
  `## Version History` entry.

## Step 1: Hand off to the agent

Launch `deep-research-agent` (Agent tool) with the user's topic and any flags
above. The agent runs the 5 phases autonomously and returns when Phase 5
completes (or when Phase 4 hard-fails and the agent surfaces the diagnostic).

## Step 2: Surface the artifact path

After the agent returns, report:
- The artifact path (`.documentation/{slug}-YYYY-MM-DD.md`)
- The validation status (`PASS` / `WARN` / `FAIL` from Phase 4)
- The handoff document path (`.scratchpad/handoffs/...`)

## Rules

- All user-facing questions during dedup preflight (Phase 1) MUST use
  `AskUserQuestion`.
- The validation gate is mandatory in Phase 4 — never skip it for "small"
  artifacts.
- The agent-handoff skill is invoked unconditionally in Phase 5, even on
  hard-fail (status `FAIL` so the next agent can pick up).
