import type { ThemeKey } from 'claude-code'
import type { Tone } from './types'

// Every number names its source. SB = the storyboard register.tsx, TPL = the list-pane template.
export const KIT = { version: 2, types: '2.1.296' } as const // toolchain-design.md:157; decisions.md A4: crawl 19/19 nodes, 67/67 edges on 2.1.296 (2026-10-10)
export const TYPING_MS = 300 // SB:161: write the draft 300 ms after the last key
export const FOCUS_SOON_MS = 80 // SB:173, SB:1436: wait for the redraw, then move the ring
export const FOCUS_RELAYOUT_MS = 160 // SB:424: a view change that also draws a new field
export const FOCUS_TAB_MS = 30 // SB:434: a tab press
export const NOTICE_CLEAR_MS = 5000 // SB:180: a timed (clear) notice
export const BAND_REOPEN_MS = 150 // SB:462: the second open from the band
export const ACTION_MS = 1500 // SB:292: a fixture action (the permission prompt and the tool)
export const MIN_WINDOW = 3 // SB:649, TPL:36: the smallest list window
export const MIN_COLS = 20 // SB:1513, TPL:152
export const MIN_ROWS = 8 // SB:1514
export const EDGE_ROWS = 2 // SB:708, SB:710: the up and down edge rows
export const POINTER = '❯' // SB:666
export const SEP = ' · ' // SB:489, SB:496
export const WAIT_HINT = 'Waiting for the result…' // SB:511
export const HINTS = {
  close: 'Esc to close', // SB:733
  back: 'Esc to back', // SB:1065
  cancel: 'Esc to cancel', // SB:610
  dismiss: 'Esc to dismiss', // SB:543
  leaveField: 'Esc to leave the field', // SB:733
  select: '↑/↓ to select', // SB:733
  view: 'Enter to view', // SB:733
  send: 'Enter to send', // SB:733
} as const
export const KEYS = { row: 'row:', act: 'act:', confirm: 'confirm:', tab: 'tab:', input: 'in:', pick: 'pick:' } as const // SB:665, 497, 607, 847, 1168
export const TONE_COLOR: { readonly [K in Tone]: ThemeKey | undefined } = { ok: 'success', err: 'error', warn: 'warning', muted: undefined } // SB:525
export const GLYPHS = { ok: '✓', err: '✕', warn: '!', up: '↑', down: '↓', crumbTop: '·', crumbIn: '›', rule: '─', more: '…' } as const // format.ts:20, SB:1072, SB:700, SB:1070
