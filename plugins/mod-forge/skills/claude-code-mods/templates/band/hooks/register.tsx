// prompt-band: the band starter of the claude-code-mods skill, built on the kit (hooks/kit/).
// A one-line band above the prompt tells the state of the rows. Open (ctrl+x tab, Enter) opens a small list pane.
// While the pane is open the band stays quiet. This file only wires the hooks. The kit holds the rules.
// views.tsx holds the band line and the screens. domain.ts holds the data and the parts of the band line.
// ONE prototype mod serves both halves of the design pass (references/ux-design.md 2,
// references/storyboard.md):
//   mockups     /prompt-band <A|B|C|D> <scenario>   (opens the pane)
//   storyboard  /prompt-band <A|B|C|D> <scenario> closed   (the pane stays closed: the band shows)
// The reply names the variant and the scenario ("Scenario C normal"): a journey marker with region "screen" can use it.
// The band can yield while no model turn runs (band idle 'yield' in the domain): the real mod reads e.props.isWorking,
// the prototype has no turn, so the scenario role idle stands for it.
// The lines that carry the proto tag are the prototype: mods.py build removes them and turns each real line into code (references/storyboard.md).
// To adapt: change the STYLE table in views.tsx (one row per persona sketch) and write the data source in source.ts.
// Keep the hooks and keep hooks/kit/ as it is.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { World } from '../types'
import type { Drafts } from './kit/types'
import { bandQuiet, bandRow, openFromBand } from './kit/band'
import { closeHook } from './kit/close'
import { ctx } from './kit/ctx'
import { KEYS } from './kit/defaults'
import { focusHook } from './kit/focus'
import { openPane } from './kit/pane'
import { pressHook } from './kit/press'
import { closeIfOpen } from './kit/pane' // @proto
import { parseSwitch, reply, startScenario, usage } from './kit/scenario' // @proto
import { mobileNote } from './kit/states'
import { BAND, ROLE, SCENARIOS, TEXT, VARIANTS, WORLD_BASE, bandSegs } from './domain'
import { NAV, UI0, bandKeys, bandLine, draw, keysOf, load } from './views'
import type { K } from './views'
import { startTimers } from './views' // @proto
import { worldFor } from './fixtures' // @proto
// @real: import { act, readRows } from './source'
// @real: import type { Io } from './source'

const PANE = 'prompt-band'
const OPEN = { id: PANE, title: TEXT.title, closeOnEscape: true, focus: true, rows: 12 } as const
const ui = atom({ plugin: 'prompt-band', key: 'ui' } as const, UI0)
const world = atom({ plugin: 'prompt-band', key: 'world' } as const, WORLD_BASE) // @proto
// @real: const world = atom({ plugin: 'prompt-band', key: 'world' } as const, { ...WORLD_BASE, variant: '{{picked}}', run: 1 })
const drafts = atom({ plugin: 'prompt-band', key: 'drafts' } as const, {} as Drafts)

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
      name: 'prompt-band',
      description: TEXT.about,
      argumentHint: '<A|B|C|D> [scenario] [closed]', // @proto
    })
    // @real: await load(bind($)) // the real band has no scenario: it reads once at start (run is 1, so bandQuiet lets it draw)
    return next(e)
  })

  // The real band reads again on each prompt, so its line is right for the turn that follows.
  // @real: on('prompt.submit', async ($, e, next) => { await load(bind($)); return next(e) }).catch(($, e, next) => next(e))

  // The command. With no argument it only opens the pane again (the state is kept).
  // The word "closed" at the end keeps the pane shut, so the band shows (the storyboard).
  on('command.run', { command: 'prompt-band' }, async ($, e) => {
    const k = bind($)
    // @proto:begin
    const closed = /(^|\s)closed\s*$/.test(e.args)
    const args = e.args.replace(/(^|\s)closed\s*$/, '')
    const sw = parseSwitch(args, VARIANTS, SCENARIOS)
    if (args.trim() !== '' && sw === null) return { text: `${usage('prompt-band', VARIANTS, SCENARIOS)} [closed]` }
    if (sw) startTimers(k, sw.scenario, await startScenario(k, sw.scenario, sw.variant, worldFor, UI0))
    if (closed) {
      await closeIfOpen(k)
      return { text: sw ? reply(sw.variant, sw.scenario) : 'Scenario kept' }
    }
    // @proto:end
    const opened = await openPane(k, { view: 'list', sel: (await k.world.get()).rows[0]?.id ?? '' })
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

  // The band. It yields to a survey, to a world with no scenario, to the open pane and, with idle 'yield', to a turn that does not run (kit/band.tsx).
  // Open selects the first row, opens the pane, then focuses that row. The keys of the band follow open.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const k = bind($)
    const w = await k.world.get()
    const working = ROLE[w.scenario] !== 'idle' // @proto
    // @real: const working = e.props.isWorking
    if (await bandQuiet(k, e.props, w, { idle: BAND.idle, working })) return next(e)
    const segs = bandSegs(w)
    if (segs.length === 0) return next(e) // @skip: a clean world draws no band
    const E = $.ui.resolve(e)
    const first = w.rows[0]?.id ?? ''
    return bandRow(E, bandLine(E, w, segs), () => void openFromBand(k, { view: 'list', sel: first }, KEYS.row + first, NAV).catch(() => undefined), bandKeys(k))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Return early for mobile and vscode, before the code takes Input from resolve().
    if (e.surface === 'mobile' || e.surface === 'vscode') return mobileNote($.ui.resolve(e)) // @skip: mobile surface; the storyboard is the terminal only
    const k = bind($)
    return draw({ ...(await ctx(k, $.ui.resolve(e), e.props)), k })
  })
}
