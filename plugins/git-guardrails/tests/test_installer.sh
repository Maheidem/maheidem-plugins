#!/usr/bin/env bash
# git-guardrails installer tests.
#   bash plugins/git-guardrails/tests/test_installer.sh
#
# HOME is a mktemp directory for the whole run, GIT_CONFIG_GLOBAL points inside it and
# GIT_CONFIG_SYSTEM is /dev/null, so ~/.gitconfig and /etc/gitconfig are never read or
# written: the only config this suite touches - and the only place the installer may
# write - is $FAKE_HOME/.gitconfig. The real home, the real global gitconfig and every
# real repository on this machine are untouched; the installer is never run against the
# real home.
#
# Covers: dry run writes nothing, --apply copies every hook and sets
# core.hooksPath globally, enforcement then works END-TO-END from the installed path
# (not from the plugin tree), re-applying is idempotent, a foreign global hooksPath is
# refused without --force and replaced with it, --uninstall unsets only when the path
# is ours, the scan lists repos that would shadow the global path (repo-local
# core.hooksPath, or their own .git/hooks/reference-transaction) and stays quiet about
# clean repos, and the scan never writes to a scanned repo.

set -u

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$PLUGIN/bin/install-git-guardrails"
SRC_HOOKS="$PLUGIN/git-hooks"
ROOT="$(mktemp -d)"
export ROOT

cleanup() {
    chmod -R u+rwX "$ROOT" 2>/dev/null
    rm -rf "$ROOT"
}
trap cleanup EXIT

# --- a whole fake home ----------------------------------------------------- #
FAKE_HOME="$ROOT/home"
mkdir -p "$FAKE_HOME"
export HOME="$FAKE_HOME"
export XDG_CONFIG_HOME="$FAKE_HOME/.config"
export GIT_CONFIG_GLOBAL="$FAKE_HOME/.gitconfig"
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_TERMINAL_PROMPT=0
export GIT_PAGER=cat
export GIT_ADVICE=0
export LC_ALL=C
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_QUARANTINE_PATH GUARDRAILS_HOME 2>/dev/null || true
printf '[user]\n\tname = installer test\n\temail = installer@example.com\n[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n' > "$GIT_CONFIG_GLOBAL"

DEST="$XDG_CONFIG_HOME/git-guardrails/hooks"

pass=0
fail=0
cases=0

p()  { printf '%s\n' "$*"; }
ok() { pass=$((pass + 1)); printf '  PASS: %s\n' "$*"; }
no() { fail=$((fail + 1)); printf '  FAIL: %s\n' "$*"; }
case_begin() { cases=$((cases + 1)); p ""; p "--- $*"; }

# run <args...> - the installer, in the fake home. Sets $? and $out.
run() {
    out=$("$INSTALLER" "$@" 2>&1)
    rc=$?
}
has() { printf '%s\n' "$out" | grep -qF -- "$1"; }

# hooks_path - the global core.hooksPath as git reads it ("" when unset)
hooks_path() { git config --global --get core.hooksPath 2>/dev/null || true; }

# e2e_repo <name> - bare remote + clone, main published.
e2e_repo() {
    local d="$ROOT/$1"
    rm -rf "$d" >/dev/null 2>&1
    mkdir -p "$d" || return 1
    git init --bare -q "$d/remote.git" >/dev/null 2>&1 || return 1
    git clone -q "$d/remote.git" "$d/work" >/dev/null 2>&1 || return 1
    git -C "$d/work" commit -q --allow-empty -m "chore: bootstrap" >/dev/null 2>&1 || return 1
    git -C "$d/work" push -q origin main >/dev/null 2>&1 || return 1
    printf '%s' "$d/work"
}

p "git-guardrails: installer"
printf '  fake HOME: %s\n  real HOME would be: %s (never used)\n  dest: %s\n' \
    "$FAKE_HOME" "$(python3 -c 'import os;print(os.path.expanduser("~"))' \
        | sed "s|$FAKE_HOME|<fake>|")" "$DEST"

