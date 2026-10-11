import type { ElementTable, RenderElement } from 'claude-code'
import { GLYPHS, HINTS } from './defaults'
import { footer } from './footer'
import { header } from './header'
import { noticeNodes } from './notice'
import type { Ctx, KeySpec } from './types'

// The three states every list screen needs: loading, empty and error. Each has a plain dim line (hard rule 19).

// Loading (SB:754-763): the header says `Loading…`, the body says what loads.
export function loadingView<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, what: string): RenderElement {
  const { Box, Text } = c.E
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, 'Loading…')}
      <Box marginTop={1} marginBottom={1}><Text dimColor>{`Loading ${what}…`}</Text></Box>
      {footer(c, [], [HINTS.close])}
    </Box>
  )
}

// Empty (SB:738-752): one dim line for each text line, then the notice, then the footer.
export function emptyView<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, o: { subject: string; lines: readonly string[]; keys?: readonly KeySpec[] }): RenderElement {
  const { Box, Text } = c.E
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, o.subject)}
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {o.lines.map((line, i) => <Text key={`line:${i}`} dimColor>{line}</Text>)}
      </Box>
      {noticeNodes(c)}
      {footer(c, o.keys ?? [], [HINTS.close])}
    </Box>
  )
}

// Error (SB:765-777): a warn header, the message with a glyph, and a dim hint.
export function errorView<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, o: { subject: string; message: string; hint: string; keys?: readonly KeySpec[] }): RenderElement {
  const { Box, Text } = c.E
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, o.subject, { tone: 'warn' })}
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Text color="error" wrap="wrap">{`${GLYPHS.err} ${o.message}`}</Text>
        <Text dimColor wrap="wrap">{`  ${o.hint}`}</Text>
      </Box>
      {footer(c, o.keys ?? [], [HINTS.close])}
    </Box>
  )
}

// The one line for a surface without Input and Select (TPL:147-150, hard rule 27).
// The mod returns it for `mobile` and `vscode` before it takes any Input.
export function mobileNote(E: Pick<ElementTable, 'Text'>): RenderElement {
  const { Text } = E
  return <Text dimColor>This pane needs the terminal or the desktop app.</Text>
}
