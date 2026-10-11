import type { RenderElement } from 'claude-code'
import { SEP, WAIT_HINT } from './defaults'
import { isBusy } from './ctx'
import { cells } from './format'
import { dismissable } from './notice'
import type { Ctx, KeySpec } from './types'

// The hint footer, one format on every screen (SB:480-505).
// Row 1: the action keys, as hotkey Buttons with `act:` keys. The arrows refuse them.
// Row 2: ONE dim hints row with `Esc to <verb>` last.

// Fit the hints in `cols` cells (SB:489, with cells instead of length).
// Drop hints from the front. Never drop the last hint: it is the Esc hint.
export function fitHints(parts: readonly string[], cols: number): string[] {
  const fit = [...parts]
  while (fit.length > 1 && cells(fit.join(SEP)) > cols) fit.shift()
  return fit
}

// The hints of a screen (SB:519-523).
// Busy: only the wait line. A dismissable notice: the notice row takes the Esc hint,
// so the footer drops every `Esc to ` hint. Else: the hints stay.
export function hintsFor<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, hints: readonly string[]): string[] {
  if (isBusy(c)) return [WAIT_HINT]
  if (dismissable(c.u.notice)) return hints.filter(h => !h.startsWith('Esc to '))
  return [...hints]
}

// What the footer shows: the keys (hidden while a field has focus or an action runs,
// SB:487) and the fitted hints. `footer` and `footerRows` use the same rule.
function shape<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, keys: readonly KeySpec[], hints: readonly string[]): { shown: readonly KeySpec[]; parts: string[] } {
  return {
    shown: c.u.inputFocused || isBusy(c) ? [] : keys,
    parts: fitHints(hintsFor(c, hints), c.cols),
  }
}

// A plain hotkey Button draws `<key>: <label>`, so each label is the verb only.
export function footer<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, keys: readonly KeySpec[], hints: readonly string[]): RenderElement {
  const { Box, Text, Button } = c.E
  const { shown, parts } = shape(c, keys, hints)
  return (
    <Box flexDirection="column">
      {shown.length ? (
        <Box flexDirection="row">
          {shown.map((s, i) => (
            <Box key={`k:${s.hotkey}`} flexDirection="row">
              {i > 0 ? <Text dimColor>{SEP}</Text> : ''}
              <Button key={`act:${s.hotkey}`} plain hotkey={s.hotkey} label={s.label} onPress={s.onPress} />
            </Box>
          ))}
        </Box>
      ) : ''}
      {parts.length ? <Text dimColor wrap="truncate-end">{parts.join(SEP)}</Text> : ''}
    </Box>
  )
}

// The rows that `footer` draws. The list window takes them off its room (6.7).
export function footerRows<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, keys: readonly KeySpec[], hints: readonly string[]): number {
  const { shown, parts } = shape(c, keys, hints)
  return (shown.length ? 1 : 0) + (parts.length ? 1 : 0)
}
