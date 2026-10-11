// Fixtures of the design pass: the rows and the world of each scenario.
// The order is fixed. The texts are fixed. No random value, no clock text (storyboard.md 4).
// The kit starts a scenario with worldFor(scenario, now) and keeps the full World it returns.
import type { Row, Scenario, State, World } from '../types'

const TEXTS = [
  'Call the vendor about the invoice before Friday',
  'Fix the flaky login test',
  'Ask for the design file',
  'Rename the staging bucket',
  'Check disk use on the build host',
  'Reply to the audit email',
  'Draft the release plan',
  'Book the team room for Monday',
  'Update the onboarding page',
  'Archive the old dashboards',
  'Review the cache change',
  'Pay the domain renewal',
  'Clean up the feature flags',
  'Write the incident summary',
]
const AGES = ['2m', '14m', '1h', '3h', '1d', '1d', '2d', '3d', '4d', '6d', '1w', '2w', '3w', '1mo']

// The overflow scenario has more rows than a 45-row dock shows, so the list window scrolls there too.
export const OVERFLOW = 60
const COUNT = 4

// Plain rows for the list scenarios: no state, no note.
export function fixture(n: number): Row[] {
  return Array.from({ length: n }, (_, i): Row => ({ id: `r${i}`, text: TEXTS[i] ?? `Older item ${i + 1}`, state: 'idle', note: '', age: AGES[i] ?? '1mo' }))
}

// Rows for the band scenarios: a state and a note.
const row = (id: string, text: string, state: State, note: string, age: string): Row => ({ id, text, state, note, age })
const bucket = (): Row => row('r0', 'Rename the staging bucket', 'waiting', 'Which name should I use?', '2m')
const plan = (id: string): Row => row(id, 'Draft the release plan', 'working', 'Writing the first section', '5m')
const login = (id: string, state: State, note: string): Row => row(id, 'Fix the flaky login test', state, note, '1h')

// The world before any scenario: nothing is loaded and no scenario ran (run 0).
const BASE: World = {
  variant: 'C', scenario: 'loading', run: 0, loaded: false, rows: [], error: '',
  banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0,
}

// The kit sets scenario, variant and run itself after this call.
export function worldFor(s: Scenario, _now: number): World {
  const on = { ...BASE, scenario: s, loaded: true }
  switch (s) {
    case 'empty': return on
    case 'loading': return { ...BASE, scenario: s }
    case 'error': return { ...on, error: 'The items could not be read.' }
    case 'overflow': return { ...on, rows: fixture(OVERFLOW) }
    case 'save-fails': return { ...on, rows: fixture(COUNT), failsLeft: 1 }
    case 'one-waiting': return { ...on, rows: [bucket(), plan('r1'), login('r2', 'idle', '')] }
    case 'many': return {
      ...on,
      rows: [
        bucket(),
        row('r1', 'Book the team room', 'waiting', 'Is 10:00 fine?', '9m'),
        row('r2', 'Reply to the audit email', 'waiting', 'Should I attach the report?', '12m'),
        plan('r3'),
        row('r4', 'Check disk use on the build host', 'failed', 'The build host refused the key.', '30m'),
      ],
    }
    case 'failed': return { ...on, rows: [row('r0', 'Check disk use on the build host', 'failed', 'The build host refused the key.', '3m'), plan('r1'), login('r2', 'idle', '')] }
    case 'working': return { ...on, rows: [login('r0', 'working', 'Running the tests'), plan('r1'), row('r2', 'Update the onboarding page', 'idle', '', '2h')] }
    case 'quiet': return { ...on, rows: [login('r0', 'idle', ''), row('r1', 'Update the onboarding page', 'idle', '', '2h'), row('r2', 'Archive the old dashboards', 'idle', '', '1d')] }
    default: return { ...on, rows: fixture(COUNT) } // normal and guarded
  }
}
