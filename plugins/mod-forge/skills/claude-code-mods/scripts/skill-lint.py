#!/usr/bin/env python3 -I
"""skill-lint: check one skill folder against the neutral-text rules.

Usage: skill-lint.py <skill dir> [--pa <dir>] [--require-pa] [--json] [--budgets <file>]

Output: one finding per line, '<file>:<line>: <rule> <severity>: <message>'.
Last line: 'skill-lint: <n> fail, <m> warn'.
Exit: 0 no failure, 1 failure, 2 usage error, 3 --require-pa and no PA folder.

Rules (the numbers match the skill rules):
  L1 names          no tool or project names (list in NAMES below)
  L2 scratch paths  no scratch or research paths
  L3 personal paths no home-folder paths
  L4 budgets        line budgets and the description length
  L5 evidence       [ev:N] tags match '## ev:N' entries in references/evidence.md
  L6 PA duplicates  no 12-word run copied from the PA reference.md, no banned phrase
  L7 cites resolve  [PA:..], [D:..] and file names in SKILL.md exist
  L8 frontmatter    name, description, argument-hint, allowed-tools
  L9 style (warn)   long sentences and filler words

Files 'scripts/skill-lint.allow', 'scripts/skill-lint.phrases' and
'scripts/skill-lint.budgets' hold the data. This script is not scanned.
"""
import argparse
import difflib
import glob
import json
import os
import re
import sys

SELF = "scripts/skill-lint.py"
TEXT_EXT = (".md", ".py", ".sh", ".ts", ".tsx", ".json", ".html")
SKIP_DIRS = {"node_modules", "__pycache__", ".git"}

NAMES = (r"pi-delegate|pi[- ]agents?|pi[- ]child(?:ren)?|pi[- ]cli|pi_[a-z_]+|ask_parent|"
         r"sb-agents|proto-agents|scout|fixer|piconfig|pitui|docsync|orchestrator-mode|shepherd")
L1_RE = re.compile(r"(?<![A-Za-z0-9_])(?:%s)(?![A-Za-z0-9_])" % NAMES, re.I)
L2_RE = re.compile(r"/private/tmp|/tmp/claude|scratchpad|mods-research|chapter-(?:ux|machinery)")
L3_RE = re.compile(r"/Users/[^/\s]+/|/home/[^/\s]+/")
LEGACY_RE = re.compile(r"\[(?:AUDIT|PROTO|SB|FIX|CH-M|CH-UX|GEN|TPL|LIVE|MEM-UX|MEM-TEST|PI|B)[: \]]")
EV_TAG_RE = re.compile(r"\[ev:(\d+)\]")
EV_HEAD_RE = re.compile(r"^## ev:(\d+)\b", re.M)
FILLER_RE = re.compile(r"\b(simply|just|easily)\b", re.I)
WORD_RE = re.compile(r"[a-z0-9]+(?:['_-][a-z0-9]+)*")
RUN = 12


class Lint:
    def __init__(self, skill):
        self.skill = skill
        self.findings = []

    def add(self, file, line, rule, sev, msg):
        self.findings.append({"file": file, "line": line, "rule": rule, "severity": sev, "message": msg})


