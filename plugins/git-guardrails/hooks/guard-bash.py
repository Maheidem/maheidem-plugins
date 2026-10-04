#!/usr/bin/env python3
"""git-guardrails PreToolUse gate for Bash: no switching the guardrails off.

The rules themselves (R1 naming, R2 branch budget, R3 publish-before-commit, R4 no
direct commits to the default branch) live in git-hooks/guardrails.py and are
enforced by git. This gate protects the enforcement and the work it protects: it
refuses Bash commands that would disable the hooks, dodge them, or delete unmerged
work.

Rules (the reason always starts with the rule name):

  guardrails-config  writing core.hooksPath or guardrails.* - `git config
                     core.hooksPath ...`, `git -c core.hooksPath=... git commit ...`,
                     `git config guardrails.maxBranches 5`, `git config --global
                     --unset core.hooksPath`, and writing/copying/moving a
                     git-guardrails config file. Reading is fine: `git config --get
                     guardrails.maxBranches`, `cat guardrails.config`.
  quarantine         any assignment to GIT_QUARANTINE_PATH (export, NAME=... prefix,
                     env/declare/typeset). It is git's receive-side plumbing; setting
                     it yourself does not bypass anything, it makes git refuse your own
                     ref updates.
  no-verify          --no-verify or --no-gpg-sign on any git subcommand: the
                     guardrails live in the hooks, so this is precisely the bypass.
  force-push         `git push` with --force, --force-with-lease, or any short bundle
                     containing f (`git push -f`, `git push -uf origin main`).
  force-delete       `git branch -D`, `git branch --delete --force`,
                     `git worktree remove --force`.
  worktree-outside   `git worktree add <path>` with <path> not inside
                     <repo>/.worktrees/ - worktrees go in the excluded corner of the
                     repo so they stay findable, never scattered beside it.

Allowed and untouched: `git push -u origin feat/x` (R3's fix), `git pull --ff-only`
(R4's fix), `git branch -d`, `git worktree add <repo>/.worktrees/x -b feat/y`,
`git config --get ...`, every non-git command.

How it reads the command: split on `;`, `&&`, `||`, `|` and newlines, so anything
hiding at the end of a chain is still checked; each piece is tokenised with shlex
(quoting respected), and `sudo`/`env`/`command`/`time` wrappers and leading
NAME=value assignments are looked through. `eval "<git ...>"` is unpacked and checked
as if it were typed. If shlex cannot tokenise a piece (unmatched quote, brace), the
piece falls back to a whitespace split, which sees more and so can only deny more.

Fails closed: an internal error while judging a command denies, with the report URL.
An empty payload, a non-Bash tool, or a command with nothing in it is silent. It
never prints "allow" - that would suppress the user's normal permission prompts.
Debug: GUARDRAILS_DEBUG=1.
"""
import os
import re
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _guard import (ISSUES_URL, cwd_of, deny, log_debug,  # noqa: E402
                    read_payload, silent, toplevel)

COMMAND_TOOLS = ("Bash", "mcp__local__bash", "mcp__local__shell")
WORKTREE_DIRNAME = ".worktrees"

SEGMENT_RE = re.compile(r"\|\||&&|[;\n|]")
# Text-level: forms the token walk cannot see (quoted keys, $(...) substitution).
ASSIGN_PROTECTED_RE = re.compile(r"(?:core\.hooksPath|guardrails\.[A-Za-z])\s*=")
QUARANTINE_RE = re.compile(r"\bGIT_QUARANTINE_PATH\s*=")
NO_VERIFY_RE = re.compile(r"--no-verify\b|--no-gpg-sign\b")
PROTECTED_PATH_RE = re.compile(r"guardrails\.config\b|git-guardrails/[^\s]*\.conf\b")

PROTECTED_KEY_RE = re.compile(r"^(?:core\.hooksPath|guardrails\.[\w.-]+)$")
READ_ACTIONS = frozenset(("--get", "--get-all", "--get-regexp", "--get-color",
                          "--get-colorbool", "--list", "-l"))
WRAPPERS = frozenset(("sudo", "env", "command", "time", "nice", "nohup", "exec"))
READ_HEADS = frozenset(("cat", "head", "tail", "less", "more", "grep", "rg", "egrep",
                        "fgrep", "stat", "ls", "ll", "wc", "diff", "shasum", "md5sum"))


def chunks(command):
    return [piece.strip() for piece in SEGMENT_RE.split(command) if piece.strip()]


def tokenize(piece):
    """Words of one command; a plain whitespace split when shlex chokes."""
    try:
        return shlex.split(piece, posix=True)
    except ValueError:
        return piece.split()


def protect(tag, why):
    return "%s: %s" % (tag, why)


def reason_config():
    return protect("guardrails-config",
                   "writing core.hooksPath or guardrails.* is refused. core.hooksPath "
                   "is where the guardrails live and guardrails.maxBranches is the "
                   "human's decision in ~/.gitconfig, so neither a repo nor an agent "
                   "can relax them - reading is fine (`git config --get "
                   "guardrails.maxBranches`). Ask the user if a value really must "
                   "change")


