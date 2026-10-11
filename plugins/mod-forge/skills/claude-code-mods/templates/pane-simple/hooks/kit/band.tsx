import type { ElementTable, RenderElement, RenderNode } from 'claude-code'
import { BAND_REOPEN_MS } from './defaults'
import { focusNow } from './focus'
import type { FocusExtra, Handles, KeySpec, UiState, World } from './types'

// The band: one row above the prompt. The line is the mod's text. The row ends
// with the words "ctrl+x tab to" and the Button "open" (SB:1495-1505).
// The Button has no hotkey (SK:203). The engine draws its own [-] mark right of
// the band, and ctrl+x ctrl+a hides the band. Put no Button in `line`: ctrl+x tab
// rings the FIRST Button of the band, so Enter then presses it, not open (crawl, 2.1.296).
// A key of the band goes in `keys`: bandRow draws its Button AFTER open, so open stays the first Button.
// ctrl+x tab, then the hotkey, presses the key Button (GB session, 2.1.296).
// A band that shows only while a turn runs tests e.props.isWorking before bandQuiet.
export function bandRow(E: Pick<ElementTable, 'Box' | 'Text' | 'Button'>, line: RenderNode, onOpen: () => void, keys: readonly KeySpec[] = []): RenderElement {
  const { Box, Text, Button } = E
  return (
    <Box flexDirection="row" paddingRight={4}>
      <Box flexGrow={1} flexShrink={1}>{line}</Box>
      <Box flexShrink={0} paddingLeft={2} flexDirection="row">
        <Text dimColor>{'ctrl+x tab to '}</Text>
        <Button key="band:open" plain label="open" onPress={onOpen} />
        {keys.map(k => <Box key={`band:k:${k.hotkey}`} paddingLeft={2}><Button key={`band:${k.hotkey}`} plain hotkey={k.hotkey} label={k.label} onPress={k.onPress} /></Box>)}
      </Box>
    </Box>
  )
}

// True when the band must stay quiet: the hook then calls next(e) (SB:1474-1477).
// o.idle 'yield': the band is quiet while no model turn runs. o.working overrides props.isWorking.
// Without o the call behaves as before.
export async function bandQuiet<V extends string, T, S extends string, X extends object = {}>(
  k: Handles<V, T, S, X>, props: { readonly hasSurvey: boolean; readonly isWorking?: boolean }, w: World<T, S, X>,
  o?: { idle?: 'yield' | 'show'; working?: boolean },
): Promise<boolean> {
  if (props.hasSurvey) return true // a survey owns the row (T:10259)
  if (o?.idle === 'yield' && !(o.working ?? props.isWorking ?? false)) return true // idle: no model turn runs
  if (!w.loaded || w.run === 0) return true // no scenario yet
  return (await k.panes()).some(p => p.id === k.pane) // the pane is open: no band
}

// The band's Open: set the view, open the pane, then focus the key (SB:458-465).
// The caller ends the chain in .catch(() => undefined) (SB:1502).
export async function openFromBand<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, patch: Partial<UiState<V>>, focusKey: string, nav?: FocusExtra<V>): Promise<void> {
  await k.ui.set(() => ({ confirm: null, editing: false, inputFocused: false, ...patch }))
  await k.open()
  k.invalidate()
  await k.sleep(BAND_REOPEN_MS)
  // Opened twice, 150 ms apart (SB:460-463). The reason is unknown. Probe on 2.1.296 (2026-10-10, docked 150 x 45,
  // keys C-x Tab Enter): one open gave the pane with no ring 3 times of 3; two opens gave the ring 3 times of 3.
  // Second probe (same setup): one open gave no ring 3 of 3 again, and one open after a 150 ms wait also gave
  // no ring 3 of 3. So the second open gives the ring, not the wait.
  await k.open()
  if (focusKey) await focusNow(k, focusKey, nav)
}
