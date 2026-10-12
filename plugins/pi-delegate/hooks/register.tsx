// pi agents: the pane, the band above the prompt, the toasts and the log lines.
// This file only wires the hooks. The kit (hooks/kit/) holds the screen rules, views.tsx and
// detail.tsx hold the screens, actions.ts holds the keys, source.ts reads the disk and calls the MCP tools.
// The pane reads disk only. An explicit action goes through the session's own pi-delegate MCP tools,
// which own every decision about ownership (the pane never guesses it).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Drafts } from './kit/types'
import { ctx } from './kit/ctx'
import { focusHook } from './kit/focus'
import { pressHook } from './kit/press'
import { openPane } from './kit/pane'
import { mobileNote } from './kit/states'
import { D, resetCache } from './source'
import type { Io } from './source'
import { NAV, PANE, TITLE, UI0, WORLD_BASE, keysOf } from './model'
import type { K } from './model'
import { escape, load } from './actions'
import { band, draw, setHome } from './views'

const ui = atom({ plugin: 'pi-delegate', key: 'ui' } as const, UI0)
const world = atom({ plugin: 'pi-delegate', key: 'world' } as const, WORLD_BASE)
const drafts = atom({ plugin: 'pi-delegate', key: 'drafts' } as const, {} as Drafts)

// Layout cache: the width of the screen at the last draw (a very wide terminal gets a wider dock),
// and whether the pane had the keys at its last draw (the Esc hook reads it).
let viewportColumns = 0
let paneHadKeys = true
function openArgs(): { id: string; title: string; focus: true; closeOnEscape: true; rows: number; columns?: number } {
  return { id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows: Math.min(D.agents.length + 16, 30), ...(viewportColumns >= 240 ? { columns: 112 } : {}) }
}

// The only function that holds $. The ui and world cells merge a patch. The drafts cell replaces the value.
function bind($: EngineInterface): K {
  const io: Io = {
    list: path => $.fs.list(path),
    read: path => $.fs.read(path),
    stat: path => $.fs.stat(path),
    run: async (argv, o) => $.process.run([...argv], { cwd: o?.cwd ?? (await $.session.root()), timeoutMs: o?.timeoutMs ?? 10000 }),
    tools: () => $.tool.list(),
    call: input => $.tool.call(input as never),
    // $.env.get takes a literal name, so the variables the pane reads are listed here.
    env: name => {
      switch (name) {
        case 'PI_DELEGATE_VIEW_DATA': return $.env.get('PI_DELEGATE_VIEW_DATA')
        case 'PI_DELEGATE_VIEW_PROJECT': return $.env.get('PI_DELEGATE_VIEW_PROJECT')
        case 'CLAUDE_CONFIG_DIR': return $.env.get('CLAUDE_CONFIG_DIR')
        case 'CLAUDE_CODE_PLUGIN_DIRS': return $.env.get('CLAUDE_CODE_PLUGIN_DIRS')
        case 'HOME': return $.env.get('HOME')
      }
    },
    root: () => $.session.root(),
    pluginRoot: $.plugin.root,
    debug: text => { try { $.ui.log(text.slice(0, 8000), { to: 'debug' }) } catch { /* the pane still shows the error */ } },
  }
  return {
    pane: PANE,
    io,
    ui: { get: () => read($, ui), set: f => update($, ui, v => ({ ...v, ...f(v) })) },
    world: { get: () => read($, world), set: f => update($, world, v => ({ ...v, ...f(v) })) },
    drafts: { get: () => read($, drafts), set: f => update($, drafts, f) },
    focus: key => $.ui.focus({ requestId: PANE, key }), open: () => $.ui.open(openArgs()), close: () => $.ui.close({ id: PANE }),
    panes: () => $.ui.panes(), sleep: ms => $.clock.sleep(ms), now: () => $.clock.now(),
    toast: t => $.ui.toast(t), log: t => $.ui.log(t), status: t => $.ui.status(t), invalidate: () => $.ui.invalidate('ui.render'),
  }
}

// The refresh timer runs at module scope: the band, the toasts and the log lines need it while the pane is closed.
// A hot reload drops it; session.start fires again and starts a new one.
let timer: { cancel: () => void } | null = null
let lastMinute = 0

