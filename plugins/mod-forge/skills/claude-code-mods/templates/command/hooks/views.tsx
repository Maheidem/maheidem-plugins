// The drawing of the command output row. The row is a transcript row, not a pane:
// it draws at the width of the transcript, so it needs no width and no scroll.
// The text stays plain: the model reads the same text. This tree only adds colour.
import type { RenderElement } from 'claude-code'
import { GLYPHS, TONE_COLOR } from './kit/defaults'
import type { Tone, Ui } from './kit/types'

// A line that starts with a glyph takes the tone of the glyph. Any other line is plain.
function toneOf(line: string): Tone | undefined {
  if (line.startsWith(GLYPHS.ok)) return 'ok'
  if (line.startsWith(GLYPHS.err)) return 'err'
  return undefined
}

// The first line is the head of the reply (the prototype: "Scenario A normal"): dim. The others follow their glyph.
// The engine puts "<command>: " before the first line of the text (live, 2.1.296). Keep that in mind
// when the first line of a real command is an answer line and not a head line.
export function outputView(E: Pick<Ui, 'Box' | 'Text'>, text: string): RenderElement {
  const { Box, Text } = E
  const [head = '', ...body] = text.split('\n')
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{head}</Text>
      {body.map((line, i) => <Text key={`line:${i}`} color={TONE_COLOR[toneOf(line) ?? 'muted']} wrap="wrap">{line}</Text>)}
    </Box>
  )
}
