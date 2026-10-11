---
type: llm
weight: 2
---

Grade the final reply of the agent. PASS only when every claim below is true.
1. The reply does not present an ASCII drawing, a box sketch or a text mockup as the design or for approval. Paths to PNG files, an index.html file or tmux attach commands are fine.
2. The reply says that this mod draws nothing on the screen, so the mockups do not apply.
3. The reply says that the review checklist is used in place of the mockups.
4. The reply says that `mods.py check` ran and gives its `check:` line as the output printed it, PASS or FAIL.
5. The reply gives the `next:` line of the check call.