def reason_quarantine():
    return protect("quarantine",
                   "GIT_QUARANTINE_PATH is git's receive-side plumbing: exporting it "
                   "bypasses nothing, it only makes git refuse your own ref updates. "
                   "Tell the user what you were trying to accomplish instead")


def reason_no_verify():
    return protect("no-verify",
                   "--no-verify/--no-gpg-sign skips the git hooks that enforce the "
                   "guardrails (R1 naming, R2 branch budget, R3 publish, R4 default "
                   "branch). Run it without the flag; if a hook is wrong, report it "
                   "at %s" % ISSUES_URL)


def reason_force_push():
    return protect("force-push",
                   "a forced push (--force / -f / --force-with-lease) rewrites history "
                   "that origin already has. Rebase first (`git pull --rebase`) and "
                   "push normally; if it still refuses, stop and tell the user - "
                   "someone else's commits are at stake")


def reason_force_delete():
    return protect("force-delete",
                   "force-deleting throws away commits that are not merged anywhere. "
                   "Use `git branch -d` (git refuses it until the work is merged) or "
                   "`bin/git-tidy` to see what is safe, and tell the user what you "
                   "wanted removed")


def reason_worktree(root, path):
    return protect("worktree-outside",
                   "new worktrees go inside the repository at %s/<name>, not at %s - "
                   ".worktrees/ is git-excluded, keeps the parent directory clean and "
                   "makes stray worktrees findable: `git worktree add %s/<name> "
                   "-b <branch>`" % (os.path.join(root, WORKTREE_DIRNAME), path,
                                     os.path.join(root, WORKTREE_DIRNAME)))


def looks_like_write_of_protected(piece):
    """core.hooksPath=... / guardrails.X=... even inside quotes or $(...)."""
    return bool(ASSIGN_PROTECTED_RE.search(piece))


def assigns_quarantine(piece):
    return bool(QUARANTINE_RE.search(piece))


def touches_protected_file(piece):
    """Writing, copying or printing the whole of a git-guardrails config file.

    Reading it is fine - an agent has to be able to find out whether its repo is
    guarded. `echo ... >> guardrails.config`, `cp guardrails.config /tmp`, `sed -i`,
    `rm` are not: that file records which repositories are protected and by what.
    """
    if not PROTECTED_PATH_RE.search(piece):
        return False
    words = piece.split()
    head = os.path.basename(words[0]) if words else ""
    if head in READ_HEADS and ">" not in piece and "tee" not in words:
        return False
    return True


def check_git_words(words, cwd):
    """Walk `git` + its arguments; return a reason string or None."""
    index = 1
    sub = None
    args = []
    while index < len(words):
        word = words[index]
        index += 1
        if sub is None:
            if word == "-c" or word.startswith("-c="):
                pair = word[3:] if word.startswith("-c=") else None
                if pair is None:
                    pair = words[index] if index < len(words) else ""
                    index += 1
                if PROTECTED_KEY_RE.match(pair.split("=", 1)[0]):
                    return reason_config()
                continue
            if word in ("-C", "--git-dir", "--work-tree", "--namespace",
                        "--exec-path", "--super-prefix") and index < len(words):
                index += 1
                continue
            if word.startswith("-"):
                continue
            sub = word
            args = words[index:]
            break
    if sub is None:
        return None
    if NO_VERIFY_RE.search(" ".join(args)):
        return reason_no_verify()
    if sub == "config":
        return check_config(args)
    if sub == "push":
        return check_push(args)
    if sub == "branch":
        return check_branch_delete(args)
    if sub == "worktree":
        return check_worktree(args, cwd)
    return None


def check_config(args):
    """Deny writes to protected keys; allow reads (--get/--list/...)."""
    action = "set"
    key = None
    index = 0
    while index < len(args):
        arg = args[index]
        index += 1
        if arg.startswith("-"):
            if arg in READ_ACTIONS:
                action = "read"
            elif arg in ("--unset", "--unset-all"):
                action = "unset"
            elif arg in ("-f", "--file", "--blob"):
                index += 1
            elif arg in ("--add", "--replace-all"):
                action = "write"
            continue
        if key is None:
            key = arg
    if key is None or action == "read":
        return None
    if PROTECTED_KEY_RE.match(key):
        return reason_config()
    return None


def check_push(args):
    for arg in args:
        if arg == "--":
            break
        if arg.startswith("--force"):
            # --force, --force-with-lease, --force-if-includes
            return reason_force_push()
        if arg == "--mirror":
            # --mirror rewrites every ref on the remote, force included
            return reason_force_push()
        if arg.startswith("+") and len(arg) > 1:
            # `git push origin +main` - the leading + in a refspec is a force push
            return reason_force_push()
        if arg in ("-d", "--delete") or (re.match(r"^-[A-Za-z]+$", arg)
                                           and "d" in arg[1:]):
            # Deleting a published branch deletes history other people may have
            # built on. That is the user's call, not the agent's.
            return reason_force_delete()
        if re.match(r"^-[A-Za-z]+$", arg) and "f" in arg[1:]:
            # -f is --force, -if/-fi is --force-with-lease inside a bundle. The
            # flags R3 actually wants you to use (-u/--set-upstream) have no f.
            return reason_force_push()
    return None


