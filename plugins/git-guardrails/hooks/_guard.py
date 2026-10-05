#!/usr/bin/env python3
"""Shared plumbing for the git-guardrails Claude Code hooks.

Two hooks use this module:

  hooks/guard-bash.py     PreToolUse on Bash - refuses commands that would switch
                          the git guardrails off or work around them.
  hooks/check-unpushed.py Stop - blocks once when the current branch has commits
                          that origin does not have.

The rules themselves live in git-hooks/guardrails.py and run inside git. These two
are the Claude Code side: they stop an agent from disabling or forgetting those
rules. Nothing here ever changes a repository - it only reads.

Isolation: every git call goes through run_git(), which never inherits a caller's
GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_QUARANTINE_PATH, and never reads a
caller's repo-independent config. Hooks never write to git config, never fetch,
never push.

Contract notes (see plugins/orchestrator-mode/hooks/enforce-orchestrator.py for the
same shape):
  * PreToolUse prints a "deny" decision or NOTHING. Printing "allow" would suppress
    the user's normal permission prompts, so silence means "not my business".
  * Stop prints {"decision":"block","reason":...} or NOTHING.
  * Stdin is JSON on stdin, cwd arrives as the "cwd" key.
"""
import json
import os
import subprocess
import sys

PLUGIN = "git-guardrails"
ISSUES_URL = "https://github.com/Maheidem/maheidem-plugins/issues"
GIT_TIMEOUT = 8
ORIGIN = "origin"
DEFAULT_FALLBACKS = ("main", "master")
# Never handed to git: a caller's stale or crafted plumbing environment.
STRIP = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_QUARANTINE_PATH",
         "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
         "GIT_CONFIG_COUNT", "GIT_PUSH_OPTION_COUNT")


def log_debug(msg):
    if os.environ.get("GUARDRAILS_DEBUG") == "1":
        sys.stderr.write("%s: %s\n" % (PLUGIN, msg))


def _text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    return ""


def read_payload():
    """Parse the hook's stdin JSON, or {} when there is nothing parseable."""
    try:
        raw = sys.stdin.read()
    except Exception:  # noqa: BLE001
        return {}
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def cwd_of(data):
    """Working directory of the tool call: payload cwd, else this process's cwd."""
    cwd = data.get("cwd")
    text = _text(cwd)
    if not text:
        text = os.getcwd()
    return text


def deny(reason):
    """Refuse the Bash command. Reason must be one line naming the rule."""
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": " ".join(str(reason).split()),
    }}) + "\n")
    sys.stdout.flush()
    log_debug("DENY: %s" % reason)
    sys.exit(0)


def block(reason):
    """Stop the turn once, with the reason shown to the model and the user."""
    sys.stdout.write(json.dumps({"decision": "block",
                                 "reason": " ".join(str(reason).split())}) + "\n")
    sys.stdout.flush()
    log_debug("BLOCK: %s" % reason)
    sys.exit(0)


def silent():
    sys.exit(0)


def run_git(args, cwd=None, timeout=None):
    """(rc, stdout) for a git plumbing call. Never raises."""
    env = dict(os.environ)
    for key in STRIP:
        env.pop(key, None)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_PAGER"] = "cat"
    env["GIT_ADVICE"] = "0"
    env["LC_ALL"] = "C"
    try:
        proc = subprocess.run(["git"] + list(args), cwd=cwd or None, env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              timeout=timeout or GIT_TIMEOUT)
    except Exception as exc:  # noqa: BLE001
        log_debug("git %s could not run: %s" % (" ".join(args), exc))
        return 1, ""
    return proc.returncode, _text(proc.stdout)


def git_out(*args, **kwargs):
    rc, out = run_git(list(args), cwd=kwargs.get("cwd"), timeout=kwargs.get("timeout"))
    return out.strip() if rc == 0 else ""


# --- repository facts ------------------------------------------------------- #

def in_repository(cwd):
    rc, _ = run_git(["rev-parse", "--git-dir"], cwd=cwd)
    return rc == 0


