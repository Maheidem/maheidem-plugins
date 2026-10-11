// The screens of the list pane. Every screen comes from a kit call: header, footer, listRows,
// confirmStrip, draftInput, noticeNodes and the loading, empty and error views (hooks/kit/).
// The data and the texts come from ./domain (generated: change them with mods.py domain, not here).
// This file holds what is yours: the STYLE rows (one row per persona sketch, ux-design.md 2),
// the layout and the hint words. Change them. Do not edit hooks/kit/ or the generated files.
// Every STYLE row draws <pointer> <mark> <tag> <title>. A variant changes the side text, the colours,
// the spacing, the header tail and the hint words. It never puts text before the title.
// An action sits in a section: lines that end in an action tag, or a block between its begin and end lines.
// mods.py new keeps the sections that the domain needs. The lines that carry the proto tag are the prototype:
// mods.py build removes them and turns each real line into code (references/storyboard.md).
import type { RenderElement, RenderNode } from 'claude-code'
import type { Row, Scenario, UiState, Variant, View, World, WorldExtra } from '../types'
import { FOCUS_SOON_MS, GLYPHS, HINTS, KEYS, TONE_COLOR } from './kit/defaults'
import { isBusy } from './kit/ctx'
import { cancelConfirm, askConfirm, confirmStrip } from './kit/confirm'
import { setDraft } from './kit/drafts'
import { focusSoon } from './kit/focus'
import { cells, clean, cut, firstLine } from './kit/format'
import { footer, footerRows } from './kit/footer'
import { header, rule } from './kit/header'
import { draftInput } from './kit/input'
import { listRows, rowKeys } from './kit/list'
import type { ListRow } from './kit/list'
import { noticeNodes, noticeRows, notify } from './kit/notice'
import { runAction } from './kit/scenario'
import type { Outcome } from './kit/scenario'
import { emptyView, errorView, loadingView } from './kit/states'
import type { Action, Ctx, Handles, KeySpec, ListKeys, Nav } from './kit/types'
import { ACTIONS, MARK, NOUN, TEXT, count, detailOf, marked, newRow, sideOf, tagOf, titleOf, toneOf } from './domain'
import type { ActionKind } from './domain'
import { COUNT, fixture } from './fixtures' // @proto

// The handles of this mod: the kit handles, the data source read and the data source act (bind() in register.tsx).
export type K = Handles<View, Row, Scenario, WorldExtra> & {
  read: () => Promise<Partial<World>>
  act: (kind: string, row: Row | undefined, text: string) => Promise<void>
}
type C = Ctx<View, Row, Scenario, WorldExtra> & { k: K }

// One row per persona sketch (ux-design.md 2): A UX, B Visual, C native, D Accessibility.
// tail: the header shows the place of the selected row. rule: a rule closes the list. noun: a key label names the thing it acts on.
// err and warn are words before a message. D adds words, so a colour never stands alone.
type Style = { readonly pointer: string; tail: boolean; rule: boolean; noun: boolean; err: string; warn: string }
const STYLE: Record<Variant, Style> = {
  A: { pointer: '❯', tail: true, rule: true, noun: false, err: '', warn: '' },
  B: { pointer: '❯', tail: false, rule: false, noun: false, err: '', warn: '' },
  C: { pointer: '❯', tail: false, rule: true, noun: false, err: '', warn: '' },
  D: { pointer: '>', tail: true, rule: true, noun: true, err: 'Error: ', warn: 'Warning: ' },
}

export const UI0: UiState = {
  view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '',
}

const GO_BACK = 'Esc to go back'
const DRAFT = 'add:text' // the key of the draft of the add field // @action-add
const SAVE = 'Enter to save' // @action-add
const FAILS = Object.keys(ACTIONS)[0] // the action that fails once in the role fails // @proto
const WAIT: number | undefined = undefined // the fixture wait of runAction: its default (1.5 s) // @proto
// @real: const WAIT = 0

const errText = (st: Style, text: string): string => `${GLYPHS.err} ${st.err}${text}`
const warnText = (st: Style, text: string): string => `${GLYPHS.warn} ${st.warn}${text}`
const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
const keyOf = (kind: ActionKind): string => ACTIONS[kind]?.key ?? ''
const verbOf = (kind: ActionKind): string => ACTIONS[kind]?.verb ?? ''
// The label of a key that acts on a row: the verb, and in D the noun too.
const labelOf = (c: C, kind: ActionKind): string => (STYLE[c.w.variant].noun ? `${verbOf(kind)} ${NOUN.one}` : verbOf(kind))
// The ring key of the first declared action of these kinds, or '' when none is declared.
const firstKey = (kinds: readonly ActionKind[]): string => {
  const key = kinds.map(keyOf).find(x => x !== '')
  return key === undefined ? '' : KEYS.act + key
}

