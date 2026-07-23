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

**5. Push to the remote** (`git push`). This is required — the marketplace is git-backed, and `marketplace update` in step 6 only sees commits that have landed on the remote (`github.com/maheidem/maheidem-plugins`, branch `master`).

> Pushing is a shared-state, hard-to-reverse action. Confirm with the user before this step unless they've already explicitly authorized the full publish sequence in the current conversation.

**6. Refresh the marketplace catalog:**

```bash
claude plugin marketplace update maheidem-plugins
```

(Interactive equivalent: `/plugin marketplace update maheidem-plugins`.) If this runs before step 5's push lands, it silently sees stale data — always push first.

**7. Update the installed plugin to the new version:**

```bash
claude plugin update <plugin-name>@maheidem-plugins
```

(Interactive equivalent: `/plugin update <plugin-name>@maheidem-plugins`.) Always use the full `<plugin-name>@maheidem-plugins` identifier — the bare plugin name has been observed to fail (CLI 2.1.x, 2026-07-23: `claude plugin update orchestrator-mode` exited 1 with `Plugin "orchestrator-mode" not found`, even with no cross-marketplace ambiguity) while the suffixed form succeeded. `plugin update` is a no-op if the version didn't actually change, so a failed step 2 or 5 will surface here.

## Gotchas

- Steps 6 and 7 are two distinct operations: marketplace update pulls the new catalog (manifest metadata); plugin update re-syncs the actual installed plugin files from that catalog entry. Both are needed — running only one leaves either a stale catalog or a stale install.
- `marketplace.json`'s per-plugin `description` field sometimes drifts from the plugin's own `plugin.json` description (pre-existing in this repo, e.g. `handoff`). The bump script does not reconcile these — only sync descriptions manually if you're intentionally updating them.
- Sources: `https://code.claude.com/docs/en/plugin-marketplaces.md`, `https://code.claude.com/docs/en/plugins-reference.md`.
