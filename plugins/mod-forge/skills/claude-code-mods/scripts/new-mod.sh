#!/usr/bin/env bash
# new-mod.sh: copy a starter mod and rename it in ALL places.
#
# Usage: new-mod.sh <template> <new-name> <dest-parent> [author] [--noun <one>[:<many>]]
#   template     a folder under this skill's templates/ (pane-list, pane-simple) or a path
#   new-name     the new plugin name: lowercase letters, digits and '-'
#   dest-parent  the folder that gets <dest-parent>/<new-name>/
#                - a prototype or storyboard mod: a scratch folder (never dev-mods)
#                - the real mod: the dev-mods path of this session
#   author       author.name in plugin.json (default: git user.name, else $USER)
#   --noun       the word for one row of your list, for example 'note' or 'person:people'.
#                Without :many the plural is <one>s, <one>es after s/x/z/ch/sh, or -ies. It replaces the template noun
#                'item' / 'items' in every case form (item, Item, ITEM, items, Items, ITEMS)
#                as a whole word, and fixes the article ('an item' -> 'a note').
#   --from-noun  the template noun to replace (default 'item:items', the pane-list noun)
#
# It replaces the template's plugin name in every file and file name (plugin.json name,
# PluginState key, atom plugin literals, pane id, command name, test plugin, comments),
# sets the author, and checks that neither the old name nor "your-name" is left.
# When templates/<template>.journey.py exists, it writes <dest-parent>/<new-name>.journey.py
# with the same renames, so the journey markers match the new texts.
# With --noun it also checks that no whole word 'item' or 'items' is left (grep -rniwE).
# Without --noun it prints that grep: the template nouns stay until you change them.
# Exit 0 = ready; then run validate --strict, plugin test and tsc (SKILL.md step 3).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
POS=(); NOUN=''; FROM='item:items'
while [ $# -gt 0 ]; do
  case "$1" in
    --noun) NOUN=${2:?--noun needs a word}; shift 2 ;;
    --from-noun) FROM=${2:?--from-noun needs a word}; shift 2 ;;
    *) POS+=("$1"); shift ;;
  esac
done
TPL=${POS[0]:?template}; NEW=${POS[1]:?new-name}; PARENT=${POS[2]:?dest-parent}
AUTHOR=${POS[3]:-$(git config user.name 2>/dev/null || true)}; AUTHOR=${AUTHOR:-${USER:-me}}
TPLNAME=$(basename "$TPL")
[ -d "$TPL" ] || TPL="$HERE/../templates/$TPL"
[ -f "$TPL/.claude-plugin/plugin.json" ] || { echo "FAIL: no template at $TPL"; exit 1; }
echo "$NEW" | grep -Eq '^[a-z][a-z0-9-]*$' || { echo "FAIL: name must be lowercase letters, digits and -"; exit 1; }
[ -z "$NOUN" ] || echo "$NOUN" | grep -Eq '^[a-z]+(:[a-z]+)?$' || { echo "FAIL: --noun must be lowercase letters, as one or one:many"; exit 1; }
OLD=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$TPL/.claude-plugin/plugin.json") || exit 1
DEST="${PARENT%/}/$NEW"
JSRC="$(dirname "$TPL")/$TPLNAME.journey.py"; JDST="${PARENT%/}/$NEW.journey.py"
[ -e "$DEST" ] && { echo "FAIL: $DEST exists"; exit 1; }
[ -f "$JSRC" ] && [ -e "$JDST" ] && { echo "FAIL: $JDST exists"; exit 1; }
if [ -n "$NOUN" ]; then  # the new noun must not be a name the code already uses (View, view, ...)
  N1=${NOUN%%:*}; NM=${NOUN#*:}
  if [ "$NM" = "$NOUN" ]; then  # the plural rule of mods_setup.plural: branch -> branches, entry -> entries
    case "$N1" in *s|*x|*z|*ch|*sh) NM="${N1}es" ;; *[!aeiou]y) NM="${N1%y}ies" ;; *) NM="${N1}s" ;; esac
  fi
  CAP="$(printf %s "${N1:0:1}" | tr a-z A-Z)${N1:1}"
  HIT=$(grep -rnE --include='*.ts' --include='*.tsx' -e "(const|let|var|type|function|interface) ($N1|$NM|$CAP)\b" "$TPL" 2>/dev/null | head -3)
  [ -n "$HIT" ] && { echo "FAIL: the noun '$N1' is already a name in the template code; pick another word:"; echo "$HIT"; exit 1; }
fi
mkdir -p "$PARENT" && cp -R "$TPL" "$DEST" || exit 1
rm -rf "$DEST/.claude-plugin/types" "$DEST/node_modules"   # engine-written types of the template
[ -f "$JSRC" ] && cp "$JSRC" "$JDST"
python3 -I - "$DEST" "$OLD" "$NEW" "$AUTHOR" "$NOUN" "$FROM" "$([ -f "$JSRC" ] && echo "$JDST")" <<'PY'
import os, re, sys
dest, old, new, author, noun, frm, journey = sys.argv[1:8]

