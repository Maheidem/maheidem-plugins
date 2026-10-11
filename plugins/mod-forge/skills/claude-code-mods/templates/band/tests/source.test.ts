// Tests of the data source (hooks/source.ts). The two functions take an io handle (run and store), so a test gives them a fake one.
// To test the whole mod with the real command instead, stub the engine call: on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: '...', stderr: '' } })).
// The seeded tests below prove the stubs: a missing data source gives an error, never a silent empty list.
// Replace them with tests of the real code. Use the real output of the program as the stdout of the fake run.
import { expect, test } from 'claude-code/testing'
import { act, readRows } from '../hooks/source'
import type { Io } from '../hooks/source'

// An io handle: run answers every program with this output, and store is a map in memory.
const fake = (stdout: string, kept = new Map<string, unknown>()): Io => ({
  run: async () => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }),
  root: async () => '/work',
  store: { get: async key => kept.get(key), set: async (key, value) => { kept.set(key, value) } },
})

test('readRows: the stub returns an error that names the file', async () => {
  const got = await readRows(fake(''), 0)
  expect(got.rows).toEqual([])
  expect(got.error).toMatch(/hooks\/source\.ts readRows\(\) is not written yet/)
})

test('act: the stub throws an error that names the action', async () => {
  await expect(act(fake(''), 'delete', undefined, '')).rejects.toThrow(/act\(delete\) is not written yet/)
})
