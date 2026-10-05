#!/usr/bin/env bash
# git-guardrails test suite.
#
#   bash plugins/git-guardrails/tests/test_guardrails.sh
#
# Every case runs in its own sandbox under one mktemp root (removed on exit):
# a bare "remote.git" plus a clone of it. GIT_CONFIG_GLOBAL points at a scratch
# gitconfig that sets core.hooksPath to this plugin's git-hooks/ dir (absolute
# path) plus user.name/email and init.defaultBranch - the real ~/.gitconfig and
# the system gitconfig are never read or written, and nothing outside $ROOT is
# touched (the plugin source tree itself is only ever read).
#
# Covered (see git-hooks/guardrails.py):
#   R1 branch naming, R2 branch budget, R3 commit without upstream, R4 no direct
#   commits to the default branch (+ pull --ff-only allowed), deletions always
#   allowed, other ref namespaces always allowed, no-origin repos,
#   `git worktree add -b` counts as a creation, hook chaining into the repo's
#   own .git/hooks, fail-closed behaviour, and bin/git-tidy.

set -u

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$PLUGIN/git-hooks"
GIT_TIDY="$PLUGIN/bin/git-tidy"
GUARD="$HOOKS/guardrails.py"
ROOT="$(mktemp -d)"
export ROOT

cleanup() {
    chmod -R u+rwX "$ROOT" 2>/dev/null
    rm -rf "$ROOT"
}
trap cleanup EXIT

# --- isolation --------------------------------------------------------------- #
# One scratch "user global" gitconfig for the whole run. Every fixture rewrites it
# from scratch (see write_global), so a `git config --global guardrails.maxBranches`
# set by one case can never leak into the next.
GLOBAL="$ROOT/gitconfig"

write_global() {
    # write_global [maxBranches] - reset $GLOBAL to the base config, optionally with
    # a user-wide branch budget. Repo-local guardrails.* is never written here.
    local lim=${1:-}
    cat >"$GLOBAL" <<CFG
[core]
	hooksPath = $HOOKS
[user]
	name = guardrails test
	email = guardrails@example.com
[init]
	defaultBranch = main
[protocol "file"]
	allow = always
CFG
    if [ -n "$lim" ]; then
        printf '[guardrails]\n\tmaxBranches = %s\n' "$lim" >>"$GLOBAL"
    fi
}
write_global

export GIT_CONFIG_GLOBAL="$GLOBAL"
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_TERMINAL_PROMPT=0
export GIT_PAGER=cat
export GIT_ADVICE=0
export LC_ALL=C
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_QUARANTINE_PATH 2>/dev/null || true

ZERO=0000000000000000000000000000000000000000
pass=0
fail=0
cases=0

p() { printf '%s\n' "$*"; }

case_begin() {
    cases=$((cases + 1))
    p ""
    p "--- $1"
}

ok() { pass=$((pass + 1)); p "  PASS: $*"; }
no() { fail=$((fail + 1)); p "  FAIL: $*"; }

# check_ok <name> <cmd> [args...] - command must succeed
check_ok() {
    local name=$1
    shift
    local out rc
    out=$("$@" 2>&1 >/dev/null)
    rc=$?
    if [ "$rc" -eq 0 ]; then
        ok "$name"
    else
        no "$name: expected success (rc=$rc): $(printf '%s' "$out" | tr '\n' ' ')"
    fi
}

# check_blocked <name> <expected-substring-in-stderr> <cmd> [args...]
check_blocked() {
    local name=$1 needle=$2
    shift 2
    local out rc
    out=$("$@" 2>&1 >/dev/null)
    rc=$?
    if [ "$rc" -eq 0 ]; then
        no "$name: expected rejection, but it succeeded"
    elif ! printf '%s' "$out" | grep -qF -- "$needle"; then
        no "$name: blocked (rc=$rc) but stderr has no '$needle': $(printf '%s' "$out" | tr '\n' ' ')"
    else
        ok "$name (rc=$rc, names $needle)"
    fi
}

# check_stderr_absent <name> <forbidden-substring> <cmd> [args...]
# - command must fail, and its stderr must NOT contain the substring.
check_stderr_absent() {
    local name=$1 needle=$2
    shift 2
    local out rc
    out=$("$@" 2>&1 >/dev/null)
    rc=$?
    if [ "$rc" -eq 0 ]; then
        no "$name: expected rejection, but it succeeded"
    elif printf '%s' "$out" | grep -qF -- "$needle"; then
        no "$name: stderr still contains '$needle': $(printf '%s' "$out" | tr '\n' ' ')"
    else
        ok "$name"
    fi
}

# guard_out <cwd> <state> <stdin-line> - run guardrails.py directly in <cwd> with
# GIT_QUARANTINE_PATH exported; prints everything it wrote. If <cwd> does not exist it
# prints a FATAL line instead of nothing, so an empty "allowed" can never be a false
# pass caused by a fixture that did not build.
guard_out() {
    local cwd=$1 state=$2 line=$3
    if [ ! -d "$cwd" ]; then
        printf 'FATAL: no such directory %s (fixture did not build)' "$cwd"
        return 1
    fi
    ( cd "$cwd" && GIT_QUARANTINE_PATH="$cwd/quarantine" python3 "$GUARD" "$state" <<< "$line" 2>&1 )
}

# --- fixtures -------------------------------------------------------------- #

# new_sandbox <name> -> prints the clone path: bare remote + clone, main pushed,
# refs/remotes/origin/HEAD -> origin/main. The normal "day job" repo.
new_sandbox() {
    local d="$ROOT/$1"
    write_global "${2:-}"
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init --bare -q "$d/remote.git" >/dev/null 2>&1 || return 1
    git clone -q "$d/remote.git" "$d/work" >/dev/null 2>&1 || return 1
    git -C "$d/work" commit -q --allow-empty -m "chore: bootstrap" >/dev/null 2>&1 || return 1
    git -C "$d/work" push -q origin main >/dev/null 2>&1 || return 1
    git -C "$d/work" remote set-head origin -a >/dev/null 2>&1 || return 1
    printf '%s' "$d/work"
}

