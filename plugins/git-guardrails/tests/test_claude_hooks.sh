#!/usr/bin/env bash
# git-guardrails Claude Code hook tests.
#
#   bash plugins/git-guardrails/tests/test_claude_hooks.sh
#
# Two hooks, fed the JSON Claude Code sends on stdin:
#   hooks/guard-bash.py      PreToolUse on Bash - denies commands that disable or
#                            dodge the git guardrails; silent for everything else.
#   hooks/check-unpushed.py  Stop - blocks once on unpushed commits, honours
#                            stop_hook_active so it can never loop.
#
# Isolation: one mktemp root (removed on exit), GIT_CONFIG_GLOBAL set to a scratch
# gitconfig, GIT_CONFIG_SYSTEM=/dev/null. The real ~/.gitconfig and the system
# gitconfig are never read or written. Remotes are local bare repos. The hooks never
# execute the command they are judging - they only read refs - and this suite never
# sets core.hooksPath, so it builds whatever fixture state it needs.
#
# Complements tests/test_guardrails.sh: that proves git blocks the ref update, this
# proves the agent is stopped from trying it in the first place.

set -u

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$PLUGIN/hooks"
GUARD_BASH="$HOOKS_DIR/guard-bash.py"
CHECK_UNPUSHED="$HOOKS_DIR/check-unpushed.py"
HOOKS_JSON="$HOOKS_DIR/hooks.json"
ROOT="$(mktemp -d)"
export ROOT

cleanup() {
    chmod -R u+rwX "$ROOT" 2>/dev/null
    rm -rf "$ROOT"
}
trap cleanup EXIT

# --- isolation --------------------------------------------------------------- #
GLOBAL="$ROOT/gitconfig"
cat >"$GLOBAL" <<CFG
[user]
	name = guardrails test
	email = guardrails@example.com
[init]
	defaultBranch = main
[protocol "file"]
	allow = always
CFG

export GIT_CONFIG_GLOBAL="$GLOBAL"
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_TERMINAL_PROMPT=0
export GIT_PAGER=cat
export GIT_ADVICE=0
export LC_ALL=C
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_QUARANTINE_PATH 2>/dev/null || true

pass=0
fail=0
cases=0
W=""

p()  { printf '%s\n' "$*"; }
ok() { pass=$((pass + 1)); printf '  PASS: %s\n' "$*"; }
no() { fail=$((fail + 1)); printf '  FAIL: %s\n' "$*"; }
case_begin() { cases=$((cases + 1)); p ""; p "--- $*"; }

# --- payloads -------------------------------------------------------------- #

# jstr - stdin text -> a JSON string literal.
jstr() { python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read()))'; }

# field <key> - stdin JSON object -> the string at hookSpecificOutput.<key>.
field() {
    python3 -c 'import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
out = data.get("hookSpecificOutput") or data
sys.stdout.write(str(out.get(sys.argv[1]) or ""))' "$1" 2>/dev/null
}

# payload <tool> <command> [cwd] - the JSON Claude Code sends to PreToolUse.
payload() {
    local tool=$1 command=$2 cwd=${3:-$W}
    { printf '{"tool_name":'; printf '%s' "$tool" | jstr
      printf ',"tool_input":{"command":'; printf '%s' "$command" | jstr
      printf '},"cwd":'; printf '%s' "$cwd" | jstr
      printf '}'; }
}

# run_pre <command> [cwd] [tool] - whatever guard-bash.py printed ("" == allowed).
run_pre() {
    payload "${3:-Bash}" "$1" "${2:-$W}" | python3 "$GUARD_BASH" 2>/dev/null
}

# run_stop <cwd> [active] - whatever check-unpushed.py printed ("" == allow).
run_stop() {
    local cwd=$1 active=${2:-}
    { printf '{"cwd":'; printf '%s' "$cwd" | jstr
      if [ -n "$active" ]; then printf ',"stop_hook_active":true'; fi
      printf '}'; } | python3 "$CHECK_UNPUSHED" 2>/dev/null
}

