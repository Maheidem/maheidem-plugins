// Pure text helpers for the kit: no handles, no I/O, no imports.
// Source: the storyboard format.ts (SBF), with cells() in place of .length.

type Range = readonly [number, number]

// Code points that take no cell (marks, joiners, variation selectors).
const ZERO: readonly Range[] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x2060, 0x2064], [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xfeff, 0xfeff], [0xe0100, 0xe01ef],
]

// Code points that take two cells (East Asian wide and full width, emoji).
// Checked against Python unicodedata (Unicode 15.1.0): no wide code point is missing.
const WIDE: readonly Range[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x18d08], [0x1aff0, 0x1b2ff], [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f2ff], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7f0], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n: number): string => String(n).padStart(2, '0')

function inRanges(cp: number, ranges: readonly Range[]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false // the tables are sorted
    if (cp <= hi) return true
  }
  return false
}

// The width of one code point in terminal cells.
// Ambiguous width counts 1: Bun.stringWidth does the same (the layout choice is unverified).
function cellOf(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0
  if (cp < 0x300) return 1
  if (inRanges(cp, ZERO)) return 0
  return inRanges(cp, WIDE) ? 2 : 1
}

// The width of a text in terminal cells. Never use .length for a drawn width.
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += cellOf(ch.codePointAt(0) ?? 0)
  return n
}

// Cut ahead of time (a Button cannot truncate): keep the head, end with an ellipsis.
export function cut(value: unknown, width: number): string {
  const text = String(value ?? '')
  if (width <= 0) return ''
  if (cells(text) <= width) return text
  let used = 0
  let head = ''
  for (const ch of text) {
    const w = cellOf(ch.codePointAt(0) ?? 0)
    if (used + w > width - 1) break
    used += w
    head += ch
  }
  return `${head}…`
}

// Cut the text to the width, then fill the rest with spaces.
export function pad(text: string, width: number): string {
  const t = cut(text, width)
  return t + ' '.repeat(Math.max(0, width - cells(t)))
}

// Fit a text in the room that is left. The result keeps one character and the ellipsis at least.
export function fit(text: string, room: number): string {
  return cut(text, Math.max(2, room))
}

export function oneLine(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function firstLine(value: unknown): string {
  return String(value ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
}

// Make raw data safe to draw: no escape sequence, no control character, no tab. Keep the new line.
export function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
}

// `1.5k` for 1500 and `2k` for 2000.
export function kChars(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

function hhmm(ts: number): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '--:--' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// `18:52` today, `Oct 1 18:52` on another day. The time is local.
export function when(ts: number, now: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return sameDay(ts, now) ? hhmm(ts) : `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()} ${hhmm(ts)}`
}

// Minute ages: <1m 12m 16h 2d.
export function age(ts: number, now: number): string {
  const m = Math.floor(Math.max(0, now - ts) / 60000)
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

// `1.5s`, `1m 01s`, `1h 01m`. An unknown or negative time gives an empty text.
export function duration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${pad2(s % 60)}s` : ''}`
  return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`
}

// The first n lines of a text, the line total and the number of lines that are cut.
export function headLines(text: string, n: number): { text: string; total: number; more: number } {
  const lines = String(text ?? '').split('\n')
  return { text: lines.slice(0, n).join('\n'), total: lines.length, more: Math.max(0, lines.length - n) }
}