# =========================================================================== #
case_begin "the installer exists and explains itself"
# =========================================================================== #
[ -f "$INSTALLER" ] && ok "bin/install-git-guardrails exists" || no "missing"
[ -x "$INSTALLER" ] && ok "it is executable" || no "not executable"
python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$INSTALLER" \
    && ok "it parses as python3" || no "syntax error"
run --help
[ "$rc" -eq 0 ] && has "--apply" && has "--uninstall" && has "Dry run" \
    && ok "--help lists --apply / --uninstall and the dry-run default" \
    || no "--help: rc=$rc out=$out"
run --bogus-flag
[ "$rc" -ne 0 ] && ok "an unknown flag is refused (rc=$rc)" || no "unknown flag accepted"

# =========================================================================== #
case_begin "dry run: a report, and nothing else"
# =========================================================================== #
# three scanned repos: clean, one that shadows the global path, one with its own hook
mkdir -p "$ROOT/scan/clean" "$ROOT/scan/shadow" "$ROOT/scan/localrtx"
git init -q "$ROOT/scan/clean/work" >/dev/null 2>&1
git -C "$ROOT/scan/clean/work" commit -q --allow-empty -m "chore: clean" >/dev/null 2>&1

git init -q "$ROOT/scan/shadow/work" >/dev/null 2>&1
mkdir -p "$ROOT/scan/shadow/work/.githooks"
git -C "$ROOT/scan/shadow/work" config --local core.hooksPath .githooks
printf '#!/bin/sh\nexit 0\n' > "$ROOT/scan/shadow/work/.githooks/pre-commit"
chmod +x "$ROOT/scan/shadow/work/.githooks/pre-commit"
git -C "$ROOT/scan/shadow/work" commit -q --allow-empty -m "chore: shadow" >/dev/null 2>&1
SHADOW_CFG_BEFORE=$(cat "$ROOT/scan/shadow/work/.git/config")

git init -q "$ROOT/scan/localrtx/work" >/dev/null 2>&1
printf '#!/bin/sh\necho repo hook\n' > "$ROOT/scan/localrtx/work/.git/hooks/reference-transaction"
chmod +x "$ROOT/scan/localrtx/work/.git/hooks/reference-transaction"
git -C "$ROOT/scan/localrtx/work" commit -q --allow-empty -m "chore: local hook" >/dev/null 2>&1
LOCALRTX_CFG_BEFORE=$(cat "$ROOT/scan/localrtx/work/.git/config")

run --roots "$ROOT/scan"
printf '%s\n' "$out" | sed 's/^/  | /'
[ "$rc" -eq 0 ] && ok "dry run exits 0" || no "dry run rc=$rc"
has "DRY RUN" && ok "it says it is a dry run" || no "no dry-run banner"
has "Re-run with --apply" && ok "it tells you how to actually install" || no "no --apply hint"
[ ! -e "$DEST" ] && ok "target dir was NOT created" || no "dry run created $DEST"
[ -z "$(hooks_path)" ] && ok "global core.hooksPath still unset" || no "dry run set core.hooksPath"
has "reference-transaction" && has "guardrails.py" && has "_chain.sh" \
    && ok "it lists the hooks it would copy" || no "the file list is incomplete"
printf '%s' "$out" | grep -qF -- "$ROOT/scan/shadow/work" \
    && ok "lists the repo that shadows the global path" || no "missed the shadowing repo"
printf '%s' "$out" | grep -qF -- "SHADOWS" && ok "labels it SHADOWS" || no "no SHADOWS label"
printf '%s' "$out" | grep -qF -- "repo-local core.hooksPath = .githooks" \
    && ok "quotes the repo-local value" || no "does not quote the value"
printf '%s' "$out" | grep -qF -- "$ROOT/scan/localrtx/work" \
    && ok "lists the repo with its own reference-transaction" || no "missed the local-hook repo"
printf '%s' "$out" | grep -qF -- "LOCAL" && ok "labels it LOCAL" || no "no LOCAL label"
printf '%s' "$out" | grep -qF -- "$ROOT/scan/clean/work" \
    && no "listed a clean repo as a problem" || ok "clean repo is not flagged"
printf '%s' "$out" | grep -qF -- "repos found: 3" \
    && ok "counts the repos it found" || no "no repo count"
