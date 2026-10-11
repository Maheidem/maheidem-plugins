import type { Args, Next, UiPressResult } from 'claude-code'
import { dismissable } from './notice'
import type { Handles, UiState } from './types'

// Any press clears a notice that has no timer, unless the press is the retry key or an action runs. (SB:1463-1471)
// The Button's own onPress runs beneath the hook, after next(e).
export async function pressHook<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, e: Args<'ui.press'>, next: Next<'ui.press'>): Promise<UiPressResult> {
  if (e.requestId !== k.pane) return next(e)
  const u: UiState<V> = await k.ui.get()
  const w = await k.world.get()
  const keep = e.element === 'act:retry' || e.element === 'act:r'
  if (dismissable(u.notice) && w.busy === null && !keep) await k.ui.set(() => ({ notice: null }))
  return next(e)
}
