import { TYPING_MS } from './defaults'
import type { Ctx, Handles } from './types'

// Two buffers. A reload drops them, and the next draw reads the drafts cell.
// typing: text the user typed, not yet written to the drafts cell (SB:46).
// submitted: fields that the user sent with Enter since the last change (SB:150).
const typing: { [key: string]: string } = {}
const submitted: { [key: string]: true } = {}

// The engine empties a field after Enter and reports it as a change (SB:149-153).
// The draft stays, so a declined or failed send leaves the text in the box.
export function onSubmitted(key: string): void {
  submitted[key] = true
}

// Keep the text in the buffer now. Write the draft when the typing pauses (SB:154-162).
export function onType<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, key: string, value: string): void {
  if (value === '' && submitted[key]) {
    delete submitted[key]
    return
  }
  delete submitted[key]
  typing[key] = value
  void k.sleep(TYPING_MS).then(() => (typing[key] === value ? setDraft(k, key, value) : undefined)).catch(() => undefined)
}

// Store a draft, or remove it when the value is null (SB:138-146).
export async function setDraft<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, key: string, value: string | null): Promise<void> {
  if (value === null) delete typing[key]
  await k.drafts.set(d => {
    const x = { ...d }
    if (value === null) delete x[key]
    else x[key] = value
    return x
  })
}

// The text to show in a field: the buffer first, then the saved draft (SB:581, SB:821, SB:1196).
export function draftValue<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>, key: string, fallback?: string): string {
  return typing[key] ?? c.drafts[key] ?? fallback ?? ''
}

// Drop both buffers. A scenario reset calls this (SB:197).
export function clearTyping(): void {
  for (const key of Object.keys(typing)) delete typing[key]
  for (const key of Object.keys(submitted)) delete submitted[key]
}