// The selected row: the row of u.sel, else the first row, else none.
function selOf(u: UiState, w: World): Row | undefined {
  return w.rows.find(r => r.id === u.sel) ?? w.rows[0]
}
// The ring order of the list: the kit's focus hook reads it.
export function keysOf(u: UiState, w: World): ListKeys | null {
  const sel = selOf(u, w)
  return u.view === 'list' && sel ? rowKeys(w.rows, r => r.id, r => r.id === sel.id) : null
}

// Where the ring goes after a view changes, and where Esc leads (kit/close.ts, kit/focus.ts).
export const NAV: Nav<View, Row, Scenario, WorldExtra> = {
  back: u => (u.view === 'list' ? null : 'list'),
  home: (u, w) => {
    if (u.view === 'detail') return firstKey(['delete', 'mark'])
    if (u.view === 'add') return '' // the field has the ring: nothing else to focus // @action-add
    const sel = selOf(u, w)
    return sel ? KEYS.row + sel.id : firstKey(['add', 'refresh'])
  },
  // The add view has one field and nothing else to leave to: Esc cancels at once.
  // So the field never counts as focused (the ladder would only leave the field first).
  onFocus: key => (key.startsWith(KEYS.input) ? { inputFocused: false } : {}), // @action-add
}

// Scenario timers: only later(k, run, ms, step) calls. The loading scenario never ends:
// the design pass needs the loading screen to stay. Start a timer here to load the rows.
export function startTimers(_k: K, _s: Scenario, _run: number): void {} // @proto

// ---- the data source -------------------------------------------------------------

// Read the rows from the data source and show them. The real command calls it when the pane opens.
// A read that throws becomes the error view, with the first line of the error.
export async function load(k: K): Promise<void> {
  const got = await k.read().catch((err: unknown): Partial<World> => ({ rows: [], error: firstLine(clean(err instanceof Error ? err.message : err)) || TEXT.error }))
  await k.world.set(() => ({ error: '', ...got, loaded: true }))
}

// The result of an action. The prototype asks the fixture store, which fails once for each failsLeft (the role fails).
// The real mod asks the data source: k.act throws when it fails, and runAction shows the first line of the error.
async function result(k: K, w: World, act: Action, row: Row | undefined, ok: string, failed: string): Promise<Outcome> {
  // @proto:begin
  if (w.failsLeft > 0 && act.kind === FAILS) return { ok: false, notice: { tone: 'err', text: errText(STYLE[w.variant], failed) } }
  // @proto:end
  // @real: await (act.kind === 'refresh' ? load(k) : k.act(act.kind, row, act.text))
  return { ok: true, text: ok }
}

// ---- actions: each one ends in .catch, because nobody awaits it -------------------

async function openDetail(k: K, id: string): Promise<void> {
  await k.ui.set(() => ({ view: 'detail', cameFrom: 'list', sel: id }))
  focusSoon(k, firstKey(['delete', 'mark']), FOCUS_SOON_MS, NAV)
}

// @action-add:begin
async function openAdd(k: K): Promise<void> {
  // The view first: an Esc right after the key must find the add view, not the list (the list closes the pane).
  await k.ui.set(u => ({ view: 'add', cameFrom: u.view, notice: null }))
  await setDraft(k, DRAFT, null)
  await k.world.set(w => ({ epoch: w.epoch + 1 })) // a new field key mounts the field empty
  // The ring goes to the field by key: autoFocus alone left it on the old row after an Esc (live, 2.1.296).
  focusSoon(k, `${KEYS.input}add#${(await k.world.get()).epoch}`, FOCUS_SOON_MS, NAV)
}

async function saveRow(k: K, value: string): Promise<void> {
  const w0 = await k.world.get()
  if (w0.busy !== null) return // a second Enter while the save runs: the save notice stays
  const st = STYLE[w0.variant]
  if (value.trim() === '') {
    await notify(k, { tone: 'err', text: errText(st, TEXT.addEmpty) })
    return
  }
  const act: Action = { kind: 'add', id: `new${w0.epoch}`, text: value.trim() }
  const landed = (w: World): boolean => w.rows.some(r => r.id === act.id)
  await runAction(
    k, act,
    (w, a) => result(k, w, a, undefined, `${GLYPHS.ok} ${TEXT.doneAdd}: ${cut(a.text, 30)}`, TEXT.failedAdd),
    (w, a) => ({ rows: [newRow(a.id, a.text), ...w.rows], banner: '' }),
    {
      pending: { tone: 'warn', text: TEXT.pendingAdd }, draftKey: DRAFT, nav: NAV, waitMs: WAIT,
      focus: (_u, w) => (landed(w) ? KEYS.row + act.id : `${KEYS.input}add#${w.epoch}`),
    },
  )
  const w = await k.world.get()
  if (landed(w)) await k.ui.set(() => ({ view: 'list', sel: act.id }))
  else await k.world.set(() => ({ banner: TEXT.addBanner }))
}

