import { ACTION_MS, FOCUS_SOON_MS, WAIT_HINT } from './defaults'
import { clearTyping, setDraft } from './drafts'
import { focusSoon } from './focus'
import { clean, firstLine } from './format'
import { notify } from './notice'
import type { Action, Handles, Nav, NoticeSpec, UiState, Variant, World } from './types'

export type { Variant } from './types'
export type Style = { readonly pointer: string }
export type Outcome = { ok: true; text: string } | { ok: false; notice: NoticeSpec }
export type ActionOpts<V extends string, T, S extends string, X extends object = {}> = {
  pending?: NoticeSpec
  draftKey?: string
  focus?: (u: UiState<V>, w: World<T, S, X>) => string
  nav?: Nav<V, T, S, X>
  waitMs?: number // the fixture wait before the outcome (ACTION_MS); a real action passes 0
}

// The command argument: "<variant> [scenario]" (TPL:88-92). The caller tells
// "no args" from "bad args" with args.trim() !== ''.
export function parseSwitch<S extends string>(args: string, variants: readonly Variant[], scenarios: readonly S[]): { variant: Variant; scenario: S } | null {
  const words = args.trim().split(/\s+/).filter(x => x !== '')
  if (words.length === 0 || words.length > 2) return null
  const v = (words[0] ?? '').toUpperCase()
  const s = words[1] ?? scenarios[0]
  const variant = variants.find(x => x === v)
  const scenario = scenarios.find(x => x === s)
  if (variant === undefined || scenario === undefined) return null
  return { variant, scenario }
}

// The usage line of a bad argument (TPL:40).
export function usage(name: string, variants: readonly string[], scenarios: readonly string[]): string {
  return `Usage: /${name} <${variants.join('|')}> [${scenarios.join('|')}]`
}

// The command reply. It is the journey marker (mod.json "ready": "Scenario", TD:42).
// A plain reopen says "Scenario kept" (TPL:104).
export function reply(variant: string, scenario: string): string {
  return `Scenario ${variant} ${scenario}`
}

// Reset the fixture world (SB:195-203) and return the run id.
// The run id is unique: two starts at one clock time get two ids (SB:199 used the
// clock time alone, so an old timer could act on the new world).
// The mod starts its scenario timers with the returned run id.
export async function startScenario<V extends string, T, S extends string, X extends object = {}>(
  k: Handles<V, T, S, X>,
  s: S,
  variant: Variant,
  worldFor: (s: S, now: number) => World<T, S, X>,
  ui0: UiState<V>,
): Promise<number> {
  const now = await k.now()
  const prev = await k.world.get()
  const run = Math.max(now, prev.run + 1)
  clearTyping()
  await k.world.set(() => ({ ...worldFor(s, now), scenario: s, variant, run }))
  await k.ui.set(() => ui0)
  await k.drafts.set(() => ({}))
  return run
}

// One fixture timer. It does nothing once another scenario started (SB:216-221).
export function later<V extends string, T, S extends string, X extends object = {}>(k: Handles<V, T, S, X>, run: number, ms: number, step: () => unknown): void {
  void k.sleep(ms).then(async () => {
    if ((await k.world.get()).run === run) await step()
  }).catch(() => undefined)
}

// A patch of the kit's own world fields. TypeScript cannot prove that a literal fits Partial<World<T, S, X>> when X is open.
function wp<T, S extends string, X extends object>(p: Partial<World<T, S>>): Partial<World<T, S, X>> {
  return p as Partial<World<T, S, X>>
}

// One action: the pending notice, 1.5 s for the permission prompt and the tool,
// then the result (SB:286-320). It never rejects (SB:321-323).
// A real action (git, a file write) gives an async outcome and waitMs 0. An outcome that throws or
// rejects ends as an error notice with its first line, so busy never stays set.
export async function runAction<V extends string, T, S extends string, X extends object = {}>(
  k: Handles<V, T, S, X>,
  act: Action,
  outcome: (w: World<T, S, X>, act: Action) => Outcome | Promise<Outcome>,
  apply: (w: World<T, S, X>, act: Action, now: number) => Partial<World<T, S, X>>,
  o?: ActionOpts<V, T, S, X>,
): Promise<void> {
  try {
    const w0 = await k.world.get()
    if (w0.busy) return // the busy guard (SB:288)
    await k.world.set(() => wp<T, S, X>({ busy: act, lastAction: act }))
    await notify(k, o?.pending ?? { tone: 'warn', text: WAIT_HINT })
    const wait = o?.waitMs ?? ACTION_MS
    if (wait > 0) await k.sleep(wait)
    const w = await k.world.get()
    if (w.run !== w0.run) return // another scenario started: apply nothing (SB:294)
    let res: Outcome
    try {
      res = await outcome(w, act)
    } catch (err) {
      res = { ok: false, notice: { tone: 'err', text: firstLine(clean(err instanceof Error ? err.message : err)) || 'The action failed.' } }
    }
    if ((await k.world.get()).run !== w0.run) return // a start during an async outcome: apply nothing
    if (res.ok) {
      const now = await k.now()
      await k.world.set(x => ({ ...apply(x, act, now), busy: null }))
      await k.ui.set(() => ({ confirm: null }))
      if (o?.draftKey) await setDraft(k, o.draftKey, null)
      await notify(k, { tone: 'ok', clear: true, text: res.text })
    } else {
      await k.world.set(() => wp<T, S, X>({ busy: null, failsLeft: Math.max(0, w.failsLeft - 1) }))
      await k.ui.set(() => ({ confirm: null }))
      await notify(k, res.notice)
    }
    // Both results raise the epoch: a new Input key shows the kept draft (SB:316).
    await k.world.set(x => wp<T, S, X>({ epoch: x.epoch + 1 }))
    const u = await k.ui.get()
    const w2 = await k.world.get()
    const key = o?.focus ? o.focus(u, w2) : o?.nav ? o.nav.home(u, w2) : ''
    if (key) focusSoon(k, key, FOCUS_SOON_MS, o?.nav)
  } catch {
    // A failed step ends the action. The caller has nothing to catch (SB:321-323).
  }
}
