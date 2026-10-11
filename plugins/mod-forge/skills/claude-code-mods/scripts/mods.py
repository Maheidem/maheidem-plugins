#!/usr/bin/env python3 -I
"""mods.py: the one entry point of the mod-forge driver.

Run it as: python3 -I mods.py [-C <workbench>] <subcommand> [options]

This file holds the shared core (config, workbench discovery, runner, RUN.md,
tmux session rules, auto-discovery) and the subcommands doctor, clean, evidence,
note, kit-sync, done and lint-skill. The other subcommands live in group modules
(mods_setup, mods_check, mods_design, mods_live). This file imports a group
module only when its subcommand runs.

Every subcommand ends with two lines: '<cmd>: PASS|FAIL <summary>' and 'next: <command>'.
With --json the two lines go to stderr, so stdout holds only the JSON document.
Exit codes: 0 pass, 1 a step failed, 2 usage or config error.

A group module imports names from this file ('from mods import Fail, Done, ...').
A group module defines one function per subcommand: cmd_<name>(ctx, args), with '-'
in the name written as '_' (cmd_upgrade_check). It returns Done or raises Fail.
"""
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the skill folder (python3 -I ignores PYTHONDONTWRITEBYTECODE)

import argparse
import contextlib
import datetime
import filecmp
import glob
import hashlib
import importlib
import json
import os
import platform
import re
import shlex
import shutil
import signal
import subprocess
import threading
import time
import traceback
from typing import NamedTuple

SC = os.path.dirname(os.path.realpath(__file__))  # the scripts folder
S = os.path.dirname(SC)                           # the skill root
if SC not in sys.path:
    sys.path.insert(0, SC)
if __name__ == '__main__':
    # A group module does 'from mods import ...'. This line makes it get THIS module, not a second copy.
    sys.modules.setdefault('mods', sys.modules['__main__'])

# ---------------------------------------------------------------- constants

UPGRADE_NAMES = ["export type PaneOpenArgs = ", "bodyRows: number", "'ui.focus': UiFocusInput", "export type UiFocusInput = ",
                 "export type CommandPresentation = ", "isPlaced", "timeoutMs", "export const atom"]
KNOWN_VERSIONS = ("2.1.295", "2.1.296")
KINDS = ("pane-list", "pane-simple", "band", "status-toast", "guard", "command", "mixed")
NO_PANE = ('guard', 'command', 'status-toast')  # these kinds draw no pane: mockups skips them, the gate reads live
ALL_KINDS = KINDS + ("audit",)
MOD_NAME = re.compile(r'^[a-z][a-z0-9-]*$')
CLAUDE_DIFF = os.path.join('plugins', 'marketplaces', 'claude-code-plugins', 'mods', 'diff', 'hooks', 'register.ts')
MARKETPLACE_LINE = 'claude plugin marketplace add anthropics/claude-code'

# subcommand -> group module. A subcommand that is not here runs in this file.
GROUP_OF = {
    'new': 'mods_setup', 'upgrade-check': 'mods_setup', 'build': 'mods_setup',
    'check': 'mods_check', 'score': 'mods_check', 'pick': 'mods_check', 'approve': 'mods_check', 'domain': 'mods_domain',
    'mockups': 'mods_design', 'journey': 'mods_design', 'audit-existing': 'mods_design',
    'crawl': 'mods_live', 'storyboard': 'mods_live', 'live': 'mods_live', 'selfcheck': 'mods_live',
}
NEEDS_WB = {'domain', 'check', 'mockups', 'score', 'pick', 'journey', 'crawl', 'storyboard', 'approve', 'live', 'build',
            'note', 'clean', 'evidence', 'done', 'kit-sync'}
OPTIONAL_WB = {'upgrade-check'}
NO_RECORD = {'evidence'}  # evidence reads RUN.md. It never writes a section.

_BRIEF_DOCTOR = False  # main() sets it for 'doctor --brief': that call always exits 0 (a skill preamble must not fail)
_WB = None  # the workbench folder of this run (refuse_busy uses it in its next: line)

# ---------------------------------------------------------------- contract types


class Fail(Exception):
    """A step failed. rc 1 = the step failed. rc 2 = usage or config error."""

    def __init__(self, summary, next='none', rc=1, facts=None):
        if isinstance(next, int):  # Fail('text', 2) is read as rc 2
            next, rc = 'none', next
        super().__init__(summary)
        self.summary, self.next, self.rc, self.facts = summary, next, rc, facts or {}


class Done(NamedTuple):
    ok: bool
    summary: str
    next: str = 'none'
    facts: dict = None


class Step(NamedTuple):
    argv: list
    rc: int
    out: str
    seconds: float
    log: str = None
    echoed: bool = True


class Ctx:
    def __init__(self, cmd, args=None, wb=None, cfg=None):
        self.cmd, self.args, self.wb = cmd, args, wb
        self.cfg = cfg if cfg is not None else {}
        self.steps = []
        self.log_path = None
        self.vers = {}
        self.record = True
        self.argv_text = ''


# ---------------------------------------------------------------- small helpers


def py(script):
    return [sys.executable, '-I', '-B', os.path.join(SC, script)]


def sh(script):
    return ['bash', os.path.join(SC, script)]


def last_lines(text, n):
    return '\n'.join(text.rstrip('\n').split('\n')[-n:])


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def now_stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def config_dir():
    return os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')


def one_line(text):
    return ' '.join(str(text).split())


def _out(argv, timeout=20):
    """Run a short command. Return (rc, text). rc is 127 when the tool is missing."""
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                           text=True, errors='replace', timeout=timeout)
        return p.returncode, p.stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, str(e)


# ---------------------------------------------------------------- runner


def run_step(ctx, argv, *, env=None, cwd=None, timeout=None, echo=True):
    """Run argv. Echo each line, copy it to the log, and keep it in a Step. Timeout gives rc 124."""
    full_env = None if env is None else {**os.environ, **env}
    log = None
    if ctx.log_path:
        os.makedirs(os.path.dirname(ctx.log_path), exist_ok=True)
        log = open(ctx.log_path, 'a', encoding='utf-8')
        log.write('$ ' + shlex.join(argv) + '\n')
    t0 = time.time()
    lines = []
    timed_out = []
    try:
        try:
            proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                    text=True, encoding='utf-8', errors='replace', bufsize=1,
                                    env=full_env, cwd=cwd, start_new_session=True)
        except OSError as e:
            lines = [f'cannot start {argv[0]}: {e}\n']
            rc = 127
            if echo:
                sys.stdout.write(lines[0])
            if log:
                log.write(lines[0])
        else:
            def kill():
                timed_out.append(True)
                with contextlib.suppress(OSError):
                    os.killpg(proc.pid, signal.SIGKILL)

            timer = threading.Timer(timeout, kill) if timeout else None
            if timer:
                timer.start()
            try:
                for line in proc.stdout:
                    if not line.endswith('\n'):
                        line += '\n'
                    lines.append(line)
                    if echo:
                        sys.stdout.write(line)
                        sys.stdout.flush()
                    if log:
                        log.write(line)
                proc.wait()
            except BaseException:
                with contextlib.suppress(OSError):
                    os.killpg(proc.pid, signal.SIGKILL)
                raise
            finally:
                if timer:
                    timer.cancel()
            rc = 124 if timed_out else proc.returncode
            if timed_out:
                note = f'timed out after {timeout} s\n'
                lines.append(note)
                if echo:
                    sys.stdout.write(note)
                if log:
                    log.write(note)
    finally:
        if log:
            log.close()
    step = Step(list(argv), rc, ''.join(lines), round(time.time() - t0, 1), ctx.log_path, echo)
    ctx.steps.append(step)
    return step


# ---------------------------------------------------------------- config


def _default_author():
    rc, text = _out(['git', 'config', 'user.name'], 5)
    return text.strip() if rc == 0 and text.strip() else os.environ.get('USER', 'me')


def _kind_variants(kind):
    try:
        with open(os.path.join(S, 'templates', 'mod.json.tpl'), encoding='utf-8') as fh:
            v = json.load(fh)['kinds'][kind]['variants']
        if isinstance(v, list) and all(isinstance(x, str) for x in v):
            return v
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return ['A', 'B', 'C', 'D']


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


TAGS = {  # tag -> (test, words for the error message)
    'str': (lambda v: isinstance(v, str), 'a string'),
    'str?': (lambda v: v is None or isinstance(v, str), 'a string or null'),
    'int': (_is_int, 'an integer'),
    'ints': (lambda v: isinstance(v, list) and all(_is_int(x) for x in v), 'a list of integers'),
    'strs': (lambda v: isinstance(v, list) and all(isinstance(x, str) for x in v), 'a list of strings'),
    'strs?': (lambda v: v is None or (isinstance(v, list) and all(isinstance(x, str) for x in v)), 'a list of strings or null'),
    'dict': (lambda v: isinstance(v, dict), 'an object'),
    'dict?': (lambda v: v is None or isinstance(v, dict), 'an object or null'),
}
# key -> (tag, default). A callable default gets the config. None in the table means 'no default, null'.
SCHEMA = {
    'template': ('str?', None), 'noun': ('str?', None), 'author': ('str', lambda c: _default_author()),
    'devMods': ('str?', None), 'sizes': ('ints', lambda c: [150, 100, 60]), 'rows': ('int', 45),
    'variants': ('strs', lambda c: _kind_variants(c['kind'])), 'picked': ('str?', None), 'pickedBy': ('str?', None),
    'approved': ('dict?', None), 'scenarios': ('strs', lambda c: []), 'ready': ('str', 'Scenario'),
    'pointer': ('dict', lambda c: {'D': '>'}), 'screens': ('strs?', None), 'crawlSessions': ('int', 6),
    'prefixes': ('dict', lambda c: {}), 'authoring': ('dict', lambda c: {}),
    'kit': ('dict', lambda c: {'version': None, 'hash': None}), 'fixtures': ('dict?', None),
    'workarounds': ('strs', lambda c: []), 'domain': ('dict?', None),
}


def load_cfg(path):
    """Read mod.json. Fill missing keys with their defaults. A wrong type is Fail rc 2."""
    try:
        with open(path, encoding='utf-8') as fh:
            cfg = json.load(fh)
    except (OSError, ValueError) as e:
        raise Fail(f'config: cannot read {path}: {e}', 'mods.py new <mod> --kind <kind> --scratch <dir> --trusted <dir>', 2)
    if not isinstance(cfg, dict):
        raise Fail(f'config: {path} must hold a JSON object', rc=2)
    for key, tag in (('mod', 'str'), ('kind', 'str')):
        if key not in cfg:
            raise Fail(f'config: {key} is missing', rc=2)
        if not TAGS[tag][0](cfg[key]):
            raise Fail(f'config: {key} must be {TAGS[tag][1]}', rc=2)
    if not MOD_NAME.match(cfg['mod']):
        raise Fail('config: mod must match ^[a-z][a-z0-9-]*$', rc=2)
    if cfg['kind'] not in ALL_KINDS:
        raise Fail(f'config: kind must be one of {", ".join(ALL_KINDS)}', rc=2)
    if 'trusted' not in cfg and cfg['kind'] != 'audit':
        raise Fail('config: trusted is missing', rc=2)
    if 'trusted' in cfg and not isinstance(cfg['trusted'], str):
        raise Fail('config: trusted must be a string', rc=2)
    for key, (tag, default) in SCHEMA.items():
        if key not in cfg:
            cfg[key] = default(cfg) if callable(default) else default
        if not TAGS[tag][0](cfg[key]):
            raise Fail(f'config: {key} must be {TAGS[tag][1]}', rc=2)
    mod = cfg['mod']
    for k, v in (('mockups', f'mx-{mod}-'), ('crawl', f'sb-{mod}-'), ('live', f'lv-{mod}-')):
        cfg['prefixes'].setdefault(k, v)
        if not isinstance(cfg['prefixes'][k], str):
            raise Fail(f'config: prefixes.{k} must be a string', rc=2)
    return cfg


