#!/usr/bin/env bash
# validate-citations.sh — Deterministic citation gate for deep-research artifacts.
#
# Enforces the rules the agent prompt declares as MUST:
#   - YAML frontmatter present with mandatory fields (date, topic, version)
#   - A "## References" (or "## Sources") section exists
#   - Every URL appearing in the body is mirrored in the References section
#   - Every reference entry carries: URL, access date (YYYY-MM-DD), reliability
#     rating (1-5 stars, accepting ⭐ / ★ / [1-5]/5)
#   - Every footnote-style citation [^N] in the body has a matching [^N]: definition
#     (only enforced if at least one footnote ref exists)
#   - The "## Findings" / "## Detailed Findings" section contains ≥1 URL
#   - Every "### " subsection within Findings references at least one URL or
#     footnote within its body
#
# Usage:
#   validate-citations.sh <artifact-path>
#
# Exit codes:
#   0   PASS — all hard checks pass, no warnings
#   1   FAIL — one or more hard checks failed (details to stderr)
#   2   WARN — hard checks pass but warnings present (details to stderr)
#
# Dependencies: bash 3.2+, awk, grep, sed.

set -u

usage() {
  cat >&2 <<EOF
Usage: validate-citations.sh <artifact-path>

Validates a deep-research artifact against the citation/reliability rules
declared in the deep-research-agent prompt.

Exit codes:
  0 = PASS, 1 = FAIL, 2 = WARN
EOF
  exit 2
}

if [ $# -lt 1 ]; then
  usage
fi

ARTIFACT="$1"
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage ;;
    *) echo "validate-citations.sh: unexpected argument: $1" >&2; usage ;;
  esac
done

if [ ! -f "$ARTIFACT" ]; then
  echo "validate-citations.sh: artifact not found: $ARTIFACT" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Accumulators
# -----------------------------------------------------------------------------
HARD_FAILS=()
WARNINGS=()

fail() { HARD_FAILS+=("$1"); }
warn() { WARNINGS+=("$1"); }

# -----------------------------------------------------------------------------
# Frontmatter extraction
# -----------------------------------------------------------------------------
# Body starts after the closing `---` of the frontmatter. If no frontmatter,
# body = whole file and frontmatter = empty.

FM_TMP=$(mktemp 2>/dev/null || mktemp -t dr-fm)
BODY_TMP=$(mktemp 2>/dev/null || mktemp -t dr-body)
trap 'rm -f "$FM_TMP" "$BODY_TMP"' EXIT

awk '
  BEGIN { state = 0 }
  NR == 1 && /^---[[:space:]]*$/ { state = 1; next }
  state == 1 && /^---[[:space:]]*$/ { state = 2; next }
  state == 1 { print > FM_FILE; next }
  state == 2 { print > BODY_FILE; next }
  state == 0 { print > BODY_FILE }
' FM_FILE="$FM_TMP" BODY_FILE="$BODY_TMP" "$ARTIFACT"

# Touch outputs so even an empty body/frontmatter is a real file.
[ -f "$FM_TMP" ] || : >"$FM_TMP"
[ -f "$BODY_TMP" ] || : >"$BODY_TMP"

HAS_FM=false
if [ -s "$FM_TMP" ]; then
  HAS_FM=true
fi

# -----------------------------------------------------------------------------
# CHECK 1 — Frontmatter mandatory fields
# -----------------------------------------------------------------------------
if [ "$HAS_FM" != "true" ]; then
  fail "frontmatter-missing: artifact has no YAML frontmatter"
else
  for field in date topic version; do
    if ! grep -qE "^${field}:[[:space:]]" "$FM_TMP"; then
      fail "frontmatter-missing-field: required field '${field}:' not in frontmatter"
    fi
  done

  # date must look like YYYY-MM-DD
  date_val=$(grep -E "^date:[[:space:]]" "$FM_TMP" | head -1 | sed -E 's/^date:[[:space:]]+//; s/[[:space:]]+$//')
  if [ -n "$date_val" ] && ! echo "$date_val" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
    fail "frontmatter-bad-date: date '${date_val}' is not YYYY-MM-DD"
  fi