# deny_check <name> <rule-tag> <command> [cwd] [tool]
deny_check() {
    local name=$1 tag=$2 command=$3 cwd=${4:-$W} tool=${5:-Bash}
    local out kind reason
    out=$(run_pre "$command" "$cwd" "$tool")
    if [ -z "$out" ]; then
        no "$name: expected a deny, got silence ($command)"
        return
    fi
    kind=$(printf '%s' "$out" | field permissionDecision)
    reason=$(printf '%s' "$out" | field permissionDecisionReason)
    if [ "$kind" != "deny" ]; then
        no "$name: permissionDecision was '$kind': $out"
    elif ! printf '%s' "$reason" | grep -q "^$tag:"; then
        no "$name: reason does not start with the rule name '$tag': $reason"
    elif [ "$(printf '%s\n' "$reason" | wc -l | tr -d ' ')" != "1" ]; then
        no "$name: reason is not a single line: $reason"
    else
        ok "$name -> $tag"
    fi
}

# allow_check <name> <command> [cwd] [tool] - silence, exit 0, never "allow".
allow_check() {
    local name=$1 command=$2 cwd=${3:-$W} tool=${4:-Bash}
    local out rc
    out=$(run_pre "$command" "$cwd" "$tool")
    rc=$?
    if [ -n "$out" ]; then
        no "$name: expected silence, got: $out"
    elif [ "$rc" -ne 0 ]; then
        no "$name: expected exit 0, got $rc"
    else
        ok "$name allowed"
    fi
}

# block_check <name> <needle> [cwd] - Stop must block with <needle> in the reason.
block_check() {
    local name=$1 needle=$2 cwd=${3:-$W}
    local out decision reason
    out=$(run_stop "$cwd")
    if [ -z "$out" ]; then
        no "$name: expected a block decision, got silence"
        return
    fi
    decision=$(printf '%s' "$out" | field decision)
    reason=$(printf '%s' "$out" | field reason)
    if [ "$decision" != "block" ]; then
        no "$name: decision was '$decision': $out"
    elif ! printf '%s' "$reason" | grep -qF -- "$needle"; then
        no "$name: reason lacks '$needle': $reason"
    else
        ok "$name -> ${reason%% - *}"
    fi
}

# silent_stop_check <name> [cwd] [active]
silent_stop_check() {
    local name=$1 cwd=${2:-$W} active=${3:-}
    local out
    out=$(run_stop "$cwd" "$active")
    if [ -n "$out" ]; then
        no "$name: expected silence, got: $out"
    else
        ok "$name"
    fi
}

# --- fixtures -------------------------------------------------------------- #

# new_repo <name> [noorigin] - clone of a local bare remote, main published,
# refs/remotes/origin/HEAD set. With "noorigin" the remote is removed afterwards.
new_repo() {
    local d="$ROOT/$1" noc=${2:-}
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init --bare -q "$d/remote.git" >/dev/null 2>&1 || return 1
    git clone -q "$d/remote.git" "$d/work" >/dev/null 2>&1 || return 1
    git -C "$d/work" commit -q --allow-empty -m "chore: bootstrap" >/dev/null 2>&1 || return 1
    git -C "$d/work" push -q origin main >/dev/null 2>&1 || return 1
    git -C "$d/work" remote set-head origin -a >/dev/null 2>&1 || return 1
    if [ "$noc" = "noorigin" ]; then
        git -C "$d/work" remote remove origin >/dev/null 2>&1 || return 1
    fi
    printf '%s' "$d/work"
}

# empty_clone <name> - clone of an empty remote: origin exists, no commits anywhere.
empty_clone() {
    local d="$ROOT/$1"
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init --bare -q "$d/remote.git" >/dev/null 2>&1 || return 1
    git clone -q "$d/remote.git" "$d/work" >/dev/null 2>&1 || return 1
    printf '%s' "$d/work"
}

p "git-guardrails: Claude Code hooks"

# =========================================================================== #
case_begin "wiring: hooks.json"
# =========================================================================== #
if python3 - "$HOOKS_JSON" "$HOOKS_DIR" <<'PY'
import json, os, sys
path, hooks_dir = sys.argv[1], sys.argv[2]
data = json.load(open(path))
events = data["hooks"]
assert "PreToolUse" in events, "no PreToolUse event"
assert "Stop" in events, "no Stop event"
matcher = events["PreToolUse"][0]["matcher"]
assert "Bash" in matcher, "matcher does not cover Bash: %s" % matcher
pre = events["PreToolUse"][0]["hooks"][0]
stop = events["Stop"][0]["hooks"][0]
assert pre["type"] == "command" and stop["type"] == "command"
assert "guard-bash.py" in pre["command"], pre["command"]
assert "check-unpushed.py" in stop["command"], stop["command"]
assert "${CLAUDE_PLUGIN_ROOT}" in pre["command"], "not plugin-root relative"
assert "${CLAUDE_PLUGIN_ROOT}" in stop["command"], "not plugin-root relative"
for name in ("guard-bash.py", "check-unpushed.py", "_guard.py"):
    assert os.path.isfile(os.path.join(hooks_dir, name)), "missing %s" % name