def mod_json_path(ctx):
    return os.path.join(ctx.wb, 'mod.json')


def save_cfg(ctx):
    """Write mod.json through a temp file. Read it back. A difference is Fail rc 1."""
    path = mod_json_path(ctx)
    text = json.dumps(ctx.cfg, indent=2, ensure_ascii=False) + '\n'
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text)
    os.replace(tmp, path)
    with open(path, encoding='utf-8') as fh:
        back = json.load(fh)
    if back != json.loads(text):
        raise Fail(f'mod.json read-back differs from what was written ({path})')


def plugin(ctx):
    return f"{ctx.cfg['mod']}-proto"


def src_dir(ctx):
    return os.path.join(ctx.wb, 'src', plugin(ctx))


def run_dir(ctx):
    return os.path.join(ctx.wb, 'run', plugin(ctx))


# ---------------------------------------------------------------- workbench discovery

NEW_HINT = 'mods.py new <mod> --kind <kind> --scratch <dir> --trusted <dir>'


def find_workbench(opt):
    """Return the absolute path of mod.json. Raise Fail rc 2 when there is none, or more than one."""
    if opt:
        p = os.path.abspath(os.path.expanduser(opt))
        if os.path.isdir(p):
            p = os.path.join(p, 'mod.json')
        if os.path.basename(p) == 'mod.json' and os.path.isfile(p):
            return p
        raise Fail(f'workbench not found: {opt} (give a folder that holds mod.json, or a mod.json file)', NEW_HINT, 2)
    cwd = os.getcwd()
    if os.path.isfile(os.path.join(cwd, 'mod.json')):
        return os.path.join(cwd, 'mod.json')
    found = sorted(set(glob.glob(os.path.join(cwd, '*', 'mod.json')) + glob.glob(os.path.join(cwd, '.mods', '*', 'mod.json'))))
    if len(found) == 1:
        return found[0]
    if found:
        raise Fail('more than one workbench here; pick one with -C: ' + ', '.join(os.path.dirname(f) for f in found),
                   'mods.py -C <workbench> <subcommand>', 2)
    raise Fail(f'no workbench found in {cwd} (no mod.json, */mod.json or .mods/*/mod.json)', NEW_HINT, 2)


# ---------------------------------------------------------------- safe delete


def _inside(path, root):
    return path.startswith(root + os.sep)


def safe_rm(ctx, rel):
    """Delete wb/<rel>. Refuse anything that is not strictly inside the workbench. Return True when it removed something."""
    wb = os.path.realpath(ctx.wb)
    full = os.path.join(ctx.wb, rel)
    parent = os.path.realpath(os.path.dirname(full))
    lexical = os.path.join(parent, os.path.basename(full))
    base = rel.rstrip('/')
    if not _inside(lexical, wb):
        raise Fail(f'refused to delete {base}: it resolves outside the workbench')
    if os.path.islink(full):
        if os.path.isdir(full):  # a link to a folder
            if not _inside(os.path.realpath(full), wb):
                raise Fail(f'refused to delete {base}: it resolves outside the workbench')
            raise Fail(f'refused to delete {base}: it is a symlink to a folder')
        os.unlink(full)  # a link to a file: remove the link, never the target
        return True
    if not os.path.lexists(full):
        return False
    real = os.path.realpath(full)
    if real == wb:
        raise Fail(f'refused to delete {base}: it is the workbench itself')
    if _inside(real, os.path.join(wb, 'src')) or real == os.path.join(wb, 'src'):
        raise Fail(f'refused to delete {base}: it is inside src/')
    if not _inside(real, wb):
        raise Fail(f'refused to delete {base}: it resolves outside the workbench')
    if os.path.isdir(full):
        shutil.rmtree(full)
    else:
        os.unlink(full)
    return True


def _ignore_run_copy(d, names):
    skip = {'node_modules'}
    if os.path.basename(d) == '.claude-plugin':
        skip.add('types')
    return [n for n in names if n in skip]