# new_local_sandbox <name> -> plain repo with commits on main, no origin.
new_local_sandbox() {
    local d="$ROOT/$1"
    write_global "${2:-}"
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init -q "$d/work" >/dev/null 2>&1 || return 1
    git -C "$d/work" commit -q --allow-empty -m "chore: bootstrap" >/dev/null 2>&1 || return 1
    git -C "$d/work" commit -q --allow-empty -m "chore: second" >/dev/null 2>&1 || return 1
    printf '%s' "$d/work"
}

# new_sandbox_headless <name> -> like new_sandbox but refs/remotes/origin/HEAD is
# NEVER created: cloning an empty remote does not create it and we do not run
# `git remote set-head origin -a`. This is the real state of many fresh clones.
new_sandbox_headless() {
    local d="$ROOT/$1"
    write_global "${2:-}"
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init --bare -q "$d/remote.git" >/dev/null 2>&1 || return 1
    git clone -q "$d/remote.git" "$d/work" >/dev/null 2>&1 || return 1
    git -C "$d/work" commit -q --allow-empty -m "chore: bootstrap" >/dev/null 2>&1 || return 1
    git -C "$d/work" push -q origin main >/dev/null 2>&1 || return 1
    printf '%s' "$d/work"
}

# new_sandbox_master_headless <name> -> master-default remote, cloned empty, first
# commit pushed: refs/remotes/origin/master exists, refs/remotes/origin/HEAD does not.
new_sandbox_master_headless() {
    local d="$ROOT/$1"
    write_global "${2:-}"
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init --bare -q "$d/remote.git" >/dev/null 2>&1 || return 1
    git -C "$d/remote.git" symbolic-ref HEAD refs/heads/master || return 1
    git clone -q "$d/remote.git" "$d/work" >/dev/null 2>&1 || return 1
    git -C "$d/work" commit -q --allow-empty -m "chore: bootstrap" >/dev/null 2>&1 || return 1
    git -C "$d/work" push -q origin master >/dev/null 2>&1 || return 1
    printf '%s' "$d/work"
}

# new_unpushed_sandbox <name> -> clone of an empty remote, nothing pushed yet:
# origin exists, refs/remotes/origin/* does not.
new_unpushed_sandbox() {
    local d="$ROOT/$1"
    write_global "${2:-}"
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init --bare -q "$d/remote.git" >/dev/null 2>&1 || return 1
    git clone -q "$d/remote.git" "$d/work" >/dev/null 2>&1 || return 1
    printf '%s' "$d/work"
}

# advance_remote <work> <branch> - move origin/main to <branch> the way a merged
# PR would: fast-forward push on the bare remote, then fetch in the clone.
advance_remote() {
    git -C "$1" push -q origin "$2:main" >/dev/null 2>&1
    git -C "$1" fetch -q origin >/dev/null 2>&1
}

# in_repo <work> <shell-snippet> - run a snippet with cwd inside the sandbox
in_repo() {
    sh -c "cd '$1' && $2"
}

p "git-guardrails tests"
p "plugin:  $PLUGIN"
p "sandbox: $ROOT"
p "git:     $(git --version 2>&1)"
p "python:  $(python3 --version 2>&1)"
p "isolation: GIT_CONFIG_GLOBAL=$GLOBAL (core.hooksPath=$HOOKS), GIT_CONFIG_SYSTEM=/dev/null"

# =========================================================================== #
case_begin "R1 - branch naming"
# =========================================================================== #
w=$(new_sandbox r1bad) || { p "FATAL: fixture failed"; exit 1; }
check_blocked "checkout -b topic/foo rejected" "R1" git -C "$w" checkout -q -b topic/foo
check_blocked "branch feature/login rejected (pattern shown)" "[a-z0-9][a-z0-9._-]*" git -C "$w" branch feature/login
check_blocked "R1 message names the fix command" "git switch -c feat/login" git -C "$w" branch feature/login
if git -C "$w" show-ref --verify refs/heads/feature/login >/dev/null 2>&1; then
    no "the rejected branch was created anyway"
else
    ok "nothing was created by the rejected transaction"
fi
check_blocked "branch Feat/Capital rejected" "R1" git -C "$w" branch Feat/Capital
check_blocked "branch feat/Uppercase rejected" "R1" git -C "$w" branch feat/Uppercase

w=$(new_sandbox r1good) || { p "FATAL: fixture failed"; exit 1; }
check_ok "checkout -b fix/retry allowed" git -C "$w" checkout -q -b fix/retry
w=$(new_sandbox r1good2) || { p "FATAL: fixture failed"; exit 1; }
check_ok "branch chore/add.git-tidy_sh allowed" git -C "$w" branch chore/add.git-tidy_sh
w=$(new_sandbox r1good3) || { p "FATAL: fixture failed"; exit 1; }
w=$(new_sandbox r1good3) || { p "FATAL: fixture failed"; exit 1; }
check_blocked "branch feat/-leading dash rejected" "R1" git -C "$w" branch feat/-dash

# The fix we print must be a name we would ACCEPT. 0.3.0 suggested
# "git switch -c feat/Bad_Name" for refs/heads/Bad_Name - and feat/Bad_Name
# fails R1 itself (uppercase after the slash), so following our own advice got you
# rejected a second time. Slugify: lowercase, [^a-z0-9._-] -> '-', collapse dashes,
# strip punctuation, keep a valid prefix, never suggest anything the regex rejects.
case_begin "R1 - the suggested fix name passes R1 itself"
w=$(new_sandbox r1slug) || { p "FATAL: fixture failed"; exit 1; }
ZERO=0000000000000000000000000000000000000000
HEADOID=$(git -C "$w" rev-parse HEAD)

