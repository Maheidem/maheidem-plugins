// What the keys of the agents pane do. Each handler writes the cells and moves the ring by key.
// Nobody awaits a handler: each one ends in .catch where it is called.
import type { Args, EventResult, Next } from 'claude-code'
import type { AgentRef, Tab } from '../types'
import { FOCUS_RELAYOUT_MS, FOCUS_SOON_MS, KEYS } from './kit/defaults'
import { askConfirm } from './kit/confirm'
import { closeHook } from './kit/close'
import { setDraft } from './kit/drafts'
import { focusSoon } from './kit/focus'
import { notify } from './kit/notice'
import { runAction } from './kit/scenario'
import { announce } from './kit/toast'
import type { Agent } from './agents-format'
import { firstLine, questionId } from './agents-format'
import { D, callAgentTool, declined, loadResult, loadSession, loadSettings, ownedElsewhere, readAgents, saveSetting, sigOfAgent } from './source'
import type { AgentAction } from './source'
import { settingLabel, settingValue, sourceWord } from './shared.mjs'
import { NAV, agentNamed, agents, composerOf, detailAgent, homeOf, logItems, stepItems } from './model'
import type { K } from './model'

// ---- reading -------------------------------------------------------------------

// The world rows: the names in list order, each with a signature of its data.
export function refsOf(): AgentRef[] {
  return agents().map(a => ({ name: a.name, sig: sigOfAgent(a) }))
}
function sameRefs(a: readonly AgentRef[], b: readonly AgentRef[]): boolean {
  return a.length === b.length && a.every((r, i) => r.name === b[i]?.name && r.sig === b[i]?.sig)
}

// Read the agents, announce what is new, and write the world only when it changed.
export async function load(k: K): Promise<void> {
  const lines = await readAgents(k.io)
  for (const line of lines) await announce(k, line)
  const rows = refsOf()
  const error = D.listError || D.pathsError
  const w = await k.world.get()
  if (!w.loaded || w.error !== error || !sameRefs(w.rows, rows) || w.run === 0) {
    await k.world.set(() => ({ rows, error, loaded: true, run: Math.max(1, w.run) }))
  }
  await loadDetailData(k)
  // A reload drops the settings snapshot: read it again while the settings show.
  if ((await k.ui.get()).view === 'settings' && !D.settings.data && !D.settings.loading) {
    await loadSettings(k.io)
    k.invalidate()
  }
}

// The files the detail shows: the result of the turn on screen and the session file.
// It redraws when one of them changed. The render only reads the cache.
export async function loadDetailData(k: K): Promise<void> {
  const u = await k.ui.get()
  const w = await k.world.get()
  const open = (await k.panes()).some(p => p.id === k.pane)
  if (!open && u.view !== 'detail') return
  const agent = detailAgent(u, w)
  if (!agent || agent.broken) return
  let changed = false
  const lt = agent.meta.lastTurn
  const gen = Number.isInteger(lt?.gen) ? Number(lt?.gen) : Number(agent.meta.gen ?? 1)
  const last = Number.isInteger(lt?.turn) ? Number(lt?.turn) : 0
  if (last) {
    const turn = w.resultTurn && w.resultTurn <= last ? w.resultTurn : last
    if (await loadResult(k.io, agent, gen, turn)) changed = true
  }
  if (w.tab === 'activity' || w.tab === 'questions') {
    if (await loadSession(k.io, agent)) changed = true
  }
  if (changed) k.invalidate()
}

// The retry of the error view: find the folders again and read again.
export async function retryLoad(k: K): Promise<void> {
  D.paths = null
  D.pathsError = ''
  await load(k)
  k.invalidate()
}

