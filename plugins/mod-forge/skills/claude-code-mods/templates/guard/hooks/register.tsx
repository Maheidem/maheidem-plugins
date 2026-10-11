// guard-starter: the tool-call guard starter of the claude-code-mods skill, built on the kit (hooks/kit/).
// It draws no pane and keeps no state. A tool.call hook judges each Bash command BEFORE it runs
// and refuses the risky ones. rules.ts holds the rules. This file only wires the hooks.
// There is no design pass for this kind (references/ux-design.md 12: the checklist only).
// The proof command runs the probe (PROBE in domain.ts, a harmless command that the rules must refuse) through the hook, as a model call would.
//   live        /guard-starter
// The reply starts with the ok glyph and "Refused" when the hook works. That text is the marker of mods.py live.
// The guard is the guard part: its lines sit in a section (a part tag marks them).
// To adapt: change the rows in rules.ts and write judge(). Keep the hooks and keep hooks/kit/ as it is.
import type { Register } from 'claude-code'
import { TEXT } from './domain'
import { judge, proof } from './rules'

export const register: Register = on => {
  on('session.start', async ($, e, next) => { // @skip: registers the command; draws nothing
    await $.command.register({ name: 'guard-starter', description: TEXT.about })
    return next(e)
  })

  // @part-guard:begin
  // The proof command: run the probe through every hook of this plugin, as a model call goes.
  on('command.run', { command: 'guard-starter' }, async $ => ({ text: await proof(command => $.tool.call({ tool: 'Bash', command }), await $.session.root()) }))

  // The guard. It judges BEFORE it calls next: a refusal after next(e) comes too late, the tool has run.
  // The .catch makes it fail closed. A hook that throws is skipped and the call goes on, unless the
  // .catch answers in its place. Where the hook did not call next yet, the .catch refuses.
  // Where it did, next(e) replays what that call settled to, and nothing runs twice.
  // Register the guard BEFORE any observer of the same event: a refusal then returns before the observer runs,
  // and an observer that throws cannot undo it (tested: an observer first lost the refusal).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const hit = judge(e.command, await $.session.root())
    return hit === undefined ? next(e) : { deny: `${$.plugin.name}: ${hit.why}` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: its rules failed. The call is refused.` }))
  // @part-guard:end
}