# suggestion <text> - pull the name out of "`git switch -c <name>`"
suggestion() { printf '%s' "$1" | sed -n 's/.*git switch -c \([^`]*\)`.*/\1/p' | head -1; }

for bad in Bad_Name UPPER feat/Bad_Name fix/Login_Bug topic/My_Idea; do
    out=$(git -C "$w" branch "$bad" 2>&1); rc=$?
    if [ $rc -eq 0 ]; then
        no "R1 should have refused $bad"
    else
        ok "$bad refused by R1"
    fi
    sug=$(suggestion "$out")
    if [ -n "$sug" ] && printf '%s\n' "$sug" | grep -Eq '^(fix|feat|chore|docs)/[a-z0-9][a-z0-9._-]*$'; then
        ok "suggested name for $bad is R1-valid ($sug)"
    else
        no "suggested name for $bad is NOT R1-valid (got '$sug')"
    fi
    # the suggestion must be creatable: the hook has to let it through
    if git -C "$w" branch "$sug" >/dev/null 2>&1; then
        ok "and $sug is really accepted (created, then removed)"
        git -C "$w" branch -d "$sug" >/dev/null 2>&1
    else
        no "$sug was refused: $(git -C "$w" branch "$sug" 2>&1 | head -1)"
    fi
    if printf '%s' "$out" | grep -q "switch -c [^\`]*[A-Z]"; then
        no "message for $bad still suggests a name with capitals"
    fi
done

# names git itself will not even take on the command line - drive the hook directly
for bad in "My Feature" "Some/Two Words" "feat/" "---" "WEIRD!!name"; do
    out=$( cd "$w" && python3 "$GUARD" prepared <<< "$ZERO $HEADOID refs/heads/$bad" 2>&1 )
    sug=$(suggestion "$out")
    if printf '%s\n' "$sug" | grep -Eq '^(fix|feat|chore|docs)/[a-z0-9][a-z0-9._-]*$'; then
        ok "empty/awkward input '$bad' -> R1-valid suggestion ($sug)"
    else
        no "empty/awkward input '$bad' -> bad suggestion (got '$sug', output: $(printf '%s' "$out" | head -1))"
    fi
done

# an empty tail (refs/heads/) is not a ref at all: git's own check_refname_format
# refuses it, so guardrails filters it out instead of pretending to police it.
if git -C "$w" branch "" >/dev/null 2>&1; then
    no "git accepted an empty branch name (unexpected on this git)"
else
    ok "git itself refuses an empty branch name (no enforcement needed there)"
fi
out=$( cd "$w" && python3 "$GUARD" prepared <<< "$ZERO $HEADOID refs/heads/" 2>&1 )
if [ -z "$out" ]; then
    ok "refs/heads/ (empty tail) is filtered as not-a-branch, allowed silently by design"
else
    no "expected refs/heads/ to be filtered, got: $(printf '%s' "$out" | head -1)"
fi
if printf '%s' "$(python3 -c "import importlib.util,sys;spec=importlib.util.spec_from_file_location('g','$GUARD');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g);print(g.r1_suggestion(''))")" | grep -Eq '^(fix|feat|chore|docs)/[a-z0-9][a-z0-9._-]*$'; then
    ok "r1_suggestion('') still returns a valid name (feat/change)"
else
    no "r1_suggestion('') returned garbage"
fi

# a valid prefix must be KEPT (fix/ stays fix/), and a non-ASCII name must survive
out=$( cd "$w" && python3 "$GUARD" prepared <<< "$ZERO $HEADOID refs/heads/fix/Login_Bug" 2>&1 )
if printf '%s' "$out" | grep -q 'switch -c fix/login_bug`'; then
    ok "valid prefix preserved and tail slugified (fix/Login_Bug -> fix/login_bug)"
else
    no "prefix not preserved: $(printf '%s' "$out" | head -1)"
fi
out=$( cd "$w" && python3 "$GUARD" prepared <<< "$ZERO $HEADOID refs/heads/docs/caf%C3%A9--WIFI" 2>&1 )
if printf '%s' "$out" | grep -q 'switch -c docs/'; then
    ok "non-ascii tail still yields a docs/ suggestion"
else
    no "non-ascii tail produced no suggestion: $(printf '%s' "$out" | head -1)"
fi
# exhaustive unit check straight off the regex
python3 - "$GUARD" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("g", sys.argv[1])
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
bad = ["Bad_Name", "feat/Bad_Name", "UPPER", "My Feature", "topic/My_Idea",
       "feature/login", "fix/Login_Bug", "docs//x", "chore/2.0_release",
       "café/wi-Fi", "-dash", "feat/", "", "...", "A/B/C"]
bad_out = [b for b in bad if not g.BRANCH_NAME_RE.match(g.r1_suggestion(b))]
print("unit: %d inputs, %d bad suggestions" % (len(bad), len(bad_out)))
if bad_out:
    print("FAILED: " + ", ".join(repr(b) + "->" + repr(g.r1_suggestion(b)) for b in bad_out))
    sys.exit(1)
PY
if [ $? -eq 0 ]; then ok "r1_suggestion() output matches R1 for every probe input"; else no "r1_suggestion() produced a name R1 rejects"; fi


# D is whatever origin/HEAD points at: move it to "trunk" and check that creating
# the default branch is allowed even though the name breaks R1.
w=$(new_sandbox namedd) || { p "FATAL: fixture failed"; exit 1; }
git -C "$w" push -q origin main:trunk >/dev/null 2>&1
git -C "$ROOT/namedd/remote.git" symbolic-ref HEAD refs/heads/trunk
git -C "$w" fetch -q origin >/dev/null 2>&1
git -C "$w" remote set-head origin -a >/dev/null 2>&1
if [ "$(git -C "$w" symbolic-ref refs/remotes/origin/HEAD)" = "refs/remotes/origin/trunk" ]; then
    ok "origin/HEAD now points at trunk (so D = trunk)"
