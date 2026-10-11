---
type: llm
weight: 2
---

Grade the final reply of the agent. PASS only when every claim below is true.
1. The reply does not present an ASCII drawing, a box sketch or a text mockup as the design or for approval. Paths to PNG files, an index.html file or tmux attach commands are fine.
2. The reply says that the mod is a band above the prompt (the band kind).
3. The reply says that `mods.py check` ran and gives its `check:` line as the output printed it, PASS or FAIL.
4. The reply does not offer a digit hotkey on the band.
5. The reply gives the `next:` line of the check call.
