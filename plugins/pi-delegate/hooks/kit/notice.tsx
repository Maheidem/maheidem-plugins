import type { RenderNode } from 'claude-code'
import { isBusy } from './ctx'
import { HINTS, MIN_COLS, NOTICE_CLEAR_MS, SEP, TONE_COLOR } from './defaults'
import { cells } from './format'
import type { Ctx, Handles, Notice, NoticeSpec } from './types'

// A notice with no timer and no warn tone: Esc dismisses it and does nothing else. (SB:514-516)
export function dismissable(n: Notice | null): boolean {
  return n !== null && !n.clear && n.tone !== 'warn'
}

// Set a notice. A timed notice (clear) goes after NOTICE_CLEAR_MS, unless a newer notice replaced it. (SB:177-181)
export async function notify<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, n: NoticeSpec | null): Promise<void> {
  const id = await k.now()
  await k.ui.set(() => ({ notice: n ? { ...n, id } : null }))
  if (n?.clear) {
    void k.sleep(NOTICE_CLEAR_MS).then(() => k.ui.set(u => (u.notice?.id === id ? { notice: null } : {}))).catch(() => undefined)
  }
}

// Draw the notice: the text, the detail and the key row. (SB:527-548)
// The mod writes the glyph in the text. Colour never stands alone.
export function noticeNodes<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, o?: { onRetry?: () => void }): RenderNode[] {
  const n = c.u.notice
  if (!n) return []
  const { Box, Text, Button } = c.E
  const muted = n.tone === 'muted'
  const nodes: RenderNode[] = [
    <Text key="n:text" color={TONE_COLOR[n.tone]} dimColor={muted ? true : undefined} italic={muted ? true : undefined} wrap="wrap">{n.text}</Text>,
  ]
  if (n.detail) nodes.push(<Text key="n:detail" dimColor wrap="wrap">{`  ${n.detail}`}</Text>)
  if (dismissable(n)) {
    const onRetry = o?.onRetry
    const retry = n.retry && onRetry !== undefined && !c.u.confirm && !isBusy(c) ? onRetry : null
    nodes.push(
      <Box key="n:keys" flexDirection="row">
        <Text dimColor>{'  '}</Text>
        {retry ? <Button key="act:retry" plain hotkey="r" label="retry" onPress={retry} /> : null}
        <Text dimColor>{retry ? `${SEP}${HINTS.dismiss}` : HINTS.dismiss}</Text>
      </Box>,
    )
  }
  return nodes
}

// Count the rows that the notice takes at the pane width. (SB:549-552, measured with cells)
export function noticeRows<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>): number {
  const n = c.u.notice
  if (!n) return 0
  const w = Math.max(MIN_COLS, c.cols)
  const text = Math.max(1, Math.ceil(cells(n.text) / w))
  const detail = n.detail ? Math.ceil((cells(n.detail) + 2) / w) : 0
  return text + detail + (dismissable(n) ? 1 : 0)
}
