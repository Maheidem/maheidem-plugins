---
enabled: true
blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit
agent_suggestions:
  Edit: general-programmer-agent
  Write: general-programmer-agent
  Bash: general-programmer-agent
  NotebookEdit: jupyter-notebook-agent
bash_whitelist:
  - "git status"
  - "git diff"
  - "ls"
---

# Test Configuration

This is a test config file for validating the agentic-mode hook.
