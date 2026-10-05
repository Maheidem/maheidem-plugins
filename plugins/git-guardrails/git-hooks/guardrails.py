#!/usr/bin/env python3
"""git-guardrails - reference-transaction guardrails for local git repos.

Git invokes this through the `reference-transaction` shim in this directory
(installed by pointing core.hooksPath at this directory):

    git-hooks/reference-transaction  ->  python3 git-hooks/guardrails.py reference-transaction "$@"

Contract git gives us:
    $1     state: preparing | prepared | committed | aborted
    stdin  one line per ref update: "<old-oid> <new-oid> <refname>"

We enforce ONLY in the "prepared" state: it is the last moment at which git
still honours a non-zero exit, so a rejected ref update never lands anywhere.
In the other three states we only chain to the repo's own hook (see chain()).

Rules (refs/heads/* only; every other namespace - refs/tags, refs/remotes,
refs/notes, AUTO_MERGE - and symref lines such as HEAD updates are always
allowed):

  D           default branch, in order: target of the refs/remotes/origin/HEAD
              symref, else refs/remotes/origin/main, else refs/remotes/origin/master,
              else refs/heads/main, else refs/heads/master, else "master". (A fresh
              clone of an empty remote has no refs/remotes/origin/HEAD at all, so
              the remote-tracking refs are the fallback; `git ls-remote --symref` is
              too slow to ask on every ref transaction.)
  HAS_REMOTE  the repo has a remote named "origin".
  R1 naming   creating refs/heads/X (X != D): X must match
              ^(fix|feat|chore|docs)/[a-z0-9][a-z0-9._-]*$
  R2 budget   creating refs/heads/X (X != D): the count of existing local
              branches other than D (and other than X) must be <
              `git config --global --get guardrails.maxBranches` (default 1, read
              from the user-global config ONLY - a repo cannot relax it for itself,
              and there is no bypass flag).
              Always allowed: creating D itself, and creating the very first
              branch of a repo that has no branches yet (fresh clone/init).
  R3 upstream updating refs/heads/X (X != D) when HAS_REMOTE and
              branch.X.remote is unset -> rejected, "push -u origin X first".
  R4 default  updating refs/heads/D when HAS_REMOTE: allowed only if the new oid
              is ancestor-or-equal of refs/remotes/origin/D - i.e. a fast-forward
              to what the remote already has (`git pull --ff-only`).

  Without origin only R1 and R2 apply (R3/R4 are meaningless with no remote).
  Deletions (new oid all zeros) are always allowed.

Defence in depth, in this order, before any rule runs:
  * lines whose refname is not refs/heads/* are ignored (refs/tags, refs/notes,
    refs/remotes, ORIG_HEAD, AUTO_MERGE, ...), as are symref lines.
  * a line whose new value is all zeros is a deletion -> always allowed.
  * bare repository -> allowed: a push into a *local* bare remote runs this hook on
    the receiving side too, where R2 would count the server's branches. Everything
    non-bare is enforced, linked worktrees included. GIT_QUARANTINE_PATH is never a
    bypass: git refuses ref updates outright while it is exported.
  * no resolvable repository -> allowed (true while `git init` is still writing
    HEAD/objects; its own plumbing refuses, and there is nothing to police yet).
  * bare repository -> allowed: a push into a *local* bare remote runs this hook
    on the receiving side too, where the "existing branches" it would count for
    R2 are the server's branches - enforcing there would block legitimate pushes.
  * nothing actually moves (old == new on stdin, or the new oid is already what
    the ref points at) -> allowed: `git worktree add` and friends re-state refs.

Whether a ref is being created or updated is decided by looking at the ref
itself (`git rev-parse --verify`), not by the old value on stdin: git only
fills that in when the caller supplied one, so `git update-ref <ref> <new>`
reports all zeros for an existing branch too.

Internal errors fail CLOSED: print a traceback summary, say how to report it,
abort the transaction.

Stdlib only. Python 3.8+.
"""

import os
import re
import subprocess
import sys
import traceback

