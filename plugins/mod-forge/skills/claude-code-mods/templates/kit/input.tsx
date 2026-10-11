import type { RenderElement } from 'claude-code'
import { KEYS } from './defaults'
import { isBusy } from './ctx'
import { draftValue, onSubmitted, onType, setDraft } from './drafts'
import type { Ctx } from './types'

export type DraftInputOpts = {
  name: string // the field name: the key is `in:<name>#<epoch>`
  draftKey: string // the key of the saved draft
  placeholder?: string
  submitLabel?: string
  autoFocus?: boolean
  blank?: 'ignore' | 'submit' // a blank submit: ignore (default) or pass it on
  fallback?: string // the text to show when no draft exists
  onSubmit: (value: string) => void
}

// One text field with a saved draft (SB:578-589, SB:817-828).
// The action raises World.epoch after each result. The new key mounts the field
// again, so a kept draft shows (SK:208).
// While an action runs, the field takes no input and no submit. The engine empties the
// field after Enter. A key typed while the save runs would replace the draft, and a failed
// save would then show the new keys, not the text it says it kept.
export function draftInput<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, o: DraftInputOpts): RenderElement {
  const { Input } = c.E
  return (
    <Input
      key={`${KEYS.input}${o.name}#${c.w.epoch}`}
      value={draftValue(c, o.draftKey, o.fallback)}
      placeholder={o.placeholder}
      submitLabel={o.submitLabel}
      autoFocus={o.autoFocus ? true : undefined}
      onInput={v => (isBusy(c) ? undefined : onType(c.k, o.draftKey, v))}
      onSubmit={v => {
        if (isBusy(c)) return
        if (!String(v).trim() && o.blank !== 'submit') return // SB:585
        onSubmitted(o.draftKey)
        void setDraft(c.k, o.draftKey, v).then(() => o.onSubmit(v)).catch(() => undefined) // SB:586-587
      }}
    />
  )
}