[ "$SHADOW_CFG_BEFORE" = "$(cat "$ROOT/scan/shadow/work/.git/config")" ] \
    && ok "the scanned repos' own config is untouched" || no "a scanned repo's config changed"
[ "$LOCALRTX_CFG_BEFORE" = "$(cat "$ROOT/scan/localrtx/work/.git/config")" ] \
    && ok "nor the one with the local hook" || no "that repo's config changed"

run --roots "$ROOT/no-such-dir-here"
printf '%s\n' "$out" | grep -qF -- "does not exist" \
    && ok "a missing root is reported, not silently skipped" || no "missing root not reported"
[ "$rc" -eq 0 ] && ok "and it is not an error (rc=0)" || no "missing root rc=$rc"

# =========================================================================== #
case_begin "--apply: copies to a stable path and sets the global hooks path"
# =========================================================================== #
run --apply --roots "$ROOT/scan"
printf '%s\n' "$out" | sed 's/^/  | /' | tail -12
[ "$rc" -eq 0 ] && ok "--apply exits 0" || no "--apply rc=$rc"
[ -d "$DEST" ] && ok "target dir created at \$XDG_CONFIG_HOME/git-guardrails/hooks" || no "$DEST missing"
missing=""
for name in reference-transaction pre-commit prepare-commit-msg commit-msg pre-push \
            post-checkout post-merge pre-rebase post-rewrite guardrails.py _chain.sh; do
    [ -f "$DEST/$name" ] || missing="$missing $name"
done
[ -z "$missing" ] && ok "every hook landed (11 files)" || no "missing after apply:$missing"
[ -x "$DEST/reference-transaction" ] && ok "reference-transaction is executable" || no "not executable"
grep -qF -- "guardrails.py" "$DEST/reference-transaction" \
    && ok "the installed shim still calls guardrails.py" || no "the installed shim does not"
cmp -s "$SRC_HOOKS/guardrails.py" "$DEST/guardrails.py" \
    && ok "guardrails.py copied byte-for-byte, path-independent" || no "guardrails.py differs from the plugin source"
cmp -s "$SRC_HOOKS/_chain.sh" "$DEST/_chain.sh" \
    && ok "_chain.sh copied byte-for-byte" || no "_chain.sh differs"
back=$(hooks_path)
[ -n "$back" ] && ok "global core.hooksPath is set: $back" || no "core.hooksPath not set"
[ "$(cd "$ROOT" && python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$back")" = \
    "$(cd "$ROOT" && python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$DEST")" ] \
    && ok "it points at the installed dir" || no "core.hooksPath=$back, expected $DEST"
[ -f "$FAKE_HOME/.gitconfig" ] && grep -qF -- "hooksPath" "$FAKE_HOME/.gitconfig" \
    && ok "the write went to \$HOME/.gitconfig and nowhere else" || no "config not in the fake home"
run --apply --roots "$ROOT/scan"
[ "$rc" -eq 0 ] && ok "applying twice succeeds" || no "second apply rc=$rc"
[ "$(hooks_path)" = "$back" ] && ok "and leaves core.hooksPath identical" || no "second apply changed core.hooksPath"

# =========================================================================== #
case_begin "installed enforcement works end-to-end (proven from \$HOME, not the plugin)"
# =========================================================================== #
W=$(e2e_repo e2e) || { p "FATAL: fixture failed"; exit 1; }
printf '  sandbox: %s\n' "$W"
out=$(git -C "$W" checkout -q -b bad_name 2>&1); rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "R1" \
    && ok "installed hooks refuse a bad branch name (R1)" || no "R1 did not fire: rc=$rc $out"
git -C "$W" checkout -q -b feat/installed >/dev/null 2>&1
out=$(git -C "$W" commit --allow-empty -m "feat: unpublished" 2>&1); rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "R3" \
    && ok "installed hooks refuse an unpublished commit (R3)" || no "R3 did not fire: rc=$rc $out"