def refresh_run(ctx, real=False):
    """Copy the plugin to run/<name>. The source is src/<plugin>, or devMods/<mod> with real=True. Return the new path."""
    mod = ctx.cfg['mod']
    if real:
        dm = ctx.cfg.get('devMods')
        if not dm or not os.path.isdir(os.path.join(dm, mod)):
            raise Fail('devMods is not set, or devMods/<mod> is missing; run mods.py build --dev-mods <dir>', rc=2)
        src, name = os.path.join(dm, mod), mod
    else:
        src, name = src_dir(ctx), plugin(ctx)
        if not os.path.isdir(src):
            raise Fail(f'no plugin source at {src}')
    safe_rm(ctx, f'run/{name}')
    dest = os.path.join(ctx.wb, 'run', name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copytree(src, dest, symlinks=True, ignore=_ignore_run_copy)
    return dest


# ---------------------------------------------------------------- tmux sessions (own sessions only, by exact name)


def tmux_prepare():
    """Run 'tmux ls' once. When tmux cannot find a socket path (a sandbox with no usable /tmp), export TMUX_TMPDIR=<wb>/logs/tmux.
    Every later tmux call of this process, and of its children, then uses that folder. A normal session is not changed."""
    if _CACHE.get('tmux_ready') or not _WB:
        return
    _CACHE['tmux_ready'] = True
    rc, text = _out(['tmux', 'ls'], 10)
    if 'no suitable socket path' in text:
        sock = os.path.join(_WB, 'logs', 'tmux')
        os.makedirs(sock, exist_ok=True)
        os.environ['TMUX_TMPDIR'] = sock
        print(f'tmux: using socket dir {sock}')


def tmux_ls():
    tmux_prepare()
    rc, text = _out(['tmux', 'ls', '-F', '#{session_name}'], 10)
    return [n for n in text.split('\n') if n] if rc == 0 else []


def _own_patterns(cfg):
    pre = cfg['prefixes']
    variants = '|'.join(re.escape(v) for v in cfg['variants']) or 'X'
    pats = {
        'mockups': re.escape(pre['mockups']) + f'(?:{variants})',
        'crawl': re.escape(pre['crawl']) + r'\d+',
        'live': re.escape(pre['live']) + r'\d+',
    }
    if cfg.get('kind') == 'audit':
        pats['audit'] = re.escape(pre.get('audit') or pre['mockups']) + 'X'
    return pats


def own_sessions(cfg, which=None):
    """The tmux sessions of this mod. which = 'mockups', 'crawl', 'live', 'audit', a list of them, or None for all."""
    pats = _own_patterns(cfg)
    keys = list(pats) if which is None else ([which] if isinstance(which, str) else list(which))
    regs = [re.compile(pats[k]) for k in keys if k in pats]
    return [n for n in tmux_ls() if any(r.fullmatch(n) for r in regs)]


def refuse_busy(cfg, which):
    own = own_sessions(cfg, which)
    if own:
        nxt = f'mods.py -C {_WB} clean' if _WB else 'mods.py clean'
        raise Fail('sessions running: ' + ', '.join(own), nxt)


def kill_own(cfg, names):
    """Kill the named sessions. A name that is not an own session is skipped. Return the names killed."""
    tmux_prepare()
    pats = [re.compile(p) for p in _own_patterns(cfg).values()]
    killed = []
    for n in names:
        if not any(r.fullmatch(n) for r in pats):
            continue
        rc, _ = _out(['tmux', 'kill-session', '-t', '=' + n], 10)  # '=' gives an exact name match
        if rc == 0:
            killed.append(n)
    return killed


# ---------------------------------------------------------------- auto-discovery

_CACHE = {}


def claude_version():
    if 'claude' not in _CACHE:
        rc, text = _out(['claude', '--version'], 30)
        _CACHE['claude'] = text.split()[0] if rc == 0 and text.split() else None
    return _CACHE['claude']


def _vtuple(v):
    try:
        return tuple(int(x) for x in v.split('.'))
    except (ValueError, AttributeError):
        return ()


def _types_header_version(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as fh:
            m = re.search(r'Written by Claude Code (\d+(?:\.\d+)*)', fh.readline())
        return m.group(1) if m else None
    except OSError:
        return None


def _path_version(path):
    parts = path.split(os.sep)  # .../bundled-skills/<version>/<hash>/plugin-authoring/types/claude-code.d.ts
    if len(parts) >= 5 and re.fullmatch(r'\d+(?:\.\d+)+', parts[-5]):
        return parts[-5]
    return _types_header_version(path)


def discover_types(pa=None, types=None):
    """Return (path, version) of the plugin-authoring types file. Return (None, None) when there is none.

    Search order: --types, then --pa, then $TMPDIR itself and its claude-<uid> folder, then the one under each system temp folder
    (each holds bundled-skills/<ver>/<hash>/plugin-authoring/types). The version of `claude --version` wins,
    else the newest version. Between equal versions the earlier folder of the order wins, then the newest file.
    The winner is named in _CACHE['typesSource'] (doctor prints it)."""
    explicit, label = (types, '--types') if types else ((os.path.join(pa, 'types', 'claude-code.d.ts'), '--pa') if pa else (None, None))
    if explicit:
        p = os.path.abspath(os.path.expanduser(explicit))
        if not os.path.isfile(p):
            raise Fail(f'types file not found: {p}', rc=2)
        _CACHE['typesSource'] = label
        return p, _path_version(p)
    uid = os.getuid()
    roots = []
    tmpdir = os.environ.get('TMPDIR')
    if tmpdir:  # in an eval sandbox $TMPDIR is itself the claude-<uid> folder; in a normal session claude-<uid> sits under it
        roots += [os.path.normpath(tmpdir), os.path.join(os.path.normpath(tmpdir), f'claude-{uid}')]
    for root in (f'/private/tmp/claude-{uid}', f'/tmp/claude-{uid}'):
        roots.append(root)
    seen, cands = set(), []
    for rank, root in enumerate(roots):
        for p in glob.glob(os.path.join(root, 'bundled-skills', '*', '*', 'plugin-authoring', 'types', 'claude-code.d.ts')):
            real = os.path.realpath(p)
            if real in seen:
                continue
            seen.add(real)
            v = _path_version(real)
            if v:
                cands.append((v, -rank, os.path.getmtime(real), real, root))
    if not cands:
        _CACHE['typesSource'] = None
        return None, None
    binary = claude_version()
    same = [c for c in cands if c[0] == binary]
    pool = same or [c for c in cands if _vtuple(c[0]) == max(_vtuple(x[0]) for x in cands)]
    best = max(pool, key=lambda c: (c[1], c[2]))
    _CACHE['typesSource'] = best[4]
    return best[3], best[0]


def versions(pa=None, types=None):
    v = {'claude': claude_version(), 'types': None, 'typesPath': None, 'typesWarning': None}
    try:
        v['typesPath'], v['types'] = discover_types(pa, types)
    except Fail as e:
        v['typesWarning'] = e.summary
    if v['typesPath']:
        head = _types_header_version(v['typesPath'])
        if head and head != v['types']:
            v['typesWarning'] = f'types header says {head}, folder says {v["types"]}'
    rc, text = _out(['tmux', '-V'], 10)
    v['tmux'] = text.strip().replace('tmux ', '') if rc == 0 else None
    rc, text = _out(['node', '--version'], 10)
    v['node'] = text.strip() if rc == 0 else None
    v['python'] = platform.python_version()
    return v


def kit_state(kit_dir):
    """Return (version, sha256) of a kit folder. Return (None, None) when the folder is missing."""
    if not os.path.isdir(kit_dir):
        return None, None
    h = hashlib.sha256()
    rels = []
    for root, dirs, files in os.walk(kit_dir):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for f in files:
            if f != '.DS_Store':
                rels.append(os.path.relpath(os.path.join(root, f), kit_dir))
    for rel in sorted(rels):
        h.update(rel.encode() + b'\0')
        with open(os.path.join(kit_dir, rel), 'rb') as fh:
            h.update(fh.read() + b'\0')
    version = None
    try:
        with open(os.path.join(kit_dir, 'defaults.ts'), encoding='utf-8') as fh:
            m = re.search(r'KIT\s*=\s*\{\s*version:\s*(\d+)', fh.read())
        version = int(m.group(1)) if m else None
    except OSError:
        pass
    return version, h.hexdigest()


def dev_mods_candidates(n=3):
    """The newest n dev-mods session folders by mtime, with the mods in each. It never picks one."""
    root = os.path.join(config_dir(), 'dev-mods')
    rows = []
    for d in glob.glob(os.path.join(root, '*')):
        if os.path.isdir(d):
            mods = sorted(m for m in os.listdir(d) if os.path.isdir(os.path.join(d, m)))
            rows.append({'path': d, 'mtime': os.path.getmtime(d), 'mods': mods})
    rows.sort(key=lambda r: -r['mtime'])
    return rows[:n]


def diff_source():
    return os.path.join(config_dir(), CLAUDE_DIFF)


# ---------------------------------------------------------------- RUN.md


def _versions_line(v):
    t = f"types {v['types']} ({v['typesPath']})" if v.get('typesPath') else 'types none'
    return (f"claude {v.get('claude')} · {t} · tmux {v.get('tmux')} · node {v.get('node')} · python {v.get('python')}")


def append_run(ctx, res, rc):
    path = os.path.join(ctx.wb, 'RUN.md')
    if not ctx.vers:
        ctx.vers = versions()
    lines = []
    if not os.path.exists(path):
        lines += [f"# RUN.md of {ctx.cfg.get('mod', '?')} (written by mods.py)", '']
    lines.append(f"## {ctx.cmd} · {now_iso()} · {'PASS' if res.ok else 'FAIL'}")
    lines.append('- versions: ' + _versions_line(ctx.vers))
    lines.append('- args: ' + ctx.argv_text)
    for i, st in enumerate(ctx.steps, 1):
        log = os.path.relpath(st.log, ctx.wb) if st.log else 'none'
        lines.append(f'- step {i}: `{shlex.join(st.argv)}` · rc {st.rc} · {st.seconds} s · log {log}')
        lines.append('  ```')
        lines += ['  ' + ln for ln in last_lines(st.out, 40).split('\n')]
        lines.append('  ```')
    lines.append('- summary: ' + one_line(res.summary))
    lines.append('- next: ' + one_line(res.next))
    lines.append('- facts: ' + json.dumps(res.facts or {}, ensure_ascii=False, default=str))
    lines.append('- result: ' + ('pass' if res.ok else 'fail'))
    had_text = os.path.exists(path) and os.path.getsize(path) > 0
    with open(path, 'a', encoding='utf-8') as fh:
        if had_text:
            fh.write('\n')
        fh.write('\n'.join(lines) + '\n')


HEAD = re.compile(r'^## (\S+) · (\S+) · (PASS|FAIL)$')


def read_runs(wb):
    """Parse RUN.md into a list of sections: cmd, ts, result, summary, facts, idx."""
    path = os.path.join(wb, 'RUN.md')
    secs = []
    if not os.path.isfile(path):
        return secs
    with open(path, encoding='utf-8') as fh:
        for line in fh.read().split('\n'):
            m = HEAD.match(line)
            if m:
                secs.append({'cmd': m.group(1), 'ts': m.group(2), 'result': m.group(3), 'summary': '', 'facts': {}, 'idx': len(secs)})
            elif secs and line.startswith('- summary: '):
                secs[-1]['summary'] = line[len('- summary: '):]
            elif secs and line.startswith('- facts: '):
                try:
                    secs[-1]['facts'] = json.loads(line[len('- facts: '):])
                except ValueError:
                    pass
    return secs


# ---------------------------------------------------------------- execute one subcommand


def _argv_text(ctx):
    toks, skip = [], False
    for t in sys.argv[1:]:
        if skip:
            skip = False
        elif t in ('-C', '--workbench'):
            skip = True
        elif t.startswith('-C') and len(t) > 2:
            continue
        else:
            toks.append(t)
    return 'mods.py ' + (f'-C {ctx.wb} ' if ctx.wb else '') + shlex.join(toks)


def _chain(ctx, res):
    """The no-pane chain (design 4.1). mockups skips a kind with one variant, so nothing is left to choose: the driver picks
    that variant (pickedBy 'single') and the next: line names the next step of the kind (journey, or approve for a guard)."""
    if ctx.cmd == 'mockups' and res.ok and ctx.cfg.get('kind') in NO_PANE and len(ctx.cfg.get('variants') or []) == 1:
        import mods_check
        return res._replace(next=mods_check.auto_pick(ctx))
    return res


def execute(ctx, handler):
    """Run one handler. Return (Done, rc). It writes the RUN.md section in a finally block."""
    global _WB
    _WB = ctx.wb
    if ctx.wb and not ctx.log_path:
        ctx.log_path = os.path.join(ctx.wb, 'logs', f'{ctx.cmd}-{now_stamp()}.log')
    res, rc = None, 0
    try:
        try:
            res = handler(ctx, ctx.args)
            if not isinstance(res, Done):
                raise TypeError(f'{ctx.cmd} handler returned {type(res).__name__}, not Done')
            res = _chain(ctx, res)
            rc = 0 if res.ok else 1
        except Fail as e:
            res, rc = Done(False, e.summary, e.next, e.facts), e.rc
        except KeyboardInterrupt:
            res, rc = Done(False, 'interrupted'), 130
        except Exception as e:  # unexpected: keep the traceback in the log
            tb = traceback.format_exc()
            if ctx.log_path:
                os.makedirs(os.path.dirname(ctx.log_path), exist_ok=True)
                with open(ctx.log_path, 'a', encoding='utf-8') as fh:
                    fh.write(tb)
            else:
                sys.stderr.write(tb)
            res, rc = Done(False, f'internal error: {type(e).__name__}: {e}'), 1
        if not res.ok and ctx.steps and ctx.steps[-1].rc != 0 and not ctx.steps[-1].echoed:
            print(last_lines(ctx.steps[-1].out, 30))  # the step was quiet: show why it failed
    finally:
        if res is None:
            res = Done(False, 'crashed before it finished')
        if ctx.wb and ctx.record:
            ctx.argv_text = ctx.argv_text or _argv_text(ctx)
            try:
                append_run(ctx, res, rc)
            except OSError as e:
                sys.stderr.write(f'WARN: cannot write RUN.md: {e}\n')
    return res, rc


def run_sub(ctx, cmd, **opts):
    """Run a local subcommand inside another one (done does this). It writes its own RUN.md section."""
    sub = Ctx(cmd, argparse.Namespace(**opts), ctx.wb, ctx.cfg)
    sub.vers = ctx.vers
    sub.record = cmd not in NO_RECORD
    sub.argv_text = f'mods.py -C {ctx.wb} {cmd}'
    res, _ = execute(sub, LOCAL[cmd])
    print(f"{cmd}: {'PASS' if res.ok else 'FAIL'} {one_line(res.summary)}")
    return res


# ---------------------------------------------------------------- doctor


def _mod_version(name):
    import importlib.metadata as md
    try:
        return md.version(name)
    except md.PackageNotFoundError:
        return None


def cmd_doctor(ctx, args):
    rows = []  # (status, name, detail)

    def add(status, name, detail):
        rows.append({'n': len(rows) + 1, 'status': status, 'name': name, 'detail': detail})

    # 1 python
    pv = platform.python_version()
    add('ok' if sys.version_info >= (3, 9) else 'missing', 'python3 >= 3.9', f'Python {pv}')
    # 2 rich and Pillow with WebP
    rich_v = _mod_version('rich')
    try:
        import PIL
        import PIL.features
        pil_v, webp = PIL.__version__, bool(PIL.features.check('webp'))
    except ImportError:
        pil_v, webp = None, False
    if rich_v is None or pil_v is None:
        gone = ' and '.join(n for n, v in (('rich', rich_v), ('Pillow', pil_v)) if v is None)
        add('missing', 'rich + Pillow (WebP)', f'{gone} not installed (pip install rich Pillow)')
    else:
        add('ok' if webp else 'warning', 'rich + Pillow (WebP)',
            f'rich {rich_v} · Pillow {pil_v} webp {webp}' + ('' if webp else ' (storyboard-build.py falls back to PNG)'))
    # 3 jsonschema
    js = _mod_version('jsonschema')
    add('ok' if js else 'warning', 'jsonschema', f'jsonschema {js}' if js else 'not installed (journey_lib.py has a fallback)')
    # 4 rsvg-convert
    rsvg = shutil.which('rsvg-convert')
    add('ok' if rsvg else 'warning', 'rsvg-convert', rsvg or 'not found (qlmanage path; hotspot geometry assumes rsvg)')
    # 5 tmux
    rc, text = _out(['tmux', '-V'], 10)
    add('ok' if rc == 0 else 'missing', 'tmux', text.strip() if rc == 0 else 'not found')
    # 6 node
    rc, text = _out(['node', '--version'], 10)
    add('ok' if rc == 0 else 'warning', 'node', f'node {text.strip()}' if rc == 0 else 'not found (no player shot)')
    # 7 playwright
    rc, text = _out(['npm', 'root', '-g'], 20)
    pw = os.path.join(text.strip(), 'playwright', 'index.mjs') if rc == 0 and text.strip() else None
    if pw and os.path.isfile(pw):
        ver = None
        with contextlib.suppress(OSError, ValueError):
            with open(os.path.join(os.path.dirname(pw), 'package.json'), encoding='utf-8') as fh:
                ver = json.load(fh).get('version')
        add('ok', 'playwright', f'playwright {ver} ({pw})' if ver else pw)
    else:
        add('warning', 'playwright', 'not found: $(npm root -g)/playwright/index.mjs (no player shot)')
    # 8 claude
    cv = claude_version()
    add('ok' if cv else 'missing', 'claude', f'claude {cv}' if cv else 'not found')
    # 9 types file
    types_path = types_ver = None
    try:
        types_path, types_ver = discover_types(args.pa, args.types)
    except Fail as e:
        add('missing', 'types file', e.summary)
    else:
        if not types_path:
            add('missing', 'types file', 'no claude-code.d.ts found under /private/tmp/claude-<uid>/bundled-skills (or $TMPDIR, /tmp). Load the plugin-authoring skill: it unpacks the types. Or use --pa or --types')
        else:
            head = _types_header_version(types_path)
            notes = []
            if head and head != types_ver:
                notes.append(f'header says {head}')
            if cv and types_ver != cv:
                notes.append(f'binary is {cv}')
            add('warning' if notes else 'ok', 'types file',
                f"types {types_ver} ({types_path}, found in {_CACHE.get('typesSource')})" + (f' · {"; ".join(notes)}' if notes else ''))

    # info lines (not counted as checks)
    info = {'devMods': dev_mods_candidates(), 'diffSource': None, 'names': {}}
    extra_warnings = 0
    info_lines = []
    notes = []  # positional text that doctor does not use: a note, never an error
    if getattr(args, 'kind', None) and args.kind not in KINDS:
        notes.append(f"note: unknown kind '{args.kind}' (known: {', '.join(KINDS)}): the next: line stays generic")
        args.kind = None
    if getattr(args, 'extra', None) or getattr(args, 'ignored', None):
        notes.append('note: ignored extra arguments: ' + ' '.join((getattr(args, 'extra', None) or []) + (getattr(args, 'ignored', None) or [])))
    src_line = f"info: types file {types_path} (found in {_CACHE.get('typesSource')})" if types_path and args.brief else None  # the full table shows it in row 9
    dm = info['devMods']
    if dm:
        info_lines.append('info: dev-mods folders, newest 3 by mtime (the driver never picks one):')
        for r in dm:
            info_lines.append(f"  {r['path']} (mods: {', '.join(r['mods']) or 'none'})")
    else:
        info_lines.append(f"info: no dev-mods folder under {os.path.join(config_dir(), 'dev-mods')}")
    ds = diff_source()
    present = os.path.isfile(ds)
    info['diffSource'] = {'path': ds, 'present': present}
    if present:
        info_lines.append(f'info: /diff source present: {ds}')
    else:
        extra_warnings += 1
        info_lines.append(f'warning: /diff source absent: {ds}')
        info_lines.append(f'  run: {MARKETPLACE_LINE}')
    if types_path:
        with open(types_path, encoding='utf-8', errors='replace') as fh:
            body = fh.read().split('\n')
        info['names'] = {n: sum(1 for ln in body if n in ln) for n in UPGRADE_NAMES}
        zero = [n for n, c in info['names'].items() if c == 0]
        found = len(UPGRADE_NAMES) - len(zero)
        counts = ' '.join(str(info['names'][n]) for n in UPGRADE_NAMES)
        if zero:
            extra_warnings += 1
            info_lines.append(f'warning: {found}/{len(UPGRADE_NAMES)} names found; count 0 for: {"; ".join(z.strip() for z in zero)}')
        else:
            info_lines.append(f'info: {found}/{len(UPGRADE_NAMES)} names found in the types file (counts {counts})')
    if args.upgrade:
        if cv and cv not in KNOWN_VERSIONS:
            info_lines.append(f'info: claude {cv} is not in {", ".join(KNOWN_VERSIONS)}: run the live smoke test')
        else:
            info_lines.append(f'info: claude {cv} is a known version: no smoke test needed')

    n_ok = sum(1 for r in rows if r['status'] == 'ok')
    n_missing = sum(1 for r in rows if r['status'] == 'missing')
    n_warn = sum(1 for r in rows if r['status'] == 'warning') + extra_warnings
    if not args.json:
        body = [f"{r['n']:>2} {r['status']:<8} {r['name']:<22} {r['detail']}" for r in rows if not (args.brief and r['status'] == 'ok')]
        body += notes
        if src_line:
            body.append(src_line)
        body += [ln for ln in info_lines if not args.brief or ln.startswith(('warning', '  run'))]
        if args.brief and len(body) > 10:  # the summary and the next: line follow: 12 lines in all
            body = body[:9] + [f'... {len(body) - 9} more lines: run mods.py doctor']
        if body:
            print('\n'.join(body))
    else:
        print(json.dumps({'checks': rows, 'info': info}, indent=2, ensure_ascii=False))

    # --upgrade on an unknown version runs the live smoke test of the group module
    if args.upgrade and cv and cv not in KNOWN_VERSIONS and not n_missing:
        handler, why = resolve_handler('selfcheck')
        if handler is None:
            raise Fail(f'--upgrade needs the selfcheck module: {why}', rc=2)
        trusted = args.trusted or os.getcwd()
        sub = Ctx('selfcheck', argparse.Namespace(quick=False, live=True, keep=False, trusted=trusted))
        res, _ = execute(sub, handler)
        print(f"selfcheck: {'PASS' if res.ok else 'FAIL'} {one_line(res.summary)}")
        if not res.ok:
            raise Fail(f'{n_ok} ok, {n_missing} missing, {n_warn} warnings; the smoke test on {cv} failed')
    plural = 'warning' if n_warn == 1 else 'warnings'
    summary = f'{n_ok} ok, {n_missing} missing, {n_warn} {plural}'
    facts = {'ok': n_ok, 'missing': n_missing, 'warnings': n_warn}
    if n_missing:
        if n_missing == 1 and any(r['status'] == 'missing' and r['name'] == 'types file' for r in rows):
            return Done(False, summary, 'load the plugin-authoring skill (it unpacks the types file), then run mods.py doctor', facts)
        return Done(False, summary, 'install the missing tools, then run mods.py doctor', facts)
    nxt = NEW_HINT
    if getattr(args, 'mod', None) and getattr(args, 'kind', None):
        # --pa names the plugin-authoring folder of THIS session: the newest folder of another session must not win (SB.p5)
        pa_dir = os.path.dirname(os.path.dirname(types_path)) if types_path else '<plugin-authoring base dir>'
        nxt = f'mods.py new {args.mod} --kind {args.kind} --trusted <dir> --pa {pa_dir}'
    return Done(True, summary, nxt, facts)


# ---------------------------------------------------------------- clean


def cmd_clean(ctx, args):
    cfg, wb = ctx.cfg, ctx.wb
    own = own_sessions(cfg)
    killed = kill_own(cfg, own)
    for n in killed:
        print(f'killed session {n}')
    rels = ['run', 'tscheck', os.path.join('logs', 'latest')]
    if args.all:
        rels += ['mockups', 'crawl']
    removed, refusal = [], None
    for rel in rels:
        try:
            if safe_rm(ctx, rel):
                removed.append(rel + ('' if rel.endswith('latest') else '/'))
                print(f'removed {removed[-1]}')
        except Fail as e:
            print(f'FAIL: {e.summary}')
            refusal = refusal or e
    uninstalled, bad = [], []
    if args.installs:
        st = run_step(ctx, ['claude', 'plugin', 'list', '--json'], echo=False)
        ids = []
        try:
            data = json.loads(st.out[st.out.index('['):])
            ids = [p['id'] for p in data if isinstance(p, dict) and isinstance(p.get('id'), str)]
        except (ValueError, KeyError):
            bad.append('claude plugin list --json gave no JSON list')
        mine = [i for i in ids if i.startswith(cfg['mod'] + '@') or i.startswith(cfg['mod'] + '-proto@')]
        for pid in mine:
            u = run_step(ctx, ['claude', 'plugin', 'uninstall', pid])
            (uninstalled if u.rc == 0 else bad).append(pid if u.rc == 0 else f'uninstall {pid} rc {u.rc}')
    left = own_sessions(cfg)
    facts = {'killed': killed, 'removed': removed, 'uninstalled': uninstalled, 'left': left}
    if refusal:
        raise Fail(refusal.summary, f'mods.py -C {wb} clean', 1, facts)
    if left:
        raise Fail('sessions left after the kill: ' + ', '.join(left), f'mods.py -C {wb} clean', 1, facts)
    if bad:
        raise Fail('; '.join(bad), 'none', 1, facts)
    parts = [f'killed {len(killed)} sessions', 'removed ' + (' '.join(removed) if removed else 'nothing')]
    if args.installs:
        parts.append('uninstalled ' + (', '.join(uninstalled) if uninstalled else 'none'))
    parts.append(f"tmux ls: no {cfg['mod']} sessions")
    return Done(True, ' · '.join(parts), 'none', facts)


# ---------------------------------------------------------------- note


def cmd_note(ctx, args):
    text = (args.workaround or '').strip()
    if not text:
        raise Fail('usage: --workaround needs a text', 'mods.py note --help', 2)
    if not getattr(args, 'workbench', None) and ctx.cfg.get('kind') == 'audit':
        # No -C: find_workbench took the only workbench of the folder. When that is an audit workbench, the note
        # belongs to the redesign that comes after it (RD.p5). find_workbench itself refuses two workbenches.
        ctx.record = False  # the refusal must not write a RUN.md section into the audit workbench
        raise Fail(f'the only workbench here is the audit workbench {ctx.wb}; run new first, or pass -C <wb>',
                   'mods.py new <new name> --kind <kind> --trusted <dir> --pa <dir>', 2)
    ctx.cfg['workarounds'].append(text)
    save_cfg(ctx)
    with open(mod_json_path(ctx), encoding='utf-8') as fh:
        back = json.load(fh)['workarounds']
    if not back or back[-1] != text:
        raise Fail('the workaround is not in mod.json after the write')
    n = len(back)
    return Done(True, f"{n} workaround{'' if n == 1 else 's'} recorded", 'none', {'workarounds': n})


# ---------------------------------------------------------------- kit-sync


def _kit_files(root):
    out = set()
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x != '__pycache__']
        for f in files:
            if f != '.DS_Store':
                out.add(os.path.relpath(os.path.join(d, f), root))
    return out


def _sync_tree(tpl, dst):
    """Make the folder dst equal to the folder tpl (add, update, remove). Return {'added': [...], 'updated': [...], 'removed': [...]}."""
    tf = _kit_files(tpl)
    df = _kit_files(dst) if os.path.isdir(dst) else set()
    rows = {'added': [], 'updated': [], 'removed': []}
    for rel in sorted(tf):
        s, d = os.path.join(tpl, rel), os.path.join(dst, rel)
        if rel not in df:
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copyfile(s, d)
            rows['added'].append(rel)
        elif not filecmp.cmp(s, d, shallow=False):
            shutil.copyfile(s, d)
            rows['updated'].append(rel)
    for rel in sorted(df - tf):
        os.unlink(os.path.join(dst, rel))  # only inside the destination folder
        rows['removed'].append(rel)
    for d, dirs, files in os.walk(dst, topdown=False):  # drop folders the removals left empty
        if d != dst and not os.listdir(d):
            os.rmdir(d)
    return rows


def _kit_sync_templates(tpl_kit):
    """kit-sync --templates: copy templates/kit/ and templates/kit-tests/ into every template that carries a kit copy.

    Same layout as kit_copy_drift reads: hooks/kit/, tests/kit/<helper>, tests/kit.*.test.ts. The template's own
    tests (for example tests/pane-list.test.ts) stay. kit_copy_drift is the read-back proof."""
    root = os.path.join(S, 'templates')
    tests = os.path.join(root, 'kit-tests')
    changed, names = 0, []
    for name in sorted(os.listdir(root)):
        copy = os.path.join(root, name, 'hooks', 'kit')
        if name in ('kit', 'kit-tests') or not os.path.isdir(copy):
            continue
        names.append(name)
        rows = _sync_tree(tpl_kit, copy)
        for kind in ('updated', 'added', 'removed'):
            for rel in rows[kind]:
                print(f'{kind} templates/{name}/hooks/kit/{rel}')
                changed += 1
        for f in sorted(os.listdir(tests)) if os.path.isdir(tests) else []:
            if not f.endswith('.ts'):
                continue
            rel = os.path.join('tests', 'kit', f) if f in ('flat.ts', 'fake.ts') else os.path.join('tests', f)
            s, d = os.path.join(tests, f), os.path.join(root, name, rel)
            if os.path.isfile(d) and filecmp.cmp(s, d, shallow=False):
                continue
            verb = 'updated' if os.path.isfile(d) else 'added'
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copyfile(s, d)
            print(f'{verb} templates/{name}/{rel}')
            changed += 1
    drift = kit_copy_drift(S)
    if drift:
        raise Fail('kit copies differ after the sync: ' + '; '.join(f'{n}: {w}' for n, w in drift))  # read-back proof
    ver, h = kit_state(tpl_kit)
    v = f'kit v{ver}' if ver is not None else 'kit v?'
    return Done(True, f'{len(names)} templates in sync ({v}, {changed} files updated)', 'none',
                {'templates': names, 'changed': changed, 'kit': ver, 'hash': h})


def cmd_kit_sync(ctx, args):
    tpl = os.path.join(S, 'templates', 'kit')
    if not os.path.isdir(tpl):
        raise Fail('no kit in this skill (templates/kit/)')
    if getattr(args, 'templates', False):
        return _kit_sync_templates(tpl)
    base = src_dir(ctx)
    if not os.path.isdir(base):
        raise Fail(f'no plugin source at {base}')
    dst = os.path.join(base, 'hooks', 'kit')
    rows = _sync_tree(tpl, dst)
    for kind in ('updated', 'added', 'removed'):
        for rel in rows[kind]:
            print(f'{kind} hooks/kit/{rel}')
    ver, h = kit_state(dst)
    if h != kit_state(tpl)[1]:
        raise Fail('hooks/kit/ differs from templates/kit/ after the sync')  # read-back proof
    ctx.cfg['kit'] = {'version': ver, 'hash': h}
    save_cfg(ctx)
    n = sum(len(v) for v in rows.values())
    v = f'kit v{ver}' if ver is not None else 'kit v?'
    summary = f'{n} files updated ({v})' if n else f'0 files updated ({v} in sync)'
    return Done(True, summary, 'none', {**rows, 'kit': ver, 'hash': h})


# ---------------------------------------------------------------- lint-skill


def _same_file(a, b):
    try:
        with open(a, 'rb') as fa, open(b, 'rb') as fb:
            return fa.read() == fb.read()
    except OSError:
        return False


def kit_copy_drift(skill):
    """The template folders whose kit copy differs from templates/kit/ and templates/kit-tests/.

    Each template carries its own copy (hooks/kit/, tests/kit/<helper>, tests/kit.*.test.ts), so that
    'claude plugin test' runs on the template itself. 'new' keeps that copy. Return [(template, why)];
    the template 'kit' means a word in templates/kit/ that new-mod.sh renames."""
    tpl = os.path.join(skill, 'templates')
    kit, tests = os.path.join(tpl, 'kit'), os.path.join(tpl, 'kit-tests')
    if not os.path.isdir(kit):
        return []
    want = kit_state(kit)[1]
    drift = []
    for name in sorted(os.listdir(tpl)):
        copy = os.path.join(tpl, name, 'hooks', 'kit')
        if name in ('kit', 'kit-tests') or not os.path.isdir(copy):
            continue
        why = []
        if kit_state(copy)[1] != want:
            why.append('hooks/kit')
        for f in sorted(os.listdir(tests)) if os.path.isdir(tests) else []:
            rel = os.path.join('tests', 'kit', f) if f in ('flat.ts', 'fake.ts') else os.path.join('tests', f)
            if f.endswith('.ts') and not _same_file(os.path.join(tests, f), os.path.join(tpl, name, rel)):
                why.append(rel)
        if why:
            drift.append((name, ', '.join(why)))
    # new-mod.sh renames every template name (a whole token) and the noun item/items in a new mod, the kit
    # copy too. Such a word in templates/kit/ makes the kit hash of every new mod differ ('check: kit drift').
    names = set()  # only templates that carry a kit copy: new-mod.sh renames their name in that copy
    for name in os.listdir(tpl):
        if not os.path.isdir(os.path.join(tpl, name, 'hooks', 'kit')):
            continue
        try:
            with open(os.path.join(tpl, name, '.claude-plugin', 'plugin.json'), encoding='utf-8') as fh:
                names.add(json.load(fh)['name'])
        except (OSError, ValueError, KeyError, TypeError):
            continue
    words = re.compile(r'(?<![a-z0-9-])(' + '|'.join(re.escape(n) for n in sorted(names)) + r')(?![a-z0-9])|\b(item|items)\b', re.I)
    for root, _, files in os.walk(kit):
        for f in sorted(files):
            p = os.path.join(root, f)
            try:
                with open(p, encoding='utf-8') as fh:
                    lines = fh.read().split('\n')
            except (OSError, UnicodeDecodeError):
                continue
            for n, line in enumerate(lines, 1):
                m = words.search(line) if names else None
                if m:
                    drift.append(('kit', f'{os.path.relpath(p, tpl)}:{n} holds {m.group(0)!r}, which new-mod.sh renames'))
    return drift


def domain_drift(skill):
    """Design 2.1 (replaces the round-1 fixtures check): each domain template holds the generated files of its kind defaults.
    Return the problem lines; empty when every template agrees. Another skill folder than this one is not checked."""
    if os.path.realpath(skill) != os.path.realpath(S):
        return []
    import mods_domain
    return [p for kind in mods_domain.DOMAIN_KINDS for p in mods_domain.template_check(kind, skill)]


def cmd_lint_skill(ctx, args):
    script = os.path.join(SC, 'skill-lint.py')
    if not os.path.isfile(script):
        raise Fail('skill-lint.py is missing', 'none', 2)
    target = os.path.abspath(args.skill_dir) if args.skill_dir else S
    if not os.path.isdir(target):
        raise Fail(f'skill folder not found: {target}', 'none', 2)
    # Two rows of the skill's own sync: the kit copies of the templates, and the fixtures of generator 4.2.
    drift = kit_copy_drift(target)
    for name, why in drift:
        if name == 'kit':
            print(f'kit words: DRIFT templates/{why}')
        else:
            print(f'kit copies: DRIFT templates/{name}: {why} (copy templates/kit and templates/kit-tests into it)')
    if not drift:
        print('kit copies: every template copy equals templates/kit and templates/kit-tests')
    fix = domain_drift(target)
    for why in fix:
        print(f'domain: DRIFT {why}')
    if not fix:
        print('domain: each template holds the domain files of its kind defaults (domain.ts, fixtures.ts, types/index.d.ts)')
    st = run_step(ctx, py('skill-lint.py') + [target])
    tail = [ln for ln in st.out.split('\n') if ln.strip()]
    summary = tail[-1].strip() if tail else f'skill-lint.py gave no output (rc {st.rc})'
    facts = {'rc': st.rc, 'kitDrift': [n for n, _ in drift], 'fixturesDrift': bool(fix)}
    if st.rc in (0, 1) and (drift or fix):
        bad = ([f'kit copies drift in {len(drift)} templates'] if drift else []) + (['domain drift'] if fix else [])
        return Done(False, f"{'; '.join(bad)} · {summary}", 'fix the rows above, then run mods.py lint-skill', facts)
    if st.rc == 0:
        return Done(True, summary, 'none', facts)
    if st.rc == 1:
        return Done(False, summary, 'fix the findings above, then run mods.py lint-skill', facts)
    raise Fail(summary, 'none', 2)


# ---------------------------------------------------------------- evidence

GATE_ITEMS = [
    (1, 'validate --strict'), (2, 'tsc'), (3, 'plugin test'), (4, 'load line, no refused/skipped/dropped'),
    (5, 'screens: states, 150 dock, 100 and 60 inline'), (6, 'keys: crawl edges'), (7, 'user paths'),
    (8, 'colour: NO_COLOR'), (9, 'hot-reload notice quote'), (10, 'cleanup'),
]
SESSION_STARTERS = ('mockups', 'crawl', 'live', 'audit-existing')


def _newest(secs, cmds, pred=None):
    for s in reversed(secs):
        if s['cmd'] in cmds and (pred is None or pred(s['facts'])):
            return s
    return None


def _parts_of(cfg):
    """The parts of a no-pane mod: the domain block, else the kind default (design 1.6)."""
    cfg = cfg or {}
    kind = cfg.get('kind')
    parts = [p for p in ((cfg.get('domain') or {}).get('parts') or []) if isinstance(p, str)]
    if not parts:
        parts = list({'status-toast': ['toast'], 'command': ['command'], 'guard': ['guard']}.get(kind, []))
    for k in ('command', 'guard'):
        if kind == k and k not in parts:
            parts.append(k)
    return parts


def _band_yields(cfg):
    return cfg.get('kind') == 'band' and (((cfg.get('domain') or {}).get('band')) or {}).get('idle') == 'yield'


def proof_plan(cfg):
    """The live proofs that the kind needs, in order: (id, live options). Design 4.1 and 4.2.

    L1 proves rows 4 and 8 (guard: row 4 only), L2 a turn (toast part, or a band with idle yield),
    L3 the three widths of a command part, L4 the guard probe."""
    cfg = cfg or {}
    kind, parts = cfg.get('kind'), _parts_of(cfg)
    plan = [('L1', '--debug' + ('' if kind == 'guard' else ' --nocolor'))]
    if _band_yields(cfg) or (kind in NO_PANE and 'toast' in parts):
        plan.append(('L2', '--turn'))
    if kind in NO_PANE and 'command' in parts:
        plan.append(('L3', f"--cols 150,100,60 --cmd /{cfg.get('mod', '<mod>')}"))
    if kind in NO_PANE and 'guard' in parts:
        plan.append(('L4', '--turn --probe'))
    return plan


def _since(secs):
    """The index of the newest passing build. A proof counts only when it is newer (design 4.3)."""
    b = [s['idx'] for s in secs if s['cmd'] == 'build' and s['result'] == 'PASS']
    return b[-1] if b else -1


def _cols_of(f):
    c = f.get('cols')
    return {c} if isinstance(c, int) and not isinstance(c, bool) else {x for x in (c or []) if isinstance(x, int)}


def _proof_state(pid, secs, since, cfg):
    """(verdict, detail) of one proof. verdict: PASS, FAIL or MISSING. Only live runs newer than the build count."""
    runs = [s for s in secs if s['cmd'] == 'live' and s['idx'] > since]
    tail = '' if since < 0 else ' after the build'
    if pid == 'L1':
        s = next((x for x in reversed(runs) if x['facts'].get('debug') is True), None)
        if not s:
            return 'MISSING', f'no live run with --debug{tail}'
        f = s['facts']
        return ('PASS' if f.get('loaded') is True and f.get('refusals') == 0 else 'FAIL',
                f"live {s['ts']}: loaded {f.get('loaded')}, refusals {f.get('refusals')}")
    if pid == 'L2':
        s = next((x for x in reversed(runs) if x['facts'].get('turn') is True and not x['facts'].get('probe')), None)
        if not s:
            return 'MISSING', f'no live run with --turn{tail}'
        f = s['facts']
        gone = _band_yields(cfg)
        ok = s['result'] == 'PASS' and (not gone or f.get('idleGone') is True)
        return ('PASS' if ok else 'FAIL', f"live {s['ts']}: turn {f.get('turn')}" + (f", idleGone {f.get('idleGone')}" if gone else ''))
    if pid == 'L3':
        cols = set()
        for s in runs:
            if s['result'] == 'PASS':
                cols |= _cols_of(s['facts'])
        full = {150, 100, 60} <= cols
        return ('PASS' if full else 'MISSING', f"live PASS at columns {sorted(cols, reverse=True) or 'none'}"
                + ('' if full else f'; run live --cols 150,100,60{tail}'))
    if pid == 'L4':
        s = next((x for x in reversed(runs) if x['facts'].get('probe') is True), None)
        if not s:
            return 'MISSING', f'no live run with --turn --probe{tail}'
        f = s['facts']
        return ('PASS' if s['result'] == 'PASS' and f.get('probeKept') is True else 'FAIL',
                f"live {s['ts']}: probeKept {f.get('probeKept')}")
    return 'MISSING', f'unknown proof {pid}'


def _colour_run(secs, since):
    """The newest live run after the build that ran with --nocolor, else None."""
    return next((x for x in reversed(secs) if x['cmd'] == 'live' and x['idx'] > since and x['facts'].get('nocolor') is True), None)


def proof_next(wb, cfg, secs):
    """The first live proof that is still missing for the kind, as a live command line. 'mods.py -C <wb> done' when none is."""
    since = _since(secs)
    for pid, opts in proof_plan(cfg):
        verdict, _ = _proof_state(pid, secs, since, cfg)
        if pid == 'L1' and verdict == 'PASS' and '--nocolor' in opts and not _colour_run(secs, since):
            verdict = 'MISSING'
        if verdict != 'PASS':
            return f'mods.py -C {wb} live --real {opts} --marker <text>'
    return f'mods.py -C {wb} done'


def gate_rows(secs, kind=None, cfg=None):
    """Evaluate the ten rows of the definition of done. Return a list of (n, name, verdict, detail).

    kind: the mod kind. cfg: mod.json (parts and band idle name the proofs: design 4.3). A verdict N/A counts
    as a pass and its detail is the reason. MISSING, PENDING and FAIL count as a fail."""
    cfg = dict(cfg or {})
    cfg['kind'] = kind or cfg.get('kind')
    kind = cfg['kind']
    rows = []

    def add(n, verdict, detail):
        rows.append((n, dict(GATE_ITEMS)[n], verdict, detail))

    def has(key):
        return lambda f: f.get(key) is not None

    since = _since(secs)
    plan = proof_plan(cfg)
    s = _newest(secs, ('check',), has('validate'))
    add(1, 'MISSING' if not s else ('PASS' if s['facts']['validate'] is True else 'FAIL'),
        'no check run with validate' if not s else f"check {s['ts']}: validate {s['facts']['validate']}")
    s = _newest(secs, ('check',), has('tsc'))
    if s and s['facts']['tsc'] == 'skipped':  # offline: typescript was not available, so nothing proved the types
        add(2, 'MISSING', f"check {s['ts']}: tsc skipped (typescript not available offline: npm i -g typescript), run check again")
    else:
        add(2, 'MISSING' if not s else ('PASS' if s['facts']['tsc'] == 0 else 'FAIL'),
            'no check run with tsc' if not s else f"check {s['ts']}: tsc rc={s['facts']['tsc']}")
    s = _newest(secs, ('check',), lambda f: f.get('testFail') is not None and f.get('testPass') is not None)
    if not s:
        add(3, 'MISSING', 'no check run with test')
    else:
        f = s['facts']
        add(3, 'PASS' if f['testFail'] == 0 and f['testPass'] >= 1 else 'FAIL', f"check {s['ts']}: {f['testPass']} pass, {f['testFail']} fail")
    # Row 4: every required proof (L1, and L2 or L4 when the kind needs them), each newer than the newest build.
    states = [(pid, *_proof_state(pid, secs, since, cfg)) for pid, _ in plan if pid in ('L1', 'L2', 'L4')]
    worst = 'FAIL' if any(v == 'FAIL' for _, v, _ in states) else ('MISSING' if any(v == 'MISSING' for _, v, _ in states) else 'PASS')
    add(4, worst, '; '.join(f'{pid} {d}' for pid, _, d in states))
    # Row 5: screens.
    parts = _parts_of(cfg)
    cands = [x for x in secs if x['cmd'] in ('mockups', 'audit-existing')]
    good = [x for x in cands if x['result'] == 'PASS' and {150, 100, 60} <= set(x['facts'].get('sizes') or [])]
    if kind == 'guard':
        add(5, 'N/A', 'kind guard draws no screen')
    elif kind in NO_PANE and 'command' not in parts:
        add(5, 'N/A', 'the engine draws the toast and the status line')
    elif kind in NO_PANE:  # a command part: the live runs at the three widths show the texts
        v, d = _proof_state('L3', secs, since, cfg)
        add(5, v, f'kind {kind} draws no pane: {d}')
    elif good:
        add(5, 'PASS', f"{good[-1]['cmd']} {good[-1]['ts']}: sizes {good[-1]['facts']['sizes']}")
    elif cands:
        add(5, 'FAIL', f"newest {cands[-1]['cmd']} is {cands[-1]['result']} or lacks sizes 150, 100 and 60")
    else:
        add(5, 'MISSING', 'no mockups or audit-existing run')
    s = _newest(secs, ('crawl',))
    if kind == 'guard':
        add(6, 'N/A', 'no journey: crawl skips a guard (the tests and live prove the refusal)')
    elif not s:
        add(6, 'MISSING', 'no crawl run')
    else:
        e = s['facts'].get('edges') or [0, 0]
        add(6, 'PASS' if s['result'] == 'PASS' and e[0] == e[1] and e[1] > 0 else 'FAIL', f"crawl {s['ts']}: edges {e[0]}/{e[1]}, {s['result']}")
    # Row 7: the newest real live run after the build that pressed keys. PASS needs the --after screen drawn (D11).
    s = next((x for x in reversed(secs) if x['cmd'] == 'live' and x['idx'] > since and x['facts'].get('real') is True and x['facts'].get('keys')), None)
    if s and s['result'] == 'PASS' and s['facts'].get('after') is True:
        add(7, 'PASS', f"live {s['ts']}: keys {s['facts']['keys']}, after drawn")
    elif s and s['result'] == 'FAIL':
        add(7, 'FAIL', f"live {s['ts']}: the user path with keys {s['facts']['keys']} failed; fix it or run it again")
    else:
        add(7, 'MANUAL', 'walk the user paths of references/testing.md section 5 in the real session, or run live --real --keys <keys> --after <text> after the build')
    if kind == 'guard':
        add(8, 'N/A', 'a guard draws nothing')
    else:
        s = _colour_run(secs, since)
        if not s:
            add(8, 'MISSING', 'no live run with --nocolor' + (' after the build' if since >= 0 else '') + ' (run the light theme by hand too)')
        else:
            f = s['facts']
            # sgr7 None: the screen shows no selected row and no ring, so there is no focus to check (live --nocolor)
            add(8, 'PASS' if f.get('sgr7') in (True, None) and f.get('c256') is False else 'FAIL',
                f"live {s['ts']}: SGR 7 {'n/a' if f.get('sgr7') is None else f.get('sgr7')}, 38;5; {f.get('c256')} (run the light theme by hand too)")
    add(9, 'MANUAL', 'quote the hot-reload notice that started your next turn: enabled, declined, still open, or off. '
           'A headless run says "Mod hot-reloading is off in this session (nobody could be asked)": quote that line')
    clean = _newest(secs, ('clean',))
    start = _newest(secs, SESSION_STARTERS)
    if clean and clean['result'] == 'FAIL':
        add(10, 'FAIL', f"newest clean {clean['ts']} failed")
    elif clean and (not start or clean['idx'] > start['idx']):
        add(10, 'PASS', f"clean {clean['ts']} is newer than the last session start")
    else:
        add(10, 'PENDING', 'no clean after the last session start: run mods.py clean')
    return rows


def _gate_part(wb, secs, kind=None, cfg=None):
    rows = gate_rows(secs, kind, cfg)
    for n, name, verdict, detail in rows:
        print(f'{n:>2} {verdict:<8} {name:<46} {detail}')
    c = {'pass': 0, 'manual': 0, 'fail': 0, 'na': 0}
    for _, _, v, _ in rows:
        c['pass' if v == 'PASS' else 'manual' if v == 'MANUAL' else 'na' if v == 'N/A' else 'fail'] += 1
    return c, rows


def _norm_files(root):
    out = []
    if not os.path.isdir(root):
        return out
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in ('node_modules', '__pycache__')]
        if os.path.basename(root) == 'hooks' and d == root:
            dirs[:] = [x for x in dirs if x != 'kit']  # hooks/kit/ is not mod code
        for f in sorted(files):
            if f.endswith(('.ts', '.tsx')) and '.test.' not in f:
                out.append(os.path.join(d, f))
    return out