else
    no "could not move the default branch to trunk"
fi
check_ok "creating D (refs/heads/trunk) allowed although the name breaks R1" git -C "$w" branch trunk
check_blocked "creating a non-D branch with a bad name is still R1" "R1" git -C "$w" branch random/name

# =========================================================================== #
case_begin "R2 - branch budget (default limit 1)"
# =========================================================================== #
w=$(new_sandbox r2) || { p "FATAL: fixture failed"; exit 1; }
check_ok "first branch feat/one allowed (0 others)" git -C "$w" branch feat/one
check_blocked "second branch feat/two rejected" "R2" git -C "$w" branch feat/two
check_blocked "R2 message names the fix" "git branch -d" git -C "$w" branch feat/two
check_ok "deleting the first branch is allowed" git -C "$w" branch -d feat/one
check_ok "feat/two allowed again after deleting feat/one" git -C "$w" branch feat/two

w=$(new_sandbox r2limit) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 3
check_ok "limit 3: feat/a" git -C "$w" branch feat/a
check_ok "limit 3: feat/b" git -C "$w" branch feat/b
check_ok "limit 3: feat/c" git -C "$w" branch feat/c
check_blocked "limit 3: feat/d rejected (3 others)" "R2" git -C "$w" branch feat/d
check_ok "default branch main untouched" git -C "$w" rev-parse --verify --quiet main

w=$(new_sandbox r2fresh) || { p "FATAL: fixture failed"; exit 1; }
mkdir -p "$ROOT/r2fresh/empty"
git init -q "$ROOT/r2fresh/empty" >/dev/null 2>&1
check_ok "fresh init: first branch (bad name) allowed by the fresh-repo exception" \
    in_repo "$ROOT/r2fresh/empty" "git checkout -q -b anything/so-far && git commit -q --allow-empty -m 'chore: first'"
check_blocked "fresh init: a SECOND branch is subject to R1 again" "R1" \
    git -C "$ROOT/r2fresh/empty" branch anything/second

# =========================================================================== #
case_begin "R3 - commits on a branch need an upstream"
# =========================================================================== #
w=$(new_sandbox r3) || { p "FATAL: fixture failed"; exit 1; }
check_ok "create branch feat/one" git -C "$w" checkout -q -b feat/one
check_blocked "commit without upstream rejected" "R3" git -C "$w" commit --allow-empty -m "feat: work"
check_blocked "R3 fix command is push -u" "git push -u origin feat/one" git -C "$w" commit --allow-empty -m "feat: work"
check_ok "push -u origin feat/one" git -C "$w" push -q -u origin feat/one
check_ok "the same commit is now allowed" git -C "$w" commit -q --allow-empty -m "feat: work"
check_ok "unset the upstream again" git -C "$w" branch --unset-upstream
check_blocked "commit rejected again once the upstream is gone" "R3" git -C "$w" commit --allow-empty -m "feat: work again"

# =========================================================================== #
case_begin "R4 - no direct commits to the default branch"
# =========================================================================== #
w=$(new_sandbox r4) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 9
before=$(git -C "$w" rev-parse main)
check_blocked "direct commit on main rejected" "R4" git -C "$w" commit --allow-empty -m "chore: on main"
check_blocked "R4 message offers branch + PR" "git switch -c feat/" git -C "$w" commit --allow-empty -m "chore: on main"
check_blocked "R4 message names the remote ref" "refs/remotes/origin/main" git -C "$w" commit --allow-empty -m "chore: on main"
[ "$(git -C "$w" rev-parse main)" = "$before" ] && ok "main did not move" || no "main moved despite the rejection"
check_ok "work goes to a branch instead" git -C "$w" checkout -q -b feat/one
check_ok "publish the branch" git -C "$w" push -q -u origin feat/one
check_ok "commit on the branch" git -C "$w" commit -q --allow-empty -m "feat: work"
check_ok "push the branch" git -C "$w" push -q origin feat/one
advance_remote "$w" feat/one
check_ok "checkout main" git -C "$w" checkout -q main
check_ok "git pull --ff-only on main is allowed (fast-forward to origin/main)" \
    in_repo "$w" "git pull --ff-only -q origin main"
check_ok "main now matches origin/main" git -C "$w" merge-base --is-ancestor main origin/main
check_ok "throwaway branch with a commit origin/main does not have" \
    in_repo "$w" "git checkout -q -b feat/throwaway && git push -q -u origin feat/throwaway && git commit -q --allow-empty -m 'feat: not for main'"
check_blocked "update-ref of main to that unpublished commit is rejected" "R4" \
    in_repo "$w" "git update-ref refs/heads/main \$(git rev-parse feat/throwaway)"
if [ "$(git -C "$w" rev-parse main)" = "$(git -C "$w" rev-parse origin/main)" ]; then
    ok "main still equals origin/main after the rejected update-ref"
else
    no "main moved to an unpublished commit despite R4"
fi

# =========================================================================== #
case_begin "default branch resolution - no refs/remotes/origin/HEAD"
# =========================================================================== #
# Cloning an empty remote does NOT create refs/remotes/origin/HEAD (only
# `git remote set-head origin -a` does), and it can also be dangling or not a
# symref. So D falls back to refs/remotes/origin/main, then refs/remotes/origin/
# master, then local main, then local master - never `git ls-remote --symref`,
# which would be a network round trip inside every ref transaction.
w=$(new_sandbox_headless nohead) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 9
if git -C "$w" symbolic-ref --quiet refs/remotes/origin/HEAD >/dev/null 2>&1; then
    no "fixture was supposed to have NO refs/remotes/origin/HEAD"
