import type { Args, EventResult, Next } from 'claude-code'
import { FOCUS_SOON_MS } from './defaults'
import { focusNow, focusSoon } from './focus'
import { dismissable } from './notice'
import type { Handles, Nav, UiState } from './types'

// The Esc ladder of a pane (SB:1419-1460). The first matching step wins.
// The mod registers this hook with a `.catch` that calls `next(e)`: when the
// hook fails, Esc closes the pane as usual (SB:1460).
export async function closeHook<V extends string, T, S extends string, X extends object = {}>(
  k: Handles<V, T, S, X>, e: Args<'ui.close'>, next: Next<'ui.close'>, nav: Nav<V, T, S, X>,
): Promise<EventResult<'ui.close'>> {
  // Step 0: only a person presses Esc (SB:1420).
  if (e.origin.kind !== 'person') return next(e)
  const u = await k.ui.get()
  const w = await k.world.get()
  // Step 1: while an action runs, the permission prompt has the keys (SB:1425).
  if (w.busy !== null) return { deny: 'an action runs' }
  // The home key comes from the state before the patch (SB:1429).
  const home = nav.home(u, w)

  // Step 2: a notice without a timer. Esc dismisses it and does nothing else (SB:1432-1437).
  // The ring stays where it was: an autoFocus field must not take it.
  if (dismissable(u.notice)) {
    await k.ui.set(() => ({ notice: null }))
    const keep = u.inputFocused || u.editing ? '' : home
    // Wait for the redraw, open the pane, then move the ring.
    void k.sleep(FOCUS_SOON_MS).then(() => k.open()).then(() => (keep ? focusNow(k, keep, nav) : undefined)).catch(() => undefined)
    return { deny: 'notice dismissed' }
  }

  // Steps 3 to 7: close one layer of the pane, then give the ring back (SB:1439-1443).
  let patch: Partial<UiState<V>> | null = null
  let refocus = ''
  if (u.picking !== '') {
    patch = { picking: '' }
    refocus = u.picking // it holds the key of the Button that opened the Select (SB:1439)
  } else if (u.editing) {
    patch = { editing: false, inputFocused: false }
    refocus = home
  } else if (u.inputFocused) {
    patch = { inputFocused: false }
    refocus = home
  } else if (u.confirm !== null) {
    patch = { confirm: null }
    refocus = home
  } else if (u.expandedKey !== '') {
    patch = { expandedKey: '' }
    refocus = u.focusKey || home
  }
  if (patch !== null) {
    const layer = patch
    await k.ui.set(() => layer)
    void k.open().then(() => (refocus ? focusNow(k, refocus, nav) : undefined)).catch(() => undefined)
    return { deny: 'back one level' }
  }

  // Step 8: go back one view (SB:1444-1448, SB:406-418).
  const to = nav.back(u, w)
  if (to !== null) {
    await k.ui.set(() => ({ view: to, confirm: null, expandedKey: '', editing: false, picking: '', inputFocused: false }))
    const u2 = await k.ui.get()
    focusSoon(k, nav.home(u2, w), FOCUS_SOON_MS, nav)
    // The pane has the keys again after a deny (SK:206).
    void k.open().catch(() => undefined)
    return { deny: 'back one level' }
  }

  // Step 9: the top level closes the pane. A timed notice stays (SB:1449-1456).
  await k.ui.set(() => ({ inputFocused: false }))
  const result = await next(e)
  k.invalidate()
  return result
}