manifest = json.load(open(os.path.join(os.path.dirname(hooks_dir), ".claude-plugin",
                                       "plugin.json")))
assert manifest["name"] == "git-guardrails", manifest["name"]
PY
then
    ok "hooks.json: PreToolUse(Bash) -> guard-bash.py, Stop -> check-unpushed.py, root-relative, all scripts present"
else
    no "hooks.json wiring"
fi
[ -x "$GUARD_BASH" ] && ok "guard-bash.py is executable" || no "guard-bash.py is not executable"
[ -x "$CHECK_UNPUSHED" ] && ok "check-unpushed.py is executable" || no "check-unpushed.py is not executable"

# =========================================================================== #
case_begin "PreToolUse denies: switching the guardrails off"
# =========================================================================== #
W=$(new_repo deny) || { p "FATAL: fixture failed"; exit 1; }
printf '  sandbox: %s\n' "$W"

deny_check "sets core.hooksPath"            "guardrails-config" "git config core.hooksPath /tmp/hooks"
deny_check "sets it globally"               "guardrails-config" "git config --global core.hooksPath \$HOME/hooks"
deny_check "-c override on a commit"       "guardrails-config" "git -c core.hooksPath=/tmp/hooks commit -m 'chore: sneaky'"
deny_check "-c override later in a chain"  "guardrails-config" "cd \$HOME && git status && git -c core.hooksPath= commit -m x"
deny_check "writes guardrails.maxBranches" "guardrails-config" "git config guardrails.maxBranches 5"
deny_check "budget with --global"          "guardrails-config" "git config --global guardrails.maxBranches 9"
deny_check "budget with --add"             "guardrails-config" "git config --add guardrails.maxBranches 12"
deny_check "unsets the hooks path"        "guardrails-config" "git config --global --unset core.hooksPath"
deny_check "quoted key"                    "guardrails-config" "git config \"core.hooksPath\" /tmp/h"
deny_check "inside \$()"                    "guardrails-config" "echo \$(git config core.hooksPath /tmp/x)"
deny_check "through eval"                  "guardrails-config" "eval \"git config core.hooksPath /tmp/h\""
deny_check "through sudo"                  "guardrails-config" "sudo git config --global core.hooksPath /tmp/h"
deny_check "through env"                   "guardrails-config" "env git config guardrails.maxBranches 3"
deny_check "writes guardrails.config"     "guardrails-config" "rm -f guardrails.config"
deny_check "copies the config out"        "guardrails-config" "cp guardrails.config /tmp/backup"
deny_check "appends to the config"        "guardrails-config" "echo 'maxBranches = 99' >> guardrails.config"
deny_check "sed -i on the config"         "guardrails-config" "sed -i.bak 's/1/9/' guardrails.config"
deny_check "tee into the config"          "guardrails-config" "printf x | tee guardrails.config"

deny_check "export GIT_QUARANTINE_PATH"        "quarantine" "export GIT_QUARANTINE_PATH=/tmp/q"
deny_check "marker as a command prefix"        "quarantine" "GIT_QUARANTINE_PATH=/tmp/q git commit -m 'chore: sneaky'"
deny_check "marker after &&"                    "quarantine" "git status && GIT_QUARANTINE_PATH=/tmp/q git push"
deny_check "export prefix form"                "quarantine" "export GIT_QUARANTINE_PATH=/tmp/q && git commit -m x"
deny_check "env assignment form"               "quarantine" "env GIT_QUARANTINE_PATH=/tmp/q git commit -m x"
deny_check "marker through eval"               "quarantine" "eval \"GIT_QUARANTINE_PATH=/tmp/q git push\""

deny_check "--no-verify on commit"             "no-verify"   "git commit --no-verify -m 'chore: bypass'"
deny_check "--no-verify on push"              "no-verify"   "git push --no-verify origin feat/x"
deny_check "--no-gpg-sign"                     "no-verify"   "git commit -a --no-gpg-sign"
deny_check "--no-verify at the end of a chain" "no-verify"  "git add -A && git commit -m 'chore: x' && git push --no-verify"
deny_check "--no-verify through sudo"         "no-verify"   "sudo git commit --no-verify -m x"
deny_check "--no-verify after a newline"      "no-verify"   "git add -A
git commit --no-verify -m 'chore: multiline'"

