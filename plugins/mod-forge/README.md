# mod-forge

This plugin holds one skill, `claude-code-mods`. The skill builds, redesigns and live-tests Claude Code mods.
A mod is a plugin with a hooks module. It can draw a pane, a band above the prompt or a toast. It can also add a slash command or guard tool calls.

## What the plugin holds

| Path | Content |
|---|---|
| `skills/claude-code-mods/SKILL.md` | The manual: the decision tree, the steps and the hard rules |
| `skills/claude-code-mods/scripts/mods.py` | The driver, with 22 subcommands. Each one ends with a PASS or FAIL line and a `next:` line. |
| `skills/claude-code-mods/templates/` | Templates for 7 mod kinds and the shared kit v2 (`kit/`) |
| `skills/claude-code-mods/references/` | Design rules, limits, pitfalls, tests, evidence and `VERSIONS.md` |
| `evals/` | Six cases for `claude plugin eval` |

The plugin has no hooks and no MCP servers.

## Install

Personal profile:

    claude plugin marketplace update maheidem-plugins && claude plugin install mod-forge@maheidem-plugins

Work profile:

    CLAUDE_CONFIG_DIR=$HOME/.claude-symphony claude plugin marketplace update maheidem-plugins && CLAUDE_CONFIG_DIR=$HOME/.claude-symphony claude plugin install mod-forge@maheidem-plugins

Then run `/reload-plugins` in each open session. The skill name is `/mod-forge:claude-code-mods`.

## Quick start

    /mod-forge:claude-code-mods notes-pane pane-list

The steps, in order: `doctor`, `new`, `check`, `mockups`, `pick`, `journey`, `crawl`, `storyboard`, `approve`, `build`, `live`, `done`.
Each call prints a `next:` line. Do what it says.

## The one hand step

After `build`, write the data source file of the kind. The driver names it:
`hooks/source.ts` (pane, band), `hooks/watch.ts` (toast) or `hooks/rules.ts` (guard). Add its test.

## Evals and lint

Run one case while you write it, from this folder (authoring):

    claude plugin eval . --case pane-list-new --runs 1 --ablation none --allow-tools Write Edit "Bash(python3 -I *)" "Bash(claude plugin *)" --scaffold --trust-plugin --no-publish --max-cost-usd 3

Run all cases with and without the plugin before a release:

    claude plugin eval . --ablation with-without --allow-tools Write Edit "Bash(python3 -I *)" "Bash(claude plugin *)" --scaffold --trust-plugin --threshold 0.8 --max-cost-usd 20 -j 1 --no-publish

Lint the skill text (budgets, banned phrases, hard-coded paths):

    python3 -I skills/claude-code-mods/scripts/mods.py lint-skill skills/claude-code-mods
