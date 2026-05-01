# Source Reliability Rubric

Every reference in a deep-research artifact carries a reliability rating from
1 to 5 stars. This rubric defines what each band means so that ratings stay
consistent across artifacts and across re-runs.

Use the rating that matches the **weakest** descriptor that's still true. When
in doubt, downgrade. A 4★ source still bears its weight; a 5★ rating is a
high-trust assertion that should be defensible by anyone reviewing later.

| Stars | Band | Format example |
|-------|------|----------------|
| 5 | Authoritative primary | `Reliability: 5/5` or `⭐⭐⭐⭐⭐` |
| 4 | Reputable secondary | `Reliability: 4/5` or `⭐⭐⭐⭐` |
| 3 | Verified expert | `Reliability: 3/5` or `⭐⭐⭐` |
| 2 | Anecdotal / low-citation | `Reliability: 2/5` or `⭐⭐` |
| 1 | Unattributed / community post | `Reliability: 1/5` or `⭐` |

The validator (`scripts/validate-citations.sh`) accepts any of `⭐` (U+2B50),
`★` (U+2605), or `[1-5]/5` text. Pick one format per artifact for visual
consistency.

---

## 5★ — Authoritative primary

Use 5★ only when the source is the canonical authority for the claim it backs.

- **Peer-reviewed primary research.** Published in a peer-reviewed venue, with
  named authors and a DOI or arxiv ID. The artifact cites the abstract or a
  specific section, not a third-party summary.
- **Official documentation from the project / standards body.** Vendor docs
  (e.g., `developers.google.com`, `docs.aws.amazon.com`, `kubernetes.io`),
  IETF RFCs, ISO/IEC standards, W3C specs, NIST publications.
- **Government / regulatory body.** Statutes, agency rulings, official
  guidance issued by the relevant regulator.
- **Source code or specification of the system being researched.** When the
  question is "what does X actually do," the canonical answer is X itself.

**Disqualifies 5★:** docs that have been deprecated, archived, or superseded
by a newer version. Drop to 4★ and note "deprecated as of YYYY-MM-DD" in the
"Used for" line.

---

## 4★ — Reputable secondary

Use 4★ when the source is well-credentialed but secondary — it interprets,
analyzes, or summarizes a primary source rather than originating the claim.

- **Industry analyst reports.** Gartner, Forrester, IDC, McKinsey, Bain, BCG,
  Deloitte tech reports — when accessible. Note paywall.
- **Established news / trade publications with editorial standards.** WSJ,
  Reuters, FT, NYT, Wired, The Verge, Ars Technica, IEEE Spectrum, ACM Queue.
- **Books from reputable technical publishers.** O'Reilly, Manning, No Starch,
  Pragmatic Bookshelf, MIT Press, Cambridge UP.
- **Major project release notes / changelogs / blog posts** authored by the
  project's core team (not community contributors), even when not in the
  formal docs site.

**Disqualifies 4★:** affiliate or sponsored content that doesn't disclose,
opinion pieces dressed as reporting. Drop to 3★ or 2★.

---

## 3★ — Verified expert

Use 3★ when the source is a single individual or small team whose expertise
is provable and the post is well-cited.

- **Conference talks and recorded sessions** at named conferences (KubeCon,
  Strange Loop, PyCon, Defcon) where the speaker is a known practitioner.
- **Personal technical blogs by domain experts** with cited primary sources
  inside the post and a track record (long publication history, recognized
  in the field).
- **Engineering blogs from companies with strong publishing reputations**
  (Stripe, Cloudflare, Netflix, Discord) — these often reach 4★, but drop to
  3★ when the post is more "war story" than "design doc."

**Disqualifies 3★:** posts where the author's credentials or sources can't be
established, or posts that themselves cite only Stack Overflow / forums. Drop
to 2★.

---

## 2★ — Anecdotal / low-citation

Use 2★ when the source is a single perspective or anecdote without supporting
citations.

- **Blog posts without citations** that share an experience or opinion.
- **Vendor marketing pages** that make claims about their own product without
  external validation.
- **GitHub README claims** for projects you haven't independently verified
  (the README says X works; you haven't confirmed).
- **Slide decks or talks** from speakers without an established record on
  the topic.

These are still useful — they shape hypotheses and surface real-world
patterns — but treat the claim as one data point, not consensus.

---

## 1★ — Unattributed / community post

Use 1★ when the source is anonymous, attribution can't be verified, or the
post is informal community discussion.

- **Stack Overflow answers, GitHub issues, Reddit / HN comments,
  Discord / Slack snippets, X / Twitter posts** — useful for spotting
  failure modes and edge cases, but never the basis for a definitive claim.
- **AI-generated summaries** of other content (some "tech news" sites are
  now LLM-rewritten). When you can identify these, mark 1★ or exclude.

A 1★ source can support a finding only when **at least one ≥3★ source agrees**
with the same claim. Cite both — the 1★ for color, the higher-rated source
for substance.

---

## Cross-reference rule

The deep-research-agent's "consensus view" finding requires **≥2 independent
sources at 3★ or higher** agreeing on the claim. If only 1-2★ sources support
a claim, mark it explicitly as "anecdotal" or "single-source" in the body —
do not present it as consensus.

When sources disagree, list the disagreement and the rating of each side
rather than averaging. A peer-reviewed primary that contradicts a vendor blog
is not a 4.5★ "split" — it's a 5★ finding with a 2★ counter-claim, and the
artifact should say so.
