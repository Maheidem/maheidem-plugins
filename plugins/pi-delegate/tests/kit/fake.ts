import type { MockClock } from 'claude-code/testing'
import type { UiPane } from 'claude-code'
import type { Drafts, Handles, UiState, World } from '../../hooks/kit/types'

// In-memory handles for kit unit tests: the cells merge as bind() does, the
// host calls are recorded in `calls`, the waits sit on the mock clock.
export type Fake<V extends string, T, S extends string> = { k: Handles<V, T, S>; calls: string[]; ui: () => UiState<V>; world: () => World<T, S>; drafts: () => Drafts; setOpen: (open: boolean) => void }

export function fakeHandles<V extends string, T, S extends string>(clock: MockClock, ui0: UiState<V>, world0: World<T, S>, focusDeny = ''): Fake<V, T, S> {
  let ui = ui0
  let world = world0
  let drafts: Drafts = {}
  let open = false
  const calls: string[] = []
  const pane: UiPane = { id: 'kit-test', title: 'Rows', isShown: true, isFocused: true, isPlaced: true }
  const k: Handles<V, T, S> = {
    pane: 'kit-test',
    ui: { get: async () => ui, set: async f => { ui = { ...ui, ...f(ui) } } },
    world: { get: async () => world, set: async f => { world = { ...world, ...f(world) } } },
    drafts: { get: async () => drafts, set: async f => { drafts = f(drafts) } },
    focus: async key => { calls.push(`focus ${key}`); return focusDeny ? { deny: focusDeny } : {} },
    open: async () => { calls.push('open'); open = true; return { isPlaced: true } },
    close: async () => { calls.push('close'); open = false },
    panes: async () => (open ? [pane] : []),
    sleep: ms => clock.sleep(ms),
    now: async () => clock.now(),
    toast: t => { calls.push(`toast ${t}`) },
    log: t => { calls.push(`log ${t}`) },
    status: t => { calls.push(`status ${t ?? ''}`) },
    invalidate: () => { calls.push('invalidate') },
  }
  return { k, calls, ui: () => ui, world: () => world, drafts: () => drafts, setOpen: v => { open = v } }
}
