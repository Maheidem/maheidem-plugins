// The screens of the simple pane. The rows are plain Text: nothing opens, nothing is selected.
// Every screen comes from a kit call: header, footer, noticeNodes and the loading, empty and error views (hooks/kit/).
// The data and the texts come from ./domain (generated: change them with mods.py domain, not here).
// This file holds what is yours: the STYLE rows (one row per persona sketch, ux-design.md 2) and the layout.
// Change them. Do not edit hooks/kit/ or the generated files.
// Every STYLE row draws <mark> <tag> <title>. A variant changes the side text, the colours, the header tail and the words.
// It never puts text before the title. The rows go newest first in the data. The pane draws the newest row last.
// An action sits in a section: lines that end in an action tag, or a block between its begin and end lines.
// mods.py new keeps the sections that the domain needs. The lines that carry the proto tag are the prototype:
// mods.py build removes them and turns each real line into code (references/storyboard.md).
import type { RenderElement } from 'claude-code'
import type { Row, Scenario, UiState, Variant, View, World, WorldExtra } from '../types'
import { GLYPHS, HINTS, KEYS, MIN_WINDOW, TONE_COLOR } from './kit/defaults'
import { cells, clean, cut, firstLine } from './kit/format'
import { footer, footerRows } from './kit/footer'
import { header } from './kit/header'
import { noticeNodes, noticeRows } from './kit/notice'
import { runAction } from './kit/scenario'
import type { Outcome } from './kit/scenario'
import { emptyView, errorView, loadingView } from './kit/states'
import type { Action, Ctx, Handles, KeySpec, Nav, Tone } from './kit/types'
import { ACTIONS, MARK, TEXT, count, sideOf, tagOf, titleOf, toneOf } from './domain'
import type { ActionKind } from './domain'
import { COUNT, fixture } from './fixtures' // @proto

// The handles of this mod: the kit handles, the data source read and the data source act (bind() in register.tsx).
// A pane with no selection acts on no row: act gets undefined for the row.
export type K = Handles<View, Row, Scenario, WorldExtra> & {
  read: () => Promise<Partial<World>>
  act: (kind: string, row: Row | undefined, text: string) => Promise<void>
}
type C = Ctx<View, Row, Scenario, WorldExtra> & { k: K }

// One row per persona sketch (ux-design.md 2): A UX, B Visual, C native, D Accessibility.
// layout: where the side text sits. sideTone: the side text takes the tone of the row. words: the side text names the tone.
// tail: the header counts the failed and warned rows. D adds words and glyphs, so a colour never stands alone.
type Style = { readonly layout: 'right' | 'inline'; sideTone: boolean; words: boolean; tail: boolean; err: string }
const STYLE: Record<Variant, Style> = {
  A: { layout: 'right', sideTone: false, words: false, tail: true, err: '' },
  B: { layout: 'right', sideTone: true, words: false, tail: false, err: '' },
  C: { layout: 'inline', sideTone: false, words: false, tail: true, err: '' },
  D: { layout: 'right', sideTone: false, words: true, tail: true, err: 'Error: ' },
}
const WORD: { readonly [K in Tone]: string } = { ok: 'ok', warn: 'warning', err: 'error', muted: '' }

export const UI0: UiState = {
  view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '',
}

const FAILS = Object.keys(ACTIONS)[0] // the action that fails once in the role fails // @proto
const WAIT: number | undefined = undefined // the fixture wait of runAction: its default (1.5 s) // @proto
// @real: const WAIT = 0

const keyOf = (kind: ActionKind): string => ACTIONS[kind]?.key ?? ''
const verbOf = (kind: ActionKind): string => ACTIONS[kind]?.verb ?? ''
// The ring key of the first declared action of these kinds, or '' when none is declared.
const firstKey = (kinds: readonly ActionKind[]): string => {
  const key = kinds.map(keyOf).find(x => x !== '')
  return key === undefined ? '' : KEYS.act + key
}