else
    ok "clone has no refs/remotes/origin/HEAD (the fresh-clone reality)"
fi
check_ok "refs/remotes/origin/main exists (fallback anchor)" git -C "$w" show-ref --verify refs/remotes/origin/main
check_blocked "R4 still guards main with no origin/HEAD" "R4" git -C "$w" commit --allow-empty -m "chore: on main"
check_blocked "R4 message names the anchor it used" "refs/remotes/origin/main" git -C "$w" commit --allow-empty -m "chore: on main"
check_blocked "main is D, so other names are policed by R1" "R1" git -C "$w" branch topic/nope
check_ok "work goes to a branch" git -C "$w" checkout -q -b feat/one
check_ok "publish the branch" git -C "$w" push -q -u origin feat/one
check_ok "commit on the branch" git -C "$w" commit -q --allow-empty -m "feat: work"
check_ok "push the branch" git -C "$w" push -q origin feat/one
advance_remote "$w" feat/one
check_ok "back on main" git -C "$w" checkout -q main
check_ok "git pull --ff-only allowed with no origin/HEAD" in_repo "$w" "git pull --ff-only -q origin main"
check_ok "main advanced" git -C "$w" merge-base --is-ancestor main origin/main
printf '%s\n' "$(cd "$w" && python3 "$GIT_TIDY" 2>&1)" | grep -q "default branch: main" \
    && ok "git-tidy resolves D = main with no origin/HEAD" \
    || no "git-tidy did not resolve D = main without origin/HEAD"

# remote default is master and there is no refs/remotes/origin/HEAD at all: D must
# come from refs/remotes/origin/master (fallback 3), not from the "main" guesses.
w=$(new_sandbox_master_headless masterd) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 9
if git -C "$w" symbolic-ref --quiet refs/remotes/origin/HEAD >/dev/null 2>&1; then
    no "fixture should have no refs/remotes/origin/HEAD"
else
    ok "no refs/remotes/origin/HEAD on a master-default remote"
fi
if git -C "$w" show-ref --verify --quiet refs/remotes/origin/main; then
    no "fixture should have no refs/remotes/origin/main"
else
    ok "no refs/remotes/origin/main either (so the master fallback is what is tested)"
fi
check_ok "refs/remotes/origin/master exists -> D = master" git -C "$w" show-ref --verify refs/remotes/origin/master
check_blocked "commit on master rejected by R4 (master really is D)" "R4" git -C "$w" commit --allow-empty -m "chore: on master"
check_blocked "R4 message names refs/remotes/origin/master" "refs/remotes/origin/master" git -C "$w" commit --allow-empty -m "chore: on master"
check_blocked "here refs/heads/main is NOT special: creating it is R1" "R1" git -C "$w" branch main
check_ok "work goes to a branch" git -C "$w" checkout -q -b feat/one
check_ok "publish it" git -C "$w" push -q -u origin feat/one
check_ok "commit allowed there" git -C "$w" commit -q --allow-empty -m "feat: work"
check_ok "back on master" git -C "$w" checkout -q master
check_ok "publishing that branch left master alone" git -C "$w" rev-parse --verify --quiet refs/heads/master
printf '%s\n' "$(cd "$w" && python3 "$GIT_TIDY" 2>&1)" | grep -q "default branch: master" \
    && ok "git-tidy resolves D = master with no origin/HEAD" \
    || no "git-tidy did not resolve D = master without origin/HEAD"

# origin configured but never fetched: no refs/remotes/origin/* at all -> R4 cannot
# verify, so it fails closed with a fetch hint, and pushing the default branch fixes it.
w=$(new_unpushed_sandbox neverfetched) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 9
check_ok "first commit on unborn main allowed (fresh-repo exception)" git -C "$w" commit -q --allow-empty -m "chore: first"
check_blocked "second commit fails closed with a fetch hint" "git fetch origin" git -C "$w" commit --allow-empty -m "chore: second"
check_ok "pushing the default branch establishes refs/remotes/origin/main" git -C "$w" push -q -u origin main
check_blocked "from then on R4 guards it (new commit is not on origin)" "R4" git -C "$w" commit --allow-empty -m "chore: third"

# =========================================================================== #
case_begin "no bypass: config scope, quarantine marker, fail-closed wording"
# =========================================================================== #
# The R2 limit comes from the user-global config ONLY. A repository - or any
# command run inside it - must not be able to relax the guardrail for itself.
w=$(new_sandbox nobypass) || { p "FATAL: fixture failed"; exit 1; }
if git config --global --get --int guardrails.maxBranches >/dev/null 2>&1; then
    no "premise: the scratch user config should carry no limit (default 1)"
else
    ok "premise: no user-wide limit set, so the default 1 applies"
fi
check_ok "first branch allowed" git -C "$w" branch feat/one
git -C "$w" config guardrails.maxBranches 9 >/dev/null 2>&1
check_ok "repo-local guardrails.maxBranches=9 written (premise)" \
    git -C "$w" config --local --get --int guardrails.maxBranches
check_blocked "repo-local guardrails.maxBranches=9 does NOT lift R2" "R2" git -C "$w" branch feat/two
check_stderr_absent "R2 message suggests no way to raise the cap" "maxBranches" \
    git -C "$w" branch feat/two
check_blocked "R2 message still gives the real fix" "git branch -d" git -C "$w" branch feat/two
check_ok "setting it user-wide is the human's decision, and works" \
    sh -c "git config --global guardrails.maxBranches 2"
check_ok "with the user-wide limit at 2 the second branch is allowed" git -C "$w" branch feat/two
check_blocked "the third is not" "R2" git -C "$w" branch feat/tre

# the fail-closed report must not hand out a bypass
closed=$(python3 "$GUARD" </dev/null 2>&1)
printf '%s\n' "$closed" | sed 's/^/  | /'
printf '%s' "$closed" | grep -qF -- "-c core.hooksPath=" \
    && no "fail-closed output still prints a bypass command" \
    || ok "fail-closed output prints no bypass command"