// Esc. The kit's ladder steps back one level and only the list closes the pane.
// At ui.close the engine has already given the keys back, so `$.ui.panes()` cannot tell where the Esc was.
// `hadKeys` is the pane's `isFocused` at its last draw: false means the prompt had the keys (an Esc at an
// empty prompt), and that Esc closes the pane as the person asked.
export async function escape(k: K, e: Args<'ui.close'>, next: Next<'ui.close'>, hadKeys = true): Promise<EventResult<'ui.close'>> {
  if (e.origin.kind === 'person' && !hadKeys) return next(e)
  return closeHook(k, e, next, NAV)
}

// ---- moving between screens ---------------------------------------------------------

// A new agent always opens on Result, unless the caller names a tab.
export async function openDetail(k: K, name: string, tab?: Tab): Promise<void> {
  await k.world.set(() => ({ agent: name, resultTurn: 0 }))
  await k.ui.set(() => ({ view: 'detail', cameFrom: 'list', expandedKey: '', confirm: null, focusKey: '' }))
  await openTab(k, tab ?? 'result')
}

// A tab press. Activity and Log start on their newest row, so the window shows the end.
export async function openTab(k: K, tab: Tab): Promise<void> {
  await k.world.set(() => ({ tab }))
  await loadDetailData(k)
  const agent = detailAgent(await k.ui.get(), await k.world.get())
  const last = !agent ? undefined : tab === 'activity' ? stepItems(agent).items.at(-1)?.id : tab === 'log' ? logItems(agent).at(-1)?.id : undefined
  await k.ui.set(() => ({ sel: last ?? '', expandedKey: '', focusKey: '' }))
  focusSoon(k, last ? KEYS.row + last : `${KEYS.tab}${tab}`, FOCUS_RELAYOUT_MS, NAV)
}

export async function showTurn(k: K, turn: number): Promise<void> {
  await k.world.set(() => ({ resultTurn: turn }))
  await loadDetailData(k)
}

export async function openSettings(k: K): Promise<void> {
  const u = await k.ui.get()
  const from = u.view === 'settings' ? u.cameFrom : u.view
  const key = u.focusKey.startsWith('set:') ? u.focusKey : 'set:questions_per_turn'
  await k.ui.set(() => ({ view: 'settings', cameFrom: from, confirm: null, editing: false, picking: '', expandedKey: '', focusKey: key }))
  focusSoon(k, key, FOCUS_SOON_MS, NAV)
  if (!D.settings.data) {
    await loadSettings(k.io)
    k.invalidate()
  }
}

// m: the composer of the agent opens in its detail, with the ring in the field.
export async function compose(k: K, agent: Agent): Promise<void> {
  if (!composerOf(agent)) return
  const u = await k.ui.get()
  if (u.view !== 'detail') await openDetail(k, agent.name)
  await k.ui.set(() => ({ editing: true, confirm: null }))
  const w = await k.world.get()
  focusSoon(k, `${KEYS.input}msg:${agent.name}#${w.epoch}`, FOCUS_RELAYOUT_MS, NAV)
}

// a: the ring goes to the answer field of the first open question.
export async function focusAnswer(k: K, agent: Agent): Promise<void> {
  const q = agent.questions[0]
  if (!q) return
  const w = await k.world.get()
  focusSoon(k, `${KEYS.input}answer:${agent.name}:${questionId(q)}#${w.epoch}`, FOCUS_SOON_MS, NAV)
}

export async function askStop(k: K, agent: Agent): Promise<void> {
  const w = await k.world.get()
  if (w.agentBusy[agent.name]) return busyNotice(k, agent.name)
  await askConfirm(k, { kind: 'stop', id: agent.name }, NAV)
}

// ---- agent actions -----------------------------------------------------------------

const VERBS: { readonly [A in AgentAction]: string } = { stop: 'stop', send: 'message', answer: 'answer' }
const draftKeyOf = (name: string, action: AgentAction, qid: string): string => (action === 'answer' ? `answer:${name}:${qid}` : `msg:${name}`)

async function busyNotice(k: K, name: string): Promise<void> {
  await notify(k, { tone: 'muted', clear: true, text: `${name} is still busy with your last action. Wait for it to end.` })
}