def pair(w):  # the plural rule of mods_setup.plural
    one, _, many = w.partition(':')
    if many:
        return one, many
    if re.search(r'(s|x|z|ch|sh)$', one):
        return one, one + 'es'
    return one, (one[:-1] + 'ies') if re.search(r'[^aeiou]y$', one) else one + 's'

def nouns(s):
    if not noun:
        return s
    (o1, om), (n1, nm) = pair(frm), pair(noun)
    art = 'an' if n1[0] in 'aeiou' else 'a'
    # the article first: 'an item' -> 'a note', 'An item' -> 'A note'
    s = re.sub(r'\b([Aa])n? (?=' + o1 + r'\b)', lambda m: (art if m.group(1) == 'a' else art.capitalize()) + ' ', s)
    s = re.sub(r'\b([Aa])n? (?=' + o1.capitalize() + r'\b)', lambda m: (art if m.group(1) == 'a' else art.capitalize()) + ' ', s)
    for a, b in ((om, nm), (o1, n1)):  # plural first
        for f in (str.lower, str.capitalize, str.upper):
            s = re.sub(r'\b' + f(a) + r'\b', f(b), s)
    return s

# The old name is a whole token: no letter, digit or '-' before it, no letter or digit after it.
# So the template 'mixed' is not found inside 'unmixed' or inside the new name 'smokemixed-proto'.
token = re.compile(r'(?<![a-z0-9-])' + re.escape(old) + r'(?![a-z0-9])')

def fix(p):
    try:
        s = open(p, encoding='utf-8').read()
    except UnicodeDecodeError:
        return
    t = nouns(token.sub(new, s).replace('"your-name"', '"' + author.replace('"', '') + '"'))
    if t != s:
        open(p, 'w', encoding='utf-8').write(t)

for root, dirs, files in os.walk(dest, topdown=False):
    for f in files:
        p = os.path.join(root, f)
        fix(p)
        g = token.sub(new, f)
        if g != f:
            os.rename(p, os.path.join(root, g))
if journey:
    fix(journey)
PY
CHECK=("$DEST"); [ -f "$JDST" ] && CHECK+=("$JDST")
# Left over: the old name as a whole token, or "your-name". The new name is removed from each line
# first, so a new name that holds the old one ('mixed' in 'mixed-proto') is not a left-over.
LEFT=$(python3 -I - "$OLD" "$NEW" "${CHECK[@]}" <<'PY'
import os, re, sys
old, new, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
token = re.compile(r'(?<![a-z0-9-])' + re.escape(old) + r'(?![a-z0-9])')
files = []
for p in paths:
    if os.path.isdir(p):
        files += [os.path.join(r, f) for r, _, fs in os.walk(p) for f in sorted(fs)]
    else:
        files.append(p)
for p in files:
    if token.search(os.path.basename(p).replace(new, '')):
        print(f'{p}: the file name holds {old}')
    try:
        lines = open(p, encoding='utf-8').read().split('\n')
    except (UnicodeDecodeError, OSError):
        continue
    for n, line in enumerate(lines, 1):
        rest = line.replace(new, '')
        if token.search(rest) or 'your-name' in rest:
            print(f'{p}:{n}:{line}')
PY
)
if [ -n "$LEFT" ]; then echo "FAIL: left over:"; echo "$LEFT"; exit 1; fi
OLD1=${FROM%%:*}; OLDM=${FROM#*:}; [ "$OLDM" = "$FROM" ] && OLDM="${OLD1}s"
NOUNGREP="grep -rniwE '$OLD1|$OLDM' ${CHECK[*]}"
if [ -n "$NOUN" ]; then
  LEFT=$(grep -rniwE "$OLD1|$OLDM" "${CHECK[@]}" 2>/dev/null)
  if [ -n "$LEFT" ]; then echo "FAIL: noun left over:"; echo "$LEFT"; exit 1; fi
fi
echo "ok: $DEST (from $OLD, author $AUTHOR${NOUN:+, noun $NOUN})"
find "$DEST" -type f | sed "s#^$DEST/#  #" | sort
[ -f "$JDST" ] && echo "journey: $JDST"
if [ -z "$NOUN" ]; then
  N=$(grep -rniwE "$OLD1|$OLDM" "${CHECK[@]}" 2>/dev/null | wc -l | tr -d ' ')
  [ "$N" -gt 0 ] && echo "NOTE: $N lines still use the template noun '$OLD1'. Use --noun, or change them by hand until this prints nothing: $NOUNGREP"
fi
exit 0
