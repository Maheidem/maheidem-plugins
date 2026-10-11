import type { RenderElement, ThemeKey } from 'claude-code'
import { GLYPHS, SEP, TONE_COLOR } from './defaults'
import type { Ctx, Tone } from './types'

// One header line for every screen: dim title, one bold subject, optional state glyph and tail.
// Source: SB:698-705 (top level) and SB:1101-1108 (a screen inside the pane).
export type HeaderOpts = {
  inside?: true // a screen inside the pane: the title ends with `›` (SB:1070, SB:1102)
  tone?: Tone // the colour of the subject
  glyph?: { text: string; tone?: Tone } // a state glyph before the subject
  tail?: { text: string; tone?: Tone } // text after the subject, after a dim separator
}

// A muted tone has no colour: it draws dim (rule 6). No tone draws plain text.
function color(tone: Tone | undefined): ThemeKey | undefined {
  return tone === undefined ? undefined : TONE_COLOR[tone]
}
function dim(tone: Tone | undefined): true | undefined {
  return tone === 'muted' ? true : undefined
}

export function header<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, subject: string, o?: HeaderOpts): RenderElement {
  const { Text } = c.E
  const glyph = o?.glyph
  const tail = o?.tail
  return (
    <Text wrap="truncate-end">
      <Text dimColor>{`${c.title}${o?.inside ? ` ${GLYPHS.crumbIn} ` : ` ${GLYPHS.crumbTop} `}`}</Text>
      {glyph ? <Text color={color(glyph.tone)} dimColor={dim(glyph.tone)}>{`${glyph.text} `}</Text> : ''}
      <Text bold color={color(o?.tone)} dimColor={dim(o?.tone)}>{subject}</Text>
      {tail ? <Text dimColor>{SEP}</Text> : ''}
      {tail ? <Text color={color(tail.tone)} dimColor={tail.tone === undefined || tail.tone === 'muted' ? true : undefined}>{tail.text}</Text> : ''}
    </Text>
  )
}

// A dim horizontal rule (SB:473-476). The default width is the pane width.
export function rule<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, width?: number): RenderElement {
  const { Text } = c.E
  return <Text dimColor wrap="truncate-end">{GLYPHS.rule.repeat(Math.max(1, width ?? c.cols))}</Text>
}