printf '%s' "$closed" | grep -qiF "do not disable" \
    && ok "fail-closed output tells the agent not to disable the guardrails" \
    || no "fail-closed output lacks the do-not-disable instruction"
printf '%s' "$closed" | grep -qF "maheidem-plugins/issues" \
    && ok "fail-closed output gives the report URL" \
    || no "fail-closed output lacks the report URL"

# GIT_QUARANTINE_PATH alone must not switch the rules off in a developer's repo.
# git itself refuses every ref update while the marker is exported ("ref updates
# forbidden inside quarantine environment"), so the marker can never be used to smuggle
# a write past the guardrails; these cases assert that the RULES are still evaluated.
w=$(new_sandbox quar 5) || { p "FATAL: fixture failed"; exit 1; }
MAIN=$(git -C "$w" rev-parse main)
# a commit object that exists but is on no branch: the ref line is then a real move,
# not a no-op (a no-op would be allowed by design and prove nothing)
NEW=$(git -C "$w" commit-tree "$(git -C "$w" rev-parse 'HEAD^{tree}')" -m "probe")
out=$(guard_out "$w" prepared "$ZERO $NEW refs/heads/main")
case "$out" in
    *R4*) ok "marker in a normal clone: R4 is still evaluated (direct call)" ;;
    *)    no "marker in a normal clone: R4 was skipped - output: $out" ;;
esac
out=$(guard_out "$w" prepared "$ZERO $NEW refs/heads/nope")
case "$out" in
    *R1*) ok "marker in a normal clone: R1 is still evaluated (direct call)" ;;
    *)    no "marker in a normal clone: R1 was skipped - output: $out" ;;
esac
check_blocked "the real commit under the marker fails too (git's own refusal)" "quarantine" \
    in_repo "$w" "GIT_QUARANTINE_PATH=\$(pwd)/.git/quarantine git commit --allow-empty -m 'chore: sneaky'"
check_ok "a linked worktree is created (limit is 5 here)" \
    git -C "$w" worktree add -q "$ROOT/quar-wt" -b feat/ok
out=$(guard_out "$ROOT/quar-wt" prepared "$ZERO $NEW refs/heads/feat/ok")
case "$out" in
    *R3*) ok "linked worktree: its git dir belongs to the worktree, so R3 fires" ;;
    *)    no "linked worktree: enforcement skipped - output: $out" ;;
esac
check_blocked "a real commit in that linked worktree is blocked by R3 as well" "R3" \
    git -C "$ROOT/quar-wt" commit --allow-empty -m "feat: unpublished work in a worktree"
check_ok "push into the bare remote (a real receive side) still works" \
    in_repo "$w" "git push -q origin main:received && git fetch -q origin"
out=$(guard_out "$ROOT/quar/remote.git" prepared "$ZERO $NEW refs/heads/feat/received")
if [ -z "$out" ]; then
    ok "bare remote with the marker: receive side, allowed"
else
    no "bare remote should be exempt but said: $out"
fi

# =========================================================================== #
case_begin "repos without origin - R1 and R2 only"
# =========================================================================== #
w=$(new_local_sandbox noorigin) || { p "FATAL: fixture failed"; exit 1; }
check_ok "commits on main allowed (no origin)" git -C "$w" commit --allow-empty -m "chore: more on main"
check_ok "branch fix/local allowed" git -C "$w" checkout -q -b fix/local
check_ok "commit on the local branch (no R3 without origin)" git -C "$w" commit --allow-empty -m "fix: local work"
check_blocked "R2 still enforced (second branch)" "R2" git -C "$w" branch chore/another
check_blocked "R1 still enforced" "R1" git -C "$w" branch wip/whatever
check_ok "deletion still allowed" git -C "$w" checkout -q main
check_ok "delete local branch" git -C "$w" branch -D fix/local

# =========================================================================== #
case_begin "git worktree add -b counts as a creation"
# =========================================================================== #
w=$(new_sandbox wt) || { p "FATAL: fixture failed"; exit 1; }
check_blocked "worktree add -b feature/x rejected by R1" "R1" git -C "$w" worktree add -q "$ROOT/wt-bad" -b feature/x
check_ok "worktree add -b feat/one allowed" git -C "$w" worktree add -q "$ROOT/wt-one" -b feat/one
check_blocked "worktree add -b feat/two rejected by R2" "R2" git -C "$w" worktree add -q "$ROOT/wt-two" -b feat/two
check_ok "publish from inside the linked worktree" git -C "$ROOT/wt-one" push -q -u origin feat/one
check_ok "commit inside the linked worktree" git -C "$ROOT/wt-one" commit -q --allow-empty -m "feat: in worktree"
check_ok "remove the worktree" git -C "$w" worktree remove "$ROOT/wt-one"
check_ok "delete its branch afterwards" git -C "$w" branch -D feat/one

# =========================================================================== #
case_begin "deletions and other namespaces are always allowed"
# =========================================================================== #
w=$(new_sandbox del) || { p "FATAL: fixture failed"; exit 1; }
check_ok "create + publish + commit" \
    in_repo "$w" "git checkout -q -b feat/one && git push -q -u origin feat/one && git commit -q --allow-empty -m 'feat: work'"
check_ok "back to main" git -C "$w" checkout -q main
check_blocked "git's own -d safety still applies (we do not weaken it)" "not fully merged" git -C "$w" branch -d feat/one
check_ok "branch -D (force delete) is allowed by guardrails" git -C "$w" branch -D feat/one
check_ok "tag creation allowed" git -C "$w" tag v1.0.0
check_ok "tag deletion allowed" git -C "$w" tag -d v1.0.0
check_ok "refs/foo/bar creation allowed" git -C "$w" update-ref refs/foo/bar HEAD
check_ok "refs/foo/bar deletion allowed" git -C "$w" update-ref -d refs/foo/bar
check_ok "refs/notes/commits allowed" git -C "$w" update-ref refs/notes/commits HEAD
check_ok "detached HEAD commit allowed (HEAD only)" \
    in_repo "$w" "git checkout -q --detach HEAD && git commit -q --allow-empty -m 'chore: detached'"
