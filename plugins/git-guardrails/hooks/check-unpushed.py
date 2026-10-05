#!/usr/bin/env python3
"""git-guardrails Stop hook: do not end a turn with work that is only local.

R3 makes every branch you create get published before its first commit, and R4 keeps
the default branch a clean fast-forward of origin. Both are pointless if a turn ends
with commits sitting on this machine. So at the end of a turn, if the working
directory is inside a git repository with an `origin` remote and the current branch has
commits its upstream does not have - or has no upstream at all while
`origin/<default>` exists and does not contain them - this blocks once, with:

    unpushed commits on <branch>: push or tell the user why not

Once, on purpose. `stop_hook_active` is true when Claude Code is already continuing
because a Stop hook blocked, so returning block again would loop forever: in that case
this hook allows, unconditionally. The nag fires at most once per stop.

Anything that is not nag-worthy is silent: not a repository, no origin remote, an
unborn repository with no commits, a detached HEAD (no branch to push), a branch that
is even with its upstream, or a brand-new branch in a repo where nothing has ever
been fetched (git-guardrails blocks that first commit anyway, so there is nothing to
report).

Read-only: `git rev-parse`, `show-ref`, `rev-list`, `symbolic-ref`. Never fetches,
never pushes, never writes config. Fails open - an unfinished check allows, because
blocking every turn because of a bug would be worse than one missed reminder.
Debug: GUARDRAILS_DEBUG=1.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _guard import (ISSUES_URL, block, cwd_of, log_debug,  # noqa: E402
                   read_payload, silent, unpushed)

MAX_AHEAD_SHOWN = 5


def main():
    data = read_payload()
    if not data:
        log_debug("no payload")
        silent()
    if data.get("stop_hook_active") is True:
        log_debug("already continuing after a Stop block - allowing")
        silent()
    cwd = cwd_of(data)
    try:
        found = unpushed(cwd)
    except Exception as exc:  # noqa: BLE001 - a reminder must never wedge a session
        log_debug("unfinished check, allowing: %s" % exc)
        silent()
    if not found:
        silent()
    branch = found["branch"]
    ahead = found["ahead"]
    if ahead >= MAX_AHEAD_SHOWN:
        count = "%d+ commits" % MAX_AHEAD_SHOWN
    elif ahead == 1:
        count = "1 commit"
    else:
        count = "%d commits" % ahead
    if found["upstream"]:
        detail = "%s is %s ahead of %s" % (branch, count, found["upstream"])
        fix = "`git push`"
    else:
        detail = "%s has %s and no upstream branch" % (branch, count)
        fix = "`git push -u origin %s`" % branch
    block_reason = ("unpushed commits on %s: push or tell the user why not - %s. "
                    "Push with %s; do not force-push, and if the branch has been "
                    "rewritten tell the user instead (report a git-guardrails problem "
                    "at %s). This reminder fires once per stop; continuing now will "
                    "not repeat it." % (branch, detail, fix, ISSUES_URL))
    block(block_reason)


if __name__ == "__main__":
    main()
