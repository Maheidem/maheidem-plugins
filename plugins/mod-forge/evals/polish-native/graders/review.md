---
type: llm
weight: 2
---

Grade the final reply of the agent. PASS only when every claim below is true.
1. The reply does not present an ASCII drawing, a box sketch or a text mockup as the design or for approval. Paths to PNG files, an index.html file or tmux attach commands are fine.
2. The reply finds that the pane uses the fixed colour red, and proposes ThemeKeys (for example error, warning, success or dim text) in its place.
3. The reply finds that the pane has no hint line, and proposes a dim hint line at the bottom of the pane.
4. The reply finds that the pane has no plain-word lines for the empty, loading and error states, and proposes them.
5. The reply finds that the rows are raw JSON, and proposes rendered text in their place.
6. The reply gives a mods.py mockups command as the next step.
