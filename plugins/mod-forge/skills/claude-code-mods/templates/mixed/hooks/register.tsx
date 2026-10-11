// mixed: the combined starter of the claude-code-mods skill, built on the kit (hooks/kit/).
// ONE hooks module holds five parts. This file only wires the hooks. The kit holds the rules.
// views.tsx holds the screens, rules.ts holds the guard rules.
//   pane     a list pane: list, detail, add, delete with a confirm
//   band     a one-line band above the prompt that names the item that needs you. Open (ctrl+x tab, Enter) opens the pane
//   toast    a news line in the transcript, and a toast while the pane is closed (a working item asks a question)
//   guard    a tool.call hook that refuses risky Bash commands and fails closed
//   command  the slash command: it answers with a transcript row (a ui.render hook draws it)
// ONE prototype command serves both halves of the design pass (references/ux-design.md 2, references/storyboard.md):
//   mockups     /mixed <A|B|C|D> <scenario>          (opens the pane)
//   storyboard  /mixed <A|B|C|D> <scenario> [closed] (crawl.py --command "/{mod} C {scenario}")
// The reply names the variant and the scenario ("Scenario C normal"): a journey marker with region "screen" can use it.
// The scenario guarded also runs one refused fixture call through the guard, as a model call would.
// Its reply holds "Refused" when the guard works. That text is the marker of mods.py live.
// To adapt: rename with scripts/new-mod.sh, then change the fixtures, the texts, the STYLE table in views.tsx
// (one row per persona sketch) and the rows in rules.ts. Remove the parts you do not need.
// Keep the hooks and keep hooks/kit/ as it is.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { UiState, World } from '../types'
import type { Cell, Drafts, Host, PatchCell } from './kit/types'
import { bandQuiet, bandRow, openFromBand } from './kit/band'
import { closeHook } from './kit/close'
import { ctx } from './kit/ctx'
import { KEYS, GLYPHS } from './kit/defaults'
import { focusHook } from './kit/focus'
import { clean, cut, oneLine } from './kit/format'
import { closeIfOpen, openPane } from './kit/pane'
import { pressHook } from './kit/press'
import { parseSwitch, reply, startScenario, usage } from './kit/scenario'
import { mobileNote } from './kit/states'
import { judge } from './rules'
import { NAV, SCENARIOS, UI0, VARIANTS, WORLD0, bandLine, bandTarget, draw, keysOf, outputView, startTimers } from './views'
import { worldFor } from './fixtures'

const NAME = 'mixed'
const PANE = 'mixed'
const OPEN = { id: PANE, title: 'Items', closeOnEscape: true, focus: true, rows: 18 } as const
const ui = atom({ plugin: 'mixed', key: 'ui' } as const, UI0)
const world = atom({ plugin: 'mixed', key: 'world' } as const, WORLD0)
const drafts = atom({ plugin: 'mixed', key: 'drafts' } as const, {} as Drafts)

// The fixture call of the guarded scenario. The rule rm-recursive refuses it. The path does not exist,
// so the call is harmless even when the rules fail to refuse it. Keep a fixture that is safe to run.
const FIXTURE = 'rm -rf mod-fixture-missing-dir'
const REPLY_COLS = 100 // the text of a refusal in the reply: the reason is short, a long one is cut

type ModHandles = Host & { ui: PatchCell<UiState>; world: PatchCell<World>; drafts: Cell<Drafts> }
// The only function that holds $. The ui and world cells merge a patch. The drafts cell replaces the value.
function bind($: EngineInterface): ModHandles {
  return {
    pane: PANE,
    ui: { get: () => read($, ui), set: f => update($, ui, v => ({ ...v, ...f(v) })) },
    world: { get: () => read($, world), set: f => update($, world, v => ({ ...v, ...f(v) })) },
    drafts: { get: () => read($, drafts), set: f => update($, drafts, f) },
    focus: key => $.ui.focus({ requestId: PANE, key }), open: () => $.ui.open(OPEN), close: () => $.ui.close({ id: PANE }),
    panes: () => $.ui.panes(), sleep: ms => $.clock.sleep(ms), now: () => $.clock.now(),
    toast: t => $.ui.toast(t), log: t => $.ui.log(t), status: t => $.ui.status(t), invalidate: () => $.ui.invalidate('ui.render'),
  }
}

