# Publishing a Plugin Version

Applies whenever the user asks to publish, release, ship, cut a new version, or "make available" a plugin in this marketplace.

## Steps (in order — do not skip or reorder)

**1. Determine the bump type.** If the user didn't specify `patch`/`minor`/`major`, ask — don't guess semver intent.

**2. Bump the version in both manifests with one command:**

```bash
python3 scripts/version_bumper.py bump plugins/<plugin-name> --type <patch|minor|major>
```

This script updates `plugins/<plugin-name>/.claude-plugin/plugin.json` **and** the matching entry in the root `.claude-plugin/marketplace.json` in one call (it derives the marketplace root from the plugin path's grandparent — see `scripts/version_bumper.py:104-136`). It also transparently handles the one plugin (`handoff`) whose manifest sits at `plugins/handoff/plugin.json` instead of under `.claude-plugin/` (`find_plugin_json`, same file lines 56-70) — no special-casing needed.

To set an exact version instead of bumping: `python3 scripts/version_bumper.py set plugins/<plugin-name> <version>` (only touches `plugin.json`, **not** `marketplace.json` — prefer `bump` unless you have a reason not to).

**3. Validate the two manifests agree**, then eyeball the diff:

```bash
claude plugin validate .
git diff --stat
```

Run `claude plugin validate .` from the marketplace root (this repo's root) — per the docs, when pointed at a marketplace directory it "validates that plugin's own `plugin.json` and warns when the entry's `version` doesn't match the one in `plugin.json`" for every local-path entry. This catches a partial/failed bump (e.g. script ran but one file didn't save) that a plain diff read might miss. Then confirm `git diff --stat` shows changes only in `plugins/<plugin-name>/.claude-plugin/plugin.json` (or `plugins/<plugin-name>/plugin.json`) and `.claude-plugin/marketplace.json`, plus any manual content changes you intended.

**4. Commit** using the convention already established in this repo's history (`git log --oneline`):

```
<plugin-name> <old-version> -> <new-version>: <one-line summary of what changed>
```

Example: `pi-delegate 0.2.0 -> 0.3.0: completion-marker contract as primary success signal`

**5. Push to the remote** (the step 6 block runs `git push` and checks it landed). The two profiles read this marketplace from different places (`plugins/known_marketplaces.json` in each config dir):

| Profile | How to run `claude` | maheidem-plugins source |
|---|---|---|
| PERSONAL | `CLAUDE_CONFIG_DIR` **unset** (`env -u CLAUDE_CONFIG_DIR`); never set it to `~/.claude`, that points at a stub state file | `directory` -> this working tree (sees even uncommitted edits) |
| WORK | `CLAUDE_CONFIG_DIR=$HOME/.claude-symphony` (what `ccsymphony` sets) | `github` -> `maheidem/maheidem-plugins`, branch `master` (sees only pushed commits) |

So PERSONAL updates without a push, but WORK silently stays on the old version until the push lands. Push is pre-authorized by Marcos as part of every release of this marketplace; still never force-push.

**6. Push, then update BOTH profiles and read the installed version back.** Run from the marketplace root, with `P` set to the plugin name. Run it as one block so a failure stops before the summary:

```bash
P=<plugin-name>
M=plugins/$P/.claude-plugin/plugin.json; [ -f "$M" ] || M=plugins/$P/plugin.json   # handoff keeps it at the plugin root
WANT=$(jq -r .version "$M")
git push && git fetch -q && [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}')" ] \
  || { echo "FAIL: push did not land on origin"; false; }
fail=0
for prof in personal work; do
  if [ "$prof" = personal ]; then run() { env -u CLAUDE_CONFIG_DIR claude "$@"; }
  else run() { CLAUDE_CONFIG_DIR="$HOME/.claude-symphony" claude "$@"; }; fi
  run plugin marketplace update maheidem-plugins || { echo "FAIL $prof: marketplace update"; fail=1; continue; }
  GOT=$(run plugin list --json | jq -r --arg id "$P@maheidem-plugins" \
        '[.[] | select(.id == $id and .scope == "user")][0].version // "not-installed"')
  if [ "$GOT" = not-installed ]; then echo "SKIP $prof: $P is not installed at user scope"; continue; fi
  run plugin update "$P@maheidem-plugins" || { echo "FAIL $prof: plugin update"; fail=1; continue; }
  GOT=$(run plugin list --json | jq -r --arg id "$P@maheidem-plugins" \
        '[.[] | select(.id == $id and .scope == "user")][0].version // "not-installed"')
  if [ "$GOT" = "$WANT" ]; then echo "OK   $prof: $P $GOT"; else echo "FAIL $prof: $P installed=$GOT source=$WANT"; fail=1; fi
done
[ "$fail" = 0 ]
```

- Always use the full `<plugin-name>@maheidem-plugins` id: the bare name has failed with `Plugin "orchestrator-mode" not found` (CLI 2.1.x, 2026-07-23) where the suffixed form worked.
- `plugin update` is a no-op when the version didn't change, so a missed bump (step 2) or push (step 5) shows up as a `FAIL ... installed=<old>` line, not as a silent success. Treat any FAIL as "not released".
- `SKIP` means the plugin was never installed in that profile. Installing it there (`run plugin install $P@maheidem-plugins`) is a separate decision, so ask first.
- The check reads `scope == "user"` only. `plugin list --json` can also show `project`/`local` entries (e.g. WORK lists a project-scope orchestrator-mode for `/Users/maheidem`); those need `--scope project|local` run from that project dir.
- Updates apply on the next session start (the CLI says "restart required").

**7. Check the settings that must match across profiles.** Three keys are meant to be identical in both `settings.json` files: `cleanupPeriodDays`, the no-hang Bash guard hook command, and `statusLine.command`:

```bash
k='{cleanupPeriodDays, statusLine: .statusLine.command, noHang: [.. | objects | .command? // empty | strings | select(test("no-hang"))]}'
diff <(jq -S "$k" ~/.claude/settings.json) <(jq -S "$k" ~/.claude-symphony/settings.json) && echo "profiles in sync"
```

Any diff output is drift: report it, don't "fix" it inside a release.

## Gotchas

- `marketplace update` and `plugin update` are two distinct operations: the first pulls the new catalog (manifest metadata), the second re-syncs the installed plugin files from that catalog entry. The step 6 loop runs both per profile; running only one leaves either a stale catalog or a stale install.
- `marketplace.json`'s per-plugin `description` field sometimes drifts from the plugin's own `plugin.json` description (pre-existing in this repo, e.g. `handoff`). The bump script does not reconcile these — only sync descriptions manually if you're intentionally updating them.
- Sources: `https://code.claude.com/docs/en/plugin-marketplaces.md`, `https://code.claude.com/docs/en/plugins-reference.md`.
