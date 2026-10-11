// Test helpers: draw a node tree as text, and check a journey marker against it.
// Copied from the proven storyboard test.
// Markers drawn by the engine, not by the mod: the mode line and toasts.
const ENGINE_ONLY = ['shift+tab to cycle']

type Node = { type?: string; props?: { [k: string]: unknown }; children?: unknown[] }

// The drawing as text: a column Box breaks lines, a row Box joins its children,
// a hotkey Button draws `k: label` as the terminal does.
export function flat(node: unknown, inRow = false): string {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(n => flat(n, inRow)).join(inRow ? '' : '\n')
  const n = node as Node
  const p = n.props ?? {}
  const kids = n.children ?? []
  switch (n.type) {
    case 'Button': {
      const body = kids.length ? kids.map(k => flat(k, true)).join('') : String(p.label ?? '')
      return p.hotkey ? `${String(p.hotkey)}: ${body}` : body
    }
    case 'Text': return kids.map(k => flat(k, true)).join('')
    case 'Markdown': return String(p.text ?? '')
    case 'Code': return String(p.source ?? '')
    case 'Input': return String(p.value || p.placeholder || '')
    case 'Select': {
      const opts = (p.options ?? []) as { value: string; label: string }[]
      // An open (autoFocus) Select lists its options under the value, as live.
      const shown = opts.find(o => o.value === p.value)?.label ?? ''
      return p.autoFocus ? [shown, ...opts.map(o => o.label)].join('\n') : shown
    }
    case 'Box': {
      const row = p.flexDirection === 'row'
      return kids.map(k => flat(k, row)).filter(s => s !== '').join(row ? '' : '\n')
    }
    default: return kids.map(k => flat(k, inRow)).join('')
  }
}

// A journey marker: ' && ' joins parts; a part that starts with '!' must not show.
export function holds(text: string, marker: string): string[] {
  const bad: string[] = []
  for (const part of marker.split(' && ')) {
    if (ENGINE_ONLY.includes(part)) continue
    if (part.startsWith('!')) { if (text.includes(part.slice(1))) bad.push(part) }
    else if (!text.includes(part)) bad.push(part)
  }
  return bad
}
