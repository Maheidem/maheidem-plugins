// The contract of this mod. A contract cannot import (the engine reads it alone),
// so it repeats the shapes of hooks/kit/types.ts. A shared field keeps the SAME type there and here.
// Add no field to UiState or World: the kit passes its own shapes, so tsc fails (TS2345). Keep the mod's
// own data in an atom of its own, and add its key to PluginState below. Never change a shared field.
export type Variant = 'A' | 'B' | 'C' | 'D'
// The first six scenarios are the list pane. The next five are the band. The last one runs the guard.
export type Scenario =
  | 'normal' | 'empty' | 'loading' | 'error' | 'overflow' | 'save-fails'
  | 'one-waiting' | 'many' | 'failed' | 'working' | 'quiet'
  | 'guarded'
export type View = 'list' | 'detail' | 'add'
// idle: a plain item. The other three states need a person, so the band names them.
export type State = 'idle' | 'waiting' | 'working' | 'failed'
export type Row = { id: string; text: string; state: State; note: string; age: string }
export type Notice = { id: number; tone: 'ok' | 'err' | 'warn' | 'muted'; text: string; detail?: string; retry?: true; clear?: true }
export type Action = { kind: string; id: string; text: string }
export type UiState = {
  view: View
  cameFrom: View
  sel: string
  confirm: { kind: string; id: string } | null
  notice: Notice | null
  focusKey: string
  inputFocused: boolean
  editing: boolean
  picking: string
  expandedKey: string
}
export type World = {
  variant: Variant
  scenario: Scenario
  run: number
  loaded: boolean
  rows: Row[]
  error: string
  banner: string
  busy: Action | null
  lastAction: Action | null
  epoch: number
  failsLeft: number
}
// A rule of the guard (hooks/rules.ts).
export type Rule = { id: string; test: RegExp; why: string }

declare module 'claude-code' {
  interface PluginState {
    'mixed': { ui: UiState; world: World; drafts: { [key: string]: string } }
  }
}