// One action on one agent. Each agent has its own busy mark, so an action on another agent still runs.
// A press on a busy agent shows a dim notice and does nothing else.
export async function runAgentAction(k: K, name: string, action: AgentAction, text = '', qid = ''): Promise<void> {
  const agent = agentNamed(name)
  if (!agent) return
  const w0 = await k.world.get()
  if (w0.agentBusy[name]) return busyNotice(k, name)
  await k.world.set(w => ({ agentBusy: { ...w.agentBusy, [name]: action }, lastAction: { kind: action, id: name, text }, lastQid: qid }))
  // The question is answered: it goes, and the ring goes to a key that stays.
  const u0 = await k.ui.get()
  if (u0.confirm !== null) {
    await k.ui.set(() => ({ confirm: null }))
    focusSoon(k, homeOf(await k.ui.get(), await k.world.get()), FOCUS_SOON_MS, NAV)
  }
  await notify(k, {
    tone: 'warn',
    text: action === 'stop' ? `Stopping ${name}…` : action === 'answer' ? 'Sending your answer…' : 'Sending your message…',
    detail: 'If a permission prompt opened, approve it there. The pane stays put.',
  })
  let ok = false
  let failure = ''
  try {
    await callAgentTool(k.io, agent, action, text, qid)
    ok = true
  } catch (e) {
    failure = String(e instanceof Error ? e.message : e)
  }
  await k.world.set(w => {
    const busy = { ...w.agentBusy }
    delete busy[name]
    const foreign = { ...w.foreign }
    if (ok) delete foreign[name]
    else if (ownedElsewhere(failure)) foreign[name] = true
    // A new epoch mounts the fields again: a kept draft shows in the box.
    return { agentBusy: busy, foreign, epoch: w.epoch + 1 }
  })
  if (ok) {
    if (action !== 'stop') await setDraft(k, draftKeyOf(name, action, qid), null)
    await k.ui.set(() => ({ confirm: null, editing: false, inputFocused: false }))
    await notify(k, {
      tone: 'ok', clear: true,
      text: action === 'stop' ? `✓ Stopped ${name} · its session is kept` : action === 'answer' ? `✓ Answer sent · ${name} is working again` : `✓ Message sent · ${name} is on it`,
    })
  } else {
    await k.ui.set(() => ({ confirm: null }))
    if (ownedElsewhere(failure)) {
      await notify(k, { tone: 'err', text: `✕ Couldn't ${VERBS[action]} ${name}. It belongs to another Claude session.`, detail: 'Open that session to steer it, or ask Claude here to start a new agent for the same task.' })
    } else if (declined(failure)) {
      await notify(k, action === 'stop'
        ? { tone: 'muted', text: 'Not stopped. You declined the permission prompt.' }
        : { tone: 'muted', text: 'Not sent. You declined the permission prompt.', detail: 'Your message is still in the box.' })
    } else {
      await notify(k, { tone: 'err', text: `✕ Couldn't ${VERBS[action]} ${name}: ${firstLine(failure) || 'the call failed'}`, retry: true })
    }
  }
  await load(k)
  // The ring goes back to a known key: the result changed the screen.
  const u = await k.ui.get()
  const w = await k.world.get()
  const field = !ok && action !== 'stop' && u.editing ? `${KEYS.input}${draftKeyOf(name, action, qid)}#${w.epoch}` : ''
  focusSoon(k, field || homeOf(u, w), FOCUS_SOON_MS, NAV)
}

export async function retryLast(k: K): Promise<void> {
  const w = await k.world.get()
  const last = w.lastAction
  if (!last) return
  await runAgentAction(k, last.id, last.kind as AgentAction, last.text, w.lastQid)
}

// ---- settings ---------------------------------------------------------------------