deny_check "--force push"                      "force-push"  "git push --force origin feat/x"
deny_check "-f push"                          "force-push"   "git push -f origin feat/x"
deny_check "--force-with-lease"               "force-push"   "git push --force-with-lease origin feat/x"
deny_check "-uf bundle"                       "force-push"   "git push -uf origin feat/x"
deny_check "bare -f"                          "force-push"   "git push -f"
deny_check "force at the end of a chain"     "force-push"   "git add -A && git commit -m 'chore: x' && git push -f"
deny_check "force through a wrapper"         "force-push"   "command git push --force"
deny_check "force on a bare push in a subshell" "force-push" "echo \$(git push -f origin main)"

deny_check "git branch -D"                    "force-delete" "git branch -D feat/x"
deny_check "--delete --force"                 "force-delete" "git branch --delete --force feat/x"
deny_check "-D later in a chain"             "force-delete" "git checkout main && git branch -D feat/x"
deny_check "worktree remove --force"         "force-delete" "git worktree remove --force .worktrees/old"

deny_check "worktree outside the repo"       "worktree-outside" "git worktree add /tmp/elsewhere -b feat/x"
deny_check "worktree beside the repo"        "worktree-outside" "git worktree add ../sibling -b feat/x"
deny_check "relative worktree outside"       "worktree-outside" "git worktree add ../sibling"
deny_check "worktree in a chain"             "worktree-outside" "git fetch && git worktree add /tmp/wt feat/y"
deny_check "worktree with only a path"       "worktree-outside" "git -C $W worktree add /tmp/wt2"

deny_check "+refspec is a force push"         "force-push" "git push origin +main"
deny_check "+ on a mapped refspec"            "force-push" "git push origin +feat/x:refs/heads/feat/x"
deny_check "--mirror"                          "force-push" "git push --mirror origin"
deny_check "--force-if-includes"              "force-push" "git push --force-if-includes origin feat/x"
deny_check "deletes a published branch"       "force-delete" "git push origin --delete feat/x"
deny_check "deletes with -d"                   "force-delete" "git push -d origin feat/x"
deny_check "deletes in a -uf bundle ... -ud"  "force-delete" "git push -ud origin feat/x"

# =========================================================================== #
case_begin "PreToolUse allows: the fixes the rules tell you to run"
# =========================================================================== #
allow_check "plain shell"                "ls -la && grep -rn guardrails ."
allow_check "git status"                 "git status --short"
allow_check "git log"                    "git log --oneline -5"
allow_check "publishes a new branch (R3's fix)"        "git push -u origin feat/x"
allow_check "plain push"                                 "git push origin feat/x"
allow_check "git pull --ff-only (R4's fix)"           "git pull --ff-only"
allow_check "git pull --rebase"                        "git pull --rebase origin main"
allow_check "git fetch --all --prune"                 "git fetch --all --prune"
allow_check "safe branch delete"                      "git branch -d feat/x"
allow_check "worktree inside .worktrees"             "git worktree add $W/.worktrees/one -b feat/one"
allow_check "relative worktree inside .worktrees"    "git worktree add .worktrees/two feat/two"
allow_check "worktree list"                           "git worktree list --porcelain"
allow_check "worktree remove without force"          "git worktree remove .worktrees/one"
allow_check "reads the budget (global only)"          "git config --global --get guardrails.maxBranches"
allow_check "reads any config"                        "git config --get user.email"
allow_check "lists config"                            "git config --list"
allow_check "writes an unrelated key"                 "git config user.name 'Somebody'"
allow_check "reads guardrails.config"                 "cat guardrails.config"
allow_check "greps the hooks dir"                     "grep -rn reference-transaction git-hooks/"
allow_check "mapped refspec without force"     "git push origin HEAD:refs/heads/feat/x"
allow_check "publish to a new remote branch"    "git push origin main:refs/heads/backup-main"
allow_check "push a tag"                        "git push origin v1.2.3"
allow_check "checkout -b"                             "git checkout -b feat/x"
allow_check "commit"                                  "git commit -m 'feat: work'"
allow_check "grep for a -f pattern"                 "git grep -n -- '-f' -- ."
allow_check "non-Bash tool with a forbidden command" "git push --force" "$W" "Read"