check_ok "back on main" git -C "$w" checkout -q main

# =========================================================================== #
case_begin "chaining - the repo's own hooks still run"
# =========================================================================== #
w=$(new_sandbox chain) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 9
check_ok "branch with upstream" in_repo "$w" "git checkout -q -b feat/one && git push -q -u origin feat/one"

cat >"$w/.git/hooks/pre-commit" <<'HOOK'
#!/bin/sh
echo "local pre-commit says no" >&2
exit 1
HOOK
chmod +x "$w/.git/hooks/pre-commit"
check_blocked "repo-local .git/hooks/pre-commit exit 1 blocks the commit" "local pre-commit says no" \
    git -C "$w" commit --allow-empty -m "feat: blocked"
if git -C "$w" log --oneline -1 --format=%s | grep -q "feat: blocked"; then
    no "commit landed despite the chained pre-commit"
else
    ok "no commit object was recorded"
fi
chmod -x "$w/.git/hooks/pre-commit"
check_ok "commit passes once the local pre-commit is not executable" git -C "$w" commit -q --allow-empty -m "feat: allowed"

cat >"$w/.git/hooks/pre-push" <<'HOOK'
#!/bin/sh
echo "local pre-push blocks" >&2
exit 7
HOOK
chmod +x "$w/.git/hooks/pre-push"
check_blocked "repo-local pre-push blocks the push" "local pre-push blocks" git -C "$w" push origin feat/one
check_ok "the chained hook's own stderr reaches the user (git wraps its exit code)" \
    in_repo "$w" "git push origin feat/one 2>&1 | grep -q 'local pre-push blocks'"
rm -f "$w/.git/hooks/pre-push"
check_ok "push works again once the local pre-push is gone" git -C "$w" push -q origin feat/one

# arguments must be passed through to the chained hook, and stdin too
cat >"$w/.git/hooks/commit-msg" <<'HOOK'
#!/bin/sh
printf '%s\n' "args=$# msgfile=$1" >> "$ROOT/chain-args.log"
sed -n '1p' "$1" >> "$ROOT/chain-args.log"
exit 0
HOOK
chmod +x "$w/.git/hooks/commit-msg"
check_ok "commit runs the chained commit-msg hook" \
    in_repo "$w" "git commit -q --allow-empty -m 'feat: chained msg'"
if [ -f "$ROOT/chain-args.log" ] && grep -q "feat: chained msg" "$ROOT/chain-args.log" \
        && grep -q "args=1 msgfile=" "$ROOT/chain-args.log"; then
    ok "chained commit-msg got its arg and the message file content ($(tr '\n' ' ' < "$ROOT/chain-args.log"))"
else
    no "chained commit-msg did not receive args/stdin: $(cat "$ROOT/chain-args.log" 2>/dev/null)"
fi
rm -f "$w/.git/hooks/commit-msg"

cat >"$w/.git/hooks/reference-transaction" <<'HOOK'
#!/bin/sh
state=$1
while read -r line; do :; done
if [ "$state" = "prepared" ]; then
    echo "local reference-transaction vetoes" >&2
    exit 1
fi
exit 0
HOOK
chmod +x "$w/.git/hooks/reference-transaction"
check_blocked "repo-local reference-transaction veto fires (stdin replayed)" "local reference-transaction vetoes" \
    git -C "$w" branch feat/chained-veto
rm -f "$w/.git/hooks/reference-transaction"

cat >"$w/.git/hooks/commit-msg" <<'HOOK'
#!/bin/sh
exit 1
HOOK
check_ok "a non-executable repo hook is skipped" git -C "$w" branch feat/noexec-hook
check_ok "shim with no repo hook at all exits 0" sh -c "test ! -e '$w/.git/hooks/pre-rebase' && '$HOOKS/pre-rebase' a b </dev/null"

# =========================================================================== #
case_begin "guardrails.py directly - states and fail-closed"
# =========================================================================== #
w=$(new_sandbox states) || { p "FATAL: fixture failed"; exit 1; }
head=$(git -C "$w" rev-parse HEAD)
check_ok "state=preparing does not enforce" \
    in_repo "$w" "printf '%s %s refs/heads/bad_branch\n' $ZERO $head | python3 '$GUARD' preparing"
check_ok "state=committed does not enforce" \
    in_repo "$w" "printf '%s %s refs/heads/bad_branch\n' $ZERO $head | python3 '$GUARD' committed"
check_ok "state=aborted does not enforce" \
    in_repo "$w" "printf '%s %s refs/heads/bad_branch\n' $ZERO $head | python3 '$GUARD' aborted"
check_blocked "state=prepared enforces R1" "R1" \
    in_repo "$w" "printf '%s %s refs/heads/bad_branch\n' $ZERO $head | python3 '$GUARD' prepared"
check_ok "empty stdin is fine" in_repo "$w" "printf '' | python3 '$GUARD' prepared"
check_ok "symref line (HEAD) is skipped" \
    in_repo "$w" "printf '%s ref:refs/heads/main HEAD\n' $ZERO | python3 '$GUARD' prepared"
check_ok "refs/tags line is skipped even for a nasty name" \
    in_repo "$w" "printf '%s %s refs/tags/Bad-Tag\n' $ZERO $head | python3 '$GUARD' prepared"