async function tick(k: K): Promise<void> {
  await load(k)
  const minute = Math.floor((await k.now()) / 60000)
  const open = (await k.panes()).some(p => p.id === PANE)
  // The ages are minute-granular: draw again once a minute while they can change.
  if (minute !== lastMinute && (open || D.agents.some(a => !a.broken && ['spawning', 'running', 'waiting'].includes(a.meta.state ?? '')))) k.invalidate()
  lastMinute = minute
}

// A reload drops the work in flight: drop its busy marks, its wait notices and an open question.
async function settle(k: K): Promise<void> {
  const w = await k.world.get()
  if (w.busy !== null || Object.keys(w.agentBusy).length) await k.world.set(() => ({ busy: null, agentBusy: {} }))
  const u = await k.ui.get()
  if (u.notice?.tone === 'warn' || u.confirm !== null || u.picking !== '') await k.ui.set(x => ({ notice: x.notice?.tone === 'warn' ? null : x.notice, confirm: null, picking: '' }))
}

async function init($: EngineInterface): Promise<void> {
  const k = bind($)
  await settle(k)
  setHome((await k.io.env('HOME')) ?? '')
  if (!timer) timer = await $.clock.every(2000, () => tick(bind($)).catch(() => undefined))
  await load(k)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try { await init($) } catch (failure) {
      try { $.ui.log(`pi-delegate pane: ${failure instanceof Error ? failure.message : String(failure)}`, { to: 'debug' }) } catch { /* nothing to show it on */ }
    }
    return next(e)
  })

  // /clear, /resume and /branch reset the cells. The timer and the module cache stay: read again now.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    resetCache()
    const k = bind($)
    try {
      // The host resets the cells too; set them here as well, so the view is the list in every case.
      await k.ui.set(() => UI0)
      await k.world.set(() => ({ ...WORLD_BASE }))
      await load(k)
    } catch { /* the next tick reads again */ }
    return next(e)
  })

  // The command lands on the list. The selection, the tab and the drafts stay.
  on('command.run', { command: 'pi-delegate:agents' }, async $ => {
    const k = bind($)
    if (!timer) await init($)
    await settle(k)
    const u = await k.ui.get()
    const opened = await openPane(k, { view: 'list', notice: u.notice?.tone === 'warn' ? null : u.notice, expandedKey: '' })
    if (!opened.isPlaced) return { text: `The pane waits: ${opened.reason}` }
    await load(k)
    return {}
  })

  // Esc steps back one level. Only the list lets the pane close (actions.ts escape, kit/close.ts).
  on('ui.close', { id: PANE }, ($, e, next) => escape(bind($), e, next, paneHadKeys)).catch(($, e, next) => next(e))

  // The selection follows the ring: the arrows walk the rows, the ring lands by screen slot (kit/focus.ts).
  on('ui.focus', { component: 'Pane', requestId: PANE }, ($, e, next) => focusHook(bind($), e, next, { keys: keysOf, nav: NAV })).catch(($, e, next) => next(e))

  // A press clears a notice that has no timer (kit/press.ts).
  on('ui.press', ($, e, next) => pressHook(bind($), e, next))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Return early for mobile and vscode, before the code takes Input from resolve().
    if (e.surface === 'mobile' || e.surface === 'vscode') return mobileNote($.ui.resolve(e))
    viewportColumns = e.viewport?.columns || viewportColumns
    paneHadKeys = e.props.isFocused
    const k = bind($)
    const c = { ...(await ctx(k, $.ui.resolve(e), e.props)), k, placement: e.props.placement }
    try {
      return draw(c)
    } catch (failure) {
      // A drawing that throws shows the error view for this draw only; the next good draw replaces it.
      logOnce(k, failure)
      return draw({ ...c, w: { ...c.w, error: 'The pane could not draw this screen. The details are in the debug log.' }, u: { ...c.u, view: 'list' } })
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    viewportColumns = e.viewport?.columns || viewportColumns
    return band(bind($), $.ui.resolve(e), e.props, () => next(e))
  }).catch(($, e, next) => next(e))
}

let logged = ''
function logOnce(k: K, failure: unknown): void {
  const text = failure instanceof Error ? failure.stack ?? failure.message : String(failure)
  if (text === logged) return
  logged = text
  k.io.debug(`pi-delegate pane: ${text}`)
}