# The data-source file of each kind: its lines are the person's code, not framework lines (a tool.call observer goes in it).
DATA_SOURCE_FILES = {'status-toast': ('watch.ts',), 'guard': ('rules.ts',), 'mixed': ('source.ts', 'rules.ts')}


def _lines_part(ctx):
    cfg = ctx.cfg
    tpl_name = cfg.get('template')
    tpl_dir = os.path.join(S, 'templates', tpl_name) if tpl_name else None
    if not tpl_dir or not os.path.isdir(tpl_dir):
        raise Fail('--lines needs mod.json "template" to name a folder of templates/', 'none', 2)
    names = [plugin(ctx), cfg['mod']]
    with contextlib.suppress(OSError, ValueError, KeyError):
        with open(os.path.join(tpl_dir, '.claude-plugin', 'plugin.json'), encoding='utf-8') as fh:
            names.append(json.load(fh)['name'])
    words = {'item', 'items'}
    if cfg.get('noun'):
        one, _, many = cfg['noun'].partition(':')
        words |= {one, many or one + 's'}
    nouns = sorted(words, key=len, reverse=True)

    def norm(line):
        t = line.strip()
        if not t or t.startswith(('//', '*', '/*')):
            return None
        for n in sorted(set(names), key=len, reverse=True):
            t = re.sub(rf'(?<![\w-]){re.escape(n)}(?![\w-])', 'MOD', t)
        for w in nouns:
            t = re.sub(rf'\b{re.escape(w)}\b', 'NOUN', t, flags=re.I)
        return re.sub(r'\s+', ' ', t)

    data_files = DATA_SOURCE_FILES.get(cfg.get('kind'), ('source.ts',))
    data = [0]

    real = os.path.join(cfg['devMods'], cfg['mod']) if cfg.get('devMods') else None
    built = bool(real and os.path.isdir(os.path.join(real, 'hooks')))  # after build the real mod is measured, not the prototype

    def lines_of(root, count=False, template=False):
        """The framework lines of hooks/. A data-source file (DATA_SOURCE_FILES) and a line that ends in a `// @source` comment
        (an observer wiring line) are the person's code: they are not framework lines. count=True adds them to data[0].
        template=True reads the template the way build turns it into the real mod (no proto lines, each @real line is code)."""
        import mods_domain
        res = []
        for f in _norm_files(os.path.join(root, 'hooks')):
            is_data = os.path.basename(f) in data_files
            with open(f, encoding='utf-8', errors='replace') as fh:
                text = fh.read()
            if template and built:
                text = mods_domain.strip(text, drop=('proto',), real=True, picked=cfg.get('picked') or 'C')
            for ln in text.split('\n'):
                n = norm(ln)
                if not n:
                    continue
                if is_data or re.search(r'//\s*@source\b', ln):
                    data[0] += count
                else:
                    res.append(n)
        return res

    mine = lines_of(real if built else src_dir(ctx), count=True)
    theirs = {hashlib.sha256(x.encode()).hexdigest() for x in lines_of(tpl_dir, template=True)}
    from_tpl = sum(1 for x in mine if hashlib.sha256(x.encode()).hexdigest() in theirs)
    return {'lines': len(mine), 'fromTemplate': from_tpl, 'new': len(mine) - from_tpl, 'dataSource': data[0], 'dataFiles': list(data_files)}


