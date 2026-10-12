// Shared stubs for the agents pane tests: a fake disk, the ui.* engine calls, the MCP tools and the clock.
// The tests drive the real hooks through the test engine ($.command.run, $.ui.mount, $.ui.close, $.ui.focus).
import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { FsEntry } from 'claude-code'
import { flat } from './kit/flat'
import { fakeHandles } from './kit/fake'
import { UI0, WORLD_BASE } from '../hooks/model'
import type { K } from '../hooks/model'
import { D, readAgents, resetCache } from '../hooks/source'
import type { Io } from '../hooks/source'
import type { UiState, World } from '../types'

type On = Parameters<TestBody>[1]

export const local = (h: number, m: number, day = 1): string => new Date(2026, 9, day, h, m).toISOString()
export const NOW = Date.parse(local(19, 0))
export const PANE_ID = 'pi-agents'

// $.command.run in a test needs origin and presentation.
export const RUN = { command: 'pi-delegate:agents', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 150 } } as const

export function mount(o: { cols?: number; rows?: number; placement?: 'inline' | 'dock'; viewport?: number } = {}) {
  return {
    plugin: 'pi-delegate', surface: 'terminal', component: 'Pane', requestId: PANE_ID,
    viewport: { columns: o.viewport ?? 160, rows: 48 },
    props: { title: 'pi agents', isFocused: true, bodyColumns: o.cols ?? 80, placement: o.placement ?? 'inline', scroll: { offset: 0, bodyRows: o.rows ?? 40 }, view: {} },
  } as const
}

export type Disk = {
  metas: Record<string, any>
  events: Record<string, any[]>
  files: Record<string, string>
  // The answer of $.process.run for the settings reader, and the probe of the data folder.
  run?: (argv: readonly string[]) => { exitCode: number; stdout: string }
  listError?: () => string
  tools?: string[]
  reply?: (e: any) => { text: string; isError?: boolean; deny?: string }
  gate?: (e: any) => Promise<void> | undefined
  readError?: (path: string) => string | undefined
}
export type Host = { lists: number; listPaths: string[]; open: boolean; focused: boolean; closes: number; focusCalls: string[]; calls: any[]; toasts: string[]; logs: string[] }

const entry = (name: string, kind: 'file' | 'dir' = 'dir'): FsEntry => ({ name, kind, size: kind === 'file' ? 10 : 0, mtimeMs: 0, isLink: false })

