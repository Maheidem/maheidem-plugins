import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { later, parseSwitch, reply, runAction, startScenario, usage } from '../hooks/kit/scenario'
import type { Outcome } from '../hooks/kit/scenario'
import type { Action, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'

type On = Parameters<TestBody>[1]
type V = 'list' | 'detail'
type R = { id: string }
type S = 'normal' | 'empty' | 'fail'

const NOW = 1000
const SCENARIOS: readonly S[] = ['normal', 'empty', 'fail']
const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const W0: World<R, S> = { variant: 'A', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
const ACT: Action = { kind: 'save', id: 'a', text: 'hello' }
const HOME = { back: () => null, home: () => 'row:a' }

// The six engine stubs and the mock clock (decisions A1). Fake handles use only the clock.
function setup(on: On) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return clock
}

// The fixture the mod would give: one row, the failures left to spend.
const worldFor = (s: S, now: number): World<R, S> => ({ ...W0, scenario: s, rows: [{ id: `r${now}` }], failsLeft: s === 'fail' ? 1 : 0 })

test('parseSwitch reads the variant and the scenario', async (_$, on) => {
  setup(on)
  const vs = ['A', 'B', 'C', 'D'] as const
  expect(parseSwitch('c fail', vs, SCENARIOS)).toEqual({ variant: 'C', scenario: 'fail' })
  expect(parseSwitch('  b   empty ', vs, SCENARIOS)).toEqual({ variant: 'B', scenario: 'empty' })
  expect(parseSwitch('C', vs, SCENARIOS)).toEqual({ variant: 'C', scenario: 'normal' })
  expect(parseSwitch('', vs, SCENARIOS)).toBeNull()
  expect(parseSwitch('X normal', vs, SCENARIOS)).toBeNull()
  expect(parseSwitch('C nothing', vs, SCENARIOS)).toBeNull()
  expect(parseSwitch('C normal extra', vs, SCENARIOS)).toBeNull()
})

test('usage and reply give the exact strings', async (_$, on) => {
  setup(on)
  expect(usage('notes-pane', ['A', 'B'], ['normal', 'empty'])).toBe('Usage: /notes-pane <A|B> [normal|empty]')
  expect(reply('C', 'normal')).toBe('Scenario C normal')
})

test('startScenario resets the world, the ui and the drafts', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, { ...UI0, view: 'detail', sel: 'x', notice: { id: 1, tone: 'err', text: 'old' } }, { ...W0, rows: [{ id: 'old' }], epoch: 4, busy: ACT })
  await f.k.drafts.set(() => ({ 'a:msg': 'draft' }))
  const run = await startScenario(f.k, 'fail', 'C', worldFor, UI0)
  expect(run).toBe(NOW)
  expect(f.world().run).toBe(NOW)
  expect(f.world().scenario).toBe('fail')
  expect(f.world().variant).toBe('C')
  expect(f.world().rows).toEqual([{ id: 'r1000' }])
  expect(f.world().failsLeft).toBe(1)
  expect(f.world().epoch).toBe(0)
  expect(f.world().busy).toBeNull()
  expect(f.ui()).toEqual(UI0)
  expect(f.drafts()).toEqual({})
})

test('two starts at one clock time get two run ids', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, W0)
  expect(await startScenario(f.k, 'normal', 'A', worldFor, UI0)).toBe(1000)
  expect(await startScenario(f.k, 'normal', 'A', worldFor, UI0)).toBe(1001)
})

test('a later of an old run does nothing after a new start', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, W0)
  const hits: string[] = []
  const first = await startScenario(f.k, 'normal', 'A', worldFor, UI0)
  later(f.k, first, 2000, () => { hits.push('first') })
  const second = await startScenario(f.k, 'normal', 'A', worldFor, UI0)
  later(f.k, second, 2000, () => { hits.push('second') })
  await clock.advance(1999)
  expect(hits).toEqual([])
  await clock.advance(1)
  expect(hits).toEqual(['second'])
})

test('runAction success: pending, result, epoch and focus', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, { ...UI0, confirm: { kind: 'save', id: 'a' } }, { ...W0, run: 5 })
  await f.k.drafts.set(() => ({ 'a:msg': 'draft', 'b:msg': 'keep' }))
  const applied: string[] = []
  const outcome = (): Outcome => ({ ok: true, text: '✓ Saved' })
  const apply = (_w: World<R, S>, act: Action, now: number) => { applied.push(`${act.id}@${now}`); return { rows: [{ id: 'new' }] } }
  const done = runAction(f.k, ACT, outcome, apply, { draftKey: 'a:msg', nav: HOME })
  await clock.settle()
  expect(f.world().busy).toEqual(ACT)
  expect(f.world().lastAction).toEqual(ACT)
  expect(f.ui().notice?.tone).toBe('warn')
  await clock.advance(1499)
  expect(f.world().busy).toEqual(ACT)
  await clock.advance(1)
  await done
  expect(f.world().busy).toBeNull()
  expect(applied).toEqual(['a@2500'])
  expect(f.world().rows).toEqual([{ id: 'new' }])
  expect(f.ui().notice?.tone).toBe('ok')
  expect(f.ui().notice?.clear).toBe(true)
  expect(f.ui().notice?.text).toBe('✓ Saved')
  expect(f.ui().confirm).toBeNull()
  expect(f.world().epoch).toBe(1)
  expect(f.drafts()).toEqual({ 'b:msg': 'keep' })
  expect(f.calls.includes('focus row:a')).toBe(false)
  await clock.advance(79)
  expect(f.calls.includes('focus row:a')).toBe(false)
  await clock.advance(1)
  expect(f.calls.includes('focus row:a')).toBe(true)
})

