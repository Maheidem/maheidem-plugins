#!/usr/bin/env python3 -I
"""Measure one Claude Code session transcript (JSONL).

usage: metrics.py <session.jsonl> [--until <ISO time>] [--json out]

A message is split over several lines with the same message.id. Each line
repeats the usage of the message. So the script takes the max per message.id
and sums those maxima. The raw sum (every line added) is printed too, to show
the difference. Stdlib only.
"""
import argparse
import datetime
import json
import sys


def parse_time(text):
    """ISO time to epoch seconds. A time without a zone is UTC."""
    d = datetime.datetime.fromisoformat(text.strip().replace('Z', '+00:00'))
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.timestamp()


def iso(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def measure(path, until=None):
    """Count one transcript. until = epoch seconds: lines after it are skipped."""
    out_max, cache_max, raw_out, raw_cache = {}, {}, 0, 0
    tools, by_name, stamps = set(), {}, []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if not isinstance(rec, dict):
                continue
            ts = rec.get('timestamp')
            if isinstance(ts, str):
                try:
                    t = parse_time(ts)
                except ValueError:
                    t = None
                if t is not None:
                    if until is not None and t > until:
                        continue
                    stamps.append(t)
            msg = rec.get('message')
            if not isinstance(msg, dict):
                continue
            if rec.get('type') != 'assistant' and msg.get('role') != 'assistant':
                continue
            content = msg.get('content')
            for b in content if isinstance(content, list) else []:
                if isinstance(b, dict) and b.get('type') == 'tool_use':
                    key = b.get('id') or (msg.get('id'), b.get('name'), json.dumps(b.get('input'), sort_keys=True))
                    if key not in tools:
                        tools.add(key)
                        by_name[b.get('name') or '?'] = by_name.get(b.get('name') or '?', 0) + 1
            usage = msg.get('usage')
            if isinstance(usage, dict):
                mid = msg.get('id') or rec.get('uuid')
                o, c = int(usage.get('output_tokens') or 0), int(usage.get('cache_read_input_tokens') or 0)
                out_max[mid] = max(out_max.get(mid, 0), o)
                cache_max[mid] = max(cache_max.get(mid, 0), c)
                raw_out += o
                raw_cache += c
    return {
        'output_tokens': sum(out_max.values()),
        'output_tokens_raw': raw_out,
        'cache_reads': sum(cache_max.values()),
        'cache_reads_raw': raw_cache,
        'messages': len(out_max),
        'tool_calls': len(tools),
        'tool_calls_by_name': dict(sorted(by_name.items(), key=lambda kv: (-kv[1], kv[0]))),
        'minutes': round((max(stamps) - min(stamps)) / 60.0, 2) if stamps else 0.0,
        'first': iso(min(stamps)) if stamps else None,
        'last': iso(max(stamps)) if stamps else None,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(prog='metrics.py', description='Measure a Claude Code session transcript.')
    ap.add_argument('session', help='session .jsonl file')
    ap.add_argument('--until', metavar='ISO', help='also count only the lines up to this time')
    ap.add_argument('--json', metavar='OUT', help='also write the result to this file')
    a = ap.parse_args(argv)
    try:
        until = parse_time(a.until) if a.until else None
    except ValueError:
        print(f'metrics.py: bad --until time: {a.until}', file=sys.stderr)
        return 2
    try:
        doc = measure(a.session)
        if until is not None:
            doc['until'] = {'time': iso(until), **measure(a.session, until)}
    except OSError as e:
        print(f'metrics.py: {e}', file=sys.stderr)
        return 2
    text = json.dumps(doc, indent=2, ensure_ascii=False)
    print(text)
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
        with open(a.json, encoding='utf-8') as fh:  # read back
            if json.load(fh) != json.loads(text):
                print('metrics.py: read-back of the --json file differs', file=sys.stderr)
                return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