// Register every stub. Call it before the first $ call of the test.
export function stubs(on: On, disk: Disk, o: { now?: number; env?: Record<string, string> } = {}): { clock: ReturnType<typeof mock.clock>; host: Host } {
  const clock = mock.clock(on, { now: o.now ?? NOW })
  mock.env(on, { HOME: '/home', CLAUDE_CONFIG_DIR: '/cfg', PI_DELEGATE_VIEW_DATA: '/data', ...(o.env ?? {}) })
  const host: Host = { lists: 0, listPaths: [], open: false, focused: true, closes: 0, focusCalls: [], calls: [], toasts: [], logs: [] }
  on('session.root', () => ({ value: '/project' }))
  on('session.start', () => ({ cwd: '/project' }) as any)
  on('classic.SessionStart', () => ({}) as any)
  on('fs.list', ($, e) => {
    host.listPaths.push(e.path)
    const err = disk.listError?.()
    if (err) throw new Error(err)
    if (e.path.endsWith('/children')) host.lists++
    if (e.path.endsWith('/children')) return { value: Object.keys(disk.metas).map(n => entry(n)) }
    const name = e.path.split('/').at(-1) ?? ''
    if (disk.metas[name] !== undefined) return { value: [entry('meta.json', 'file'), ...(disk.events[name] ? [entry('events.jsonl', 'file')] : [])] }
    return { value: [] }
  })
  on('fs.read', ($, e) => {
    const bad = disk.readError?.(e.path)
    if (bad) throw new Error(bad)
    if (disk.files[e.path] !== undefined) return { value: disk.files[e.path] ?? '' }
    const parts = e.path.split('/')
    const name = parts.at(-2) ?? ''
    if (e.path.endsWith('/meta.json') && disk.metas[name] !== undefined) {
      const m = disk.metas[name]
      return { value: typeof m === 'string' ? m : JSON.stringify(m) }
    }
    if (e.path.endsWith('/events.jsonl') && disk.events[name]) return { value: disk.events[name].map(x => JSON.stringify(x)).join('\n') }
    throw new Error(`ENOENT: no such file ${e.path}`)
  })
  on('fs.stat', ($, e) => {
    const text = disk.files[e.path]
    if (text === undefined) throw new Error(`ENOENT: no such file ${e.path}`)
    return { value: { kind: 'file', size: text.length, mtimeMs: 1, isLink: false } as any }
  })
  on('process.run', ($, e) => {
    const r = disk.run?.(e.argv) ?? { exitCode: 0, stdout: '' }
    return { value: { ...r, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.list', () => ({ value: (disk.tools ?? ['pi_stop', 'pi_send_message', 'pi_answer']).map(t => ({ name: `mcp__plugin_pi-delegate_pi-delegate__${t}`, description: '', mcp: true })) }))
  on('tool.call', async ($, e) => {
    host.calls.push(e)
    await disk.gate?.(e)
    const r = disk.reply?.(e) ?? { text: '{"ok":true}' }
    if (r.deny) return { deny: r.deny } as any
    return (r.isError ? { isError: true, result: r.text, text: r.text } : { result: r.text, text: r.text }) as any
  })
  on('ui.open', () => { host.open = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { host.closes++; host.open = false; return { value: undefined } })
  on('ui.panes', () => ({ value: host.open ? [{ id: PANE_ID, title: 'pi agents', isShown: true, isFocused: host.focused, isPlaced: true }] : [] }))
  on('ui.focus', ($, e) => { host.focusCalls.push(String((e as any).key ?? e.element ?? '')); return {} })
  on('ui.toast', ($, e) => { host.toasts.push(String(e.text ?? '')); return { value: undefined } })
  on('ui.log', ($, e) => { host.logs.push(String(e.text ?? '')); return { value: undefined } })
  return { clock, host }
}

// The drawing as text, one screen row per line.
export async function screen(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  return flat(await ui.drawn())
}
// The line that has the pointer.
export async function pointed(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  return (await screen(ui)).split('\n').find(l => l.startsWith('❯ ')) ?? ''
}
// The key of the drawn Input whose key starts with `prefix` (the kit adds `#<epoch>`).
export async function inputKey(ui: { findAll: (q: { type?: string }) => Promise<{ key: string | undefined }[]> }, prefix: string): Promise<string> {
  const all = await ui.findAll({ type: 'Input' })
  return all.map(x => x.key ?? '').find(k => k.startsWith(prefix)) ?? ''
}

// A person's arrow onto an element, and a person's Esc.
export const arrowTo = (element: string) => ({ component: 'Pane', requestId: PANE_ID, element, origin: { kind: 'person' } }) as const
export const esc = { id: PANE_ID, origin: { kind: 'person' } } as const

export const agentMeta = (name: string, state: string, extra: Record<string, unknown> = {}) => ({ name, state, gen: 1, turn: 1, instance: 'i1', updatedAt: local(18, 0), ...extra })

// ---- fake handles: the pane's own functions on in-memory cells (no mount) --------------


// K on in-memory cells. `calls` records the host calls (open, close, focus <key>); `tools` records the MCP calls.
export async function fakeK(clock: ReturnType<typeof mock.clock>, disk: Disk, ui: Partial<UiState> = {}, world: Partial<World> = {}, o: { focused?: boolean } = {}) {
  const f = fakeHandles<any, any, any>(clock, { ...UI0, ...ui }, { ...WORLD_BASE, ...world } as any)
  f.setOpen(true)
  const tools: any[] = []
  const meta = (name: string): string => JSON.stringify(disk.metas[name])
  const io: Io = {
    list: async path => (path.endsWith('/children') ? Object.keys(disk.metas).map(n => entry(n)) : [entry('meta.json', 'file'), entry('events.jsonl', 'file')]),
    read: async path => {
      const name = path.split('/').at(-2) ?? ''
      if (path.endsWith('/meta.json') && disk.metas[name]) return meta(name)
      if (path.endsWith('/events.jsonl')) return (disk.events[name] ?? []).map(x => JSON.stringify(x)).join('\n')
      if (disk.files[path] !== undefined) return disk.files[path] ?? ''
      throw new Error('ENOENT')
    },
    stat: async () => { throw new Error('ENOENT') },
    run: async () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }),
    tools: async () => ['pi_stop', 'pi_send_message', 'pi_answer'].map(t => ({ name: `mcp__plugin_pi-delegate_pi-delegate__${t}`, description: '', mcp: true })),
    call: async input => {
      tools.push(input)
      await disk.gate?.(input)
      const r = disk.reply?.(input) ?? { text: 'ok' }
      if (r.deny) return { deny: r.deny }
      return (r.isError ? { isError: true, result: r.text, text: r.text } : { result: r.text, text: r.text }) as any
    },
    env: async name => (name === 'PI_DELEGATE_VIEW_DATA' ? '/data' : name === 'HOME' ? '/home' : undefined),
    root: async () => '/project',
    pluginRoot: '/plugin',
    debug: () => undefined,
  }
  const k = { ...f.k, pane: PANE_ID, io, panes: async () => [{ id: PANE_ID, title: 'pi agents', isShown: true, isFocused: o.focused ?? true, isPlaced: true }] } as unknown as K
  resetCache()
  D.paths = null
  await readAgents(io)
  return { f, k, tools }
}