test('runAction uses the pending notice and the focus option', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, { ...W0, run: 5 })
  const done = runAction(f.k, ACT, () => ({ ok: true, text: 'done' }), () => ({}), { pending: { tone: 'warn', text: 'Saving…', detail: 'wait' }, focus: u => `tab:${u.view}` })
  await clock.settle()
  expect(f.ui().notice?.text).toBe('Saving…')
  expect(f.ui().notice?.detail).toBe('wait')
  await clock.advance(1500)
  await done
  await clock.advance(80)
  expect(f.calls.includes('focus tab:list')).toBe(true)
})

test('runAction failure shows the notice and spends one fail', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, { ...UI0, confirm: { kind: 'save', id: 'a' } }, { ...W0, run: 5, failsLeft: 1 })
  let applied = 0
  const fail: Outcome = { ok: false, notice: { tone: 'err', text: '✕ Could not save', retry: true } }
  const done = runAction(f.k, ACT, () => fail, () => { applied++; return {} })
  await clock.advance(1500)
  await done
  expect(applied).toBe(0)
  expect(f.ui().notice?.tone).toBe('err')
  expect(f.ui().notice?.text).toBe('✕ Could not save')
  expect(f.ui().notice?.retry).toBe(true)
  expect(f.ui().confirm).toBeNull()
  expect(f.world().failsLeft).toBe(0)
  expect(f.world().busy).toBeNull()
  expect(f.world().epoch).toBe(1)
  // No nav and no focus option: the kit does not move the ring.
  await clock.advance(80)
  expect(f.calls.filter(c => c.startsWith('focus '))).toEqual([])
})

test('a second runAction while busy changes nothing', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, { ...W0, run: 5, busy: ACT })
  let asked = 0
  await runAction(f.k, { kind: 'save', id: 'b', text: 'x' }, () => { asked++; return { ok: true, text: 'x' } }, () => ({}))
  await clock.advance(1500)
  expect(asked).toBe(0)
  expect(f.world().busy).toEqual(ACT)
  expect(f.world().epoch).toBe(0)
  expect(f.ui().notice).toBeNull()
  expect(f.calls).toEqual([])
})

test('a start during the 1.5 s applies nothing of the action', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, { ...W0, run: 5 })
  let applied = 0
  const done = runAction(f.k, ACT, () => ({ ok: true, text: '✓ Saved' }), () => { applied++; return {} }, { nav: HOME })
  await clock.advance(700)
  await startScenario(f.k, 'empty', 'B', worldFor, UI0)
  await clock.advance(2000)
  await done
  expect(applied).toBe(0)
  expect(f.world().scenario).toBe('empty')
  expect(f.world().epoch).toBe(0)
  expect(f.world().busy).toBeNull()
  expect(f.ui().notice).toBeNull()
  expect(f.calls.filter(c => c.startsWith('focus '))).toEqual([])
})

test('runAction never rejects when a step throws', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, { ...W0, run: 5 })
  const done = runAction(f.k, ACT, () => ({ ok: true, text: 'x' }), () => { throw new Error('boom') })
  await clock.advance(1500)
  await done
  expect(f.world().epoch).toBe(0)
})

test('runAction turns a thrown outcome into an error notice and clears busy', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, { ...W0, run: 5 })
  const done = runAction(f.k, ACT, () => { throw new Error('fatal: not a git repository\nmore') }, () => ({}))
  await clock.advance(1500)
  await done
  expect(f.world().busy).toBeNull()
  expect(f.ui().notice?.tone).toBe('err')
  expect(f.ui().notice?.text).toBe('fatal: not a git repository')
  expect(f.world().epoch).toBe(1)
})

test('runAction awaits an async outcome, and waitMs 0 skips the fixture wait', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, R, S>(clock, UI0, { ...W0, run: 5 })
  const outcome = async (): Promise<Outcome> => { await f.k.sleep(300); return { ok: true, text: '✓ Deleted' } }
  const done = runAction(f.k, ACT, outcome, () => ({ rows: [] }), { waitMs: 0, nav: HOME })
  await clock.advance(299)
  expect(f.world().busy).toEqual(ACT)
  await clock.advance(1)
  await done
  expect(f.world().busy).toBeNull()
  expect(f.ui().notice?.text).toBe('✓ Deleted')
  expect(f.world().epoch).toBe(1)
})