def _find_session(ident):
    if ident.endswith('.jsonl') or os.sep in ident:
        p = os.path.abspath(os.path.expanduser(ident))
        if os.path.isfile(p):
            return p
        raise Fail(f'session file not found: {p}', 'none', 2)
    hits = glob.glob(os.path.join(config_dir(), 'projects', '*', ident + '.jsonl'))
    if not hits:
        raise Fail(f'no session {ident}.jsonl under {os.path.join(config_dir(), "projects")}', 'none', 2)
    return hits[0]


HAND = re.compile(r'\bsed\s+-i|\bcp\s+-R|send-keys|shot\.mjs')
DRIVER = re.compile(r'\bmods\.py\b')


def _measure(path):
    """Measure one transcript. Count usage once per message id (a message is split over several lines)."""
    mx = {k: {} for k in ('output_tokens', 'input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')}
    raw = {'output_tokens': 0, 'cache_read_input_tokens': 0}
    tools, blocks, driver, hand, examples, stamps = set(), 0, set(), set(), [], []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            ts = rec.get('timestamp')
            if isinstance(ts, str):
                with contextlib.suppress(ValueError):
                    stamps.append(datetime.datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp())
            msg = rec.get('message')
            if not isinstance(msg, dict):
                continue
            if rec.get('type') == 'assistant' or msg.get('role') == 'assistant':
                content = msg.get('content')
                for b in content if isinstance(content, list) else []:
                    if not (isinstance(b, dict) and b.get('type') == 'tool_use'):
                        continue
                    blocks += 1
                    inp = b.get('input') if isinstance(b.get('input'), dict) else {}
                    bid = b.get('id') or (msg.get('id'), b.get('name'), json.dumps(inp, sort_keys=True))
                    tools.add(bid)
                    cmd = inp.get('command', '') if isinstance(inp.get('command', ''), str) else ''
                    if b.get('name') == 'Bash' and DRIVER.search(cmd):
                        driver.add(bid)
                    elif b.get('name') == 'Bash' and HAND.search(cmd):
                        hand.add(bid)
                        if len(examples) < 5:
                            examples.append(cmd[:120])
                    elif b.get('name') in ('Write', 'Edit') and str(inp.get('file_path', '')).endswith('shot.mjs'):
                        hand.add(bid)
                        if len(examples) < 5:
                            examples.append(f"{b.get('name')} {inp.get('file_path')}"[:120])
            usage = msg.get('usage')
            if not isinstance(usage, dict):
                continue
            mid = msg.get('id') or rec.get('uuid')
            for k in mx:
                v = int(usage.get(k) or 0)
                mx[k][mid] = max(mx[k].get(mid, 0), v)
            raw['output_tokens'] += int(usage.get('output_tokens') or 0)
            raw['cache_read_input_tokens'] += int(usage.get('cache_read_input_tokens') or 0)
    return {
        'output_tokens_per_message': sum(mx['output_tokens'].values()),
        'input_tokens_per_message': sum(mx['input_tokens'].values()),
        'cache_reads_per_message': sum(mx['cache_read_input_tokens'].values()),
        'cache_creation_per_message': sum(mx['cache_creation_input_tokens'].values()),
        'output_tokens_raw': raw['output_tokens'], 'cache_reads_raw': raw['cache_read_input_tokens'],
        'tool_calls': len(tools), 'tool_calls_raw_blocks': blocks, 'messages_distinct': len(mx['output_tokens']),
        'minutes': round((max(stamps) - min(stamps)) / 60.0, 2) if stamps else 0.0,
        'driver_calls': len(driver), 'hand_calls': len(hand), 'hand_examples': examples,
    }, stamps


