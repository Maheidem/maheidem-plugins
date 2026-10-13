#!/usr/bin/env python3
"""capture-matrix.py: capture every mockup of the design pass live: variants x modes x sizes,
plus extra screens after keys, with a PNG, a ring check and a contact sheet.

Usage:
  python3 -I capture-matrix.py <out-dir> [options]

  out-dir         gets <V>-<mode>-<cols>.{ansi,txt,png}, matrix.json and index.html.
                  Use a new folder per pass (old files are overwritten, never deleted).
Options:
  --mod-dir DIR   a COPY of the prototype mod. The script starts one tmux session per
                  variant (<prefix><V>) through live-test.sh with NODEBUG=1 and KEEP=1.
                  Without it, the sessions must already run.
  --ready TEXT    with --mod-dir: text the first mode's screen shows (live-test marker)
  --trusted DIR   a folder Claude Code trusts (default: cwd)
  --mod NAME      the plugin name for {mod} (default: from --mod-dir)
  --command T     default "/{mod} {variant} {mode}"
  --variants A,B,C,D   --modes normal,empty,loading,error,overflow   --sizes 150,100,60
  --rows N        terminal rows, default 45
  --prefix P      session name prefix, default "proto-"
  --extra NAME=MODE:KEYS   repeatable. After the command for MODE, press KEYS (edge key
                  syntax: 'Down*5', 'Enter', 'd', 'text:"Buy milk" Enter') and capture
                  <V>-NAME-<first size>. Example: --extra scrolled=overflow:Down*5
  --pointer V=GLYPH   repeatable: the pointer of variant V for the ring check (default ❯)
  --focus NAME=TEXT   repeatable: on capture NAME (an extra or a mode) the ring must hold TEXT
  --band SUFFIX=MARKER   also capture each mode with the band only: the command gets SUFFIX at the
                  end (for example "closed"), and the capture is <V>-band-<mode>-<cols>. It waits for
                  the --ready text, not for a pane: a band draws no pane. MARKER is the band text the
                  score looks for (for example "ctrl+x tab to"). A scenario with no band is no failure.
  --title T       contact sheet title
  --kill          kill the sessions at the end (default: leave each at the first mode and
                  the first size, for `tmux attach -t <prefix><V>`)

Each capture: resize, close the pane (one Esc at a time, only while it is open), /clear,
run the command, wait for the pane, press the extra keys, capture with SGR. Run the command
AFTER the resize: a docked pane that moves inline on a resize loses its focus ring.
Exit 0 when every capture drew a pane and no ring check gave MISMATCH.
"""
import argparse
import concurrent.futures as cf
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # no __pycache__ in the skill folder (journey_lib is imported below)
import journey_lib as jl  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def pairs(items, sep):
    out = {}
    for it in items or []:
        k, _, v = it.partition(sep)
        out[k] = v
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out')
    ap.add_argument('--mod-dir')
    ap.add_argument('--ready')
    ap.add_argument('--trusted', default=os.getcwd())
    ap.add_argument('--mod')
    ap.add_argument('--command', default='/{mod} {variant} {mode}')
    ap.add_argument('--variants', default='A,B,C,D')
    ap.add_argument('--modes', default='normal,empty,loading,error,overflow')
    ap.add_argument('--sizes', default='150,100,60')
    ap.add_argument('--rows', type=int, default=45)
    ap.add_argument('--prefix', default='proto-')
    ap.add_argument('--extra', action='append')
    ap.add_argument('--pointer', action='append')
    ap.add_argument('--focus', action='append')
    ap.add_argument('--band')
    ap.add_argument('--title')
    ap.add_argument('--kill', action='store_true')
    a = ap.parse_args()

    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    variants, modes = a.variants.split(','), a.modes.split(',')
    sizes = [int(x) for x in a.sizes.split(',')]
    extras = []
    for name, spec in pairs(a.extra, '=').items():
        mode, _, keys = spec.partition(':')
        extras.append((name, mode, keys))
    pointers, focus = pairs(a.pointer, '='), pairs(a.focus, '=')
    band_suffix, _, band_marker = (a.band or '').partition('=')
    if a.band and (not band_suffix or not band_marker or not a.ready):
        print('FAIL: --band wants SUFFIX=MARKER, and --ready')
        return 1
    mod = a.mod or (jl.load(os.path.join(a.mod_dir, '.claude-plugin', 'plugin.json'))['name'] if a.mod_dir else None)
    if not mod:
        print('FAIL: give --mod-dir or --mod')
        return 1
    cmd = lambda v, m: a.command.format(mod=mod, variant=v, mode=m)  # noqa: E731
    sess = {v: f'{a.prefix}{v}' for v in variants}

    if a.mod_dir:
        if not a.ready:
            print('FAIL: --mod-dir needs --ready <text the first screen shows>')
            return 1

        def start(v):
            env = dict(os.environ, SESSION=sess[v], ROWS=str(a.rows), KEEP='1', NODEBUG='1')
            p = subprocess.run([os.path.join(HERE, 'live-test.sh'), os.path.abspath(a.mod_dir), cmd(v, modes[0]),
                                a.ready, str(sizes[0]), a.trusted], env=env, capture_output=True, text=True)
            return v, p.returncode, p.stdout + p.stderr
        with cf.ThreadPoolExecutor(len(variants)) as ex:
            for v, rc, text in ex.map(start, variants):
                if rc != 0:
                    print(f'FAIL: session {sess[v]} live-test.sh failed:\n{text}')
                    return 1
                print(f'started {sess[v]}')
    for v in variants:
        if subprocess.run(['tmux', 'has-session', '-t', f'={sess[v]}'], capture_output=True).returncode != 0:
            print(f'FAIL: no tmux session {sess[v]} (start it, or pass --mod-dir)')
            return 1

    def capture(v, name, mode, keys, cols, band=False):
        s = sess[v]
        rec = {'file': f'{v}-{name}-{cols}', 'variant': v, 'mode': mode, 'keys': keys, 'cols': cols}
        jl.close_pane(s)
        jl.type_command(s, '/clear')
        time.sleep(2.5)
        jl.type_command(s, cmd(v, mode) + (' ' + band_suffix if band else ''))
        drawn = (lambda t: a.ready in t) if band else jl.pane_open  # a band draws no pane: wait for the reply
        end = time.time() + 10
        while time.time() < end and not drawn(jl.tmux('capture-pane', '-p', '-t', s)):
            time.sleep(0.3)
        time.sleep(1.5)
        if keys:
            jl.send_keys(s, keys, mod)
            time.sleep(1.5)
        ansi = jl.tmux('capture-pane', '-p', '-e', '-t', s)
        txt = jl.tmux('capture-pane', '-p', '-t', s)
        base = os.path.join(out, rec['file'])
        open(base + '.ansi', 'w', encoding='utf-8').write(ansi)
        open(base + '.txt', 'w', encoding='utf-8').write(txt)
        rec['pane'] = drawn(txt)
        if band:
            rec['band'] = band_marker  # the score finds the band row by this text
        args = ['python3', '-I', '-B', os.path.join(HERE, 'ring-check.py'), base + '.ansi', '--pointer', pointers.get(v, '❯')]
        if name in focus:
            args += ['--focus', focus[name]]
        p = subprocess.run(args, capture_output=True, text=True)
        rec['ring'] = {0: 'OK', 1: 'MISMATCH'}.get(p.returncode, 'n/a')
        rec['ringLine'] = p.stdout.strip().split('\n')[-1]
        r = subprocess.run([os.path.join(HERE, 'render.sh'), base + '.ansi', base + '.png', rec['file'], str(cols)],
                           capture_output=True, text=True)
        rec['png'] = r.returncode == 0
        print(f"{rec['file']}: pane {'yes' if rec['pane'] else 'NO'} · ring {rec['ring']} · {rec['ringLine']}", flush=True)
        return rec

    def run_variant(v):
        s, recs = sess[v], []
        for cols in sizes:
            jl.tmux('resize-window', '-t', s, '-x', str(cols), '-y', str(a.rows))
            time.sleep(2)
            for m in modes:
                recs.append(capture(v, m, m, None, cols))
                if a.band:
                    recs.append(capture(v, f'band-{m}', m, None, cols, band=True))
            if cols == sizes[0]:
                for name, m, keys in extras:
                    recs.append(capture(v, name, m, keys, cols))
        jl.tmux('resize-window', '-t', s, '-x', str(sizes[0]), '-y', str(a.rows))
        time.sleep(2)
        jl.close_pane(s)
        jl.type_command(s, '/clear')
        time.sleep(2.5)
        jl.type_command(s, cmd(v, modes[0]))
        return recs

    t0 = time.time()
    try:
        with cf.ThreadPoolExecutor(len(variants)) as ex:
            recs = [r for part in ex.map(run_variant, variants) for r in part]
    finally:
        if a.kill:
            for v in variants:
                jl.tmux('kill-session', '-t', f'={sess[v]}')
    bad = [r['file'] for r in recs if not r['pane'] or r['ring'] == 'MISMATCH' or not r['png']]
    json.dump({'command': a.command, 'mod': mod, 'rows': a.rows, 'captures': recs}, open(os.path.join(out, 'matrix.json'), 'w'), indent=1, ensure_ascii=False)
    note = ('Live: ' + ', '.join(f'tmux attach -t {sess[v]}' for v in variants) + f'. Switch: {cmd("<V>", "<mode>")}.') if not a.kill else ''
    subprocess.run(['python3', '-I', '-B', os.path.join(HERE, 'contact-sheet.py'), out, a.title or f'{mod}: {len(variants)} variants x {len(modes)} modes x {len(sizes)} sizes', note])
    ring = {k: sum(r['ring'] == k for r in recs) for k in ('OK', 'MISMATCH', 'n/a')}
    print(f'DONE {len(recs)} captures in {time.time() - t0:.0f} s · ring {ring} · failed {bad or "none"}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