fi

# -----------------------------------------------------------------------------
# CHECK 2 — References section exists
# -----------------------------------------------------------------------------
REF_LINE=$(grep -nE '^##[[:space:]]+(References|Sources|Sources Consulted)[[:space:]]*$' "$BODY_TMP" | head -1 | cut -d: -f1)
if [ -z "${REF_LINE:-}" ]; then
  fail "references-section-missing: no '## References' or '## Sources' section found"
fi

# Slice body into pre-references and references-section
PRE_TMP=$(mktemp 2>/dev/null || mktemp -t dr-pre)
REF_TMP=$(mktemp 2>/dev/null || mktemp -t dr-ref)
trap 'rm -f "$FM_TMP" "$BODY_TMP" "$PRE_TMP" "$REF_TMP"' EXIT

if [ -n "${REF_LINE:-}" ]; then
  awk -v r="$REF_LINE" 'NR < r { print > PRE; next } { print > REF }' \
    PRE="$PRE_TMP" REF="$REF_TMP" "$BODY_TMP"
else
  cp "$BODY_TMP" "$PRE_TMP"
  : >"$REF_TMP"
fi

# -----------------------------------------------------------------------------
# Helpers — URL extraction
# -----------------------------------------------------------------------------
# Strip fenced code blocks (```...```) from a file. Inline code (`...`) is
# left intact — code blocks contain example URLs that aren't citations.
strip_codeblocks() {
  awk '
    BEGIN { in_fence = 0 }
    /^[[:space:]]*```/ { in_fence = !in_fence; next }
    !in_fence { print }
  ' "$1"
}

# Extract distinct http(s) URLs from a file (excluding fenced code blocks).
extract_urls() {
  local f="$1"
  strip_codeblocks "$f" \
    | grep -oE 'https?://[^[:space:])>"<`]+' 2>/dev/null \
    | sed -E 's/[\.,;:\)\]\`]+$//' \
    | sort -u
}

# Detect malformed URL-like strings (e.g., htp:// or htps://) outside code blocks.
extract_malformed() {
  local f="$1"
  strip_codeblocks "$f" \
    | grep -oE '(htp|htps|hhttp)s?://[^[:space:])>"<`]+' 2>/dev/null | sort -u
}

# -----------------------------------------------------------------------------
# CHECK 3 — Malformed URLs
# -----------------------------------------------------------------------------
malformed=$(extract_malformed "$BODY_TMP")
if [ -n "$malformed" ]; then
  while IFS= read -r u; do
    [ -z "$u" ] && continue
    fail "url-malformed: '$u' looks like a malformed URL"
  done <<<"$malformed"
fi

# -----------------------------------------------------------------------------
# CHECK 4 — Every URL in body must be mirrored in References
# -----------------------------------------------------------------------------
if [ -n "${REF_LINE:-}" ]; then
  body_urls=$(extract_urls "$PRE_TMP")
  ref_urls=$(extract_urls "$REF_TMP")

  if [ -n "$body_urls" ]; then
    while IFS= read -r u; do
      [ -z "$u" ] && continue
      if ! grep -Fq "$u" "$REF_TMP"; then
        fail "url-not-in-references: '$u' appears in body but not in References section"
      fi
    done <<<"$body_urls"
  fi
fi