def toplevel(cwd):
    return git_out("rev-parse", "--show-toplevel", cwd=cwd)


def has_remote(cwd, remote=ORIGIN):
    """The remote's URL, or "" when there is no such remote."""
    return git_out("remote", "get-url", remote, cwd=cwd)


def default_branch(cwd, remote=ORIGIN):
    """D - the default branch, by local lookup only. Never `git ls-remote`.

    Order: refs/remotes/<remote>/HEAD as a symref -> refs/remotes/<remote>/main ->
    refs/remotes/<remote>/master -> refs/heads/main -> refs/heads/master -> "master".
    Cloning an empty remote creates no refs/remotes/<remote>/HEAD, and
    `git symbolic-ref --quiet` fails when it is dangling or not a symref, so the
    remote-tracking fallbacks are what keep the default branch looking like the
    default branch in a fresh clone.

    The symref is read as a full ref and the `refs/remotes/<remote>/` prefix is
    stripped: `git symbolic-ref --short` answers "origin/main", which is not a
    branch name (that mistake makes the default branch look like a ref called
    origin/main and silently switches R4 off).
    """
    ns = "refs/remotes/%s/" % remote
    rc, out = run_git(["symbolic-ref", "--quiet", ns + "HEAD"], cwd=cwd)
    target = _text(out).strip()
    if rc == 0 and target:
        name = target
        if name.startswith(ns):
            name = name[len(ns):]
        elif name.startswith("%s/" % remote):
            name = name[len(remote) + 1:]
        if name and name != "HEAD":
            return name
    for name in DEFAULT_FALLBACKS:
        for ref in (ns + name, "refs/heads/%s" % name):
            if run_git(["show-ref", "--verify", "--quiet", ref], cwd=cwd)[0] == 0:
                return name
    return "master"


def current_branch(cwd):
    """Short branch name of HEAD, or "" when HEAD is detached."""
    return git_out("symbolic-ref", "--quiet", "--short", "HEAD", cwd=cwd)


def ahead_count(cwd, upstream):
    """How many commits HEAD has that <upstream> does not (0 if unmeasurable)."""
    rc, out = run_git(["rev-list", "--count", "%s..HEAD" % upstream], cwd=cwd)
    if rc != 0:
        return 0
    text = out.strip()
    try:
        return int(text)
    except ValueError:
        return 0


def upstream_of(cwd, branch):
    """Full ref of <branch>'s upstream, or ""."""
    return git_out("rev-parse", "--abbrev-ref", "--symbolic-full-name",
                   "%s@{upstream}" % branch, cwd=cwd)


def unpushed(cwd):
    """Unpushed-commit facts for the current branch.

    Returns None when there is nothing to nag about (not a repo, no origin, no
    commits at all, detached HEAD, or nothing ahead), else a dict:
      branch, upstream ("origin/feat/x" or None), ahead (int, >= 1),
      why  - "ahead of <upstream>" or "no upstream".
    """
    if not in_repository(cwd):
        return None
    if not has_remote(cwd):
        return None
    branch = current_branch(cwd)
    if not branch:
        return None  # detached HEAD: no branch to nag about
    if run_git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd=cwd)[0] != 0:
        return None  # unborn branch: there are no commits anywhere yet
    up = upstream_of(cwd, branch)
    if up:
        ahead = ahead_count(cwd, up)
        if ahead <= 0:
            return None
        return {"branch": branch, "upstream": up, "ahead": ahead,
                "why": "ahead of %s" % up}
    target = "refs/remotes/%s/%s" % (ORIGIN, default_branch(cwd))
    if run_git(["show-ref", "--verify", "--quiet", target], cwd=cwd)[0] != 0:
        return None  # nothing published yet; guardrails already cover the first push
    ahead = ahead_count(cwd, target)
    if ahead <= 0:
        return None
    return {"branch": branch, "upstream": None, "ahead": ahead,
            "why": "no upstream, and %s is %d commit(s) away" % (target, ahead)}