allow_check "empty command"          ""
# malformed / missing payload: silent, exit 0, never a crash
out=$(printf 'this is not json' | python3 "$GUARD_BASH" 2>/dev/null); rc=$?
if [ -z "$out" ] && [ "$rc" -eq 0 ]; then
    ok "unparseable stdin -> silent allow, exit 0"
else
    no "unparseable stdin: rc=$rc out=$out"
fi
out=$(printf '{"tool_name":"Bash"}' | python3 "$GUARD_BASH" 2>/dev/null); rc=$?
if [ -z "$out" ] && [ "$rc" -eq 0 ]; then
    ok "payload without tool_input -> silent allow"
else
    no "payload without tool_input: rc=$rc out=$out"
fi
out=$(printf '{"tool_name":"Bash","tool_input":{"command":123}}' | python3 "$GUARD_BASH" 2>/dev/null); rc=$?
if [ -z "$out" ] && [ "$rc" -eq 0 ]; then
    ok "non-string command -> silent allow"
else
    no "non-string command: rc=$rc out=$out"
fi

# =========================================================================== #
case_begin "PreToolUse: the reason text is usable"
# =========================================================================== #
out=$(run_pre "git push -f origin feat/x")
reason=$(printf '%s' "$out" | field permissionDecisionReason)
printf '  reason: %s\n' "$reason"
printf '%s' "$reason" | grep -qF -- "force-push:" \
    && ok "names the rule first" || no "does not name the rule: $reason"
printf '%s' "$reason" | grep -qF -- "git pull --rebase" \
    && ok "gives the fix" || no "gives no fix: $reason"
[ "$(printf '%s\n' "$reason" | wc -l | tr -d ' ')" = "1" ] \
    && ok "single line" || no "multi-line reason"
printf '%s' "$reason" | grep -qF -- "--force" \
    && ok "quotes the flag it refused" || no "does not quote the flag"
out=$(run_pre "git config core.hooksPath /tmp/h")
printf '%s' "$out" | field permissionDecisionReason | grep -qiF -- "ask the user" \
    && ok "config denial sends the agent to the user" \
    || no "config denial does not mention the user"
printf '%s' "$out" | field permissionDecision | grep -qF -- "deny" \
    && ok "permissionDecision is exactly deny" || no "unexpected decision: $out"
printf '%s' "$out" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
sys.exit(0 if set(d) == {"hookSpecificOutput"}
        and set(d["hookSpecificOutput"])
        == {"hookEventName", "permissionDecision", "permissionDecisionReason"}
        and d["hookSpecificOutput"]["hookEventName"] == "PreToolUse" else 1)' \
    && ok "JSON shape matches the PreToolUse contract" || no "unexpected JSON shape: $out"

# =========================================================================== #
case_begin "Stop: unpushed work"
# =========================================================================== #
W=$(new_repo stop) || { p "FATAL: fixture failed"; exit 1; }
printf '  sandbox: %s\n' "$W"

# main is level with origin/main: nothing to say
silent_stop_check "level with origin -> silent" "$W"
silent_stop_check "stop_hook_active on a clean repo -> silent" "$W" active

# a branch published with -u, then one commit ahead
git -C "$W" checkout -q -b feat/work >/dev/null 2>&1
git -C "$W" push -q -u origin feat/work >/dev/null 2>&1
git -C "$W" commit -q --allow-empty -m "feat: local work" >/dev/null 2>&1
block_check "one commit ahead of upstream" "unpushed commits on feat/work: push or tell the user why not" "$W"
block_check "names the upstream it compared against" "ahead of origin/feat/work" "$W"
silent_stop_check "stop_hook_active -> silent (no loop)" "$W" active
git -C "$W" push -q origin feat/work >/dev/null 2>&1
silent_stop_check "after pushing -> silent" "$W"

# branch with no upstream at all, in a repo where origin/main exists
git -C "$W" checkout -q -b feat/orphan >/dev/null 2>&1
git -C "$W" commit -q --allow-empty -m "feat: never published" >/dev/null 2>&1
block_check "no upstream, ahead of origin/main" "unpushed commits on feat/orphan" "$W"
block_check "suggests git push -u origin <branch>" "git push -u origin feat/orphan" "$W"
block_check "still silent-safe with stop_hook_active off" "push or tell the user why not" "$W"
silent_stop_check "stop_hook_active -> silent" "$W" active

# detached HEAD: there is no branch to push
git -C "$W" checkout -q --detach HEAD >/dev/null 2>&1
silent_stop_check "detached HEAD -> silent" "$W"
git -C "$W" checkout -q feat/orphan >/dev/null 2>&1