PLUGIN = "git-guardrails"
ISSUES_URL = "https://github.com/Maheidem/maheidem-plugins/issues"
BRANCH_NS = "refs/heads/"
ORIGIN_NS = "refs/remotes/origin/"
STATES = ("preparing", "prepared", "committed", "aborted")
ZERO_LENS = (40, 64)
HEX = set("0123456789abcdefABCDEF")
BRANCH_NAME_RE = re.compile(r"^(fix|feat|chore|docs)/[a-z0-9][a-z0-9._-]*$")
DEFAULT_MAX_BRANCHES = 1


class GuardrailError(Exception):
    """Something went wrong inside the guardrails -> fail closed."""


# --------------------------------------------------------------------------- #
# git plumbing
# --------------------------------------------------------------------------- #

def git(*args):
    """Run git in the current repo, return (exit_code, stdout_text)."""
    try:
        proc = subprocess.run(
            ["git"] + list(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:  # git missing from PATH, fork failure, ...
        raise GuardrailError("could not run `git %s`: %s" % (" ".join(args), exc))
    return proc.returncode, proc.stdout.decode("utf-8", "replace")


def git_out(*args):
    rc, out = git(*args)
    if rc != 0:
        raise GuardrailError("`git %s` failed with exit %d" % (" ".join(args), rc))
    return out.strip()


def ref_exists(ref):
    rc, _ = git("show-ref", "--verify", "--quiet", ref)
    return rc == 0


def ref_value(ref):
    """Current oid of <ref>, or "" when it does not exist.

    Read during "prepared", so this is the state *before* the transaction lands:
    it is how we tell a creation from an update. Git only fills in the old value
    on stdin when the caller supplied one - `git update-ref <ref> <new>` reports
    all zeros even for an existing ref - so the ref itself is the honest source.
    """
    rc, out = git("rev-parse", "--verify", "--quiet", ref)
    if rc != 0:
        return ""
    return out.strip()


def ref_is_ancestor(oid, other_ref):
    rc, _ = git("merge-base", "--is-ancestor", oid, other_ref)
    return rc == 0


def commit_exists(oid):
    rc, _ = git("cat-file", "-e", "%s^{commit}" % oid)
    return rc == 0


def git_common_dir():
    """Absolute path of the common git dir, or "" when it cannot be resolved.

    Unresolvable means "no repository here yet" - true while `git init` is still
    running its own ref transaction. Handled by the callers as "nothing to do".
    """
    rc, out = git("rev-parse", "--path-format=absolute", "--git-common-dir")
    if rc == 0 and out.strip():
        return out.strip()
    # git < 2.31 has no --path-format; resolve the relative answer ourselves.
    rc, out = git("rev-parse", "--git-common-dir")
    if rc != 0:
        return ""
    out = out.strip()
    if not out:
        return ""
    return out if os.path.isabs(out) else os.path.abspath(out)


def is_zero_oid(value):
    return len(value) in ZERO_LENS and all(c == "0" for c in value)


def is_oid(value):
    return len(value) in ZERO_LENS and all(c in HEX for c in value)


def has_remote():
    rc, out = git("remote")
    if rc != 0:
        raise GuardrailError("`git remote` failed with exit %d" % rc)
    return "origin" in out.split()


def is_bare():
    return git_out("rev-parse", "--is-bare-repository") == "true"


def receive_side():
    """True only for a real receive-side run: a bare repository.

    A `git push` into a *local* bare remote runs this hook on the receiving side
    too, where R2 would count the server's branches and R4 would compare the push
    against the wrong origin. The receiving side is bare, so bareness is the test.

    GIT_QUARANTINE_PATH is deliberately NOT used as a bypass signal. Two reasons,
    both measured:
      * git itself refuses every ref update while that variable is exported
        ("fatal: ref updates forbidden inside quarantine environment"), so the
        marker cannot smuggle a write past anything - it only disables git.
      * every heuristic built on it misfires. Requiring GIT_DIR to sit outside the
        working tree exempted ordinary *linked worktrees*, whose git dir
        (`<common>/worktrees/<name>`) lives outside the worktree by design - that
        was a real bypass, caught by a test.

    So: enforce in every non-bare repository, marker or no marker.
    """
    return is_bare()


def local_branches():
    """Short names of the local branches that exist right now."""
    out = git_out("for-each-ref", "--format=%(refname)", "refs/heads")
    names = []
    for line in out.splitlines():
        line = line.strip()
        if line.startswith(BRANCH_NS) and len(line) > len(BRANCH_NS):
            names.append(line[len(BRANCH_NS):])
    return names


def default_branch(remote):
    """D, in this order:

      1. target of the refs/remotes/origin/HEAD symref, when it resolves
      2. refs/remotes/origin/main, then refs/remotes/origin/master
      3. refs/heads/main, then refs/heads/master
      4. "master" (nothing exists yet - fresh repo)

    Step 2 exists because a fresh clone can have no refs/remotes/origin/HEAD at
    all: cloning an empty remote does not create it, `git remote set-head -a` has
    to be run to fix it up, and it can be dangling or not a symref at all. We do
    not use `git ls-remote --symref origin HEAD` - that is a network round trip
    inside every ref transaction. A remote-tracking ref is a local, honest answer:
    if origin/main exists locally, main is the branch that came from origin.
    """
    if remote:
        rc, out = git("symbolic-ref", "--quiet", ORIGIN_NS + "HEAD")
        target = out.strip()
        if rc == 0 and target.startswith(ORIGIN_NS):
            name = target[len(ORIGIN_NS):]
            if name:
                return name
        for candidate in ("main", "master"):
            if ref_exists(ORIGIN_NS + candidate):
                return candidate
    for candidate in ("main", "master"):
        if ref_exists(BRANCH_NS + candidate):
            return candidate
    return "master"


def max_branches():
    """R2 limit, read from the USER-GLOBAL config only.

    `git config --global --get --int guardrails.maxBranches`. Repo-local and
    worktree-local values are deliberately ignored: a repository (or a command run
    inside it) must not be able to relax its own guardrail. The limit is one
    human decision, made once per machine, and there is no bypass flag.
    """
    rc, out = git("config", "--global", "--get", "--int", "guardrails.maxBranches")
    text = out.strip()
    if rc != 0 or not text:
        return DEFAULT_MAX_BRANCHES
    try:
        value = int(text)
    except ValueError:
        return DEFAULT_MAX_BRANCHES
    return value if value >= 0 else DEFAULT_MAX_BRANCHES


def branch_upstream(short):
    rc, out = git("config", "--get", "branch.%s.remote" % short)
    if rc != 0:
        return None
    return out.strip() or None


# --------------------------------------------------------------------------- #
# stdin parsing
# --------------------------------------------------------------------------- #

def parse_lines(data):
    """Parse hook stdin into [(old, new, refname)]. Skips symref lines."""
    if not isinstance(data, str):
        data = data.decode("utf-8", "replace")
    parsed = []
    for raw in data.splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split(" ", 2)
        if len(parts) != 3:
            raise GuardrailError("malformed reference-transaction line: %r" % line)
        old, new, refname = (p.strip() for p in parts)
        # Symref updates carry "ref:refs/..." instead of an oid, e.g.
        # "0000... ref:refs/heads/main HEAD" - not ours to police.
        if old.startswith("ref:") or new.startswith("ref:"):
            continue
        if not is_oid(old) or not is_oid(new):
            raise GuardrailError("malformed oids in reference-transaction line: %r" % line)
        parsed.append((old, new, refname))
    return parsed


# --------------------------------------------------------------------------- #
# rule messages (one paragraph each: rule id, why, fix command)
# --------------------------------------------------------------------------- #

def msg_r1(name, short):
    tail = short.split("/")[-1].strip("-._") or "change"
    suggestion = "feat/" + tail
    return (
        "%s R1 (branch naming): creating %s was rejected because branch names must match "
        "%s - prefix fix|feat|chore|docs, lowercase first character after the slash. "
        "Nothing changed: the reference transaction aborted, so %s does not exist. Fix: "
        "`git switch -c %s` (or `git branch -m %s %s` if it already exists) - details and "
        "knobs in plugins/git-guardrails/README.md."
    ) % (PLUGIN, name, BRANCH_NAME_RE.pattern, name, suggestion, short, suggestion)


def msg_r2(name, short, others, limit, default):
    listed = ", ".join(sorted(others))
    return (
        "%s R2 (branch budget): creating %s would leave %d local branches besides the "
        "default branch %s, and the limit is %d. Counted: %s. Nothing changed: the "
        "reference transaction aborted. Fix: finish or delete the work that is already "
        "there - `git branch -d <branch>` for one that is merged, or run "
        "`plugins/git-guardrails/bin/git-tidy` to see which ones are safe and "
        "`bin/git-tidy --prune` to remove them - then retry. If this really needs more "
        "branches open at once, ask the user to decide; a repository cannot raise this "
        "limit for itself."
    ) % (PLUGIN, name, len(others), default, limit, listed)


def msg_r3(name, short):
    return (
        "%s R3 (no upstream): %s was updated but has no upstream branch "
        "(`git config branch.%s.remote` is unset), so this work would stay on this "
        "machine and drift from origin. Nothing changed: the reference transaction aborted. "
        "Fix: `git push -u origin %s` to publish the branch and set its upstream - commits "
        "on %s are allowed from then on. (Commits on the default branch are R4 territory: "
        "branch + PR.)"
    ) % (PLUGIN, name, short, short, short)


def msg_r4(default, new_oid, remote_ref):
    return (
        "%s R4 (no direct commits to %s): %s may only move to a commit origin already has, "
        "and %s is not an ancestor-or-equal of %s. Nothing changed: the reference "
        "transaction aborted. Fix: take the work off the default branch - `git switch -c "
        "feat/<topic>`, redo the commit, `git push -u origin feat/<topic>`, open a PR. "
        "Legitimate moves of %s are allowed: `git pull --ff-only` and `git reset --hard %s`."
    ) % (PLUGIN, default, default, new_oid[:12], remote_ref, default, remote_ref)


def msg_r4_unknown(default, remote_ref):
    return (
        "%s R4 (no direct commits to %s): the update could not be verified because the "
        "remote tracking ref %s does not exist locally, and this guardrail fails closed "
        "rather than guessing. Nothing changed: the reference transaction aborted. Fix: "
        "`git fetch origin` and retry; if origin has never had this default branch, "
        "establish it once with `git push -u origin %s` and `git remote set-head origin -a`."
    ) % (PLUGIN, default, remote_ref, default)


# --------------------------------------------------------------------------- #
# enforcement
# --------------------------------------------------------------------------- #

def check_creation(name, short, branches, default, limit):
    """R1 + R2 for the creation of refs/heads/<short>. Returns violation or None."""
    if short == default:
        return None  # creating the default branch itself is always allowed
    if not branches:
        return None  # very first branch of a fresh clone/init
    if not BRANCH_NAME_RE.match(short):
        return msg_r1(name, short)
    others = [b for b in branches if b != default and b != short]
    if len(others) >= limit:
        return msg_r2(name, short, others, limit, default)
    return None


def check_update(name, short, new_oid, remote, default):
    """R3 (feature branches) / R4 (default branch). Returns violation or None."""
    if not remote:
        return None  # no origin -> nothing to compare against
    remote_default_ref = ORIGIN_NS + default
    if short != default:
        if branch_upstream(short) is None:
            return msg_r3(name, short)
        return None
    if not ref_exists(remote_default_ref):
        return msg_r4_unknown(default, remote_default_ref)
    if not commit_exists(new_oid):
        return msg_r4_unknown(default, remote_default_ref)
    if not ref_is_ancestor(new_oid, remote_default_ref):
        return msg_r4(default, new_oid, remote_default_ref)
    return None


def evaluate(state, data):
    """Return the list of violations for this transaction ([] == allowed)."""
    updates = parse_lines(data)
    if state != "prepared":
        return []
    # Only refs/heads/* matter - filter before touching plumbing, so a HEAD-only
    # transaction (git init, plain `git checkout` of a symref) costs nothing.
    candidates = [
        (old, new, name) for old, new, name in updates
        if name.startswith(BRANCH_NS) and len(name) > len(BRANCH_NS)
        and not is_zero_oid(new) and old != new
    ]
    if not candidates:
        return []
    if receive_side():
        return []  # bare repository: the receiving side of a push, see receive_side()
    # No repository yet (`git init` runs its own ref transaction before HEAD and
    # objects exist, so its plumbing refuses) - nothing to police there.
    if not git_common_dir():
        return []
    if is_bare():
        return []  # a local bare remote receiving a push is not the developer's repo

    remote = has_remote()
    default = default_branch(remote)
    branches = local_branches()
    limit = max_branches()
    violations = []

    for _old, new, name in candidates:
        short = name[len(BRANCH_NS):]
        current = ref_value(name)
        if current and current == new:
            continue  # no-op write: git re-stating the same oid changes nothing
        if not current:
            problem = check_creation(name, short, branches, default, limit)
        else:
            problem = check_update(name, short, new, remote, default)
        if problem:
            violations.append(problem)

    return violations


# --------------------------------------------------------------------------- #
# chaining to the repo's own hooks
# --------------------------------------------------------------------------- #

def chain(name, args, stdin_bytes):
    """Run this repo's own hook <name>, passing args + stdin through.

    Returns its exit code; 0 when there is no such executable hook (or no repo
    context to find it in - chaining is a courtesy, not a gate). Never runs
    itself: if the plugin's own hooks dir *is* $(git-common-dir)/hooks, we skip.
    """
    common = git_common_dir()
    if not common:
        return 0
    target = os.path.join(common, "hooks", name)
    if not os.path.isfile(target) or not os.access(target, os.X_OK):
        return 0
    own = os.path.realpath(os.path.abspath(__file__))
    if os.path.dirname(own) == os.path.realpath(common):
        return 0  # hooksPath == this dir: chaining here would recurse forever
    try:
        proc = subprocess.run([target] + list(args), input=stdin_bytes)
    except OSError as exc:
        raise GuardrailError("chained hook %s could not run: %s" % (target, exc))
    return proc.returncode


# --------------------------------------------------------------------------- #
# reporting / entry point
# --------------------------------------------------------------------------- #

def fail_closed(summary, tb_text=None):
    lines = [
        "%s: INTERNAL ERROR - failing closed. The reference transaction was aborted and "
        "nothing was changed. Reason: %s" % (PLUGIN, summary),
    ]
    if tb_text:
        tail = [ln for ln in tb_text.rstrip().splitlines() if ln.strip()][-6:]
        lines.append("Traceback summary:")
        lines.extend("  " + ln for ln in tail)
    lines.append(
        "Report it at %s with the text above, your `git --version` and the command you "
        "ran, and tell the user what happened. Do NOT disable or work around the "
        "guardrails (no --no-verify, no core.hooksPath override, no GIT_QUARANTINE_PATH) "
        "- a guardrail that quietly steps aside is not a guardrail."
        % ISSUES_URL
    )
    sys.stderr.write("\n".join(lines) + "\n")
    return 1


def main(argv):
    # The shim calls us as `guardrails.py reference-transaction <state>`; direct
    # calls may pass just the state. Accept both, fail closed on anything else.
    args = list(argv[1:])
    if args and args[0] == "reference-transaction":
        args = args[1:]
    state = args[0] if args else ""
    try:
        data = sys.stdin.buffer.read() if hasattr(sys.stdin, "buffer") else b""
        if state not in STATES:
            raise GuardrailError(
                "git passed state %s; expected one of: %s"
                % (repr(state), ", ".join(STATES))
            )
        violations = evaluate(state, data)
        if violations:
            for text in violations:
                sys.stderr.write(text + "\n")
            return 1
        # Checks passed -> hand the same state + stdin to the repo's own hook.
        return chain("reference-transaction", args, data)
    except GuardrailError as exc:
        return fail_closed(str(exc))
    except Exception:  # noqa: BLE001 - internal errors fail closed
        return fail_closed("unexpected exception in %s" % PLUGIN, traceback.format_exc())


if __name__ == "__main__":
    sys.exit(main(sys.argv))
