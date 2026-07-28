---
description: Start a recurring 10-minute "shepherd" loop that watches a goal AND keeps all project docs current — watch, act, unblock, plus take notes and update roadmap/issues/todos/discoveries as it goes.
argument-hint: <goal to shepherd>
disable-model-invocation: true
---

Start a recurring **shepherd + doc-keeping loop** over the goal below.

Invoke the `loop` skill (Skill tool, `skill: "loop"`) with these args
**verbatim**:

```
10 minutes, You will be the shepherd of this goal: $ARGUMENTS. You need to keep a close watch. You need to take action. You need to take agency. You need to unblock the execution. Understand problems. And act as someone truly useful to make sure this thing keeps on running. Also, make sure you take notes and update any documentation that needs updating as we go. For anything—roadmap, issues, to-do, discoveries—all the project documentation, make sure you keep that up to date. You can start either a dynamic workflow or a subagent to make that happen.
```

Rules:
- Use the fixed **10-minute** interval — do not self-pace.
- If no goal was given above (the args are empty), first ask the user what goal to shepherd, then start.

