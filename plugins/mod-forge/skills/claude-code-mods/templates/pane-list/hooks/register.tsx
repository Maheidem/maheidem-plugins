// pane-list: the list-pane starter of the claude-code-mods skill, built on the kit (hooks/kit/).
// This file only wires the hooks. The kit holds the rules. views.tsx holds the screens. domain.ts holds the data.
// ONE prototype mod serves both halves of the design pass (references/ux-design.md 2,
// references/storyboard.md):
//   mockups     /pane-list <A|B|C|D> <scenario>
//   storyboard  /pane-list <A|B|C|D> <scenario>   (crawl.py --command "/{mod} C {scenario}")
// The reply names the variant and the scenario ("Scenario C empty"): a journey marker
// with region "screen" can use it.
// The lines that carry the proto tag are the prototype: mods.py build removes them and turns each real line into code (references/storyboard.md).
// To adapt: change the STYLE table in views.tsx (one row per persona sketch) and write the data source in source.ts.
// Keep the hooks and keep hooks/kit/ as it is.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { World } from '../types'
import type { Drafts } from './kit/types'
import { closeHook } from './kit/close'
import { ctx } from './kit/ctx'
import { focusHook } from './kit/focus'
import { pressHook } from './kit/press'
import { openPane } from './kit/pane'
import { parseSwitch, reply, startScenario, usage } from './kit/scenario' // @proto
import { mobileNote } from './kit/states'
import { SCENARIOS, TEXT, VARIANTS, WORLD_BASE } from './domain'
import { NAV, UI0, draw, keysOf, load } from './views'
import type { K } from './views'
import { startTimers } from './views' // @proto
import { worldFor } from './fixtures' // @proto
// @real: import { act, readRows } from './source'
// @real: import type { Io } from './source'

const PANE = 'pane-list'
const OPEN = { id: PANE, title: TEXT.title, closeOnEscape: true, focus: true, rows: 18 } as const
const ui = atom({ plugin: 'pane-list', key: 'ui' } as const, UI0)
const world = atom({ plugin: 'pane-list', key: 'world' } as const, WORLD_BASE) // @proto
// @real: const world = atom({ plugin: 'pane-list', key: 'world' } as const, { ...WORLD_BASE, variant: '{{picked}}' })
const drafts = atom({ plugin: 'pane-list', key: 'drafts' } as const, {} as Drafts)

// The only function that holds $. The ui and world cells merge a patch. The drafts cell replaces the value.
// read and act are the data source: the prototype has none (the fixtures are the data), the real mod runs source.ts.
function bind($: EngineInterface): K {
  // @real: const io: Io = { run: async argv => $.process.run([...argv], { cwd: await $.session.root(), timeoutMs: 15000 }), root: () => $.session.root(), store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) } }
  return {
    pane: PANE,
    ui: { get: () => read($, ui), set: f => update($, ui, v => ({ ...v, ...f(v) })) },
    world: { get: () => read($, world), set: f => update($, world, v => ({ ...v, ...f(v) })) },
    drafts: { get: () => read($, drafts), set: f => update($, drafts, f) },
    focus: key => $.ui.focus({ requestId: PANE, key }), open: () => $.ui.open(OPEN), close: () => $.ui.close({ id: PANE }), // @skip: bind(): the host handles; the Esc ladder is the ui.close hook
    panes: () => $.ui.panes(), sleep: ms => $.clock.sleep(ms), now: () => $.clock.now(), // @skip: bind(): the host handles; the kit waits with them
    toast: t => $.ui.toast(t), log: t => $.ui.log(t), status: t => $.ui.status(t), invalidate: () => $.ui.invalidate('ui.render'),
    read: async (): Promise<Partial<World>> => ({}), // @proto
    act: async () => undefined, // @proto
    // @real: read: async () => readRows(io, await $.clock.now()),
    // @real: act: (kind, row, text) => act(io, kind, row, text),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => { // @skip: registers the command; draws nothing
    await $.command.register({
      name: 'pane-list',
      description: TEXT.about,
      argumentHint: '<A|B|C|D> [scenario]', // @proto
    })
    return next(e)
  })

  // The real pane reads again when a turn ends, while it is open: data that the turn changed (a tool.call observer, a file) shows.
  // @real: on('turn.complete', async ($, e, next) => { const k = bind($); if ((await k.panes()).some(p => p.id === PANE)) await load(k); return next(e) }).catch(($, e, next) => next(e))

  // The command. With no argument it only opens the pane again (the state is kept).
  on('command.run', { command: 'pane-list' }, async ($, e) => {
    const k = bind($)
    // @proto:begin
    const sw = parseSwitch(e.args, VARIANTS, SCENARIOS)
    if (e.args.trim() !== '' && sw === null) return { text: usage('pane-list', VARIANTS, SCENARIOS) }
    if (sw) startTimers(k, sw.scenario, await startScenario(k, sw.scenario, sw.variant, worldFor, UI0))
    // @proto:end
    const opened = await openPane(k, { view: 'list' })
    if (!opened.isPlaced) return { text: `Pane waits: ${opened.reason}` }
    // @real: await load(k)
    return { text: sw ? reply(sw.variant, sw.scenario) : 'Scenario kept' } // @proto
    // @real: return { text: `${TEXT.title} opened` }
  })

  // Esc steps back one level. Only the top level lets the pane close (kit/close.ts).
  on('ui.close', { id: PANE }, ($, e, next) => closeHook(bind($), e, next, NAV)).catch(($, e, next) => next(e))

  // The selection follows the ring: the arrows walk the rows, the ring lands by screen slot (kit/focus.ts).
  on('ui.focus', { component: 'Pane', requestId: PANE }, ($, e, next) => focusHook(bind($), e, next, { keys: keysOf, nav: NAV })).catch(($, e, next) => next(e))

  // A press clears a notice that has no timer (kit/press.ts).
  on('ui.press', ($, e, next) => pressHook(bind($), e, next)) // @skip: clears a notice with no timer on a press; the crawl presses no Button while one shows (tests/kit.press.test.ts)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Return early for mobile and vscode, before the code takes Input from resolve().
    if (e.surface === 'mobile' || e.surface === 'vscode') return mobileNote($.ui.resolve(e)) // @skip: mobile surface; the storyboard is the terminal only
    const k = bind($)
    return draw({ ...(await ctx(k, $.ui.resolve(e), e.props)), k })
  })
}
