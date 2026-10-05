# git-guardrails

Git-level guardrails for your own working clones: a `reference-transaction` hook that
stops a ref update **before it lands**, plus shims so every hook the repository already
had keeps running, plus `git-tidy` to see (and clean) branches and worktrees.

Python 3 standard library only, plus small POSIX `sh` shims. No network, no daemon,
no state files.

Status: **sandbox-tested only** (suite in `tests/`, run against a local bare remote in
`mktemp`). Not registered in the marketplace yet.

---

## What it enforces

Git calls `reference-transaction` with `$1` = `preparing | prepared | committed |
aborted` and one stdin line per ref change: `<old-oid> <new-oid> <refname>`.
Enforcement happens only in **`prepared`** - the last moment git still honours a
non-zero exit - so a rejected change never appears anywhere: the transaction aborts,
`git` exits non-zero, and your working tree and index are untouched.

`D` = the default branch, resolved in this order:
`refs/remotes/origin/HEAD` (as a symref) → `refs/remotes/origin/main` →
`refs/remotes/origin/master` → `refs/heads/main` → `refs/heads/master` → `master`.
The remote-tracking fallbacks matter: cloning an **empty** remote never creates
`refs/remotes/origin/HEAD` (only `git remote set-head origin -a` does), and it can
also be dangling or not a symref - `git symbolic-ref --quiet` fails there, which
used to make `main` look like an ordinary branch. `git ls-remote --symref origin HEAD`
is deliberately *not* used: it is a network round trip inside every ref transaction.
`HAS_REMOTE` = the repo has a remote named `origin`.

| Rule | Fires on | Condition | Fix it with |
|------|----------|-----------|-------------|
| **R1** naming | creating `refs/heads/X`, `X != D` | `X` does not match `^(fix\|feat\|chore\|docs)/[a-z0-9][a-z0-9._-]*$` | `git switch -c <slug of X>` - a slugified name that itself passes R1 |
| **R2** budget | creating `refs/heads/X`, `X != D` | count of existing local branches other than `D` (and other than `X`) is `>= guardrails.maxBranches` (default **1**, read from `git config --global` only) | `git branch -d <merged>` / `bin/git-tidy --prune` |
| **R3** upstream | updating `refs/heads/X`, `X != D`, `HAS_REMOTE` | `branch.X.remote` is unset | `git push -u origin X` |
| **R4** default branch | updating `refs/heads/D`, `HAS_REMOTE` | new oid is **not** ancestor-or-equal of `refs/remotes/origin/D` | `git switch -c feat/<topic>` + PR; `git pull --ff-only` is fine |

Always allowed: **deletions** (new value all zeros), **every other namespace**
(`refs/tags`, `refs/remotes`, `refs/notes`, `ORIG_HEAD`, `AUTO_MERGE`, symref/`HEAD`
lines), creating **`D` itself**, and creating the **very first branch** of a fresh
clone or `git init`. Repos **without `origin`** only get R1 + R2 - R3/R4 have nothing
to compare against.

Rejections print one paragraph to stderr naming the rule, why it fired, and the fix
command, e.g.

```
git-guardrails R3 (no upstream): refs/heads/feat/login was updated but has no upstream
branch (`git config branch.feat.login.remote` is unset), so this work would stay on this
machine and drift from origin. Nothing changed: the reference transaction aborted. Fix:
`git push -u origin feat/login` ...
```

The name R1 suggests is **slugified and checked against R1 before it is printed**:
ASCII-folded, lowercased, anything outside `[a-z0-9._-]` becomes `-`, runs of dashes
collapsed, leading/trailing punctuation stripped, and a prefix you already got right is
kept (`fix/LoginBug` -> `fix/login_bug`, `feature/login` -> `feat/login`,
`My Feature` -> `feat/my-feature`, `feat/-` -> `feat/change`). Until 0.3.1 it printed
`feat/Bad_Name` for `Bad_Name` - a name R1 rejects too, so following our own advice got
you refused twice. An unparseable name falls back to `feat/change` rather than to a
suggestion we would refuse; the test feeds both real `git branch` calls and raw hook
stdin, and asserts every suggestion is accepted and created.

### Deliberate carve-outs

Checked in this order, before any rule:

* refname is not `refs/heads/*`, or it is a symref line (`ref:...`) - ignored.
* new value is all zeros (a deletion) - allowed.
* no resolvable repository - true while `git init` is still writing `HEAD`/objects;
  git's own plumbing refuses there and there is nothing to police yet.
