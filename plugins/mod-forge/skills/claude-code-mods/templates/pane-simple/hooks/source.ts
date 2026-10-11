// The data source of the mod. This file is yours: write the two functions, then test them in tests/source.test.ts.
// It holds no $: it takes an io handle (bind() in register.tsx gives it) with run (a program in the session folder) and store (the plugin's JSON store).
// The stubs below make a real run show the error view, so a missing data source is visible and never silent.
import type { ProcessRunResult, ToolCallInput } from 'claude-code'
import type { Row, World } from '../types'

// Run one program: run(['git', 'status']). It resolves with the exit code and the text of the program.
export type Run = (argv: readonly string[]) => Promise<ProcessRunResult>
// The plugin's own JSON store ($.store): get gives undefined for a key that is not set.
export type Store = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
// What the data source can use: run a program in the session folder, keep data in the store, or ask for the session folder (root).
// root() is the key of a per-project store entry: io.store.get(`notes:${await io.root()}`).
export type Io = { run: Run; store: Store; root: () => Promise<string> }

// Read the rows now: { rows } when the read works, { rows: [], error } when it does not.
export async function readRows(_io: Io, _now: number): Promise<Partial<World>> {
  return { rows: [], error: 'hooks/source.ts readRows() is not written yet.' }
}

// Do one action on the data source: kind is add, delete, mark, clear or refresh. Throw an Error with a one line message when it fails.
export async function act(_io: Io, kind: string, _row: Row | undefined, _text: string): Promise<void> {
  throw new Error(`hooks/source.ts act(${kind}) is not written yet.`)
}

// The tool.call observer slot: a mod that records tool calls keeps its code here, never in register.tsx. Keep what you see with
// io.store.set (readRows reads it back). The hook in register.tsx (the line that ends in "@source") calls this and never blocks the tool.
export async function observe(_io: Io, _e: ToolCallInput): Promise<void> {}
