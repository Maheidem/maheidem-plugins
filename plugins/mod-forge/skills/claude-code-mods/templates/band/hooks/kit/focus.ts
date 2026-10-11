import type { Args, Next, UiFocusResult } from 'claude-code'
import { FOCUS_SOON_MS, KEYS } from './defaults'
import { topOf, windowSeen } from './list'
import type { FocusExtra, Handles, ListKeys, Nav, UiState, World } from './types'

// What the view state records when the ring lands on `key` (SB:101-115).
// The rows apply in the order of kit-api.md section 5. The result is one patch.
export function focusPatch<V extends string>(u: UiState<V>, key: string, nav?: FocusExtra<V>): Partial<UiState<V>> {
  const patch: Partial<UiState<V>> = {}
  const inputKey = key.startsWith(KEYS.input)
  if (inputKey !== u.inputFocused) patch.inputFocused = inputKey // row 1
  if (u.picking !== '' && !key.startsWith(KEYS.pick)) patch.picking = '' // row 2
  if (key.startsWith(KEYS.row)) {
    const id = key.slice(KEYS.row.length)
    // Row 3: a new selection. Row 4: the same selection gives no patch.
    if (id !== u.sel) Object.assign(patch, { sel: id, expandedKey: '', focusKey: '' })
  } else if (key.startsWith(KEYS.act) || key.startsWith(KEYS.confirm) || key.startsWith(KEYS.pick)) {
    // Row 5: a footer action, a confirm button or a Select. The ring key is not stored.
  } else if (key !== u.focusKey) patch.focusKey = key // row 6
  if (nav?.onFocus) Object.assign(patch, nav.onFocus(key, u)) // row 7: the mod has the last word
  return patch
}

// Write the patch of a landed key. One atomic update: the patch is built from the state at the write.
// A read, then a write, lets two fast arrow presses write their selections in the wrong order.
async function record<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, key: string, nav?: FocusExtra<V>): Promise<void> {
  await k.ui.set(u => focusPatch(u, key, nav))
}

// Move the ring, then record what the hook would record (SB:165-171).
// The live engine does not raise this plugin's own ui.focus hook for its own move (SB:163-164).
// This function does not catch: the caller chains .catch.
export async function focusNow<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, key: string, nav?: FocusExtra<V>): Promise<void> {
  const r = await k.focus(key)
  if (r?.deny) return
  await record(k, key, nav)
}

// After a change that reshapes the tree, move the ring once the redraw landed (SB:173-175).
export function focusSoon<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, key: string, ms?: number, nav?: FocusExtra<V>): void {
  void k.sleep(ms ?? FOCUS_SOON_MS).then(() => focusNow(k, key, nav)).catch(() => undefined)
}

// The self-heal of the ring in a windowed list. The slot math in focusHook reads the last draw of the
// hook, but the engine can still show the draw before it. Then the ring lands one row away from the
// pointer (live, 2.1.296: arrow bursts 5-10 ms apart, about 1 burst in 40). After that, Up from the top
// slot goes to a footer key, the hook refuses it, and the list seems stuck. So when the arrows stop for
// FOCUS_SOON_MS, put the ring on the selected row by key. Do nothing when the selection or the screen
// changed. Only move the ring: the selection is right. A write of the selection here undid a newer
// arrow (live: presses 80-85 ms apart then moved only 6 to 9 rows of 10). focusHook calls this only
// when a draw was in flight: an unconditional heal took the ring from a press 80 ms later (4 of 50 lost).
function settle<V extends string, T, S extends string, X extends object = {}>(
  k: Handles<V, T, S, X>, key: string, keys: (u: UiState<V>, w: World<T, S, X>) => ListKeys | null,
): void {
  void k.sleep(FOCUS_SOON_MS).then(async () => {
    const u = await k.ui.get()
    const L = keys(u, await k.world.get())
    const still = KEYS.row + u.sel === key && u.focusKey === '' && !u.inputFocused && !u.editing && u.confirm === null && u.picking === ''
    if (still && L !== null && L.keys.includes(key)) await k.focus(key)
  }).catch(() => undefined)
}

// The ring (SB:1368-1415): the selection follows the ring, a footer hotkey refuses the arrows,
// and a windowed list lands by screen slot. The mod registers this hook with a catch that calls next(e).
// Never return a new deny after next(e).
// The slot math reads the window that is drawn NOW (windowSeen), after the awaits and just before next.
// The selection in the cells can be newer than the draw during a burst of arrows (5-20 ms apart), and a
// landing from it puts the ring one row away from the pointer (live, 2.1.296).
export async function focusHook<V extends string, T, S extends string, X extends object = {}>(
  k: Handles<V, T, S, X>,
  e: Args<'ui.focus'>,
  next: Next<'ui.focus'>,
  o: { keys: (u: UiState<V>, w: World<T, S, X>) => ListKeys | null; nav: Nav<V, T, S, X> },
): Promise<UiFocusResult> {
  const el = e.element
  if (!el) return next(e) // SB:1370
  const person = e.origin.kind === 'person'
  if (person && el.startsWith(KEYS.act)) return {} // the arrows walk the rows; the hotkey still presses (SB:1372)
  if (person && el.startsWith(KEYS.row)) {
    const before = windowSeen() // the draw before the awaits
    const L = o.keys(await k.ui.get(), await k.world.get())
    if (L) {
      const picked = L.keys.indexOf(el)
      const n = L.keys.length
      const { room, top, at: cur } = windowSeen() // the drawn window: no await from here to next
      if (picked >= 0 && cur >= 0 && n > room) {
        const last = Math.min(n, top + room) - 1
        // A wrap (SB:1387): a jump over 3 or more drawn rows from an end, as /diff (dialog-focus-of.ts isFar).
        // In a window of 2 rows the next row is the last drawn row: that is a step, not a wrap.
        const far = last - top >= 2
        if (far && ((cur === n - 1 && picked === top) || (cur === 0 && picked === last))) return {}
        // The ring keeps its screen slot: land on the key that is drawn NOW at the slot of the picked row (SB:1388).
        const landing = L.keys[top + (picked - topOf(picked, n, room))] ?? el
        const moved = await next({ ...e, element: landing })
        // The selection is the PICKED row, not the landing (SB:1389-1391).
        if (!moved.deny) {
          await record(k, el, o.nav)
          // A draw was in flight: it landed during the awaits, or the cells are ahead of it. The landing
          // can then be one row off (live, 2.1.296: the log showed top 49 before the awaits, 48 after).
          const inFlight = before.top !== top || before.at !== cur || before.room !== room || L.at !== cur
          if (inFlight) settle(k, el, o.keys)
        }
        return moved
      }
    }
  }
  const moved = await next(e)
  if (!moved.deny) await record(k, el, o.nav) // SB:1408-1414
  return moved
}