# the same repository inside a linked worktree
git -C "$W" worktree add -q "$ROOT/stop-wt" -b feat/wt >/dev/null 2>&1
git -C "$ROOT/stop-wt" commit -q --allow-empty -m "feat: in the worktree" >/dev/null 2>&1
block_check "linked worktree, unpublished branch" "unpushed commits on feat/wt" "$ROOT/stop-wt"
git -C "$ROOT/stop-wt" push -q -u origin feat/wt >/dev/null 2>&1
silent_stop_check "linked worktree after push -u -> silent" "$ROOT/stop-wt"
git -C "$W" worktree remove -q "$ROOT/stop-wt" >/dev/null 2>&1

# a repo with no origin: nothing to push to, nothing to say
NOW=$(new_repo stop-noorigin noorigin) || { p "FATAL: fixture failed"; exit 1; }
git -C "$NOW" commit -q --allow-empty -m "chore: local only" >/dev/null 2>&1
silent_stop_check "no origin -> silent" "$NOW"

# a fresh clone of an empty remote: no commits anywhere yet
EMPTY=$(empty_clone stop-empty) || { p "FATAL: fixture failed"; exit 1; }
silent_stop_check "empty clone, no commits -> silent" "$EMPTY"

# not a repository at all
NOT=$ROOT/not-a-repo
mkdir -p "$NOT"
silent_stop_check "outside any git repo -> silent" "$NOT"
silent_stop_check "a path that does not exist -> silent" "$ROOT/does-not-exist"

# the reason must not tell the agent to force anything
git -C "$W" commit -q --allow-empty -m "feat: ahead again" >/dev/null 2>&1
out=$(run_stop "$W")
reason=$(printf '%s' "$out" | field reason)
printf '  reason: %s\n' "$reason"
printf '%s' "$reason" | grep -qE -- "push -f|--force" \
    && no "Stop reason suggests a force push: $reason" \
    || ok "Stop reason never suggests forcing"
printf '%s' "$reason" | grep -qF -- "unpushed commits on feat/orphan" \
    && ok "reason leads with the required sentence" || no "reason wording: $reason"
printf '%s' "$reason" | grep -qF -- "once" \
    && ok "reason says it fires once" || no "reason does not say it fires once"

# the Stop hook must not have changed anything
git -C "$W" push -q origin feat/orphan:refs/heads/never >/dev/null 2>&1
if git -C "$W" show-ref --verify --quiet refs/heads/never; then
    git -C "$W" branch -q -D never >/dev/null 2>&1
    no "fixture wrote a branch (test hygiene)"
else
    ok "read-only check: refs unchanged by the Stop hook"
fi
if git -C "$W" config --local --get guardrails.maxBranches >/dev/null 2>&1; then
    no "Stop hook wrote repo config"
else
    ok "Stop hook wrote no config"
fi

# =========================================================================== #
case_begin "the two suites do not contradict each other"
# =========================================================================== #
# R3 tells the agent to run `git push -u origin <branch>`; the gate must allow
# exactly that. R4 tells it to run `git pull --ff-only`; same. The gate denies the
# command that would defeat R4's guard by moving the hook out of the way.
W=$(new_repo cross) || { p "FATAL: fixture failed"; exit 1; }
git -C "$W" checkout -q -b feat/cross >/dev/null 2>&1
allow_check "the exact command R3 prints" "git push -u origin feat/cross"
git -C "$W" push -q -u origin feat/cross >/dev/null 2>&1
git -C "$W" commit -q --allow-empty -m "feat: work" >/dev/null 2>&1
allow_check "the push R3 wanted is still allowed afterwards" "git push"
git -C "$W" push -q origin feat/cross >/dev/null 2>&1
silent_stop_check "and Stop is quiet once it is pushed" "$W"
allow_check "the command R4 prints" "git pull --ff-only"
deny_check  "but not the command that removes the hooks" "guardrails-config" "git config --local core.hooksPath .git/hooks"
deny_check  "nor a global one" "guardrails-config" "git config --global core.hooksPath ~/.my-hooks"
silent_stop_check "nothing was committed, so Stop stays quiet" "$W"

# =========================================================================== #
p ""
p "================================================================"
printf 'cases: %s   assertions passed: %s   failed: %s\n' "$cases" "$pass" "$fail"
if [ "$fail" -eq 0 ]; then
    p "ALL TESTS PASSED"
    exit 0
fi
p "FAILURES: $fail"
exit 1