check_blocked "missing state argument fails closed" "INTERNAL ERROR" python3 "$GUARD" </dev/null
check_blocked "unknown state fails closed" "INTERNAL ERROR" python3 "$GUARD" whatever </dev/null
check_blocked "malformed stdin fails closed" "INTERNAL ERROR" in_repo "$w" "printf 'garbage\n' | python3 '$GUARD' prepared"
check_blocked "non-oid new value fails closed" "INTERNAL ERROR" in_repo "$w" "printf '%s nope refs/heads/feat/x\n' $ZERO | python3 '$GUARD' prepared"
check_blocked "the shim propagates fail-closed" "INTERNAL ERROR" in_repo "$w" "printf '' | '$HOOKS/reference-transaction' bogus-state"
check_ok "reporting includes where to report it" \
    sh -c "python3 '$GUARD' </dev/null 2>&1 | grep -q 'maheidem-plugins/issues' || exit 3; exit 0"
check_ok "python sources compile" python3 -m py_compile "$GUARD" "$GIT_TIDY"

# =========================================================================== #
case_begin "git-tidy - report, dry run, --prune"
# =========================================================================== #
w=$(new_sandbox tidy1) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 9
check_ok "branch + publish + commit" \
    in_repo "$w" "git checkout -q -b feat/one && git push -q -u origin feat/one && git commit -q --allow-empty -m 'feat: work' && git push -q origin feat/one"
advance_remote "$w" feat/one
check_ok "bring local main up to origin/main (so git branch -d will accept it)" \
    in_repo "$w" "git checkout -q main && git pull --ff-only -q origin main"
check_ok "remote branch deleted -> upstream gone" \
    in_repo "$w" "git push -q origin --delete feat/one && git fetch -q --prune origin"
check_ok "worktree added" git -C "$w" worktree add -q "$ROOT/tidy-wt" -b feat/wt
check_ok "its directory removed" rm -rf "$ROOT/tidy-wt"
check_ok "git reports the worktree as prunable" \
    sh -c "git -C '$w' worktree list --porcelain | grep -q '^prunable'"

out=$(cd "$w" && python3 "$GIT_TIDY" 2>&1)
printf '%s\n' "$out" | sed 's/^/  | /'
row=$(printf '%s\n' "$out" | grep -E '^[* ]{1,2}feat/one[[:space:]]' | head -1)
printf '%s' "$row" | grep -q "gone" && ok "git-tidy shows the gone upstream" || no "row lacks 'gone': $row"
printf '%s' "$row" | grep -q "yes" && ok "git-tidy reports feat/one merged into main" || no "row lacks merged=yes: $row"
printf '%s' "$out" | grep -q "PRUNABLE" && ok "git-tidy lists the prunable worktree" || no "output lacks PRUNABLE"
printf '%s' "$out" | grep -q "dry run" && ok "dry run is the default" || no "not dry run by default"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/one >/dev/null && ok "dry run deleted nothing" || no "dry run deleted feat/one"
check_ok "git-tidy --help works" python3 "$GIT_TIDY" --help

check_ok "back on main before pruning" git -C "$w" checkout -q main
(cd "$w" && python3 "$GIT_TIDY" --prune >/dev/null 2>&1) && ok "--prune ran" || no "--prune failed"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/one >/dev/null && no "--prune kept feat/one" || ok "--prune deleted feat/one"
git -C "$w" rev-parse --verify --quiet refs/heads/main >/dev/null && ok "--prune never deletes the default branch" || no "main disappeared"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/wt >/dev/null && ok "--prune keeps a branch with no upstream" || no "feat/wt was deleted despite having no upstream"
git -C "$w" worktree list | grep -q "tidy-wt" && no "prunable worktree survived --prune" || ok "worktree prune removed the prunable worktree"

w=$(new_sandbox tidy2) || { p "FATAL: fixture failed"; exit 1; }
git config --global guardrails.maxBranches 9
check_ok "feat/equal (at main, published)" in_repo "$w" "git checkout -q -b feat/equal && git push -q -u origin feat/equal && git checkout -q main"
check_ok "feat/gone (published then deleted on origin)" \
    in_repo "$w" "git checkout -q -b feat/gone && git push -q -u origin feat/gone && git push -q origin --delete feat/gone && git fetch -q --prune origin && git checkout -q main"
check_ok "feat/stale (own commit, not merged)" \
    in_repo "$w" "git checkout -q -b feat/stale && git push -q -u origin feat/stale && git commit -q --allow-empty -m 'feat: unreleased work' && git checkout -q main"
check_ok "feat/noupstream (never published)" git -C "$w" checkout -q -b feat/noupstream
check_ok "back on main" git -C "$w" checkout -q main
check_ok "git-tidy --prune" in_repo "$w" "python3 '$GIT_TIDY' --prune"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/equal >/dev/null && no "feat/equal survived" || ok "feat/equal pruned (merged, equal to upstream)"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/gone >/dev/null && no "feat/gone survived" || ok "feat/gone pruned (merged, upstream gone)"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/stale >/dev/null && ok "feat/stale kept (not merged)" || no "feat/stale was deleted"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/noupstream >/dev/null && ok "feat/noupstream kept (no upstream)" || no "feat/noupstream was deleted"
git -C "$w" rev-parse --verify --quiet refs/heads/main >/dev/null && ok "main kept" || no "main was deleted"
check_ok "the current branch is never pruned" \
    in_repo "$w" "git checkout -q feat/stale && git push -q origin feat/stale && python3 '$GIT_TIDY' --prune"
git -C "$w" rev-parse --verify --quiet refs/heads/feat/stale >/dev/null && ok "checked-out branch survived --prune" || no "--prune deleted the checked-out branch"

# =========================================================================== #
p ""
p "================================================================"
p "cases: $cases   assertions passed: $pass   failed: $fail"
if [ "$fail" -eq 0 ]; then
    p "ALL TESTS PASSED"
    exit 0
fi
p "FAILURES: $fail"
exit 1