const addKey = (c: C): KeySpec => ({ hotkey: keyOf('add'), label: labelOf(c, 'add'), onPress: () => void openAdd(c.k).catch(() => undefined) })

function addView(c: C): RenderElement {
  const { Box } = c.E
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, TEXT.addTitle, { inside: true })}
      <Box marginTop={1}>
        {draftInput(c, {
          name: 'add', draftKey: DRAFT, placeholder: TEXT.addPlaceholder, submitLabel: 'save', autoFocus: true, blank: 'submit',
          onSubmit: v => void saveRow(c.k, v).catch(() => undefined),
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {noticeNodes(c)}
        {footer(c, [], [SAVE, HINTS.cancel])}
      </Box>
    </Box>
  )
}
// @action-add:end

// @action-delete:begin
// Ask: open the detail with the question. The safe choice (Cancel) gets the ring.
async function askDelete(k: K, id: string): Promise<void> {
  if ((await k.world.get()).busy !== null) return
  await k.ui.set(() => ({ view: 'detail', sel: id }))
  await askConfirm(k, { kind: 'delete', id }, NAV)
}

async function deleteRow(k: K, id: string): Promise<void> {
  const row = (await k.world.get()).rows.find(r => r.id === id)
  if (!row) return
  const act: Action = { kind: 'delete', id, text: titleOf(row) }
  const first = (w: World): string => (w.rows[0] ? KEYS.row + w.rows[0].id : firstKey(['add', 'refresh']))
  await runAction(
    k, act,
    (w, a) => result(k, w, a, row, `${GLYPHS.ok} ${TEXT.doneDelete}: ${cut(a.text, 30)}`, TEXT.failedDelete),
    (w, a) => ({ rows: w.rows.filter(r => r.id !== a.id) }),
    { pending: { tone: 'warn', text: TEXT.pendingDelete }, nav: NAV, waitMs: WAIT, focus: (_u, w) => first(w) },
  )
  const w = await k.world.get()
  await k.ui.set(() => ({ view: 'list', sel: w.rows[0]?.id ?? '' }))
}

const deleteKey = (c: C, id: string): KeySpec => ({ hotkey: keyOf('delete'), label: labelOf(c, 'delete'), onPress: () => void askDelete(c.k, id).catch(() => undefined) })

// The question of the delete, with the safe choice first. A running action shows only the wait line.
const askNodes = (c: C, row: Row): RenderNode[] => (c.u.confirm === null ? [] : confirmStrip(c, {
  question: warnText(STYLE[c.w.variant], TEXT.askDelete), verb: verbOf('delete'), yesLabel: verbOf('delete'),
  onYes: () => void deleteRow(c.k, row.id).catch(() => undefined),
  onNo: () => void cancelConfirm(c.k, NAV).catch(() => undefined),
}))
// @action-delete:end

// @action-mark:begin
async function markRow(k: K, id: string): Promise<void> {
  const row = (await k.world.get()).rows.find(r => r.id === id)
  if (!row) return
  const act: Action = { kind: 'mark', id, text: titleOf(row) }
  await runAction(
    k, act,
    (w, a) => result(k, w, a, row, `${GLYPHS.ok} ${TEXT.doneMark}: ${cut(a.text, 30)}`, TEXT.failedMark),
    (w, a) => ({ rows: w.rows.map(r => (r.id === a.id ? marked(r) : r)) }),
    { pending: { tone: 'warn', text: TEXT.pendingMark }, nav: NAV, waitMs: WAIT, focus: () => KEYS.row + id },
  )
}

const markKey = (c: C, id: string): KeySpec => ({ hotkey: keyOf('mark'), label: labelOf(c, 'mark'), onPress: () => void markRow(c.k, id).catch(() => undefined) })
// @action-mark:end

// @action-refresh:begin
// Read the rows again. The prototype reads the fixture store again. The real mod calls load().
const reread = (): Partial<World> => ({ rows: fixture(COUNT), error: '' }) // @proto
// @real: const reread = (): Partial<World> => ({})

async function refreshRows(k: K): Promise<void> {
  const act: Action = { kind: 'refresh', id: '', text: '' }
  await runAction(
    k, act,
    (w, a) => result(k, w, a, undefined, `${GLYPHS.ok} ${TEXT.doneRefresh}`, TEXT.failedRefresh),
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
    (w, a) => result(k, w, a, undefined, `${GLYPHS.ok} ${TEXT.doneClear}`, TEXT.failedClear),
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
const listKeys = (c: C, id: string): KeySpec[] => declared([
  addKey(c), // @action-add
  deleteKey(c, id), // @action-delete
  markKey(c, id), // @action-mark
  refreshKey(c.k), // @action-refresh
  clearKey(c), // @action-clear
])
const detailKeys = (c: C, id: string): KeySpec[] => declared([
  deleteKey(c, id), // @action-delete
  markKey(c, id), // @action-mark
])
const emptyKeys = (c: C): KeySpec[] => declared([
  addKey(c), // @action-add
  refreshKey(c.k), // @action-refresh
])
const errorKeys = (c: C): KeySpec[] => declared([
  refreshKey(c.k), // @action-refresh
])
// The nodes that a detail screen adds under the row: the question of an action that asks first.
const questionNodes = (c: C, row: Row): RenderNode[] => [
  ...askNodes(c, row), // @action-delete
]

// One screen line for each row: <pointer> <mark> <tag> <title>, then the side text at the right.
// The title is cut to the room left of the side text (UX 13.1).
function rowOf(c: C, r: Row, width: number): ListRow {
  const { Box, Text } = c.E
  const tone = toneOf(r)
  const tag = tagOf(r)
  const lead = `${tone === undefined ? '' : `${MARK[tone]} `}${tag === '' ? '' : `${tag} `}`
  const side = sideOf(r)
  const room = width - cells(lead) - cells(side) - 1
  const mark = tone === undefined ? '' : <Text key="mark" color={TONE_COLOR[tone]} dimColor={tone === 'muted' ? true : undefined}>{`${MARK[tone]} `}</Text>
  return {
    body: <Text wrap="truncate-end">{mark}{`${tag === '' ? '' : `${tag} `}${cut(titleOf(r), room)}`}</Text>,
    side: side === '' ? undefined : <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{side}</Text></Box>,
    onPress: () => void openDetail(c.k, r.id).catch(() => undefined),
  }
}

function listView(c: C, sel: Row): RenderElement {
  const { Box, Text } = c.E
  const st = STYLE[c.w.variant]
  const keys = listKeys(c, sel.id)
  // One row has nothing to select: no arrow hint (the storyboard gate wants an edge for each shown key).
  const hints = c.w.rows.length > 1 ? [HINTS.select, HINTS.view, HINTS.close] : [HINTS.view, HINTS.close]
  // Every other row of the screen: the header, the banner, the rule, the notice and the footer.
  const fixed = 1 + (c.w.banner !== '' ? 1 : 0) + (st.rule ? 1 : 0) + noticeRows(c) + footerRows(c, keys, hints)
  const tail = st.tail && c.w.rows.length > 1 ? { text: `${c.w.rows.indexOf(sel) + 1} of ${c.w.rows.length}` } : undefined
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, count(c.w.rows.length), tail ? { tail } : undefined)}
      {c.w.banner !== '' ? <Text color="error" wrap="truncate-end">{errText(st, c.w.banner)}</Text> : ''}
      {listRows(c, c.w.rows, { idOf: r => r.id, isSel: r => r.id === sel.id, row: (r, _on, width) => rowOf(c, r, width), fixedRows: fixed, pointer: st.pointer })}
      {st.rule ? rule(c) : ''}
      {noticeNodes(c)}
      {footer(c, keys, hints)}
    </Box>
  )
}