# -----------------------------------------------------------------------------
# CHECK 5 — Every reference entry has URL + access date + reliability rating
# -----------------------------------------------------------------------------
# A reference entry is detected as a numbered list item (`N. ` or `N) `) OR
# a `- ` bullet that contains a markdown link `[text](url)`. For each detected
# entry, accumulate the lines until the next entry / heading and inspect.
if [ -n "${REF_LINE:-}" ] && [ -s "$REF_TMP" ]; then
  ENTRIES_TMP=$(mktemp 2>/dev/null || mktemp -t dr-ent)
  trap 'rm -f "$FM_TMP" "$BODY_TMP" "$PRE_TMP" "$REF_TMP" "$ENTRIES_TMP"' EXIT

  awk '
    BEGIN { ent_n = 0; in_ent = 0 }
    /^## / && NR > 1 { in_ent = 0; if (buf) { print buf "\n---END---" > OUT; buf = "" } next }
    /^### / { in_ent = 0; if (buf) { print buf "\n---END---" > OUT; buf = "" } next }
    /^[[:space:]]*[0-9]+[\.\)][[:space:]]/ {
      if (buf) { print buf "\n---END---" > OUT }
      buf = $0
      in_ent = 1
      next
    }
    /^[[:space:]]*[-*][[:space:]].*\[.*\]\(http/ {
      if (buf) { print buf "\n---END---" > OUT }
      buf = $0
      in_ent = 1
      next
    }
    in_ent {
      buf = buf "\n" $0
      next
    }
    END {
      if (buf) print buf "\n---END---" > OUT
    }
  ' OUT="$ENTRIES_TMP" "$REF_TMP"

  # Iterate entries split on ---END---
  if [ -s "$ENTRIES_TMP" ]; then
    awk 'BEGIN { RS="---END---\n"; ORS="\n===ENTRY===\n" } /[A-Za-z0-9]/ { print }' \
      "$ENTRIES_TMP" >"${ENTRIES_TMP}.split"

    entry_buf=""
    while IFS= read -r line; do
      if [ "$line" = "===ENTRY===" ]; then
        if [ -n "$entry_buf" ]; then
          # Inspect $entry_buf
          first_line=$(echo "$entry_buf" | head -1)
          short_id=$(echo "$first_line" | sed -E 's/^[[:space:]]*//; s/^([^.]+)\..*/\1/' | cut -c1-40)

          # URL?
          if ! echo "$entry_buf" | grep -qE 'https?://'; then
            fail "reference-no-url: entry starting with '$first_line' has no URL"
          fi

          # Access date?
          if ! echo "$entry_buf" | grep -qiE '(Accessed|Access date)[[:space:]]*:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
            warn "reference-no-access-date: entry starting with '$first_line' missing 'Accessed: YYYY-MM-DD'"
          fi

          # Reliability rating?
          # Accept ⭐ (U+2B50), ★ (U+2605), or text "[1-5]/5"
          if ! echo "$entry_buf" | grep -qE '(⭐+|★+|[1-5]/5)'; then
            warn "reference-no-reliability: entry starting with '$first_line' missing reliability rating (★/⭐/[1-5]/5)"
          fi
        fi
        entry_buf=""
      else
        if [ -n "$entry_buf" ]; then
          entry_buf="$entry_buf
$line"
        else
          entry_buf="$line"
        fi
      fi
    done <"${ENTRIES_TMP}.split"

    rm -f "${ENTRIES_TMP}.split"
  fi
fi

# -----------------------------------------------------------------------------
# CHECK 6 — Footnote pairing (only if any [^N] reference appears in body)
# -----------------------------------------------------------------------------
# Only consider a "use" as `[^N]` outside fenced code blocks. Definitions
# `[^N]:` are matched separately below, so we exclude any line that already
# contains `[^N]:` from the use-search.
fn_uses=$(strip_codeblocks "$BODY_TMP" \
  | grep -v -E '\[\^[A-Za-z0-9_-]+\]:' \
  | grep -oE '\[\^[A-Za-z0-9_-]+\]' \
  | sort -u)

if [ -n "$fn_uses" ]; then
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    # Definition would be at start-of-line as `[^N]:`
    def="${ref}:"
    if ! grep -Fq "$def" "$BODY_TMP"; then
      fail "footnote-undefined: '${ref}' has no matching '${def}' definition"
    fi
  done <<<"$fn_uses"
fi

# -----------------------------------------------------------------------------
# CHECK 7 — Findings section contains ≥1 URL, and each ### subsection cites
# -----------------------------------------------------------------------------
FIND_LINE=$(grep -nE '^##[[:space:]]+(Detailed[[:space:]]+)?Findings[[:space:]]*$' "$PRE_TMP" | head -1 | cut -d: -f1)

if [ -n "${FIND_LINE:-}" ]; then
  FIND_TMP=$(mktemp 2>/dev/null || mktemp -t dr-find)
  trap 'rm -f "$FM_TMP" "$BODY_TMP" "$PRE_TMP" "$REF_TMP" "$FIND_TMP"' EXIT

  # Slice from FIND_LINE+1 up to next "^## " heading, then strip code fences
  # so URLs inside ``` blocks don't satisfy the citation requirement.
  awk -v start="$FIND_LINE" '
    NR > start {
      if (/^## / && !done) { exit }
      print
    }
  ' "$PRE_TMP" | awk '
    BEGIN { in_fence = 0 }
    /^[[:space:]]*```/ { in_fence = !in_fence; next }
    !in_fence { print }
  ' >"$FIND_TMP"

  # ≥1 URL or footnote in the section as a whole
  if ! grep -qE 'https?://|\[\^[A-Za-z0-9_-]+\]' "$FIND_TMP"; then
    fail "findings-no-url: Findings section contains no URLs or footnote citations"
  fi

  # Each ### subsection must have ≥1 URL or footnote in its body
  awk '
    BEGIN { name = ""; has_cite = 0; warned = 0 }
    /^### / {
      if (name != "" && !has_cite) {
        printf "findings-bare-claim: subsection \"%s\" has no URL or footnote citation\n", name > "/dev/stderr"
        anyfail = 1
      }
      name = $0
      sub(/^###[[:space:]]+/, "", name)
      has_cite = 0
      next
    }
    /^## / && name != "" {
      if (!has_cite) {
        printf "findings-bare-claim: subsection \"%s\" has no URL or footnote citation\n", name > "/dev/stderr"
        anyfail = 1
      }
      name = ""
      has_cite = 0
    }
    name != "" && /https?:\/\// { has_cite = 1 }
    name != "" && /\[\^[A-Za-z0-9_-]+\]/ { has_cite = 1 }
    END {
      if (name != "" && !has_cite) {
        printf "findings-bare-claim: subsection \"%s\" has no URL or footnote citation\n", name > "/dev/stderr"
        anyfail = 1
      }
      exit anyfail
    }
  ' "$FIND_TMP" 2>"${FIND_TMP}.err"
  awk_exit=$?

  if [ "$awk_exit" -ne 0 ] && [ -s "${FIND_TMP}.err" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && fail "$line"
    done <"${FIND_TMP}.err"
  fi
  rm -f "${FIND_TMP}.err"
fi

# -----------------------------------------------------------------------------
# Final report
# -----------------------------------------------------------------------------
if [ ${#HARD_FAILS[@]} -gt 0 ]; then
  echo "validate-citations: FAIL (${#HARD_FAILS[@]} hard issue(s))" >&2
  for m in "${HARD_FAILS[@]}"; do echo "  - $m" >&2; done
  if [ ${#WARNINGS[@]} -gt 0 ]; then
    echo "validate-citations: warnings (${#WARNINGS[@]}):" >&2
    for m in "${WARNINGS[@]}"; do echo "  - $m" >&2; done
  fi
  exit 1
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "validate-citations: WARN (${#WARNINGS[@]} warning(s))" >&2
  for m in "${WARNINGS[@]}"; do echo "  - $m" >&2; done
  exit 2
fi

echo "validate-citations: PASS"
exit 0
