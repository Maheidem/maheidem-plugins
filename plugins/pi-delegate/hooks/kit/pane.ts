import type { Handles, UiState } from './types'
import type { UiOpenResult } from 'claude-code'

// Open the pane from a command or a press. Reset the fields that a fresh open
// must not keep, apply the caller's patch, then ask the engine to open (SB:386-392).
// The command lands on the list: the mod passes { view: 'list' }.
// Selection and drafts stay. The caller checks `isPlaced` (SK:192).
export async function openPane<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, patch?: Partial<UiState<V>>): Promise<UiOpenResult> {
  const u = await k.ui.get()
  const want: Partial<UiState<V>> = { confirm: null, editing: false, inputFocused: false, picking: '', ...patch }
  const keys = Object.keys(want) as (keyof UiState<V>)[]
  // Write only when one field differs: a write forces a new draw.
  if (keys.some(key => u[key] !== want[key])) await k.ui.set(() => want)
  const r = await k.open()
  k.invalidate()
  return r
}

// True while the engine lists this pane (SB:185, SB:1356).
export async function isOpen<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>): Promise<boolean> {
  return (await k.panes()).some(p => p.id === k.pane)
}

// Close the pane only when it is open. Draw again in both cases (SB:1355-1357).
export async function closeIfOpen<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>): Promise<void> {
  if (await isOpen(k)) await k.close()
  k.invalidate()
}
