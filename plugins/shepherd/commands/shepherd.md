---
description: Start a recurring 10-minute "shepherd" loop that watches a goal and actively takes agency to keep it running — watch, act, unblock, understand problems.
argument-hint: <goal to shepherd>
disable-model-invocation: true
---

Start a recurring **shepherd loop** over the goal below.

Invoke the `loop` skill (Skill tool, `skill: "loop"`) with these args
**verbatim**:

```
10 minutes, You will be the shepherd of this goal: $ARGUMENTS. You need to keep a close watch. You need to take action. You need to take agency. You need to unblock the execution. Understand problems. And act as someone truly useful to make sure this thing keeps on running.
```

Rules:
- Use the fixed **10-minute** interval — do not self-pace.
- If no goal was given above (the args are empty), first ask the user what goal to shepherd, then start.
