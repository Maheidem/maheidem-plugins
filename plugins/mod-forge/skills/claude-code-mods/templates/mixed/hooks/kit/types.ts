import type { ElementTable, UiFocusResult, UiOpenResult, UiPane } from 'claude-code'

export type Ui = Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text' | 'Button' | 'Input' | 'Select' | 'Code' | 'Markdown'>
export type Cell<T> = { get: () => Promise<T>; set: (fn: (v: T) => T) => Promise<unknown> }
export type PatchCell<T> = { get: () => Promise<T>; set: (fn: (v: T) => Partial<T>) => Promise<unknown> }
export type Host = {
  pane: string
  focus: (key: string) => Promise<UiFocusResult>
  open: () => Promise<UiOpenResult>
  close: () => Promise<void>
  panes: () => Promise<readonly UiPane[]>
  sleep: (ms: number) => Promise<void>
  now: () => Promise<number>
  toast: (text: string) => void
  log: (text: string) => void
  status: (text: string | undefined) => void
  invalidate: () => void
}
export type Tone = 'ok' | 'err' | 'warn' | 'muted'
export type Notice = { id: number; tone: Tone; text: string; detail?: string; retry?: true; clear?: true }
export type NoticeSpec = Omit<Notice, 'id'>
export type Confirm = { kind: string; id: string }
export type Action = { kind: string; id: string; text: string }
export type Variant = 'A' | 'B' | 'C' | 'D'
export type UiState<V extends string> = { view: V; cameFrom: V; sel: string; confirm: Confirm | null; notice: Notice | null; focusKey: string; inputFocused: boolean; editing: boolean; picking: string; expandedKey: string }
export type World<T, S extends string, X extends object = {}> = { variant: Variant; scenario: S; run: number; loaded: boolean; rows: T[]; error: string; banner: string; busy: Action | null; lastAction: Action | null; epoch: number; failsLeft: number } & X
export type Drafts = { [key: string]: string }
export type Handles<V extends string, T, S extends string, X extends object = {}> = Host & { ui: PatchCell<UiState<V>>; world: PatchCell<World<T, S, X>>; drafts: Cell<Drafts> }
export type PaneProps = { readonly title: string; readonly bodyColumns: number; readonly scroll: { readonly bodyRows: number } }
export type Ctx<V extends string, T, S extends string, X extends object = {}> = { E: Ui; k: Handles<V, T, S, X>; title: string; now: number; cols: number; rows: number; u: UiState<V>; w: World<T, S, X>; drafts: Drafts }
export type KeySpec = { hotkey: string; label: string; onPress: () => void }
export type ListKeys = { keys: readonly string[]; at: number }
export type FocusExtra<V extends string> = { onFocus?: (key: string, u: UiState<V>) => Partial<UiState<V>> }
export type Nav<V extends string, T, S extends string, X extends object = {}> = FocusExtra<V> & {
  back: (u: UiState<V>, w: World<T, S, X>) => V | null
  home: (u: UiState<V>, w: World<T, S, X>) => string
}