def read_lines(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


def list_files(skill):
    out = []
    for root, dirs, files in os.walk(skill):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(files):
            if not name.endswith(TEXT_EXT):
                continue
            rel = os.path.relpath(os.path.join(root, name), skill)
            if rel != SELF:
                out.append(rel)
    return out


def find_pa():
    base = "/private/tmp/claude-%d/bundled-skills" % os.getuid()
    best = None
    for ref in glob.glob(os.path.join(base, "*", "*", "plugin-authoring", "reference.md")):
        d = os.path.dirname(ref)
        ver = os.path.basename(os.path.dirname(os.path.dirname(d)))
        key = (tuple(int(x) if x.isdigit() else 0 for x in ver.split(".")), os.path.getmtime(ref))
        if best is None or key > best[0]:
            best = (key, d)
    return best[1] if best else None


def load_data_lines(path):
    if not os.path.isfile(path):
        return []
    return [(n, l.rstrip("\n")) for n, l in enumerate(read_lines(path), 1) if l.strip() and not l.lstrip().startswith("#")]


def load_allow(skill):
    allow = []
    for n, l in load_data_lines(os.path.join(skill, "scripts", "skill-lint.allow")):
        if ":" in l:
            f, rx = l.split(":", 1)
            allow.append((f.strip(), re.compile(rx)))
    return allow


def allowed(allow, rel, text):
    return any(f == rel and rx.search(text) for f, rx in allow)


def parse_frontmatter(lines):
    """Return (dict, last frontmatter line number) or (None, 0)."""
    if not lines or lines[0].strip() != "---":
        return None, 0
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None, 0
    fm, key = {}, None
    for i in range(1, end):
        raw = lines[i]
        m = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", raw)
        if m and not raw.startswith((" ", "\t")):
            key = m.group(1)
            fm[key] = {"value": m.group(2).strip(), "line": i + 1}
        elif key and raw.strip():
            fm[key]["value"] += " " + raw.strip()
    for k, d in fm.items():
        v = d["value"]
        if v[:1] in (">", "|"):
            v = v.lstrip(">|+-").strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        d["value"] = v
    return fm, end + 1


def strip_blocks(lines, skip_frontmatter_to=0):
    """Yield (line number, text) for prose lines: no code fences, no tables, no frontmatter."""
    fence = False
    for i, raw in enumerate(lines, 1):
        if i <= skip_frontmatter_to:
            continue
        s = raw.strip()
        if s.startswith("```") or s.startswith("~~~"):
            fence = not fence
            continue
        if fence or s.startswith("|"):
            continue
        yield i, raw


def tokens(lines, skip_to=0):
    toks = []
    for i, raw in strip_blocks(lines, skip_to):
        for m in WORD_RE.finditer(raw.lower()):
            toks.append((m.group(0), i))
    return toks


def rule_patterns(lint, files, allow):
    for rel in files:
        for n, text in enumerate(read_lines(os.path.join(lint.skill, rel)), 1):
            for rule, rx, what in (("L1", L1_RE, "name"), ("L2", L2_RE, "scratch path"), ("L3", L3_RE, "personal path")):
                m = rx.search(text)
                if m and not allowed(allow, rel, text):
                    lint.add(rel, n, rule, "fail", "%s '%s'" % (what, m.group(0)))


def rule_budgets(lint, files, budgets_path):
    budgets = {}
    for n, l in load_data_lines(budgets_path):
        parts = l.split()
        if len(parts) == 2 and parts[1].isdigit():
            budgets[parts[0]] = int(parts[1])
    skill_md = os.path.join(lint.skill, "SKILL.md")
    for rel in files:
        count = len(read_lines(os.path.join(lint.skill, rel)))
        limit = budgets.get(rel, budgets.get(os.path.basename(rel)))
        if rel == "SKILL.md":
            # The budget caps the body that an agent reads. The frontmatter has its own
            # check: the description character limit below.
            lines = read_lines(os.path.join(lint.skill, rel))
            fm_end = 0
            if lines and lines[0].strip() == "---":
                fm_end = next((i + 1 for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)
            body = count - fm_end
            limit = 150
            if body > limit:
                lint.add(rel, count, "L4", "fail", "SKILL.md body has %d lines; the limit is %d" % (body, limit))
        elif limit is not None:
            hard = int(limit * 1.1)
            if count > hard:
                lint.add(rel, count, "L4", "fail", "%d lines; the budget is %d (+10%% = %d)" % (count, limit, hard))
            elif count > limit:
                lint.add(rel, count, "L4", "warn", "%d lines; the budget is %d (inside the +10%% tolerance)" % (count, limit))
    if os.path.isfile(skill_md):
        fm, _ = parse_frontmatter(read_lines(skill_md))
        d = fm.get("description") if fm else None
        if d:
            n = len(d["value"])
            if n > 1000:
                lint.add("SKILL.md", d["line"], "L4", "fail", "description has %d characters; the limit is 1000" % n)
            elif n > 500:
                lint.add("SKILL.md", d["line"], "L4", "warn", "description has %d characters; 500 is the soft limit" % n)


def rule_evidence(lint, files):
    ev_rel = "references/evidence.md"
    ev_path = os.path.join(lint.skill, ev_rel)
    used = {}
    for rel in files:
        lines = read_lines(os.path.join(lint.skill, rel))
        if rel == ev_rel:
            continue
        for n, text in enumerate(lines, 1):
            for m in EV_TAG_RE.finditer(text):
                used.setdefault(int(m.group(1)), (rel, n))
            m = LEGACY_RE.search(text)
            if m:
                lint.add(rel, n, "L5", "fail", "legacy tag '%s'" % m.group(0))
    heads = {}
    if os.path.isfile(ev_path):
        for n, text in enumerate(read_lines(ev_path), 1):
            m = re.match(r"^## ev:(\d+)\b", text)
            if m:
                k = int(m.group(1))
                if k in heads:
                    lint.add(ev_rel, n, "L5", "fail", "duplicate heading ev:%d (first at line %d)" % (k, heads[k]))
                else:
                    heads[k] = n
    elif used:
        lint.add(ev_rel, 1, "L5", "fail", "file is missing; the skill cites %d evidence tags" % len(used))
    for k, (rel, n) in sorted(used.items()):
        if k not in heads:
            lint.add(rel, n, "L5", "fail", "[ev:%d] has no '## ev:%d' entry in %s" % (k, k, ev_rel))
    for k, n in sorted(heads.items()):
        if k not in used:
            lint.add(ev_rel, n, "L5", "fail", "'## ev:%d' is never cited" % k)


def rule_duplicates(lint, files, pa):
    # (b) banned phrases
    phrases = [l.strip() for _, l in load_data_lines(os.path.join(lint.skill, "scripts", "skill-lint.phrases"))]
    for rel in files:
        if rel == "references/evidence.md" or not rel.endswith(".md"):
            continue
        for n, text in enumerate(read_lines(os.path.join(lint.skill, rel)), 1):
            low = text.lower()
            for p in phrases:
                if p.lower() in low:
                    lint.add(rel, n, "L6", "fail", "banned phrase '%s'" % p)
    # (a) 12-word runs
    if not pa:
        lint.add("-", 0, "L6", "warn", "no PA folder; 12-word duplicate check skipped")
        return
    ref = os.path.join(pa, "reference.md")
    pa_toks = [w for w, _ in tokens(read_lines(ref))]
    grams = {tuple(pa_toks[i:i + RUN]) for i in range(len(pa_toks) - RUN + 1)}
    for rel in files:
        if not rel.endswith(".md"):
            continue
        lines = read_lines(os.path.join(lint.skill, rel))
        _, skip = parse_frontmatter(lines)
        toks = tokens(lines, skip)
        words = [w for w, _ in toks]
        hit = [tuple(words[i:i + RUN]) in grams for i in range(len(words) - RUN + 1)]
        i = 0
        while i < len(hit):
            if hit[i]:
                j = i
                while j + 1 < len(hit) and hit[j + 1]:
                    j += 1
                lint.add(rel, toks[i][1], "L6", "fail",
                         "%d-word run shared with the PA reference.md: '%s'" % (j - i + RUN, " ".join(words[i:i + 8]) + " ..."))
                i = j + 1
            else:
                i += 1


def check_d(lint, rel, n, part, dts):
    rng = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
    if not part:
        return
    if rng:
        hi = int(rng.group(2) or rng.group(1))
        if hi > len(dts) or int(rng.group(1)) < 1:
            lint.add(rel, n, "L7", "fail", "[D:%s] is outside the %d lines of claude-code.d.ts" % (part, len(dts)))
    elif not any(part in l for l in dts):
        lint.add(rel, n, "L7", "fail", "[D:%s] symbol is not in claude-code.d.ts" % part)


def rule_cites(lint, files, pa):
    heads = set()
    dts = None
    if pa:
        heads = {re.sub(r"^#+\s*", "", l).strip() for l in read_lines(os.path.join(pa, "reference.md")) if l.startswith("#")}
        dts_path = os.path.join(pa, "types", "claude-code.d.ts")
        if os.path.isfile(dts_path):
            dts = read_lines(dts_path)
    for rel in files:
        for n, text in enumerate(read_lines(os.path.join(lint.skill, rel)), 1):
            if pa:
                for m in re.finditer(r"\[PA:([^\]]+)\]", text):
                    h = m.group(1).strip()
                    if re.fullmatch(r"<[^>]*>", h):
                        continue
                    if h not in heads:
                        close = difflib.get_close_matches(h, heads, 1, 0.5)
                        lint.add(rel, n, "L7", "fail", "[PA:%s] is not a heading of reference.md%s" %
                                 (h, "; near: '%s'" % close[0] if close else ""))
                for m in re.finditer(r"\[D:([^\]]+)\]", text):
                    v = m.group(1).strip()
                    if re.fullmatch(r"<[^>]*>", v) or dts is None:
                        continue
                    for part in re.split(r"\s*,\s*", v):
                        part = re.sub(r"^D:\s*", "", part.strip())
                        ticks = re.findall(r"`([^`]+)`", part)
                        for sym in ticks or [part]:
                            check_d(lint, rel, n, sym, dts)
            if rel == "SKILL.md":
                for m in re.finditer(r"(?<![\w/.-])((?:references|scripts|templates)/[A-Za-z0-9_./*-]*)", text):
                    p = m.group(1)
                    if text[m.end():m.end() + 1] == "<":
                        p = p.rstrip("/") or p
                    p = p.rstrip(".,;:")
                    full = os.path.join(lint.skill, p)
                    if "*" in p:
                        ok = bool(glob.glob(full))
                    elif p.endswith("/"):
                        ok = os.path.isdir(full)
                    else:
                        ok = os.path.exists(full)
                    if not ok:
                        lint.add(rel, n, "L7", "fail", "'%s' does not exist in the skill" % p)


def rule_frontmatter(lint):
    path = os.path.join(lint.skill, "SKILL.md")
    fm, _ = parse_frontmatter(read_lines(path))
    if fm is None:
        lint.add("SKILL.md", 1, "L8", "fail", "no frontmatter")
        return
    folder = os.path.basename(os.path.realpath(lint.skill))
    name = fm.get("name")
    if not name or name["value"] != folder:
        lint.add("SKILL.md", name["line"] if name else 1, "L8", "fail",
                 "name '%s' does not equal the folder name '%s'" % (name["value"] if name else "", folder))
    d = fm.get("description")
    if not d or not d["value"]:
        lint.add("SKILL.md", 1, "L8", "fail", "description is missing")
    else:
        v = d["value"]
        if re.search(r"\byou(?:r|rs|rself)?\b", v, re.I):
            lint.add("SKILL.md", d["line"], "L8", "fail", "description is not in third person (it has 'you')")
        if re.match(r"use\b", v, re.I):
            lint.add("SKILL.md", d["line"], "L8", "fail", "description starts with 'Use'")
    if "argument-hint" not in fm:
        lint.add("SKILL.md", 1, "L8", "warn", "argument-hint is missing")
    at = fm.get("allowed-tools")
    if at:
        v = at["value"]
        if re.search(r"(?:^|[\s(,\"'\[])(?:/(?!\$)[A-Za-z~]|~/)", v):
            lint.add("SKILL.md", at["line"], "L8", "fail", "allowed-tools has an absolute path; use ${CLAUDE_SKILL_DIR}")


def rule_style(lint, files):
    for rel in files:
        if not rel.endswith(".md"):
            continue
        lines = read_lines(os.path.join(lint.skill, rel))
        _, skip = parse_frontmatter(lines)
        paras, cur = [], []  # each paragraph: list of (line number, text)
        for n, raw in strip_blocks(lines, skip):
            s = raw.strip()
            starts = re.match(r"^(?:[-*+]\s|\d+[.)]\s|#)", s)
            if not s or starts or s.startswith(">"):
                if cur:
                    paras.append(cur)
                cur = []
                if not s or s.startswith("#"):
                    continue
            cur.append((n, s))
        if cur:
            paras.append(cur)
        for para in paras:
            text, marks = "", []
            for n, s in para:
                marks.append((len(text), n))
                text += re.sub(r"^(?:[-*+]|\d+[.)]|>)\s+", "", s) + " "
            clean = re.sub(r"`[^`]*`", "X", text)
            clean = re.sub(r"\[[a-zA-Z]+:[^\]]*\]", "", clean)
            pos = 0
            for sent in re.split(r"(?<=[.!?])\s+", clean):
                start = clean.find(sent, pos)
                pos = start + len(sent)
                words = [w for w in sent.split() if re.search(r"[A-Za-z0-9]", w)]
                line = next((n for off, n in reversed(marks) if off <= max(start, 0)), para[0][0])
                if len(words) > 25:
                    lint.add(rel, line, "L9", "warn", "sentence has %d words; the limit is 25" % len(words))
                for m in FILLER_RE.finditer(sent):
                    lint.add(rel, line, "L9", "warn", "filler word '%s'" % m.group(0).lower())


def main(argv):
    ap = argparse.ArgumentParser(prog="skill-lint.py", description="Lint one skill folder.")
    ap.add_argument("skill_dir")
    ap.add_argument("--pa", help="the plugin-authoring folder (has reference.md and types/)")
    ap.add_argument("--require-pa", action="store_true", help="exit 3 when no PA folder is found")
    ap.add_argument("--json", action="store_true", help="print the findings as JSON")
    ap.add_argument("--budgets", help="budget file (default: scripts/skill-lint.budgets)")
    a = ap.parse_args(argv)
    skill = os.path.abspath(a.skill_dir)
    if not os.path.isfile(os.path.join(skill, "SKILL.md")):
        print("skill-lint: no SKILL.md in %s" % skill, file=sys.stderr)
        return 2
    pa = a.pa if a.pa else find_pa()
    if pa and not os.path.isfile(os.path.join(pa, "reference.md")):
        pa = None
    if a.require_pa and not pa:
        print("skill-lint: no PA folder found", file=sys.stderr)
        return 3
    budgets = a.budgets or os.path.join(skill, "scripts", "skill-lint.budgets")
    lint = Lint(skill)
    files = list_files(skill)
    allow = load_allow(skill)
    rule_patterns(lint, files, allow)
    rule_budgets(lint, files, budgets)
    rule_evidence(lint, files)
    rule_duplicates(lint, files, pa)
    rule_cites(lint, files, pa)
    rule_frontmatter(lint)
    rule_style(lint, files)
    lint.findings.sort(key=lambda f: (f["file"], f["line"], f["rule"], f["message"]))
    nf = sum(f["severity"] == "fail" for f in lint.findings)
    nw = len(lint.findings) - nf
    summary = "skill-lint: %d fail, %d warn" % (nf, nw)
    if a.json:
        print(json.dumps({"findings": lint.findings, "fail": nf, "warn": nw}, indent=1))
        print(summary, file=sys.stderr)
    else:
        for f in lint.findings:
            print("%s:%d: %s %s: %s" % (f["file"], f["line"], f["rule"], f["severity"], f["message"]))
        print(summary)
    return 1 if nf else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