def _session_part(ctx, ident):
    path = _find_session(ident)
    main, stamps = _measure(path)
    subs = []
    sid = os.path.splitext(os.path.basename(path))[0]
    for f in sorted(glob.glob(os.path.join(os.path.dirname(path), sid, 'subagents', '**', 'agent-*.jsonl'), recursive=True)):
        m, st = _measure(f)
        stamps += st
        m.update({'agentId': os.path.basename(f)[len('agent-'):-len('.jsonl')], 'file': f})
        subs.append(m)
    mins = round((max(stamps) - min(stamps)) / 60.0, 2) if stamps else 0.0
    total = {
        'output_tokens_per_message': main['output_tokens_per_message'] + sum(s['output_tokens_per_message'] for s in subs),
        'tool_calls': main['tool_calls'] + sum(s['tool_calls'] for s in subs),
        'driver_calls': main['driver_calls'] + sum(s['driver_calls'] for s in subs),
        'hand_calls': main['hand_calls'] + sum(s['hand_calls'] for s in subs),
        'minutes': mins,
    }
    doc = {'session': sid, 'file': path, 'generatedAt': now_iso(), 'main': main, 'subagents': subs, 'total': total}
    out = os.path.join(ctx.wb, 'metrics.json')
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
    with open(out, encoding='utf-8') as fh:  # read back
        if json.load(fh) != json.loads(json.dumps(doc)):
            raise Fail('metrics.json read-back differs from what was written')
    return doc


