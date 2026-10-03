export type AgentsConfirm = { kind: 'stop'; name: string } | { kind: 'reset'; key: string }

export type AgentsNotice = {
  tone: 'ok' | 'err' | 'warn' | 'muted'
  text: string
  detail?: string
  retry?: boolean
  clear?: boolean
}

// The agents pane's view state: kept by the host across hot reloads,
// reset by /clear, /resume and /branch.
export type AgentsUi = {
  view: 'list' | 'detail' | 'settings'
  cameFrom: 'list' | 'detail' | 'settings'
  selected: string
  tab: 'result' | 'activity' | 'log' | 'questions'
  expandedKey: string
  confirm: AgentsConfirm | null
  resultTurn: number
  drafts: Record<string, string>
  notice: AgentsNotice | null
  foreign: Record<string, boolean>
  focusKey: string
  showEnded: boolean
  earlier: number
  settingsKey: string
  editing: boolean
  scope: 'project' | 'user'
  inputFocused: boolean
  focusAnswer: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'pi-delegate': { ui: AgentsUi }
  }
}
