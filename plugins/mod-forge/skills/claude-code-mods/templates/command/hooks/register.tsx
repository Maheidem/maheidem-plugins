// command-demo: the slash-command starter of the claude-code-mods skill, built on the kit (hooks/kit/).
// It draws no pane. A command.run hook answers a slash command with { text }: the head, then the last rows.
// A ui.render hook on the CommandOutput row draws that text as a tree (views.tsx). domain.ts holds the data and the texts.
// ONE prototype mod serves the design pass (references/ux-design.md 2, references/storyboard.md):
//   live        /command-demo A <scenario>
//   storyboard  /command-demo A <scenario>   (crawl.py --command "/{mod} A {scenario}")
// The prototype command answers with the fixture rows of the scenario. The real command reads the data source (source.ts).
// The first line of the prototype reply names the scenario ("Scenario A normal"). The output row is the journey marker, region "screen".
// It has up to two parts, each in a section (a part tag marks its lines): command and guard (a tool.call hook, rules.ts judges).
// The lines that carry the proto tag are the prototype: mods.py build removes them and turns each real line into code (references/storyboard.md).
// To adapt: write readRows in source.ts. Keep the hooks and keep hooks/kit/ as it is.
import type { Register } from 'claude-code'
import { GLYPHS } from './kit/defaults'
import { clean, firstLine } from './kit/format'
import { parseSwitch, reply, usage } from './kit/scenario' // @proto
import { ROLE, SCENARIOS, TEXT, VARIANTS, history } from './domain'
import { fixtureRows } from './fixtures' // @proto
import { judge, proof } from './rules' // @part-guard
import { outputView } from './views'
// @real: import { readRows } from './source'
// @real: import type { Io } from './source'

const NAME = 'command-demo'
export const register: Register = on => {
  on('session.start', async ($, e, next) => { // @skip: registers the command; draws nothing
    await $.command.register({
      name: NAME,
      description: TEXT.about,
      argumentHint: '<A> [scenario]', // @proto
    })
    return next(e)
  })

  // The command. The prototype answers with the fixture rows of a scenario. The real command reads the data source.
  on('command.run', { command: NAME }, async ($, e) => {
    // @proto:begin
    const sw = parseSwitch(e.args, VARIANTS, SCENARIOS)
    if (sw === null) return { text: usage(NAME, VARIANTS, SCENARIOS) }
    if (ROLE[sw.scenario] === 'deny') return { text: await proof(command => $.tool.call({ tool: 'Bash', command })) } // @part-guard
    return { text: [reply(sw.variant, sw.scenario), ...history(fixtureRows(sw.scenario))].join('\n') }
    // @proto:end
    // @real: try {
    // @real:   const io: Io = { run: async argv => $.process.run([...argv], { cwd: await $.session.root(), timeoutMs: 15000 }), root: () => $.session.root(), store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) } }
    // @real:   return { text: history((await readRows(io, await $.clock.now())).rows).join('\n') }
    // @real: } catch (err) {
    // @real:   return { text: `${GLYPHS.err} ${firstLine(clean(err instanceof Error ? err.message : err))}` }
    // @real: }
  })

  // The output row of this command. The row of an error (isErrored) stays the engine's.
  // The .catch keeps the row safe: when this hook fails, the engine draws its own row.
  on('ui.render', { component: 'CommandOutput', props: { command: NAME } }, ($, e, next) => {
    if (e.props.isErrored) return next(e)
    return outputView($.ui.resolve(e), e.props.text)
  }).catch(($, e, next) => next(e))

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
}
