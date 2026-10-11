// Tests of the data source (hooks/watch.ts rowFrom) and of the rules (hooks/rules.ts judge). Both are plain functions: no engine call is needed.
// The seeded tests below prove the stubs: a missing data source shows its own text, never a silent gap.
// Replace them with tests of the real code. Use the real event of the hook as the argument of rowFrom.
import { expect, test } from 'claude-code/testing'
import { rowFrom } from '../hooks/watch'
import type { Handles } from '../hooks/watch'

test('rowFrom: the stub toasts a text that names the file and returns no row', async () => {
  const toasts: string[] = []
  const k: Handles = { seen: { get: async () => ({ rows: [] }), set: async () => undefined }, toast: t => { toasts.push(t) }, log: () => undefined, status: () => undefined }
  expect(await rowFrom(k, {})).toBeUndefined()
  expect(toasts).toEqual(['hooks/watch.ts rowFrom() is not written yet.'])
})
