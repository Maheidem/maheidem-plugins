// Tests of the data source (hooks/source.ts). The function takes an io handle (run and store), so a test gives it a fake one.
// To test the whole mod with the real command instead, stub the engine call: on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: '...', stderr: '' } })).
// The seeded test below proves the stub: a missing data source throws an error that names the file, and the command answers with it.
// Replace it with tests of the real code. Use the real output of the program as the stdout of the fake run.
import { expect, test } from 'claude-code/testing'
import { readRows } from '../hooks/source'
import type { Io } from '../hooks/source'

// An io handle: run answers every program with this output, and store is a map in memory.
const fake = (stdout: string, kept = new Map<string, unknown>()): Io => ({
  run: async () => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }),
  root: async () => '/work',
  store: { get: async key => kept.get(key), set: async (key, value) => { kept.set(key, value) } },
})

test('readRows: the stub throws an error that names the file', async () => {
  await expect(readRows(fake(''), 0)).rejects.toThrow(/hooks\/source\.ts readRows\(\) is not written yet/)
})