// Save one setting through the kit's action: the pane waits while the write runs.
export async function saveSettingValue(k: K, key: string, raw: string): Promise<void> {
  const w0 = await k.world.get()
  if (w0.busy !== null) return
  const scope = w0.scope
  const label = settingLabel(key)
  const value = String(raw).trim()
  await runAction(
    k, { kind: 'save', id: key, text: value },
    async () => {
      const r = await saveSetting(k.io, scope, key, value)
      if (!r.ok) {
        if (r.why === 'invalid') return { ok: false, notice: { tone: 'err', text: `✕ ${r.text}` } }
        if (r.why === 'declined') return { ok: false, notice: { tone: 'muted', text: 'Not saved. You declined the permission prompt.' } }
        return { ok: false, notice: { tone: 'err', text: `✕ Couldn't save ${label}: ${r.text}` } }
      }
      await loadSettings(k.io)
      await k.ui.set(() => ({ editing: false, inputFocused: false, picking: '' }))
      const now = D.settings.data?.settings?.[key]
      const where = scope === 'project' ? 'in this project' : 'in your user settings'
      return r.value === 'inherit'
        ? { ok: true, text: `✓ Reset · ${label} is now ${settingValue(key, now?.value)} (${sourceWord(now?.source)})` }
        : { ok: true, text: `✓ Saved · ${label} is now ${settingValue(key, now?.[scope] ?? r.value)} ${where}` }
    },
    () => ({}),
    {
      pending: { tone: 'warn', text: 'Saving… approve the write in the prompt if one opened.' },
      draftKey: `set:${key}`, nav: NAV, waitMs: 0,
      focus: (u, w) => (u.editing ? `${KEYS.input}set:${key}#${w.epoch}` : `set:${key}`),
    },
  )
}

export async function askReset(k: K, key: string): Promise<void> {
  await askConfirm(k, { kind: 'reset', id: key }, NAV)
}

export async function startEdit(k: K, key: string): Promise<void> {
  const w = await k.world.get()
  if (w.busy !== null) return
  await setDraft(k, `set:${key}`, null)
  await k.world.set(x => ({ epoch: x.epoch + 1 }))
  await k.ui.set(() => ({ editing: true, confirm: null, focusKey: `set:${key}` }))
  focusSoon(k, `${KEYS.input}set:${key}#${w.epoch + 1}`, FOCUS_RELAYOUT_MS, NAV)
}

// A Select stays behind its Button until the person presses it (kit key pick:<name>).
export async function startPick(k: K, key: string): Promise<void> {
  const w = await k.world.get()
  if (w.busy !== null) return
  await k.ui.set(() => ({ picking: `set:${key}`, confirm: null, focusKey: `set:${key}` }))
  focusSoon(k, `${KEYS.pick}${key}`, FOCUS_SOON_MS, NAV)
}

export async function picked(k: K, key: string, value: string, current: string): Promise<void> {
  await k.ui.set(() => ({ picking: '' }))
  if (key === 'scope') {
    await k.world.set(() => ({ scope: value === 'user' ? 'user' : 'project' }))
    focusSoon(k, 'set:scope', FOCUS_SOON_MS, NAV)
    return
  }
  // Enter on a Select commits the shown value too: that is no change, so it writes nothing.
  if (value === current) {
    focusSoon(k, `set:${key}`, FOCUS_SOON_MS, NAV)
    return
  }
  await saveSettingValue(k, key, value)
}

// ---- the band ---------------------------------------------------------------------

export function bandTarget(): { agent: Agent; answer: boolean } | undefined {
  const all = D.agents.filter(a => !a.broken)
  const waiting = all.find(a => a.meta.state === 'waiting' && a.questions.length)
  if (waiting) return { agent: waiting, answer: true }
  const failed = all.find(a => a.meta.state === 'failed')
  const working = all.find(a => a.meta.state === 'running' || a.meta.state === 'spawning')
  const target = failed ?? working
  return target ? { agent: target, answer: false } : undefined
}

