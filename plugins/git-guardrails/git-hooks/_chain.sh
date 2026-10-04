#!/bin/sh
# git-guardrails: shared chain helper.
#
# Called by the chain shims in this directory:
#     exec "$(dirname "$0")/_chain.sh" <hook-name> "$@"
#
# Runs the repository's own hook at $(git rev-parse --git-common-dir)/hooks/<name>
# when it exists and is executable, with arguments and stdin passed straight
# through (exec keeps stdin and the exit status). Exits 0 when there is no such
# hook, so installing git-guardrails never disables a repo that has no hooks -
# and never disables the hooks it finds.
#
# core.hooksPath makes git ignore .git/hooks entirely, which is exactly why this
# indirection exists: without it, installing the plugin would silently orphan
# every pre-commit / commit-msg / pre-push hook a repo (or a tool like husky,
# lefthook or pre-commit) had already installed there.

name=$1
shift || true

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 0

common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -z "$common" ]; then
    common=$(git rev-parse --git-common-dir 2>/dev/null)
    case "$common" in
        /*) ;;
        ?*) common=$(CDPATH= cd -- "$common" 2>/dev/null && pwd) ;;
    esac
fi
if [ -z "$common" ]; then
    # Not a git repo (or git unusable): nothing to chain to.
    exit 0
fi

# If this very directory *is* $(git-common-dir)/hooks, chaining would exec the
# shim again and recurse - bail out instead.
common_hooks=$(CDPATH= cd -- "$common/hooks" 2>/dev/null && pwd)
if [ -n "$common_hooks" ] && [ "$common_hooks" = "$dir" ]; then
    exit 0
fi

target="$common/hooks/$name"
if [ -f "$target" ] && [ -x "$target" ]; then
    exec "$target" "$@"
fi
exit 0