// Where the ring goes after an action, and where Esc leads (kit/close.ts). Nothing opens: Esc closes the pane.
export const NAV: Nav<View, Row, Scenario, WorldExtra> = {
  back: () => null,
  home: () => firstKey(['refresh', 'clear']),
}

// ---- the data source -------------------------------------------------------------

// Read the rows from the data source and show them. The real command calls it when the pane opens.
// A read that throws becomes the error view, with the first line of the error.
export async function load(k: K): Promise<void> {
  const got = await k.read().catch((err: unknown): Partial<World> => ({ rows: [], error: firstLine(clean(err instanceof Error ? err.message : err)) || TEXT.error }))
  await k.world.set(() => ({ error: '', ...got, loaded: true }))
}

// The result of an action. The prototype asks the fixture store, which fails once for each failsLeft (the role fails).
// The real mod asks the data source: k.act throws when it fails, and runAction shows the first line of the error.
async function result(k: K, w: World, act: Action, ok: string, failed: string): Promise<Outcome> {
  // @proto:begin
  if (w.failsLeft > 0 && act.kind === FAILS) return { ok: false, notice: { tone: 'err', text: `${GLYPHS.err} ${STYLE[w.variant].err}${failed}` } }
  // @proto:end
  // @real: await (act.kind === 'refresh' ? load(k) : k.act(act.kind, undefined, act.text))
  return { ok: true, text: ok }
}

// ---- actions: each one ends in .catch, because nobody awaits it -------------------

// @action-refresh:begin
// Read the rows again. The prototype reads the fixture store again. The real mod calls load().
const reread = (): Partial<World> => ({ rows: fixture(COUNT), error: '' }) // @proto
// @real: const reread = (): Partial<World> => ({})

async function refreshRows(k: K): Promise<void> {
  const act: Action = { kind: 'refresh', id: '', text: '' }
  await runAction(
    k, act,
    (w, a) => result(k, w, a, `${GLYPHS.ok} ${TEXT.doneRefresh}`, TEXT.failedRefresh),
    reread,
    { pending: { tone: 'warn', text: TEXT.pendingRefresh }, nav: NAV, waitMs: WAIT },
  )
}

const refreshKey = (k: K): KeySpec => ({ hotkey: keyOf('refresh'), label: verbOf('refresh'), onPress: () => void refreshRows(k).catch(() => undefined) })
// @action-refresh:end

// @action-clear:begin
async function clearRows(k: K): Promise<void> {
  const act: Action = { kind: 'clear', id: '', text: '' }
  await runAction(
    k, act,
    (w, a) => result(k, w, a, `${GLYPHS.ok} ${TEXT.doneClear}`, TEXT.failedClear),
    () => ({ rows: [] }),
    { pending: { tone: 'warn', text: TEXT.pendingClear }, nav: NAV, waitMs: WAIT },
  )
}

const clearKey = (c: C): KeySpec => ({ hotkey: keyOf('clear'), label: verbOf('clear'), onPress: () => void clearRows(c.k).catch(() => undefined) })
// @action-clear:end

// ---- screens ---------------------------------------------------------------------

// The footer keys of each screen, in the order the footer shows them. A section adds its key here.
// A kind that the domain does not declare has no hotkey: declared() drops its key.
const declared = (keys: KeySpec[]): KeySpec[] => keys.filter(k => k.hotkey !== '')
const listKeys = (c: C): KeySpec[] => declared([
  refreshKey(c.k), // @action-refresh
  clearKey(c), // @action-clear
])
const emptyKeys = (c: C): KeySpec[] => declared([
  refreshKey(c.k), // @action-refresh
])
const errorKeys = (c: C): KeySpec[] => declared([
  refreshKey(c.k), // @action-refresh
])

