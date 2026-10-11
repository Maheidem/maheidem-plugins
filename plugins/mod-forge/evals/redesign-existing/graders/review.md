---
type: llm
weight: 2
---

Grade the final reply of the agent. PASS only when every claim below is true.
1. The reply does not present an ASCII drawing, a box sketch or a text mockup as the design or for approval. Paths to PNG files, an index.html file or tmux attach commands are fine.
2. The reply says that `mods.py audit-existing` was run before `mods.py new`. The audit result can be a FAIL.
3. The reply names the notes in `.notes/*.md` as the data source of the old mod that the new prototype must keep.
4. The reply says that `mods.py check` ran and gives its `check:` line as the output printed it, PASS or FAIL.
5. The reply gives the `next:` line of the check call.
