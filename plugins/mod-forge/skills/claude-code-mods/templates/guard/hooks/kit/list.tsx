import type { RenderChildren, RenderElement, RenderNode } from 'claude-code'
import { EDGE_ROWS, KEYS, MIN_WINDOW, POINTER } from './defaults'
import type { Ctx, ListKeys } from './types'

// A flat list with a window. One list window for each mod (kit API 10, question 7).
// A mod gives each row as a ListRow: the body, an optional side column and the press handler.
export type ListRow = { body: RenderChildren; side?: RenderNode; onPress: () => void }
export type ListWindow = { room: number; windowed: boolean; top: number; count: number; below: number; gap: number; edges: boolean }
export type ListOpts<R> = { idOf: (r: R) => string; isSel: (r: R) => boolean; row: (r: R, sel: boolean, width: number) => ListRow; fixedRows: number; pointer?: string }

// Buffer, not drawn state: the window of the last measured draw. The cells hold the state; this is
// only what the engine shows now, for the focus hook (rule 4 of kit-api.md allows this one buffer).
// room: the most rows the list shows at once (the window height, or the free rows of a list that is not
// windowed). top: the first shown row. at: the selected row of that draw (-1: none).
// The ring keeps its screen slot through a redraw, so the slot math must use the window that is drawn,
// not a newer selection in the cells: a burst of arrows writes the cells faster than the engine draws.
// A reload drops the buffer. The next draw measures it again (SB:47).
let seen = { room: 20, top: 0, at: -1 }

// First shown row of a windowed list. One row of context stays above the selection (SB:84-86),
// except in a window of one row: that row is the selection.
export function topOf(at: number, n: number, roomRows: number): number {
  return Math.min(Math.max(0, at - Math.min(1, roomRows - 1)), Math.max(0, n - roomRows))
}

// The window for n rows with the selection at index `at` (SB:648-655).
// `fixedRows` is every other row of the screen: header, rule, cards, facts, notice, footer and their margins.
// `gap` is the blank row above the list (SB:707). The edges are the up and down edge rows (SB:708, SB:710).
// The first layout that the pane holds wins, so the footer always shows (a 30-row terminal gives 8 body
// rows, and a fixed floor made the engine cut the 'Esc to close' row):
//   1. every row and the gap;  2. a window with the gap and the edges;  3. every row, no gap;
//   4. a window with the gap, no edges;  5. a window, no gap and no edges.
// A window keeps MIN_WINDOW rows where it can: an arrow moves the ring only to a drawn row, and the
// selection needs one drawn row above it and one below it (live, 2.1.296: a window of 2 rows froze Down).
export function listWindow<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, n: number, at: number, fixedRows: number): ListWindow {
  const space = c.rows - fixedRows // the rows for the gap, the edges and the list
  let gap = 1
  let edges = false
  let windowed = true
  let roomRows: number
  if (n <= space - 1) {
    windowed = false
    roomRows = space - 1 - EDGE_ROWS
  } else if (space - 1 - EDGE_ROWS >= MIN_WINDOW) {
    edges = true
    roomRows = space - 1 - EDGE_ROWS
  } else if (n <= space) {
    gap = 0
    windowed = false
    roomRows = space - EDGE_ROWS
  } else if (space - 1 >= MIN_WINDOW) {
    roomRows = space - 1
  } else {
    gap = 0
    roomRows = space
  }
  roomRows = Math.max(1, roomRows)
  const top = windowed ? topOf(Math.max(0, at), n, roomRows) : 0
  seen = { room: windowed ? roomRows : Math.max(space - gap, n), top, at }
  const count = Math.min(n - top, windowed ? roomRows : n)
  return { room: roomRows, windowed, top, count, below: n - top - count, gap, edges }
}

// The row keys in ring order and the index of the selected row. `at` is -1 when no row is selected.
export function rowKeys<R>(rows: readonly R[], idOf: (r: R) => string, isSel: (r: R) => boolean): ListKeys {
  return { keys: rows.map(r => KEYS.row + idOf(r)), at: rows.findIndex(isSel) }
}

// Draw the list rows (SB:664-670, SB:706-712).
// The mod cuts each body to the width it gets, so a row stays one screen line.
// A wrapped row breaks the window count. Edges are dim Text, never Buttons.
export function listRows<V extends string, T, S extends string, R, X extends object = {}>(c: Ctx<V, T, S, X>, rows: readonly R[], o: ListOpts<R>): RenderElement {
  const { Box, Text, Button } = c.E
  const at = rows.findIndex(o.isSel)
  const win = listWindow(c, rows.length, at, o.fixedRows)
  const pointer = o.pointer ?? POINTER
  const shown = rows.slice(win.top, win.top + win.count)
  return (
    <Box flexDirection="column" marginTop={win.gap}>
      {win.edges ? <Text key="edge:up" dimColor>{win.top > 0 ? `↑ ${win.top} more` : ' '}</Text> : ''}
      {shown.map(r => {
        const id = o.idOf(r)
        const sel = o.isSel(r)
        const row = o.row(r, sel, c.cols - 2)
        return (
          <Box key={`r:${id}`} flexDirection="row">
            <Button key={KEYS.row + id} plain autoFocus={sel && !c.u.confirm && !c.u.inputFocused ? true : undefined} onPress={row.onPress}>
              {sel ? `${pointer} ` : '  '}
              {row.body}
            </Button>
            {row.side ?? ''}
          </Box>
        )
      })}
      {win.edges ? <Text key="edge:down" dimColor>{win.below > 0 ? `↓ ${win.below} more` : ' '}</Text> : ''}
    </Box>
  )
}

// The most rows that the last measured list shows at once (see `seen`). Tests and the mod read it.
export function roomSeen(): number {
  return seen.room
}

// The window of the last measured draw: room, first shown row and selected row (see `seen`). The focus hook reads it.
export function windowSeen(): { room: number; top: number; at: number } {
  return { ...seen }
}