// Run the fixture call through every hook of this plugin, as a model call goes. One line tells the result.
async function probeGuard($: EngineInterface): Promise<string> {
  try {
    const r = await $.tool.call({ tool: 'Bash', command: FIXTURE })
    if (r.deny === undefined) return `${GLYPHS.err} The fixture call was NOT refused: ${FIXTURE}`
    return `${GLYPHS.ok} Refused: ${cut(oneLine(clean(r.deny)), REPLY_COLS)}`
  } catch (err) {
    return `${GLYPHS.err} The fixture call did not run: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: NAME, description: 'Open the list pane, the band and the guard proof', argumentHint: '<A|B|C|D> [scenario] [closed]' })
    return next(e)
  })

  // The reset command. With no argument it only opens the pane again (the state is kept).
  // The word "closed" at the end keeps the pane shut, so the band shows (the storyboard).
  on('command.run', { command: NAME }, async ($, e) => {
    const k = bind($)
    const closed = /(^|\s)closed\s*$/.test(e.args)
    const args = e.args.replace(/(^|\s)closed\s*$/, '')
    const sw = parseSwitch(args, VARIANTS, SCENARIOS)
    if (args.trim() !== '' && sw === null) return { text: `${usage(NAME, VARIANTS, SCENARIOS)} [closed]` }
    if (sw) startTimers(k, sw.scenario, await startScenario(k, sw.scenario, sw.variant, worldFor, UI0))
    if (closed) await closeIfOpen(k)
    else {
      const target = bandTarget(await k.world.get())
      const opened = await openPane(k, { view: 'list', sel: target?.id ?? '' })
      if (!opened.isPlaced) return { text: `Pane waits: ${opened.reason}` }
    }
    const head = sw ? reply(sw.variant, sw.scenario) : 'Scenario kept'
    return { text: sw?.scenario === 'guarded' ? `${head}\n${await probeGuard($)}` : head }
  })

  // The output row of this command. The row of an error (isErrored) stays the engine's.
  // The .catch keeps the row safe: when this hook fails, the engine draws its own row.
  on('ui.render', { component: 'CommandOutput', props: { command: NAME } }, ($, e, next) => {
    if (e.props.isErrored) return next(e)
    return outputView($.ui.resolve(e), e.props.text)
  }).catch(($, e, next) => next(e))

  // The guard. It judges BEFORE it calls next: a refusal after next(e) comes too late, the tool has run.
  // The .catch makes it fail closed. A hook that throws is skipped and the call goes on, unless the
  // .catch answers in its place. Where the hook did not call next yet, the .catch refuses.
  // Where it did, next(e) replays what that call settled to, and nothing runs twice.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const hit = judge(e.command)
    return hit === undefined ? next(e) : { deny: `${$.plugin.name}: ${hit.why}` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: its rules failed. The call is refused.` }))

  // Esc steps back one level. Only the top level lets the pane close (kit/close.ts).
  on('ui.close', { id: PANE }, ($, e, next) => closeHook(bind($), e, next, NAV)).catch(($, e, next) => next(e))

  // The selection follows the ring: the arrows walk the rows, the ring lands by screen slot (kit/focus.ts).
  on('ui.focus', { component: 'Pane', requestId: PANE }, ($, e, next) => focusHook(bind($), e, next, { keys: keysOf, nav: NAV })).catch(($, e, next) => next(e))

  // A press clears a notice that has no timer (kit/press.ts).
  on('ui.press', ($, e, next) => pressHook(bind($), e, next))

  // The band. It yields to a survey, to a world with no scenario, and to the open pane (kit/band.tsx).
  // Open selects the item that the band names, opens the pane, then focuses that row.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const k = bind($)
    const w = await k.world.get()
    const target = bandTarget(w)
    if (target === undefined || (await bandQuiet(k, e.props, w))) return next(e)
    const E = $.ui.resolve(e)
    return bandRow(E, bandLine(E, w), () => void openFromBand(k, { view: 'list', sel: target.id }, KEYS.row + target.id, NAV).catch(() => undefined))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Return early for mobile and vscode, before the code takes Input from resolve().
    if (e.surface === 'mobile' || e.surface === 'vscode') return mobileNote($.ui.resolve(e))
    return draw(await ctx(bind($), $.ui.resolve(e), e.props))
  })
}