* bare repository - the only receive-side exemption. A push into a *local* bare remote
  runs the hook on the receiving side too, where R2's "existing branches" would be the
  server's branches, so enforcing there would block legitimate pushes.
* nothing actually moves (`old == new`, or the new oid is what the ref already
  points at) - `git worktree add` and friends re-state refs.

`GIT_QUARANTINE_PATH` is **not** a carve-out and gets you nothing: git refuses every
ref update while it is exported (`fatal: ref updates forbidden inside quarantine
environment`), and any rule built on it misfires - a linked worktree keeps its git dir
in `<common>/worktrees/<name>`, outside the working tree, so "GIT_DIR differs from the
worktree" would have exempted ordinary developer work. Everything non-bare is enforced,
linked worktrees included (tested).

Creation vs update is decided by asking the ref store (`git rev-parse --verify`), not
by the old value on stdin: git fills that in only when the caller supplied one, so
`git update-ref <ref> <new>` reports all zeros even for an existing branch.

### Fail closed - and no bypass

Anything unexpected (bad state argument, malformed stdin line, git disappearing, a
crash) prints `git-guardrails: INTERNAL ERROR - failing closed`, a short traceback
summary and the issues URL, tells the agent to **ask the user and not to disable the
guardrails**, and exits non-zero, aborting the transaction. A guardrail that fails open
is decoration. (Missing `python3` also fails closed: the shim's `exec` fails.)

There is **no bypass command printed anywhere** and no bypass flag: not `--no-verify`
(the rules are not in `pre-commit`), not a `-c core.hooksPath=...` override, not an
exported `GIT_QUARANTINE_PATH`. The R2 limit is read from the **user-global** config
only, so a repository cannot raise it for itself - changing it is a human decision made
once per machine, in `~/.gitconfig`.

## Hook chaining

`core.hooksPath` makes git **ignore** `.git/hooks` entirely. So every other standard
hook name ships as a shim that hands the hook to the repository's own copy:

`pre-commit`, `commit-msg`, `prepare-commit-msg`, `pre-push`, `post-checkout`,
`post-merge`, `pre-rebase`, `post-rewrite` → `exec $(git rev-parse --git-common-dir)/hooks/<name>`,
with arguments and stdin passed straight through; exit 0 when there is no such
executable hook. Non-executable files are skipped (git would not run them anyway).
`reference-transaction` also chains, after its own checks pass, with stdin **replayed**
(git's ref lines are consumed by the checks first).

That keeps husky, lefthook, pre-commit, git-lfs, Gerrit's `commit-msg` and any
hand-written hook working - including a repo-local `pre-commit` that exits 1, which
still blocks the commit. Chaining never execs itself: if the plugin directory *is*
`$(git-common-dir)/hooks`, the shims exit 0.

The one thing chaining cannot fix: a repository that sets its **own** `core.hooksPath`
shadows the global one, and git-guardrails then never runs there. Check a repo with
`git config --local --get core.hooksPath`; if it is set, either move these hooks into
that path or call them from the repo's own `reference-transaction` after its checks
pass. `bin/install-git-guardrails` scans every root you give it and prints those repos
by name - that is what its dry run is for.

## Install

**The human runs this.** The Claude Code side of this plugin refuses `git config`
writes to `core.hooksPath` and `guardrails.*` on purpose (`hooks/hooks.json`), so an
agent cannot move its own guardrails - and the installer is written to be run by you,
once, for your own account.

```bash
plugins/git-guardrails/bin/install-git-guardrails              # dry run, writes nothing
plugins/git-guardrails/bin/install-git-guardrails --apply     # installs
plugins/git-guardrails/bin/install-git-guardrails --uninstall # removes, if it is ours
plugins/git-guardrails/bin/install-git-guardrails --roots ~/code ~/src   # extra scan roots
```

What it does:

1. **copies** `git-hooks/` to a stable path, `~/.config/git-guardrails/hooks`
   (`$GUARDRAILS_HOME` overrides the parent). Stable on purpose: a plugin lives in a
   versioned cache that Claude Code replaces on update, and `core.hooksPath` must not
   point into a directory that vanishes under git's feet. Files are copied byte-for-byte,
   shims `chmod 755`, `guardrails.py` 644.
2. **with `--apply` only**, sets `git config --global core.hooksPath` to that directory,
   then reads it back and verifies the shims landed and are executable. The default is a
   report: without `--apply` nothing is written anywhere.
3. **scans** the roots you pass (default `~/Documents`, depth 6, skipping `node_modules`,
   `Library`, `.git`, symlinks and friends) and lists every repository that a global
   install would *not* protect:
   - `SHADOWS` - the repo sets its own `core.hooksPath`, so git never looks at the
     global one and the guardrails silently do not run there.
   - `LOCAL` - the repo has its own `.git/hooks/reference-transaction`, which a global
     path shadows (git-guardrails chains to it, so this one is usually fine - the line
     is there so you notice a *copy* instead of a chain).
   Those repos are reported, never touched.

It writes exactly one config key, in `--apply`, in your own global gitconfig. It
refuses to replace a `core.hooksPath` that already points somewhere else (husky,
lefthook, a company profile) unless you pass `--force`, and then says so in the output.
It never deletes anything: `--uninstall` unsets the key **only** when the value is this
installer's own directory, prints the path of the leftovers, and leaves them for you.

Per repository instead of globally, if you prefer:

```bash
cd /path/to/repo
git config core.hooksPath "$HOME/.config/git-guardrails/hooks"
```

Because the shims chain, a global setting does not disable the hooks a repo has in
`.git/hooks`. Linked worktrees need nothing extra: hooks live in the common git dir.

## Claude Code hooks

`hooks/hooks.json` wires two hooks. They do not enforce R1-R4 - `core.hooksPath` and
`git-hooks/guardrails.py` do that, inside git. These two protect the enforcement from
the agent, and stop work from staying on the laptop.

### `PreToolUse` on Bash - `hooks/guard-bash.py`

Denies, with a one-line reason that names the rule first:

| Rule | Refuses | Why |
|------|---------|-----|
| `guardrails-config` | `git config core.hooksPath ...`, `git -c core.hooksPath=...`, `git config guardrails.maxBranches 5`, `--unset core.hooksPath`; writing, copying or `rm` of a `guardrails.config` | the hooks path *is* the enforcement, and the budget is the human's decision in `~/.gitconfig` |
| `quarantine` | any assignment to `GIT_QUARANTINE_PATH` (`export`, `NAME=... git ...`, `env ...`) | git's receive-side plumbing; exporting it only makes git refuse your own ref updates |
| `no-verify` | `--no-verify`, `--no-gpg-sign` | the rules live in the hooks, so this is precisely the bypass |
| `force-push` | `git push` with `--force`, `--force-with-lease`, `--force-if-includes`, `--mirror`, `-f` or a short bundle containing `f` (`-uf`), or a `+`-refspec (`git push origin +main`) | it rewrites history origin already has |
| `force-delete` | `git branch -D`, `git branch --delete --force`, `git worktree remove --force`, `git push --delete` / `-d` | throws away commits, or a published branch other people may have built on |
| `worktree-outside` | `git worktree add <path>` where `<path>` is not under `<repo>/.worktrees/` | worktrees stay in one git-excluded, findable place |

Left alone, deliberately: `git push -u origin feat/x` (R3's own fix),
`git push origin HEAD:refs/heads/feat/x`, `git pull --ff-only` (R4's fix), `git branch
-d`, `git worktree add <repo>/.worktrees/one -b feat/one`, `git config --get --global
guardrails.maxBranches`, `cat guardrails.config`, and every non-git command.

How it reads a command line: split on `&&`, `;`, `|` and newlines, so a forbidden
command at the end of a chain is still seen; each piece tokenised with `shlex` (quoting
respected), looking through `sudo` / `env` / `command` / `time` wrappers and leading
`NAME=value` prefixes, unpacking `eval "..."` and `$(...)`. If `shlex` cannot parse a
piece it falls back to a whitespace split, which sees more and so can only deny more.
`git config` is parsed as *config*, so `git grep --no-index -f patterns.txt` is not
mistaken for `git push -f`.

**Fails closed**: an internal error refuses the command, with the report URL. It never
prints `"allow"` - that would suppress your normal permission prompts; silence means
"not my business". The reason text never suggests forcing anything.

### `Stop` - `hooks/check-unpushed.py`

If the working directory is in a git repo with an `origin` remote and the current branch
has commits its upstream does not have - or has no upstream while `origin/<default>`
exists and lacks them - it blocks the turn **once**:

```json
{"decision": "block",
 "reason": "unpushed commits on feat/x: push or tell the user why not - feat/x is 2 commits ahead of origin/feat/x. Push with `git push`; do not force-push ..."}
```

`stop_hook_active` is honoured: when Claude Code is continuing *because* this hook
blocked, the hook allows, so it cannot loop. Silent for not-a-repo, no `origin`,
nothing committed, detached HEAD, a branch level with its upstream, and a fresh clone
nothing has been fetched from (R3 blocks that first commit anyway). Read-only -
`rev-parse`, `show-ref`, `rev-list` - and its test asserts it wrote no refs and no
config.

## Configuration

| Knob | Default | Effect |
|------|---------|--------|
| `guardrails.maxBranches` | `1` | R2 budget: how many local branches (besides `D`) may be open at once. **Read with `git config --global --get --int` only** - repo-local and worktree-local values are ignored on purpose, so no repository can relax its own guardrail. Invalid or negative values fall back to 1. |

Only the human sets it, once, machine-wide:

```bash
git config --global guardrails.maxBranches 3     # the only scope that is read
```

`git config guardrails.maxBranches 3` inside a repo is deliberately **not** honoured.

## `bin/git-tidy`

```bash
plugins/git-guardrails/bin/git-tidy            # dry run (default): report only
plugins/git-guardrails/bin/git-tidy --prune    # delete what is provably safe
```

Report: one row per local branch - `branch | upstream | ahead/behind | merged into D? |
worktree | last commit` - the current branch marked with `*`, `self` in the merged
column for `D`, `-` where there is no upstream (`ahead/behind` shows `gone` when the
remote-tracking ref is gone) and the worktree path or `-`. Then it lists worktrees git
marks prunable, the branches it would delete (with the reason), and the branches it
keeps (also with reasons).

`--prune` deletes a branch only when **all** of these hold:

* it is not `D` and not the checked-out branch,
* it is not checked out in any worktree,
* its tip is an ancestor of `origin/D` (fully merged),
* its upstream is gone, **or** equal to the branch (ahead 0 / behind 0).

Then it runs `git worktree prune`. It **never** force-deletes (`-D` is never used), so
git's own merged-into-HEAD check applies too: if `git branch -d` refuses, git-tidy
reports it and keeps the branch (usually `git pull --ff-only` on `D` first). Branches
with no upstream are reported but never pruned - publish once with `git push -u` or
delete them yourself. Without `origin/D` present, nothing is pruned.

## Tests

```bash
bash plugins/git-guardrails/tests/test_guardrails.sh     # git side:    13 cases / 202
bash plugins/git-guardrails/tests/test_claude_hooks.sh    # Claude Code:   6 cases / 123
bash plugins/git-guardrails/tests/test_installer.sh       # installer:     7 cases /  54
```

379 assertions in total, exit code 0 only when every one passes; a failure names the
assertion and quotes stderr. Every case builds a fresh sandbox under `mktemp`.

`test_guardrails.sh` - a bare `remote.git`, a clone, `main` pushed. `GIT_CONFIG_GLOBAL`
points at a scratch gitconfig carrying `core.hooksPath` (absolute path to this
`git-hooks/`), `user.name/email`, `init.defaultBranch`, and `GIT_CONFIG_SYSTEM=/dev/null`.
It is rewritten per fixture, so a `git config --global` set by one case cannot leak into
the next. Covers: R1 (accept/reject, `D` from `origin/HEAD` set to `trunk`), the full
`D` resolution order **without** `refs/remotes/origin/HEAD` (fresh clone of an empty
remote, master-default remote with no symref at all, remote added but never fetched),
the slugified R1 suggestion (every suggestion is created for real to prove it passes,
including raw-hook input like `My Feature` and `---`), R2 (limit 1, user-global limit
honoured, **repo-local ignored**, re-allowed after a delete, fresh-init first-branch
exception), R3 (rejected without upstream, allowed
after `push -u`, rejected again after `--unset-upstream`, enforced for a commit in a
*linked* worktree), R4 (direct commit on `main` rejected, `git pull --ff-only` allowed,
`update-ref` to an unpublished commit rejected), no-origin repos, `git worktree add -b`
as a creation, deletions, other namespaces, detached HEAD, chaining (pre-commit /
pre-push / commit-msg args / reference-transaction stdin, non-executable hooks skipped),
every state argument, fail-closed output (no bypass command printed, and the
quarantine marker is not a bypass), and all of `git-tidy` - never deleting `D`, the
current branch, unmerged branches, branches checked out in a worktree, or branches
without upstream.

`test_claude_hooks.sh` - both hooks, fed the JSON Claude Code sends on stdin: every
denial above (including chained `&&`/`;`, `eval`, `sudo`, `$(...)`, `-uf` bundles and
`+`-refspecs), every allowed fix, the exact `hookSpecificOutput` JSON shape, malformed
and empty payloads, and the `Stop` matrix - blocked ahead of upstream, blocked with no
upstream, silent when level / detached / no origin / nothing committed, silent when
`stop_hook_active`.

`test_installer.sh` - `HOME` is a mktemp directory for the whole run, so the real home
and the real global gitconfig are never in play. Dry run writes nothing and names the
repos that would shadow a global install; `--apply` copies all 11 files, sets
`core.hooksPath`, is idempotent, and **then enforcement is proven end-to-end from the
installed path** - R1 refuses `bad_name`, R3 refuses the unpublished commit, `push -u`
unblocks it, R4 refuses a commit on `main`. A foreign global `core.hooksPath` is
refused without `--force` and replaced with it, `--uninstall` unsets only when the path
is ours, leaves the files, and enforcement really stops. Nothing in the suite ever runs
`--apply` against the real home.

## Known edges (decisions, not bugs)
* **R3 means you publish before you commit.** `git switch -c feat/x` then
  `git push -u origin feat/x` before the first commit. That is the point: it is the
  rule that stops local-only work from drifting.
* **R4 blocks merge commits on `D`.** Use `git pull --ff-only`; `git pull --rebase`
  and `git merge` on `D` produce commits origin does not have and are rejected.
* A rejected `git commit` leaves its commit object unreachable (git aborts the ref
  write, the object stays until `git gc`). Nothing referenced moves - that is the
  guarantee, and it is the same behaviour as any rejecting hook.
* The shims are POSIX `sh` with `python3` on PATH. Windows needs `.cmd`/`.ps1`
  wrappers (or Git Bash only) - intentionally out of scope for this slice.
* **A remote that was added but never fetched fails closed on `D`.** With `origin`
  configured and no `refs/remotes/origin/*` yet, R4 cannot verify the move, so it
  refuses and says so. `git push -u origin main` (or `git fetch origin`) fixes it -
  the first push of the default branch is never blocked, because it only writes
  `refs/remotes/*` locally.
* `bin/git-tidy` reads `refs/remotes/<upstream>`; a remote renamed away from `origin`
  means no `D` resolution beyond the `main`/`master` fallback.
* **Pushing into a non-bare local repo is enforced on the receiving side.** Only bare
  repos are exempt as receive-sides. `git push` into a colleague's checked-out clone
  (with `receive.denyCurrentBranch=ignore`) therefore gets policed as if it were that
  repo's own work, and R1/R2 can reject it. Use a bare repo for a shared local remote.
* `pre-rebase`/`post-rewrite` are chain-only here (no rules of their own): rebasing a
  published branch is a ref force-update and git's own non-fast-forward protection
  applies, while a rebase of an unpublished branch shows up as R3/R4 on the ref move.

## Layout

```
plugin.json in .claude-plugin/plugin.json   manifest (not registered in marketplace.json yet)
git-hooks/guardrails.py                     all rule logic (stdlib only)
git-hooks/reference-transaction             exec python3 guardrails.py reference-transaction "$@"
git-hooks/_chain.sh                         shared chain helper
git-hooks/{pre-commit,commit-msg,prepare-commit-msg,pre-push,
           post-checkout,post-merge,pre-rebase,post-rewrite}   chain shims
hooks/hooks.json                            Claude Code wiring: PreToolUse(Bash) + Stop
hooks/_guard.py                             shared: payload/cwd, git plumbing, D resolution
hooks/guard-bash.py                         refuses commands that defeat the guardrails
hooks/check-unpushed.py                     Stop: blocks once on unpushed commits
bin/git-tidy                                branch/worktree report + safe prune
bin/install-git-guardrails                  copy to ~/.config/git-guardrails/hooks;
                                            --apply sets core.hooksPath, --uninstall
                                            removes it if it is ours, dry run by default
tests/test_guardrails.sh                  git-side suite (mktemp, isolated GIT_CONFIG_GLOBAL)
tests/test_claude_hooks.sh                PreToolUse + Stop, fed real hook JSON
tests/test_installer.sh                   installer in a fake HOME, end-to-end enforcement
```

## Reporting

Issues: <https://github.com/Maheidem/maheidem-plugins/issues> - include
`git --version`, the command you ran and the full stderr.