git -C "$W" push -q -u origin feat/installed >/dev/null 2>&1
git -C "$W" commit -q --allow-empty -m "feat: published branch" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "allowed after git push -u (the fix the rule prints)" || no "legit commit blocked rc=$rc"
git -C "$W" checkout -q main >/dev/null 2>&1
out=$(git -C "$W" commit --allow-empty -m "chore: on main" 2>&1); rc=$?
[ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "R4" \
    && ok "installed hooks refuse a direct commit on main (R4)" || no "R4 did not fire: rc=$rc $out"
[ -x "$DEST/reference-transaction" ] || no "installed shim lost its +x"

# =========================================================================== #
case_begin "it will not take over someone else's hooks"
# =========================================================================== #
mkdir -p "$ROOT/other-hooks"
printf '#!/bin/sh\nexit 0\n' > "$ROOT/other-hooks/pre-commit"
chmod +x "$ROOT/other-hooks/pre-commit"
git config --global core.hooksPath "$ROOT/other-hooks"
run --apply --roots "$ROOT/scan"
printf '%s\n' "$out" | grep -qF -- "REFUSING" && ok "--apply refuses a foreign global hooksPath" || no "it did not refuse"
[ "$(hooks_path)" = "$ROOT/other-hooks" ] && ok "and left it exactly as it was" || no "it clobbered the foreign path"
run --uninstall
[ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qF -- "REFUSING" \
    && ok "--uninstall refuses a path that is not ours (rc=$rc)" || no "--uninstall touched a foreign path: rc=$rc $out"
[ "$(hooks_path)" = "$ROOT/other-hooks" ] && ok "foreign path still intact" || no "foreign path changed"
run --apply --force --roots "$ROOT/scan"
[ "$rc" -eq 0 ] && ok "--apply --force succeeds when told to" || no "--force rc=$rc"
[ "$(cd "$ROOT" && python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$(hooks_path)")" = \
    "$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$DEST")" ] \
    && ok "and core.hooksPath now points at the installed dir" || no "--force did not set it: $(hooks_path)"

# =========================================================================== #
case_begin "--uninstall: ours only, and it leaves the files"
# =========================================================================== #
run --uninstall
printf '%s\n' "$out" | sed 's/^/  | /'
[ "$rc" -eq 0 ] && ok "--uninstall exits 0 when the path is ours" || no "rc=$rc"
[ -z "$(hooks_path)" ] && ok "global core.hooksPath is unset again" || no "still set: $(hooks_path)"
[ -d "$DEST" ] && ok "the copied hooks stay (nothing is deleted)" || no "it deleted the hooks dir"
printf '%s\n' "$out" | grep -qF -- "$DEST" && ok "it prints where the leftovers are" || no "no leftover path printed"
run --uninstall
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qiF -- "nothing to do" \
    && ok "uninstalling twice is harmless" || no "second uninstall rc=$rc $out"

# enforcement really is gone
out=$(git -C "$W" checkout -q -b another_bad_name 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "after uninstall git no longer polices names" || no "still enforcing after uninstall: rc=$rc $out"
git -C "$W" checkout -q main >/dev/null 2>&1
git -C "$W" branch -q -D another_bad_name >/dev/null 2>&1
git -C "$W" branch -q -D feat/installed >/dev/null 2>&1

# =========================================================================== #
case_begin "the real home was never in play"
# =========================================================================== #
[ "$HOME" = "$FAKE_HOME" ] && ok "HOME was the fake home for the whole suite" || no "HOME leaked: $HOME"
[ "${GIT_CONFIG_GLOBAL:-}" = "$FAKE_HOME/.gitconfig" ] \
    && ok "GIT_CONFIG_GLOBAL was the fake .gitconfig" || no "GIT_CONFIG_GLOBAL=${GIT_CONFIG_GLOBAL:-unset}"
[ ! -e "$ROOT/home/.config/git-guardrails/hooks/guardrails.py.orig" ] \
    && ok "no stray backups written" || no "stray backup file"
grep -c "hooksPath" "$FAKE_HOME/.gitconfig" | grep -qx 0 \
    && ok "fake .gitconfig has no hooksPath left after uninstall" \
    || no "leftover hooksPath in the fake .gitconfig: $(cat "$FAKE_HOME/.gitconfig")"

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