def cmd_evidence(ctx, args):
    wb = ctx.wb
    secs = read_runs(wb)
    parts, ok, facts = [], True, {}
    explicit = args.gate or args.lines or args.session
    if not explicit:
        for s in secs:
            print(f"{s['ts']} {s['cmd']} {s['result']} {s['summary']}")
        last = {}
        for s in secs:
            last[s['cmd']] = s
        bad = [c for c, s in last.items() if s['result'] != 'PASS']
        n_pass = sum(1 for s in secs if s['result'] == 'PASS')
        facts.update({'steps': len(secs), 'pass': n_pass, 'failing': bad})
        if not secs:
            return Done(False, 'RUN.md has no steps yet', 'run a subcommand first, for example mods.py -C <wb> check', facts)
        parts.append(f'RUN.md {len(secs)} steps, {n_pass} pass')
        ok = not bad
        nxt = f'mods.py -C {wb} {bad[0]}' if bad else f'mods.py -C {wb} evidence --gate'
        return Done(ok, parts[0], nxt, facts)
    if args.gate:
        c, rows = _gate_part(wb, secs, ctx.cfg.get('kind'), ctx.cfg)
        parts.append(f"gate {c['pass']} pass, {c['manual']} manual, {c['fail']} fail" + (f", {c['na']} n/a" if c['na'] else ''))
        facts['gate'] = {'pass': c['pass'], 'manual': c['manual'], 'fail': c['fail'], 'na': c['na'],
                         'rows': [{'n': n, 'verdict': v, **({'reason': d} if v == 'N/A' else {})} for n, _, v, d in rows]}
        ok = ok and c['fail'] == 0
        for n, name, v, detail in rows:
            if v == 'MANUAL':
                print(f'manual {n}: {detail}')
    if args.lines:
        ln = _lines_part(ctx)
        parts.append(f"lines {ln['lines']} · {ln['fromTemplate']} from the template · {ln['new']} new · {ln['dataSource']} data source, not counted ({', '.join(ln['dataFiles']) or 'none'})")
        facts['lines'] = ln
    if args.session:
        doc = _session_part(ctx, args.session)
        t, m = doc['total'], doc['main']
        parts.append(f"metrics.json · {round(t['output_tokens_per_message'] / 1000)}k output · {t['tool_calls']} tool calls · "
                     f"{t['driver_calls']} driver calls · {t['hand_calls']} hand calls · {t['minutes']} min")
        facts['metrics'] = {'main_messages_distinct': m['messages_distinct'], **t}
    nxt = 'none' if ok else (f'mods.py -C {wb} done' if args.gate else 'none')
    return Done(ok, ' · '.join(parts), nxt, facts)


# ---------------------------------------------------------------- done


def cmd_done(ctx, args):
    cleaned = run_sub(ctx, 'clean', all=False, installs=False)
    print()
    gate = run_sub(ctx, 'evidence', gate=True, lines=False, session=None)
    secs = read_runs(ctx.wb)
    mod = ctx.cfg['mod']
    # Only the exact own sessions count (mx-<mod>-<V>, sb-<mod>-<n>, lv-<mod>-<n>). A session of another tool,
    # or of a sibling mod whose name starts with this one, is not ours (round 2, design 5a).
    pats = [f"{ctx.cfg['prefixes'][k]}{tail}" for k, tail in (('mockups', '<V>'), ('crawl', '<n>'), ('live', '<n>')) if ctx.cfg['prefixes'].get(k)]
    hits = own_sessions(ctx.cfg)
    v = versions()
    g = (gate.facts or {}).get('gate', {})
    print('\n---- paste-ready evidence block ----')
    print(f'## evidence for {mod} ({now_iso()})')
    print('- versions: ' + _versions_line(v))
    # Each step shows its newest PASS, else its newest section. A step with FAIL sections says how many (SB, FN).
    newest, fails = {}, {}
    for s in secs:
        if s['result'] == 'FAIL':
            fails[s['cmd']] = fails.get(s['cmd'], 0) + 1
        if s['result'] == 'PASS' or newest.get(s['cmd'], {}).get('result') != 'PASS':
            newest[s['cmd']] = s
    for c, s in sorted(newest.items(), key=lambda kv: kv[1]['idx']):
        print(f"- {c}: {s['result']} {s['summary']}" + (f" (and {fails[c]} FAIL in RUN.md)" if fails.get(c) else ''))
    print('- gate:')
    for r in g.get('rows', []):
        print(f"  - {r['n']} {dict(GATE_ITEMS)[r['n']]}: {r['verdict']}" + (f" ({r['reason']})" if r.get('reason') else ''))
    print(f"- own tmux sessions ({', '.join(pats)}): " + ('\n  ' + '\n  '.join(hits) if hits else 'none'))
    print('---- end of block ----')
    facts = {'clean': cleaned.ok, 'gate': g}
    if not cleaned.ok:
        raise Fail('cleanup failed: ' + cleaned.summary, f'mods.py -C {ctx.wb} clean', 1, facts)
    summary = f"{gate.summary} · cleanup ok"
    if hits:
        return Done(False, f"{summary} · {len(hits)} own tmux sessions still run: {', '.join(hits)}", f'mods.py -C {ctx.wb} clean', facts)
    return Done(gate.ok, summary, 'none' if gate.ok else f'mods.py -C {ctx.wb} evidence --gate', facts)


LOCAL = {
    'doctor': cmd_doctor, 'clean': cmd_clean, 'note': cmd_note, 'kit-sync': cmd_kit_sync,
    'lint-skill': cmd_lint_skill, 'evidence': cmd_evidence, 'done': cmd_done,
}


def resolve_handler(cmd):
    """Return (handler, None), or (None, why) when the group module or its function is missing."""
    if cmd in LOCAL:
        return LOCAL[cmd], None
    mod = GROUP_OF[cmd]
    fn = 'cmd_' + cmd.replace('-', '_')
    try:
        m = importlib.import_module(mod)
    except ModuleNotFoundError as e:
        if e.name == mod:
            return None, f'{mod}.py is not in scripts/'
        raise
    h = getattr(m, fn, None)
    return (h, None) if h else (None, f'{mod}.py has no {fn}')


# ---------------------------------------------------------------- command line


class Parser(argparse.ArgumentParser):
    def __init__(self, *a, cmdname='mods.py', **kw):
        super().__init__(*a, **kw)
        self.cmdname = cmdname

    def error(self, message):
        sys.stderr.write(self.format_usage())
        c = self.cmdname
        print(f'{c}: FAIL usage: {message}')
        print('next: mods.py ' + ('--help' if c == 'mods.py' else f'{c} --help'))
        sys.exit(0 if _BRIEF_DOCTOR else 2)


