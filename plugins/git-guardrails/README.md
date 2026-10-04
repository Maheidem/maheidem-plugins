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
| **R1** naming | creating `refs/heads/X`, `X != D` | `X` does not match `^(fix\|feat\|chore\|docs)/[a-z0-9][a-z0-9._-]*$` | `git switch -c feat/<topic>` |
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
pass. `bin/install-git-guardrails` scans for exactly those repos.

## Install

**These commands are for the human to run.** The Claude Code side of this plugin
refuses `git config` writes to `core.hooksPath` and `guardrails.*` on purpose - see
`hooks/hooks.json` - so an agent cannot move its own guardrails.

Point `core.hooksPath` at this `git-hooks/` directory. Per repository:

```bash
cd /path/to/repo
git config core.hooksPath "$PWD/../path/to/plugins/git-guardrails/git-hooks"
```

Or for every repo of yours (global; **think first, it applies everywhere**):

```bash
git config --global core.hooksPath "$HOME/path/to/plugins/git-guardrails/git-hooks"
```

Because the shims chain, a global setting does not disable the hooks a repo has in
`.git/hooks`. If you also want them inside linked worktrees, nothing extra is needed:
hooks live in the common git dir.

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
bash plugins/git-guardrails/tests/test_guardrails.sh
```

Each case builds a fresh sandbox under `mktemp`: a bare `remote.git`, a clone of it,
`main` pushed and `origin/HEAD` fixed. `GIT_CONFIG_GLOBAL` points at a scratch
gitconfig that sets `core.hooksPath` (absolute path to this `git-hooks/`),
`user.name/email` and `init.defaultBranch`, and `GIT_CONFIG_SYSTEM=/dev/null` - the
real `~/.gitconfig` and system config are never read or written. Covered: R1
(accept/reject, `D` derived from `origin/HEAD` set to `trunk`), the full `D`
resolution order **without** `refs/remotes/origin/HEAD` (fresh clone of an empty
remote, master-default remote with no symref at all, remote added but never fetched),
R2 (limit 1, configurable limit, re-allowed after a delete, fresh-init first-branch
exception), R3 (rejected without upstream, allowed after `push -u`, rejected again
after `--unset-upstream`), R4 (direct commit on `main` rejected, `git pull --ff-only`
allowed, `update-ref` to an unpublished commit rejected), no-origin repos,
`git worktree add -b` counting as a creation, deletions, other namespaces, detached
HEAD, chaining (pre-commit / pre-push / commit-msg args / reference-transaction stdin,
non-executable hooks skipped), every state argument, fail-closed paths, and all of
`git-tidy` including never deleting `D`, the current branch, unmerged branches,
branches checked out in a worktree or branches without upstream.

Exit code is 0 only when every assertion passes; failures name the assertion and quote
stderr.

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
bin/git-tidy                                branch/worktree report + safe prune
tests/test_guardrails.sh                  sandbox suite (mktemp, isolated GIT_CONFIG_GLOBAL)
```

## Reporting

Issues: <https://github.com/Maheidem/maheidem-plugins/issues> - include
`git --version`, the command you ran and the full stderr.