function detailView(c: C, row: Row): RenderElement {
  const { Box, Text } = c.E
  const asking = c.u.confirm !== null
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, cap(NOUN.one), { inside: true })}
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text wrap="wrap">{titleOf(row)}</Text>
        {detailOf(row).map((l, i) => <Text key={`d:${i}`} dimColor={l.dim ? true : undefined} wrap="wrap">{l.text}</Text>)}
      </Box>
      {questionNodes(c, row)}
      {noticeNodes(c)}
      {asking ? (isBusy(c) ? footer(c, [], []) : '') : footer(c, detailKeys(c, row.id), [GO_BACK])}
    </Box>
  )
}

// The screen order: an error first, then loading, then the add field, then no rows, then the view.
export function draw(c: C): RenderElement {
  const st = STYLE[c.w.variant]
  const sel = selOf(c.u, c.w)
  if (c.w.error !== '') return errorView(c, { subject: TEXT.errorSubject, message: `${st.err}${c.w.error}`, hint: TEXT.errorHint, keys: errorKeys(c) })
  if (!c.w.loaded) return loadingView(c, TEXT.loadingWhat)
  if (c.u.view === 'add') return addView(c) // @action-add
  if (sel === undefined) return emptyView(c, { subject: count(0), lines: [TEXT.empty], keys: emptyKeys(c) })
  return c.u.view === 'detail' ? detailView(c, sel) : listView(c, sel)
}