def _csv_ints(text):
    try:
        return [int(x) for x in text.split(',') if x.strip()]
    except ValueError:
        raise argparse.ArgumentTypeError(f'"{text}" is not a list of integers like 150,100,60')


def _domain_flags(sp):
    """The domain flags of 'new' and 'domain' (design 1.3). A flag that is left out stays None: the kind default, or the old value."""
    sp.add_argument('--fields', metavar="'name:type,...'", help='row fields; type: text|slug|path|name|age|number|enum(a|b)|enum(a=ok|b=err)')
    sp.add_argument('--title-field', dest='title_field', metavar='NAME')
    sp.add_argument('--detail-fields', dest='detail_fields', metavar="'NAME,NAME'")
    sp.add_argument('--actions', metavar="'k:verb,...'")
    sp.add_argument('--scenarios', metavar="'name[:role],...'")
    sp.add_argument('--count', type=int, metavar='N')
    sp.add_argument('--overflow', type=int, metavar='N')
    sp.add_argument('--world', metavar="'name:type,...'")
    sp.add_argument('--band', metavar="'lead=NAME,counts=NAME,idle=yield|show'")
    sp.add_argument('--say', metavar='TEXT', help='{field}, or {numberField|one|many}: the number, then the word (3 tool calls)')
    sp.add_argument('--on', metavar='EVENT', help='turn.complete | tool.call | prompt.submit')
    sp.add_argument('--parts', metavar="'toast,command,guard'")
    sp.add_argument('--keep', type=int, metavar='N')
    sp.add_argument('--probe', metavar="'rm -rf {dir}'")
    sp.add_argument('--text', action='append', metavar='KEY=VALUE', help='a text override (repeat it)')


def build_parser():
    p = Parser(prog='mods.py', description='The one entry point of the mod-forge driver.')
    p.add_argument('-C', '--workbench', metavar='WB', default=None, help='a folder that holds mod.json, or a mod.json file')
    sub = p.add_subparsers(dest='cmd', required=True, parser_class=Parser, metavar='<subcommand>')

    def add(name, help_, positional=()):
        sp = sub.add_parser(name, cmdname=name, help=help_, description=help_)
        sp.add_argument('-C', '--workbench', metavar='WB', default=argparse.SUPPRESS, help=argparse.SUPPRESS)
        for pos in positional:
            sp.add_argument(pos[0], **pos[1])
        return sp

    s = add('doctor', 'check the tools and the types file', [
        ('mod', {'nargs': '?', 'help': 'optional: the mod name for the next: line'}),
        ('kind', {'nargs': '?', 'help': 'optional: the mod kind for the next: line (an unknown kind gives a note)'}),
        ('extra', {'nargs': '*', 'help': 'ignored free text'})])
    s.add_argument('--brief', action='store_true', help='at most 12 lines, and the exit code is always 0')
    s.add_argument('--json', action='store_true')
    s.add_argument('--upgrade', action='store_true')
    s.add_argument('--pa', metavar='DIR')
    s.add_argument('--types', metavar='FILE')
    s.add_argument('--trusted', metavar='DIR', help='trusted folder for the --upgrade smoke test (default: the current folder)')

    s = add('new', 'make a workbench', [('mod', {})])
    s.add_argument('--kind', required=True, choices=KINDS)
    s.add_argument('--trusted', required=True, metavar='DIR')
    s.add_argument('--scratch', default='./.mods', metavar='DIR')
    s.add_argument('--noun', metavar='STR')
    s.add_argument('--author', metavar='STR')
    s.add_argument('--dev-mods', dest='dev_mods', metavar='DIR')
    s.add_argument('--sizes', default='150,100,60', metavar='CSV')
    s.add_argument('--rows', type=int, default=45)
    s.add_argument('--pa', metavar='DIR', help='the plugin-authoring base folder of this session (its types/claude-code.d.ts wins over the discovery)')
    _domain_flags(s)

    s = add('domain', 'write the domain files from the domain block of mod.json')
    s.add_argument('--noun', metavar='STR')
    s.add_argument('--check', action='store_true', help='write nothing: compare the generated files with the disk')
    _domain_flags(s)

    s = add('check', 'validate, test and type-check the plugin')
    s.add_argument('--what', default='validate,test,tsc', metavar='CSV')
    s.add_argument('--real', action='store_true')

    s = add('mockups', 'capture the design variants')
    s.add_argument('--variants', metavar='CSV')
    s.add_argument('--modes', metavar='CSV')
    s.add_argument('--sizes', metavar='CSV')
    s.add_argument('--kill', action='store_true')
    s.add_argument('--no-score', dest='no_score', action='store_true')
    s.add_argument('--no-extras', dest='no_extras', action='store_true')

    s = add('score', 'mechanical pre-score of a mockups pass')
    s.add_argument('--pass', dest='pass_n', type=int, metavar='INT')
    s.add_argument('--json', action='store_true')

    s = add('pick', 'record the picked variant', [('variant', {})])
    s.add_argument('--by', choices=('person', 'headless'), default='person')

    s = add('journey', 'build the journey, a skeleton or the marker tests',
            [('action', {'nargs': '?', 'choices': ('build', 'skeleton', 'markers'), 'default': 'build'})])
    s.add_argument('--out', metavar='FILE')

    s = add('crawl', 'crawl the journey with real sessions')
    s.add_argument('--only', metavar='CSV')
    s.add_argument('--phase', choices=('all', 'nodes', 'edges'), default='all')
    s.add_argument('--sessions', type=int, metavar='INT')
    s.add_argument('--no-render', dest='no_render', action='store_true')

    s = add('storyboard', 'build the storyboard player')
    s.add_argument('--draft', action='store_true')
    s.add_argument('--colors', type=int, metavar='INT')
    s.add_argument('--node', metavar='ID')

    s = add('approve', 'record the storyboard approval')
    s.add_argument('--by', choices=('person', 'headless'), required=True)

    s = add('live', 'run the plugin in one real session')
    s.add_argument('--cmd', dest='live_cmd', metavar='STR')  # dest 'cmd' is the subcommand name
    s.add_argument('--marker', metavar='STR')
    s.add_argument('--cols', type=_csv_ints, default=[150], metavar='N[,N...]', help='one session per width: 150 or 150,100,60')
    s.add_argument('--rows', type=int, default=40)
    s.add_argument('--keys', metavar='STR', help='keys sent AFTER --marker shows (the marker is the screen before the keys)')
    s.add_argument('--after', metavar='STR', help='text that must show in the pane rows or band rows, never the transcript, after the keys (waits up to 10 s, or the turn wait with --turn): the proof of a key path')
    s.add_argument('--nocolor', action='store_true')
    s.add_argument('--debug', action='store_true')
    s.add_argument('--keep', action='store_true')
    s.add_argument('--real', action='store_true')
    s.add_argument('--env', action='append', metavar='NAME=VALUE', help='an env var for claude and the processes of the mod (repeat it)')
    s.add_argument('--turn', action='store_true', help='with --real: send one real model prompt and wait for the marker (the first model turn costs tokens)')
    s.add_argument('--prompt', metavar='TEXT', help='the prompt of --turn (default: Reply with the word ok and stop.)')
    s.add_argument('--probe', action='store_true', help='with --turn: the guard proof; <wb>/logs/guard-probe/ must still exist after the turn')
    s.add_argument('--git-repo', dest='git_repo', action='store_true', help='pass a fixed scratch git repo (<wb>/logs/git-repo) to the session by GIT_DIR and GIT_WORK_TREE. Branch merged-demo is merged into main (git branch -d works); the 40 other branches, for example feat/login-1, are not merged (git branch -d refuses)')

    s = add('build','copy the approved prototype to dev-mods')
    s.add_argument('--dev-mods', dest='dev_mods', metavar='DIR')

    s = add('audit-existing', 'audit an existing mod', [('folder', {})])
    s.add_argument('--marker', required=True, metavar='STR')
    s.add_argument('--cmd', dest='cmd_text', metavar='STR')
    s.add_argument('--scratch', default='./.mods', metavar='DIR')
    s.add_argument('--trusted', default=os.getcwd(), metavar='DIR')

    s = add('upgrade-check', 'compare the binary and the types file')
    s.add_argument('--types', metavar='FILE')
    s.add_argument('--pa', metavar='DIR')

    s = add('note', 'record a workaround')
    s.add_argument('--workaround', required=True, metavar='STR')

    s = add('clean', 'stop own sessions and remove run files')
    s.add_argument('--all', action='store_true')
    s.add_argument('--installs', action='store_true')

    s = add('evidence', 'read RUN.md, the gate, line counts and session metrics')
    s.add_argument('--gate', action='store_true')
    s.add_argument('--lines', action='store_true')
    s.add_argument('--session', metavar='ID|PATH')

    add('done', 'clean, then the gate, then the evidence block')
    s = add('kit-sync', 'copy templates/kit into the mod')
    s.add_argument('--templates', action='store_true', help='copy the kit and the kit tests into the skill templates (no workbench)')
    add('lint-skill', 'lint a skill folder', [('skill_dir', {'nargs': '?', 'default': None})])

    s = add('selfcheck', 'test the toolchain on a throw-away workbench')
    s.add_argument('--quick', action='store_true')
    s.add_argument('--live', action='store_true')
    s.add_argument('--keep', action='store_true')
    s.add_argument('--trusted', required=True, metavar='DIR')
    return p


def finish(cmd, ok, summary, nxt, to_stderr=False):
    out = sys.stderr if to_stderr else sys.stdout
    out.write(f"{cmd}: {'PASS' if ok else 'FAIL'} {one_line(summary)}\n")
    out.write(f"next: {one_line(nxt) if nxt else 'none'}\n")
    out.flush()


def main(argv=None):
    global _BRIEF_DOCTOR
    argv = sys.argv[1:] if argv is None else list(argv)
    _BRIEF_DOCTOR = 'doctor' in argv and '--brief' in argv
    args, rest = build_parser().parse_known_args(argv)
    brief = args.cmd == 'doctor' and bool(getattr(args, 'brief', False))
    if rest and not brief:
        build_parser().error('unrecognized arguments: ' + ' '.join(rest))
    _BRIEF_DOCTOR = brief
    args.ignored = rest
    if hasattr(args, 'pass_n'):
        setattr(args, 'pass', args.pass_n)  # the DD name of the option
    cmd = args.cmd
    to_err = bool(getattr(args, 'json', False)) and cmd in ('doctor', 'score')  # --json: stdout holds only the JSON
    handler, why = resolve_handler(cmd)
    if handler is None:
        finish(cmd, False, f'group module missing ({why})', 'none', to_err)
        return 2
    ctx = Ctx(cmd, args)
    wb_opt = getattr(args, 'workbench', None)
    try:
        if cmd == 'kit-sync' and getattr(args, 'templates', False):
            path = None  # the skill's own templates: no workbench
        elif cmd in NEEDS_WB or (cmd in OPTIONAL_WB and wb_opt):
            path = find_workbench(wb_opt)
        elif cmd in OPTIONAL_WB:
            try:
                path = find_workbench(None)
            except Fail:
                path = None
        else:
            path = None
        if path:
            ctx.wb = os.path.dirname(path)
            ctx.cfg = load_cfg(path)
            print(f'using {path}', file=sys.stderr if to_err else sys.stdout)
    except Fail as e:
        finish(cmd, False, e.summary, e.next, to_err)
        return e.rc
    ctx.record = cmd not in NO_RECORD
    res, rc = execute(ctx, handler)
    finish(cmd, res.ok, res.summary, res.next, to_err)
    return 0 if brief else rc


if __name__ == '__main__':
    sys.exit(main())
