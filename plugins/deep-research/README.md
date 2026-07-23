# Deep Research Plugin

A deep-research agent for Claude Code that runs a 5-phase workflow with a
deterministic citation gate, dedup preflight, and an auto-maintained research
index.

## What's Included

| Component | Description |
|-----------|-------------|
| `/deep-research:research` | Slash command — explicit entry point with `--scope` and `--update` flags |
| **deep-research-agent** | Autonomous agent — 5 phases (SCOPE → SEARCH+CAPTURE → SYNTHESIZE → VALIDATE → HANDOFF) |
| `scripts/validate-citations.sh` | Deterministic citation gate — frontmatter, references, URL mirroring, footnote pairing, reliability ratings |
| `scripts/build-research-index.sh` | Deterministic index builder — rewrites `research-index.md` from artifact frontmatter |
| `references/source-reliability.md` | Formal 1-5★ rubric for source ratings |
| `agent-handoff` skill | Standardized handoff protocol |
| `tests/run_all.sh` | Fixture suite for the validation gate (7 cases) |

## Installation

```bash
claude install-plugin /path/to/deep-research
```

Or add to your project's `.claude/plugins` configuration.

## Usage

### Slash command (preferred)

```
/deep-research:research <topic> [--scope broad|narrow] [--update]
```

Examples:

- `/deep-research:research RAG pipeline best practices`
- `/deep-research:research --scope narrow Whisper.cpp ARM throughput`
- `/deep-research:research --update Kubernetes scaling strategies`

### Natural language triggers

Any of these phrases will route Claude to the agent:

- "research this", "deep dive on", "investigate claim", "find sources for"
- "literature review", "background on <X>"
- "what does the literature say about <X>", "validate this claim"
- "what are best practices for <X>"

## The 5-phase workflow

| Phase | Name | Key output | Gate |
|-------|------|------------|------|
| 1 | SCOPE | research plan + topic slug + dedup verdict | manual user-confirm if dup |
| 2 | SEARCH + CAPTURE | claim/URL/timestamp/reliability log | every claim has ≥1 source; consensus claims have ≥2 ≥3★ sources |
| 3 | SYNTHESIZE | draft artifact at `.documentation/{slug}-YYYY-MM-DD.md` | structural template match |
| 4 | VALIDATE | validation report (PASS / WARN / FAIL) | `validate-citations.sh` exits 0 or 2 |
| 5 | HANDOFF | refreshed `research-index.md` + handoff doc | `agent-handoff` skill invoked |

The agent prompt declares each phase with explicit Input / Output / Done-when
contracts so the workflow is auditable, not just behavioral.

## Where research gets saved

Resolved in Phase 1, in this order:

1. `.documentation/` (preferred)
2. `docs/research/`
3. `documentation/`
4. Falls back to creating `.documentation/`

Filename convention: `{slug}-YYYY-MM-DD.md` (e.g.
`rag-pipeline-best-practices-2026-04-29.md`).

## The validation gate

`scripts/validate-citations.sh` enforces, deterministically:

- Frontmatter has `date:`, `topic:`, `version:`.
- A `## References` (or `## Sources`) section exists.
- Every URL in the body is mirrored in References.
- Every reference entry has URL + access date + reliability rating
  (warnings for missing access date / rating).
- Every footnote `[^N]` has a matching `[^N]:` definition.
- `## Findings` / `## Detailed Findings` contains ≥1 URL.
- Every `### ` subsection within Findings cites at least one URL or footnote.

Exit codes: `0` = PASS, `1` = FAIL (hard issues to stderr), `2` = WARN
(advisory, exit code returned but artifact accepted).

URLs inside fenced code blocks are excluded from the URL-mirroring check —
they're typically API examples, not citations.

## Source reliability rubric

`references/source-reliability.md` defines the 1-5★ bands:

- 5★ Authoritative primary (peer-reviewed, official docs, standards bodies)
- 4★ Reputable secondary (analyst reports, established trade press, books)
- 3★ Verified expert (named conference talks, well-cited expert blogs)
- 2★ Anecdotal / low-citation (uncited blog posts, vendor marketing)
- 1★ Unattributed / community (Stack Overflow, Reddit, social media)

Cross-reference rule: a "consensus" claim requires ≥2 independent sources
at 3★ or higher.

## Delegating research from another workflow

deep-research is a clean delegation target for any workflow that surfaces a
question needing external grounding — it doesn't need to be invoked directly
by a person. Three concrete patterns:

### Filling a knowledge gap mid-task

When another agent or command surfaces a question it can't answer from local
context, delegate the gap to deep-research:

```
# ... a task surfaces "What is the current state of FedRAMP HIGH for vector DBs?"
/deep-research:research --scope narrow FedRAMP HIGH for vector databases
# ... artifact saved; cite the artifact path from the calling workflow's output.
```

### Background research before a decision

When a workflow needs background on a technology, standard, or market before
proceeding:

```
# ... a planning step needs "recent developments in on-device LLM inference"
/deep-research:research on-device LLM inference 2026 — recent developments
# ... artifact informs the decision.
```

### Grounding a specific claim

When a workflow flags a claim whose acceptability depends on external
precedent or evidence:

```
# ... a review step flags "data residency requirements for AI services — uncertain"
/deep-research:research data residency requirements for AI services in <jurisdiction>
# ... artifact backs the review comment with cited primary sources.
```

The deep-research artifact path can be referenced from the calling workflow's
own output (e.g., a decision log can cite
`.documentation/{slug}-YYYY-MM-DD.md`).

## Tests

```bash
bash plugins/deep-research/tests/run_all.sh
```

Currently runs `test_validate_citations.sh` with 7 fixture cases covering:
good artifact, missing References, bare claims in Findings, malformed URL,
orphan footnote, missing reliability rating (WARN), missing `date:` in
frontmatter.

## Requirements

- Claude Code CLI
- bash 3.2+, awk, grep, sed (for the validation / index scripts)
- No additional dependencies — uses built-in WebSearch and file tools
