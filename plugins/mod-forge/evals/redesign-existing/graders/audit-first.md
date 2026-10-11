---
type: tool_order
before:
  tool: Bash
  input_match: 'python3 -I \S*?(?:mods\.py|\$M)(?:\\?")? (?:-C \S+ )?audit-existing [^-\s]\S*'
after:
  tool: Bash
  input_match: 'python3 -I \S*?(?:mods\.py|\$M)(?:\\?")? (?:-C \S+ )?new [^-\s]\S*'
weight: 1
---
