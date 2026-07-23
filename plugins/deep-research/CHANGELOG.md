# Changelog — deep-research

All notable changes to the deep-research plugin.

Format: human-readable summaries grouped by impact. See [marketplace CHANGELOG](../../CHANGELOG.md) for cross-plugin / marketplace-level changes.

---

## [v2.0.0] — 2026-04-29

### Breaking Changes

- **New artifact frontmatter contract.** Artifacts must now declare `date:`,
  `topic:`, and `version:` in YAML frontmatter. The validation gate hard-fails
  on missing fields. Existing pre-v2 artifacts are not retroactively
  re-validated, but new artifacts produced by the agent must conform.

### New Features

- **Slash command `/deep-research:research`.** Explicit entry point with
  `<topic>` argument and `--scope broad|narrow`, `--update` flags. Wraps the
  agent and surfaces phase status to the user.
- **5-phase agent workflow.** The agent prompt now declares 5 named phases
  (SCOPE, SEARCH+CAPTURE, SYNTHESIZE, VALIDATE, HANDOFF) with explicit
  Input / Output / Done-when contracts replacing the previous 4 implicit
  phases.
- **Deterministic citation gate.** `scripts/validate-citations.sh` enforces
  frontmatter mandatory fields, References-section presence, URL mirroring,
  reliability ratings, footnote pairing, and bare-claim detection in the
  Findings section. Exit 0 = PASS, 1 = FAIL, 2 = WARN.
- **Deterministic index builder.** `scripts/build-research-index.sh` rewrites
  `research-index.md` from artifact frontmatter on every Phase 5 completion.
  Idempotent — no diff when nothing changed.
- **Source reliability rubric.** `references/source-reliability.md` formalizes
  the 1-5★ bands and the cross-reference rule (consensus claims require ≥2
  independent ≥3★ sources).
- **Dedup preflight.** Phase 1 reads `research-index.md` and the artifact
  directory before research starts; if a topic-keyword overlap >50% is found,
  the agent asks via `AskUserQuestion` whether to re-research / supplement /
  cancel.
- **Trigger phrases.** Agent description lists explicit triggers so natural
  language routing is predictable: "research this", "deep dive on",
  "literature review", "background on <X>", etc.
- **Test suite.** `tests/run_all.sh` orchestrates fixture-based tests for the
  validation gate (7 cases: good artifact, missing References, bare claim,
  malformed URL, orphan footnote, missing reliability rating, missing
  `date:`).
- **Delegation documentation.** README documents three concrete patterns
  where another workflow naturally delegates to `/deep-research:research`:
  filling a knowledge gap mid-task, background research before a decision,
  and grounding a specific claim.

### Improvements

- **Agent-handoff wired into agent body.** The `agent-handoff` skill was
  declared in frontmatter but the prompt body never invoked it. Phase 5
  now mandates the handoff with status, files-changed, and domain-specific
  details.
- **Code-block-aware URL extraction.** The validator excludes URLs inside
  fenced code blocks from the mirroring check — example URLs in code samples
  no longer cause false positives.
- **Permissive reliability format.** The rubric and validator accept ⭐
  (U+2B50), ★ (U+2605), and `[1-5]/5` text interchangeably.

### Internal

- Plugin grows from 5 to 12 files (5 new scripts/tests/references, 4 modified
  prose files, +`commands/research.md`). Net ~1,000 lines added.

---

## [v1.0.1] — 2026-03-12

### Bug Fixes

- Restored missing content from original agent definition that was accidentally dropped during registration.

---

## [v1.0.0] — 2026-03-12

### New Features

- **Deep research agent plugin** — conducts comprehensive web research with source citations, organized documentation, and standardized handoff protocol.
