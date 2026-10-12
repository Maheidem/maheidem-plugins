// The contract of the agents pane. A contract cannot import (the engine reads it alone), so it repeats the kit shapes.
// The host keeps these cells across a hot reload; /clear, /resume and /branch reset them.
export type View = 'list' | 'detail' | 'settings'
export type Tab = 'result' | 'activity' | 'log' | 'questions'
export type Scenario = 'live'
export type Notice = { id: number; tone: 'ok' | 'err' | 'warn' | 'muted'; text: string; detail?: string; retry?: true; clear?: true }
export type Action = { kind: string; id: string; text: string }

// The pane's view state (kit UiState). `sel` is the selected row of the list on screen:
// an agent name in the list, `step:<n>` or `ev:<seq>` in a detail tab.
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

// One agent in the list: its name and a signature that changes when its files change.
export type AgentRef = { name: string; sig: string }

export type WorldExtra = {
  tab: Tab // the detail tab
  agent: string // the agent the detail shows
  resultTurn: number // 0: the last turn
  scope: 'project' | 'user' // where a setting save goes
  foreign: { [name: string]: true } // agents another Claude session owns
  agentBusy: { [name: string]: string } // an action that runs, per agent
  lastQid: string // the question of the last answer, for retry
}

export type World = {
  variant: 'A' | 'B' | 'C' | 'D'
  scenario: Scenario
  run: number
  loaded: boolean
  rows: AgentRef[]
  error: string
  banner: string
  busy: Action | null
  lastAction: Action | null
  epoch: number
  failsLeft: number
} & WorldExtra

declare module 'claude-code' {
  interface PluginState {
    'pi-delegate': { ui: UiState; world: World; drafts: { [key: string]: string } }
  }
}