// The header tail: how many rows failed and how many warn. A glyph and a number, so it reads with NO_COLOR too.
function tallyOf(rows: readonly Row[]): { text: string; tone: Tone } | undefined {
  const failed = rows.filter(r => toneOf(r) === 'err').length
  const warned = rows.filter(r => toneOf(r) === 'warn').length
  const parts = [failed > 0 ? `${MARK.err} ${failed}` : '', warned > 0 ? `${MARK.warn} ${warned}` : ''].filter(p => p !== '')
  return parts.length === 0 ? undefined : { text: parts.join('  '), tone: failed > 0 ? 'err' : 'warn' }
}

// One screen line for each row: <mark> <tag> <title>, then the side text. The title is cut to the room that is left (UX 13.1).
function rowOf(c: C, r: Row): RenderElement {
  const { Box, Text } = c.E
  const st = STYLE[c.w.variant]
  const tone = toneOf(r)
  const tag = tagOf(r)
  const lead = `${tone === undefined ? '' : `${MARK[tone]} `}${tag === '' ? '' : `${tag} `}`
  const word = st.words && tone !== undefined && WORD[tone] !== '' ? `${WORD[tone]} ` : ''
  const side = `${word}${sideOf(r)}`.trim()
  const sideColor = st.sideTone && tone !== undefined ? TONE_COLOR[tone] : undefined
  const mark = tone === undefined ? '' : <Text key="mark" color={TONE_COLOR[tone]} dimColor={tone === 'muted' ? true : undefined}>{`${MARK[tone]} `}</Text>
  const key = `t:${r.id}`
  if (st.layout === 'inline') {
    return <Text key={key} wrap="truncate-end">{mark}{`${tag === '' ? '' : `${tag} `}${titleOf(r)}`}<Text dimColor>{side === '' ? '' : `  ${side}`}</Text></Text>
  }
  const room = c.cols - cells(lead) - cells(side) - 1
  return (
    <Box key={key} flexDirection="row">
      <Text wrap="truncate-end">{mark}{`${tag === '' ? '' : `${tag} `}${cut(titleOf(r), room)}`}</Text>
      <Box flexGrow={1} justifyContent="flex-end"><Text color={sideColor} dimColor={sideColor === undefined ? true : undefined}>{side}</Text></Box>
    </Box>
  )
}

function listView(c: C): RenderElement {
  const { Box, Text } = c.E
  const st = STYLE[c.w.variant]
  const keys = listKeys(c)
  const hints = [HINTS.close]
  // Every other row of the screen: the header, two margin rows, the notice and the footer.
  const full = Math.max(MIN_WINDOW, c.rows - 1 - 2 - noticeRows(c) - footerRows(c, keys, hints))
  const windowed = c.w.rows.length > full
  // The data goes newest first. The pane draws the newest row last: the window keeps the end and one row for the edge line.
  const rows = [...c.w.rows].reverse()
  const shown = rows.slice(-(windowed ? full - 1 : full))
  const hidden = rows.length - shown.length
  const tally = st.tail ? tallyOf(rows) : undefined
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, count(rows.length), tally ? { tail: tally } : undefined)}
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {hidden > 0 ? <Text key="edge:up" dimColor>{`${GLYPHS.up} ${hidden} more`}</Text> : ''}
        {shown.map(r => rowOf(c, r))}
      </Box>
      {noticeNodes(c)}
      {footer(c, keys, hints)}
    </Box>
  )
}

// The screen order: an error first, then loading, then no rows, then the list.
export function draw(c: C): RenderElement {
  const st = STYLE[c.w.variant]
  if (c.w.error !== '') return errorView(c, { subject: TEXT.errorSubject, message: `${st.err}${c.w.error}`, hint: TEXT.errorHint, keys: errorKeys(c) })
  if (!c.w.loaded) return loadingView(c, TEXT.loadingWhat)
  if (c.w.rows.length === 0) return emptyView(c, { subject: count(0), lines: [TEXT.empty], keys: emptyKeys(c) })
  return listView(c)
}
