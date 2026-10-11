import type { Handles } from './types'
import { isOpen } from './pane'

// Write a line to the transcript. Also show a toast while the pane is closed,
// because an open pane already shows the news (SB:182-187).
export async function announce<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, line: string): Promise<void> {
  k.log(line)
  if (!(await isOpen(k))) k.toast(line)
}
