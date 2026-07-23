#!/usr/bin/env bash
# Tests for validate-citations.sh — the deterministic citation gate.
#
# Shell-driven, fixture-based, trap'd cleanup. Each case writes a
# self-contained artifact under $TMP via heredoc and asserts exit code +
# a substring in stderr/stdout.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATE="$PLUGIN_ROOT/scripts/validate-citations.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
total=0

run_case() {
  local name="$1"; shift
  local expect_exit="$1"; shift
  local expect_substr="$1"; shift
  total=$((total + 1))
  local out actual_exit
  set +e
  out=$("$@" 2>&1)
  actual_exit=$?
  set -e
  if [ "$actual_exit" != "$expect_exit" ]; then
    echo "FAIL: $name (exit: expected $expect_exit, got $actual_exit)"
    sed 's/^/    /' <<<"$out"
    fail=$((fail + 1))
    return
  fi
  if [ -n "$expect_substr" ] && ! grep -Fq "$expect_substr" <<<"$out"; then
    echo "FAIL: $name (missing substring: $expect_substr)"
    sed 's/^/    /' <<<"$out"
    fail=$((fail + 1))
    return
  fi
  echo "PASS: $name"
  pass=$((pass + 1))
}

# ===========================================================================
# Case 1 — Good artifact: PASS (exit 0)
# ===========================================================================
f1="$TMP/good.md"
cat >"$f1" <<'EOF'
---
date: 2026-04-29
topic: Sample research topic
version: 1.0.0
status: completed
---

# Sample research topic

## Executive Summary

Brief summary with a citation [GH](https://github.com/example/repo).

## Findings

### Section A

According to [Source A](https://example.com/a), the answer is yes.

### Section B

The pattern shows up in [Source B](https://example.org/b) as well.

## References

1. **[Source A](https://example.com/a)**
   - Accessed: 2026-04-29
   - Type: Official Documentation
   - Reliability: 5/5
   - Used for: confirming approach

2. **[Source B](https://example.org/b)**
   - Accessed: 2026-04-29
   - Type: Technical Blog
   - Reliability: 4/5
   - Used for: cross-reference

3. **[GH](https://github.com/example/repo)**
   - Accessed: 2026-04-29
   - Type: Official Repository
   - Reliability: 5/5
   - Used for: code examples
EOF
run_case "good-artifact-passes" 0 "PASS" \
  bash "$VALIDATE" "$f1"

# ===========================================================================
# Case 2 — Missing References section: FAIL with named diagnostic
# ===========================================================================
f2="$TMP/no-refs.md"
cat >"$f2" <<'EOF'
---
date: 2026-04-29
topic: No refs section
version: 1.0.0
---

## Executive Summary

Body has a URL https://example.com but no References section.

## Findings

### Section A

[Source](https://example.com) was consulted.
EOF
run_case "missing-references-section" 1 "references-section-missing" \
  bash "$VALIDATE" "$f2"

# ===========================================================================
# Case 3 — Findings subsection without any URL/footnote: FAIL
# ===========================================================================
f3="$TMP/bare-claim.md"
cat >"$f3" <<'EOF'
---
date: 2026-04-29
topic: Bare claim demo
version: 1.0.0
---

## Executive Summary

[A](https://example.com/a) was consulted.

## Findings

### Section A

According to [Source A](https://example.com/a), things are good.

### Section B

This subsection makes claims without citing any source.

## References

1. **[Source A](https://example.com/a)**
   - Accessed: 2026-04-29
   - Type: Official Documentation
   - Reliability: 5/5
   - Used for: confirming approach
EOF
run_case "findings-bare-claim" 1 "findings-bare-claim" \
  bash "$VALIDATE" "$f3"

# ===========================================================================
# Case 4 — Malformed URL (htp://): FAIL
# ===========================================================================
f4="$TMP/malformed.md"
cat >"$f4" <<'EOF'
---
date: 2026-04-29
topic: Malformed URL demo
version: 1.0.0
---

## Executive Summary

This cites htp://broken.example.com which is malformed.

## Findings

### Section A

According to [Source](https://example.com), the answer is yes.

## References

1. **[Source](https://example.com)**
   - Accessed: 2026-04-29
   - Type: Official Documentation
   - Reliability: 5/5
   - Used for: testing
EOF
run_case "malformed-url" 1 "url-malformed" \
  bash "$VALIDATE" "$f4"

# ===========================================================================
# Case 5 — Footnote [^3] without matching definition: FAIL
# ===========================================================================
f5="$TMP/footnote-orphan.md"
cat >"$f5" <<'EOF'
---
date: 2026-04-29
topic: Orphan footnote demo
version: 1.0.0
---

## Executive Summary

The result is well documented[^1] across multiple studies[^3].

## Findings

### Section A

Per peer-reviewed work[^1], the consensus holds. See also [Source](https://example.com).

## References

1. **[Source](https://example.com)**
   - Accessed: 2026-04-29
   - Type: Official Documentation
   - Reliability: 5/5
   - Used for: testing

[^1]: First reference, https://primary.example.com
EOF
run_case "footnote-orphan" 1 "footnote-undefined" \
  bash "$VALIDATE" "$f5"

# ===========================================================================
# Case 6 — Reference missing reliability rating: WARN (exit 2, not FAIL)
# ===========================================================================
f6="$TMP/no-reliability.md"
cat >"$f6" <<'EOF'
---
date: 2026-04-29
topic: Missing reliability rating demo
version: 1.0.0
---

## Executive Summary

[Source A](https://example.com/a) was consulted.

## Findings

### Section A

According to [Source A](https://example.com/a), the result holds.

## References

1. **[Source A](https://example.com/a)**
   - Accessed: 2026-04-29
   - Type: Official Documentation
   - Used for: confirming approach
EOF
run_case "reference-no-reliability" 2 "reference-no-reliability" \
  bash "$VALIDATE" "$f6"

# ===========================================================================
# Case 7 — Frontmatter missing 'date:': FAIL
# ===========================================================================
f7="$TMP/no-date.md"
cat >"$f7" <<'EOF'
---
topic: No date in frontmatter
version: 1.0.0
---

## Executive Summary

[Source A](https://example.com/a) was consulted.

## Findings

### Section A

According to [Source A](https://example.com/a), the result holds.

## References

1. **[Source A](https://example.com/a)**
   - Accessed: 2026-04-29
   - Type: Official Documentation
   - Reliability: 5/5
   - Used for: testing
EOF
run_case "frontmatter-missing-date" 1 "frontmatter-missing-field" \
  bash "$VALIDATE" "$f7"

# ===========================================================================
# Summary
# ===========================================================================
echo ""
echo "test_validate_citations.sh: $pass/$total passed, $fail failed"
[ "$fail" -eq 0 ]
