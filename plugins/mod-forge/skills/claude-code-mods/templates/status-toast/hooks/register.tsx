// status-toast: the observer starter of the claude-code-mods skill, built on the kit (hooks/kit/).
// It draws no pane. It has up to three parts, each in a section (a part tag marks its lines):
//   toast    an event hook makes one row from an event ($.ui.log and $.ui.toast say the row)
//   command  the command /status-toast prints the last rows
//   guard    a tool.call hook refuses a risky Bash command before it runs (rules.ts judges)
// watch.ts holds the rules of the toast. This file only wires the hooks. domain.ts holds the data and the texts.
// ONE prototype mod serves the design pass (references/ux-design.md 2, references/storyboard.md):
//   live        /status-toast A <scenario>
//   storyboard  /status-toast A <scenario>   (crawl.py --command "/{mod} A {scenario}")
// The prototype command sends each fixture row of the scenario to the mod, as an event would. The scenario deny runs the probe
// through the guard. The reply names the scenario ("Scenario A normal"). The transcript line is the journey marker, region "screen".
// The lines that carry the proto tag are the prototype: mods.py build removes them and turns each real line into code (references/storyboard.md).
// To adapt: write rowFrom in watch.ts (and judge in rules.ts for the guard). Keep the hooks and keep hooks/kit/ as it is.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Seen } from '../types'
import { parseSwitch, reply, usage } from './kit/scenario' // @proto
import type { PatchCell } from './kit/types'
import { ROLE, SCENARIOS, TEXT, VARIANTS, history } from './domain'
import { fixtureRows } from './fixtures' // @proto
import { judge, proof } from './rules' // @part-guard
import { announce, remember, rowFrom } from './watch'
import type { Handles } from './watch'

const seen = atom({ plugin: 'status-toast', key: 'seen' } as const, { rows: [] } as Seen)

// The only function that holds $. The cell merges a patch.
function bind($: EngineInterface): Handles {
  const cell: PatchCell<Seen> = { get: () => read($, seen), set: f => update($, seen, v => ({ ...v, ...f(v) })) }
  return { seen: cell, toast: t => $.ui.toast(t), log: t => $.ui.log(t), status: t => $.ui.status(t) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => { // @skip: registers the command; draws nothing
    await $.command.register({ name: 'status-toast', description: TEXT.about, argumentHint: '<A> [scenario]' }) // @proto
    // @part-command:begin
    // @real: await $.command.register({ name: 'status-toast', description: TEXT.about })
    // @part-command:end
    return next(e)
  })

  // @proto:begin
  // The prototype command: send the fixture rows of the scenario to the mod, one by one, as events would come.
  on('command.run', { command: 'status-toast' }, async ($, e) => {
    const sw = parseSwitch(e.args, VARIANTS, SCENARIOS)
    if (sw === null) return { text: usage('status-toast', VARIANTS, SCENARIOS) }
    const k = bind($)
    await k.seen.set(() => ({ rows: [] }))
    if (ROLE[sw.scenario] === 'deny') return { text: await proof(command => $.tool.call({ tool: 'Bash', command })) } // @part-guard
    for (const r of fixtureRows(sw.scenario)) {
      announce(k, r)
      await remember(k, r)
    }
    const lines = [reply(sw.variant, sw.scenario)]
    lines.push(...history((await k.seen.get()).rows)) // @part-command
    return { text: lines.join('\n') }
  })
  // @proto:end

  // @part-command:begin
  // The real command: print the last rows that the mod saw.
  // @real: on('command.run', { command: 'status-toast' }, async $ => ({ text: history((await read($, seen)).rows).join('\n') }))
  // @part-command:end

  // @part-guard:begin
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

  // @part-toast:begin
  // The observer. It passes the event on first, then makes a row from it. The .catch keeps the event safe:
  // when this hook fails, the event goes on as it was. The engine wants the event name as a literal here:
  // mods.py build writes the event of the domain (EVENT in ./domain, flag --on) in place of the placeholder in the @real line.
  // @real: on('{{event}}', async ($, e, next) => {
  // @real:   const ran = await next(e)
  // @real:   const k = bind($)
  // @real:   const row = await rowFrom(k, e)
  // @real:   if (row !== undefined) {
  // @real:     announce(k, row)
  // @real:     await remember(k, row)
  // @real:   }
  // @real:   return ran
  // @real: }).catch(($, e, next) => next(e))
  // @part-toast:end
}
