# shepherd

Starts a recurring **shepherd loop** over a goal: a background loop that
watches, acts, unblocks, and understands problems to keep a goal running
unattended, instead of you having to babysit it turn by turn.

## Usage

```
/shepherd:shepherd <goal to shepherd>
```

If no goal is given, the command asks you for one before starting.

## What it does

The command invokes the built-in `loop` skill with a fixed **10-minute**
interval and a shepherd-role prompt built around your goal:

```
10 minutes, You will be the shepherd of this goal: <goal>. You need to keep
a close watch. You need to take action. You need to take agency. You need to
unblock the execution. Understand problems. And act as someone truly useful
to make sure this thing keeps on running.
```

It does not self-pace the interval — every tick is 10 minutes, on purpose,
regardless of how long the goal is expected to take.

## Relationship to the `loop` skill

`shepherd` is a thin, fixed-parameter wrapper around the `loop` skill (`/loop
<interval> <prompt>`). `loop` is generic (any interval, any prompt/slash
command); `shepherd` pins the interval to 10 minutes and pins the prompt to a
"shepherd" role description, so you only need to supply the goal.

## Session-only cadence

The recurring schedule is driven by the `loop` skill's use of `CronCreate`.
That means the loop is **session-only** — it runs on a schedule for the
current session and auto-expires per `CronCreate`'s normal behavior; it does
not persist as a durable background job across sessions. Start a new
`/shepherd:shepherd` if you need it to keep watching in a later session.
