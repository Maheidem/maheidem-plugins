// The data source of the mod. This file is yours: write the function, then test it in tests/source.test.ts.
// It holds no $: it takes an io handle (bind() in register.tsx gives it) with run (a program in the session folder) and store (the plugin's JSON store).
// The stub throws, and the command answers with the error, so a missing data source is visible and never silent.
import type { ProcessRunResult } from 'claude-code'
import type { Row } from '../types'

// Run one program: run(['git', 'status']). It resolves with the exit code and the text of the program.
export type Run = (argv: readonly string[]) => Promise<ProcessRunResult>
// The plugin's own JSON store ($.store): get gives undefined for a key that is not set.
export type Store = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
// What the data source can use: run a program in the session folder, keep data in the store, or ask for the session folder (root).
// root() is the key of a per-project store entry: io.store.get(`notes:${await io.root()}`).
export type Io = { run: Run; store: Store; root: () => Promise<string> }

// Read the rows now: the command prints the last ones. Throw an Error with a one line message when the read fails.
export async function readRows(_io: Io, _now: number): Promise<{ rows: Row[] }> {
  throw new Error('hooks/source.ts readRows() is not written yet.')
}
