import { FOCUS_SOON_MS, HINTS, SEP, TONE_COLOR } from './defaults'
import { isBusy } from './ctx'
import { focusSoon } from './focus'
import { cut } from './format'
import type { Confirm, Ctx, FocusExtra, Handles, Nav } from './types'
import type { RenderNode } from 'claude-code'

export type ConfirmOpts = { question: string; verb: string; yesLabel: string; onYes: () => void; onNo: () => void }

// The strip that asks "are you sure". It draws no footer: it has its own hint row (SB:601-612).
export function confirmStrip<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, o: ConfirmOpts): RenderNode[] {
  const { Box, Text, Button } = c.E
  const ask = <Text key="s:ask" color={TONE_COLOR.warn} wrap="wrap">{o.question}</Text>
  // While an action runs, only the question stays (SB:603).
  if (isBusy(c)) return [ask]
  return [
    ask,
    <Box key="s:keys" flexDirection="row" columnGap={4}>
      <Button key="confirm:yes" plain hotkey="y" label={cut(o.yesLabel, 20)} onPress={o.onYes} />
      <Button key="confirm:no" plain hotkey="n" label="cancel" autoFocus onPress={o.onNo} />
    </Box>,
    <Text key="s:hint" dimColor>{`y to ${o.verb}${SEP}${HINTS.cancel}`}</Text>,
  ]
}

// Ask the question. The ring goes to the safe choice by key: autoFocus alone left it on yes (SK:209).
export async function askConfirm<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, confirm: Confirm, nav?: FocusExtra<V>): Promise<void> {
  if ((await k.world.get()).busy !== null) return // SB:426-431
  await k.ui.set(() => ({ confirm }))
  focusSoon(k, 'confirm:no', FOCUS_SOON_MS, nav)
}

// Close the question and put the ring back on the home key (SB:613-619).
export async function cancelConfirm<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, nav: Nav<V, T, S, X>): Promise<void> {
  await k.ui.set(() => ({ confirm: null }))
  const u2 = await k.ui.get()
  const w = await k.world.get()
  focusSoon(k, nav.home(u2, w), FOCUS_SOON_MS, nav)
}
