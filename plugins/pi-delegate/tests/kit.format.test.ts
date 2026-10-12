// Tests for hooks/kit/format.ts. The functions are pure: no mount is needed.
// Each test still sets the clock and the six ui stubs, as every kit test does.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { age, cells, clean, cut, duration, firstLine, fit, headLines, kChars, oneLine, pad, when } from '../hooks/kit/format'

const NOW = new Date(2026, 9, 9, 18, 47).getTime()

// The clock and the engine stubs. Register them before the first $ call.
function setup(on: Parameters<TestBody>[1]): void {
  mock.clock(on, { now: NOW })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('cells counts narrow, wide, zero width and ambiguous text', async (_$, on) => {
  setup(on)
  expect(cells('abc')).toBe(3)
  expect(cells('中文')).toBe(4)
  expect(cells('e\u0301')).toBe(1)
  expect(cells('😀')).toBe(2)
  expect(cells('\u200d')).toBe(0)
  expect(cells('ｱ')).toBe(1)
  expect(cells('❯ ✓ ✕ · … ─')).toBe(11)
  expect(cells('a\x07b')).toBe(2)
})

test('cut keeps the head and ends with an ellipsis', async (_$, on) => {
  setup(on)
  expect(cut('Call the vendor', 8)).toBe('Call th…')
  expect(cut('中文字', 4)).toBe('中…')
  expect(cut('abc', 0)).toBe('')
  expect(cut('abc', 3)).toBe('abc')
  expect(cut(undefined, 5)).toBe('')
})

test('pad and fit measure cells', async (_$, on) => {
  setup(on)
  expect(pad('中', 3)).toBe('中 ')
  expect(pad('abcdef', 4)).toBe('abc…')
  expect(cells(pad('中文字', 5))).toBe(5)
  expect(fit('abcdef', 1)).toBe('a…')
  expect(fit('abcdef', 4)).toBe('abc…')
})

test('oneLine, firstLine and clean make raw text safe', async (_$, on) => {
  setup(on)
  expect(oneLine(' a\n b ')).toBe('a b')
  expect(firstLine('\n  x \ny')).toBe('x')
  expect(clean('a\x1b[31mb\x07c\td')).toBe('abc d')
  expect(clean('a\nb')).toBe('a\nb')
  expect(clean(null)).toBe('')
})

test('age, when and duration format time', async (_$, on) => {
  setup(on)
  expect(age(0, 59999)).toBe('<1m')
  expect(age(0, 3600000)).toBe('1h')
  expect(age(0, 172800000)).toBe('2d')
  expect(duration(1500)).toBe('1.5s')
  expect(duration(61000)).toBe('1m 01s')
  expect(duration(3660000)).toBe('1h 01m')
  expect(duration(undefined)).toBe('')
  expect(when(NOW, NOW)).toMatch(/^\d\d:\d\d$/)
  expect(when(NOW - 2 * 86400000, NOW)).toMatch(/^[A-Z][a-z]{2} \d{1,2} \d\d:\d\d$/)
})

test('kChars and headLines shorten counts and long text', async (_$, on) => {
  setup(on)
  expect(kChars(999)).toBe('999')
  expect(kChars(1500)).toBe('1.5k')
  expect(kChars(2000)).toBe('2k')
  expect(headLines('a\nb\nc', 2)).toEqual({ text: 'a\nb', total: 3, more: 1 })
  expect(headLines('a', 2)).toEqual({ text: 'a', total: 1, more: 0 })
})
