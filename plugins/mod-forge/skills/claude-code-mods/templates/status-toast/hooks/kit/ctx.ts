import { MIN_COLS, MIN_ROWS } from './defaults'
import type { Ctx, Handles, PaneProps, Ui } from './types'

// The three cells, read in the render: a read in a render subscribes it (T:3380-3382).
export async function ctx<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, E: Ui, props: PaneProps): Promise<Ctx<V, T, S, X>> {
  return {
    E, k, title: props.title, now: await k.now(),
    cols: Math.max(MIN_COLS, props.bodyColumns - 1), // one blank column at the right, as /diff (SB:1513)
    rows: Math.max(MIN_ROWS, props.scroll.bodyRows), // SB:1514
    u: await k.ui.get(), w: await k.world.get(), drafts: await k.drafts.get(),
  }
}
export function isBusy<V extends string, T, S extends string, X extends object = {}>(c: Ctx<V, T, S, X>): boolean {
  return c.w.busy !== null // SB:508-510
}
