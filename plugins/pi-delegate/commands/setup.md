---
description: Check whether the local pi CLI is ready and report its configured provider/model
allowed-tools: Bash, Read, AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" setup --json
```

Report back:
- Whether `pi` is installed and its version.
- Whether `~/.pi/agent/settings.json` was found, and if so its `defaultProvider` and `defaultModel`.
- The exact error message if `pi` was not found on PATH.
- The current project pin state, from the same JSON output's `projectConfigFound` / `projectConfigProvider` / `projectConfigModel` fields: report either "pinned to `<provider>`/`<model>`" or "no project pin set (using pi's global default)".

If `pi` is missing (the result's `piInstalled` is `false` / `ok` is `false` with an ENOENT-style error):
- Use `AskUserQuestion` exactly once to ask whether to install pi now.
- Options:
  - `Install pi (Recommended)`
  - `Skip for now`
- Do NOT run the install yourself without the user confirming via `AskUserQuestion` — this is a global package install and a real side effect.
- If the user chooses to install, run:

```bash
npm install -g @earendil-works/pi-coding-agent
```

- Then rerun the setup check:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" setup --json
```

and report the final result. If this rerun now reports `piInstalled: true`, continue into the project-pin picker below in this same run (pi is installed now, so the picker applies exactly as it would have on a clean run).

If `pi` is already installed, do not ask about installation — report the readiness summary above, then continue with the project-pin picker below.

## Project provider/model pin picker

Only do this when `piInstalled` is `true`. It lets the user view, set, or clear the per-project pin stored in `.claude/pi-delegate.local.md`. See the README's "Per-project provider/model pin" section for the full precedence contract: an explicit `--provider`/`--model` flag on a given `pi-companion.mjs task` call wins over this project config file, which in turn wins over pi's own global default from `~/.pi/agent/settings.json`.

1. Fetch the real, machine-specific provider/model combinations — never rely on memory or a guessed name here:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" list-models --json
```

This returns `{ ok, models: [{provider, model}, ...], rawOutput, errorMessage }`. If `ok` is `false`, report the failure and stop — do not offer the picker below.

2. Build every picker option from this `models` list only. Never let the user free-type a provider or model name: a mistyped provider name silently falls through to pi's default (no error, wrong behavior), and a mistyped model name makes pi hard-fail at run time. (AskUserQuestion always offers its own built-in "Other" free-text entry as an escape hatch and this cannot be turned off — if a user manually types something there, treat it as an unvalidated guess, not a confirmed pin: check it against the `list-models` output before writing it, and if it doesn't match, tell the user it's not a recognized combination instead of writing it.)

3. Ask what to do with a single `AskUserQuestion` call, one question:
   - Always include `Keep as-is`.
   - If not currently pinned (`projectConfigFound` was `false`): also include `Pin a provider/model`.
   - If currently pinned (`projectConfigFound` was `true`): also include `Change pin` and `Remove pin`.

   That's at most 3 options, comfortably under AskUserQuestion's 2-4-options-per-question limit.

4. Branch on the answer:

   - **Keep as-is** — do nothing further. Confirm the current state and stop.

   - **Remove pin** — run

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" remove-config --json
     ```

     and report the result (`ok`, `configPath`).

   - **Pin a provider/model** or **Change pin** — run the two-step provider → model picker below, then write the result.

### Two-step provider → model picker

AskUserQuestion hard-caps every question at 2-4 options (and at most 4 questions per call). A real `list-models --json` result is far bigger than that — verified output on this machine returned 168 provider/model combos across 9 distinct providers, with some single providers offering 40+ models — so the picker must paginate, never dump the full list into one question.

**Provider step:**
- Deduplicate `models[].provider` into a sorted list.
- If there are 9+ providers, first offer the same browse-or-filter choice
  described in the model step below, scoped to provider names.
- If exactly 1 provider remains unshown (only possible on the last page, or if the machine only has one provider at all), don't open a 1-option `AskUserQuestion` — `AskUserQuestion` requires at least 2 options. Just state it ("Only one provider is available: `<name>`") and treat it as selected.
- If 2-4 providers remain unshown, ask one `AskUserQuestion` listing all of them.
- Otherwise (5+ remain), page through them 3 at a time: show the next 3 unshown providers plus a 4th option `More providers...`. If the user picks it, show the next page the same way, applying the same 1/2-4/5+ rule to whatever remains.

**Model step (same pagination scheme, scoped to the chosen provider):**
- Filter `models[]` to `provider === <chosen provider>`, take `.model`, sorted.
- If the chosen provider has more than ~8 models, first ask (one `AskUserQuestion`, two options) whether to `Browse all (paged)` or `Filter by name`:
  - **Browse all** — proceed straight into the pagination below over the full list.
  - **Filter by name** — ask the user to type a substring, then match it case-insensitively against this provider's model names from the `list-models --json` output. Run the pagination below over the **filtered** list. If the filter matches nothing, say so and re-offer the browse/filter choice. The typed text is only ever a filter — the pin the user finally picks still comes from the validated list, never from what they typed.
- Apply the identical 1-direct-confirm / 2-4-direct-ask / 5+-page-by-3-with-"More models..." logic to whichever list (full or filtered) is in play.
- Never write a model that isn't in the `list-models` output, filtered or not.
- Providers with large catalogs may take several pages this way — that's the accepted tradeoff for never letting a typo reach `write-config`.

5. Once both a provider and a model are chosen, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" write-config --provider <chosen-provider> --model <chosen-model> --json
```

and report the result (`ok`, `configPath`, `provider`, `model`).
