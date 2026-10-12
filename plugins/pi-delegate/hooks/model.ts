// The shapes, the selectors and the navigation of the agents pane.
// The kit (hooks/kit/) holds the screen rules; this file says what the rows and keys are.
import type { AgentRef, Scenario, Tab, UiState, View, World, WorldExtra } from '../types'
import { KEYS } from './kit/defaults'
import type { Ctx, Handles, ListKeys, Nav } from './kit/types'
import { listOrder } from './agents-format'
import type { Agent, Ev, Step } from './agents-format'
import { D, sessionOf } from './source'
import type { Io } from './source'

export const PANE = 'pi-agents'
export const TITLE = 'pi agents'
export const TABS: readonly (readonly [Tab, string])[] = [['result', 'Result'], ['activity', 'Activity'], ['log', 'Log'], ['questions', 'Questions']]
export const SETTING_KEYS = ['questions_per_turn', 'turn_timeout_minutes', 'question_wait_minutes', 'max_live_children', 'idle_park_minutes', 'default_thinking'] as const

// The handles of this mod: the kit handles and the data source io (bind() in register.tsx).
export type K = Handles<View, AgentRef, Scenario, WorldExtra> & { io: Io }
export type C = Ctx<View, AgentRef, Scenario, WorldExtra> & { k: K; placement: 'dock' | 'inline' }

export const UI0: UiState = {
  view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '',
}
export const WORLD_BASE: World = {
  variant: 'C', scenario: 'live', run: 0, loaded: false, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0,
  tab: 'result', agent: '', resultTurn: 0, scope: 'project', foreign: {}, agentBusy: {}, lastQid: '',
}

// ---- selectors ---------------------------------------------------------------

export function agents(): Agent[] {
  return listOrder(D.agents)
}
export function agentNamed(name: string): Agent | undefined {
  return D.agents.find(a => a.name === name)
}
// The selected agent of the list: the row of u.sel, else the agent of the detail, else the first row
// (the first row of the first group that has rows).
export function listSel(u: UiState, w: World): Agent | undefined {
  const rows = agents()
  return rows.find(a => a.name === u.sel) ?? rows.find(a => a.name === w.agent) ?? rows[0]
}
// The agent that the detail shows.
export function detailAgent(u: UiState, w: World): Agent | undefined {
  return agentNamed(w.agent) ?? listSel(u, w)
}
// The setting that has the pointer: it follows the ring (u.focusKey), so the pointer and the ring agree.
export function settingOf(u: UiState): string {
  // The ring is on the row (`set:<key>`) or in its field (`in:set:<key>#<epoch>`).
  const f = u.focusKey.startsWith(`${KEYS.input}set:`) ? u.focusKey.slice(KEYS.input.length).split('#')[0] ?? '' : u.focusKey
  const key = f.startsWith('set:') ? f.slice(4) : ''
  return (SETTING_KEYS as readonly string[]).includes(key) || key === 'scope' ? key : SETTING_KEYS[0]
}
export const isSplit = (c: { placement: string; cols: number }): boolean => c.placement === 'dock' && c.cols >= 110

// The composer of each state: the footer label and the words of the composer row. One label for each state.
export const COMPOSER: { readonly [state: string]: { key: string; label: string; prompt: string; hint: string } } = {
  running: { key: 'm', label: 'steer', prompt: 'Steer', hint: 'Your message goes into the current turn.' },
  spawning: { key: 'm', label: 'steer', prompt: 'Steer', hint: 'Your message goes into the current turn.' },
  idle: { key: 'm', label: 'message', prompt: 'Message', hint: 'Your message starts the next turn.' },
  parked: { key: 'm', label: 'wake and send', prompt: 'Wake and send', hint: 'Sending restarts its process with the same session.' },
  stopped: { key: 'm', label: 'wake and send', prompt: 'Wake and send', hint: 'Sending starts it again with the same session.' },
  failed: { key: 'm', label: 'restart and send', prompt: 'Restart and send', hint: 'Sending restarts it with the same session.' },
}
export function composerOf(agent: Agent | undefined): (typeof COMPOSER)[string] | undefined {
  if (!agent || agent.broken || agent.questions.length) return undefined
  return COMPOSER[agent.meta.state ?? '']
}

// ---- the drawn list ------------------------------------------------------------

// Layout cache: the row keys of the list that the last render drew, and for which screen.
// The render may set it (as the kit's own window buffer); the focus hook reads it, so the
// slot math uses the keys that are on the screen.
let drawn: { owner: string; keys: readonly string[] } = { owner: '', keys: [] }
export function noteDrawn(owner: string, keys: readonly string[]): void {
  drawn = { owner, keys }
}
export function ownerOf(u: UiState, w: World, split: boolean): string {
  if (u.view === 'settings') return 'settings'
  if (u.view === 'list') return 'list'
  return split ? `split:${w.tab}` : `detail:${w.tab}`
}
let lastSplit = false
export function noteSplit(split: boolean): void {
  lastSplit = split
}
// The ring order of the list on the screen, for the kit's focus hook.
export function keysOf(u: UiState, w: World): ListKeys | null {
  const owner = ownerOf(u, w, lastSplit)
  if (drawn.owner !== owner || !drawn.keys.length) return null
  return { keys: drawn.keys, at: drawn.keys.indexOf(KEYS.row + u.sel) }
}

// ---- navigation ------------------------------------------------------------------

export function homeOf(u: UiState, w: World): string {
  if (u.view === 'detail') return `${KEYS.tab}${w.tab}`
  if (u.view === 'settings') return `set:${settingOf(u)}`
  const sel = listSel(u, w)
  return sel ? KEYS.row + sel.name : `${KEYS.act}s`
}

// Esc goes back one level: settings to the screen it came from, the detail to the list.
// Only the list closes the pane (kit/close.ts).
export const NAV: Nav<View, AgentRef, Scenario, WorldExtra> = {
  back: (u, w) => {
    if (u.view === 'settings') return u.cameFrom === 'detail' && agentNamed(w.agent) ? 'detail' : 'list'
    return u.view === 'detail' ? 'list' : null
  },
  home: homeOf,
}

// ---- the rows of the detail lists ---------------------------------------------------

// The rows of the Activity tab: every step but thinking.
export type StepItem = { id: string; step: Exclude<Step, { kind: 'thinking' }> }
export function stepItems(agent: Agent): { items: StepItem[]; thinking: number } {
  const all = sessionOf(agent)?.parsed.steps ?? []
  let thinking = 0
  const items: StepItem[] = []
  all.forEach((step, idx) => {
    if (step.kind === 'thinking') thinking += step.count
    else items.push({ id: `step:${idx}`, step })
  })
  return { items, thinking }
}


export type EvItem = { id: string; e: Ev; idle?: number }
export function logItems(agent: Agent): EvItem[] {
  const events = agent.events
  const items: EvItem[] = []
  for (const e of events) {
    let idle: number | undefined
    if (e.type === 'parked') {
      const done = events.filter(x => (x.type === 'done' || x.type === 'failed') && (x.seq ?? 0) < (e.seq ?? 0)).at(-1)
      if (done) idle = Math.round((Date.parse(e.ts ?? '') - Date.parse(done.ts ?? '')) / 60000)
    }
    items.push({ id: `ev:${e.seq ?? items.length}`, e, idle: idle !== undefined && Number.isFinite(idle) ? idle : undefined })
  }
  return items
}