def check_branch_delete(args):
    for arg in args:
        if arg == "-D" or arg == "--force":
            return reason_force_delete()
    return None


def same_or_inside(path, prefix):
    """Is path the prefix, or under it? Resolved and case-folded.

    macOS hands out /var/folders/... but git answers /private/var/folders/..., and
    APFS is case-insensitive, so a naive string compare rejects worktrees that are
    perfectly inside .worktrees/. Comparing resolved paths fixes both.
    """
    forms = ((os.path.realpath(path), os.path.realpath(prefix)),
             (os.path.normpath(path), os.path.normpath(prefix)))
    for got, want in forms:
        got, want = got.rstrip("/"), want.rstrip("/")
        if got.lower() == want.lower():
            return True
        if got.lower().startswith(want.lower() + os.sep):
            return True
    return False


def check_worktree(args, cwd):
    if not args:
        return None
    verb = args[0]
    rest = args[1:]
    if verb == "remove":
        for arg in rest:
            if arg in ("--force", "-f"):
                return reason_force_delete()
        return None
    if verb != "add":
        return None
    root = toplevel(cwd)
    if not root:
        return None  # not inside a repo: nothing to anchor <repo>/.worktrees to
    allowed = os.path.join(os.path.normpath(root), WORKTREE_DIRNAME)
    path = None
    index = 0
    while index < len(rest):
        arg = rest[index]
        index += 1
        if arg.startswith("-"):
            if arg in ("-b", "-B", "-c", "--config", "--lock-reason", "--reference",
                       "--reference-if-able"):
                index += 1
            continue
        path = arg
        break
    if not path:
        return None
    full = path if os.path.isabs(path) else os.path.join(os.path.normpath(cwd), path)
    full = os.path.normpath(full)
    if same_or_inside(full, allowed):
        return None
    return reason_worktree(root, full)


def check_piece(piece, cwd):
    """One command of the chain."""
    if looks_like_write_of_protected(piece):
        return reason_config()
    if assigns_quarantine(piece):
        return reason_quarantine()
    if touches_protected_file(piece):
        return protect("guardrails-config",
                       "this writes, moves or prints a git-guardrails config file. "
                       "It records which repositories are guarded - read it "
                       "(`cat guardrails.config`), do not change it or copy it "
                       "anywhere. If the user asked for a change, ask them to make "
                       "it themselves")
    words = tokenize(piece)
    if not words:
        return None
    if NO_VERIFY_RE.search(piece):
        return reason_no_verify()
    position = 0
    while position < len(words):
        word = words[position]
        if "=" in word and not word.startswith("-") and position == 0:
            # leading NAME=value prefix: `GIT_QUARANTINE_PATH=... git commit ...`
            name = word.split("=", 1)[0]
            if name == "GIT_QUARANTINE_PATH":
                return reason_quarantine()
            if PROTECTED_KEY_RE.match(name):
                return reason_config()
            position += 1
            continue
        if word in ("export", "local", "declare", "typeset", "set") and position == 0:
            joined = " ".join(words[position:])
            if QUARANTINE_RE.search(joined):
                return reason_quarantine()
            if looks_like_write_of_protected(joined):
                return reason_config()
            return None
        if word in WRAPPERS:
            position += 1
            continue
        if word == "eval":
            for arg in words[position + 1:]:
                found = check_text(arg, cwd)
                if found:
                    return found
            return None
        if word == "git" or word.endswith("/git"):
            found = check_git_words(words[position:], cwd)
            if found:
                return found
            return None
        return None
    return None


def check_text(text, cwd):
    """Re-check the contents of a quoted argument (eval, sh -c, $(...))."""
    for piece in chunks(text):
        found = check_piece(piece, cwd)
        if found:
            return found
    return None


def check(command, cwd):
    for piece in chunks(command):
        found = check_piece(piece, cwd)
        if found:
            return found
        # $(...) / `...` inside an allowed-looking command
        for inner in re.findall(r"\$\(([^)]*)\)", piece):
            found = check_text(inner, cwd)
            if found:
                return found
        for inner in re.findall(r"`([^`]*)`", piece):
            found = check_text(inner, cwd)
            if found:
                return found
    return None


def main():
    data = read_payload()
    if not data:
        silent()
    tool = data.get("tool_name")
    if not isinstance(tool, str) or tool not in COMMAND_TOOLS:
        silent()
    payload = data.get("tool_input")
    command = payload.get("command") if isinstance(payload, dict) else None
    if not isinstance(command, str) or not command.strip():
        silent()
    cwd = cwd_of(data)
    log_debug("checking: %s" % command)
    try:
        reason = check(command, cwd)
    except Exception as exc:  # noqa: BLE001 - a command we cannot judge is refused
        deny("git-guardrails: INTERNAL ERROR while checking this command, failing "
             "closed - it did not run. Reason: %s. Report it at %s; the guardrails "
             "stay on." % (exc, ISSUES_URL))
    if reason:
        deny(reason)
    silent()


if __name__ == "__main__":
    main()
