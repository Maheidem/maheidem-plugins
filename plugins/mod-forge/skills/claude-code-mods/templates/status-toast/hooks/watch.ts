// The rules of the observer. This file holds no $: it takes handles (the kit rule).
// An observed event gives one row. The row goes to the log, to a toast and to the history of the command.
// announce, remember and the text of a row (say in ./domain) are the framework. rowFrom is yours: it is the data source.
import type { Row, Seen } from '../types'
import { KEEP, say } from './domain'
import type { Host, PatchCell } from './kit/types'

// The handles of this mod: three host calls and the cell of what the mod saw.
export type Handles = Pick<Host, 'toast' | 'log' | 'status'> & { seen: PatchCell<Seen> }

// A line for the transcript and a toast. No pane exists, so the toast always shows.
// A mod with a pane uses kit/toast.ts: it toasts only while the pane is closed.
export function announce(k: Handles, row: Row): void {
  k.log(say(row))
  k.toast(say(row))
}

// Keep the last KEEP rows, oldest first. The command prints them.
export async function remember(k: Handles, row: Row): Promise<void> {
  await k.seen.set(s => ({ rows: [...s.rows, row].slice(-KEEP) }))
}

// Make one row from one event, or undefined when the event is not worth a toast. This is the data source: write it.
// e is the event of the hook (the event of EVENT in ./domain). The stub shows its own text, so a live run makes the gap visible.
export async function rowFrom(k: Handles, _e: unknown): Promise<Row | undefined> {
  k.toast('hooks/watch.ts rowFrom() is not written yet.')
  return undefined
}
