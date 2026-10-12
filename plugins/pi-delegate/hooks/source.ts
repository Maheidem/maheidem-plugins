// The data source of the agents pane: disk reads and the calls to the MCP tools.
// It holds no $: it takes an io handle (bind() in register.tsx gives it).
// The data lives in one module cache (D). A hot reload drops it, and the next
// read fills it again; the cells of the pane hold only small view state.
import type { FsEntry, FsStat, ProcessRunResult, ToolCallResult, ToolInfo } from 'claude-code'
import { buildSteps, firstLine, jsonLines, oneLine, openQuestions, safeText } from './agents-format'
import type { Agent, Ev, Meta, Steps } from './agents-format'
import { dataPathFor, installedIdentity, loadedInline, projectSlug } from './shared.mjs'

export type EnvName = 'PI_DELEGATE_VIEW_DATA' | 'PI_DELEGATE_VIEW_PROJECT' | 'CLAUDE_CONFIG_DIR' | 'CLAUDE_CODE_PLUGIN_DIRS' | 'HOME'
export type Io = {
  list: (path: string) => Promise<FsEntry[]>
  read: (path: string) => Promise<string>
  stat: (path: string) => Promise<FsStat>
  run: (argv: readonly string[], o?: { timeoutMs?: number; cwd?: string }) => Promise<ProcessRunResult>
  tools: () => Promise<ToolInfo[]>
  call: (input: { tool: string; [key: string]: unknown }) => Promise<ToolCallResult>
  env: (name: EnvName) => Promise<string | undefined>
  root: () => Promise<string>
  pluginRoot: string
  debug: (text: string) => void
}

export type SettingDef = { default?: unknown; min?: number; max?: number; special?: string[] }
export type SettingRow = { value: unknown; source: string; project?: unknown; user?: unknown }
export type Snapshot = {
  ok: true
  settings: { [key: string]: SettingRow }
  definitions: { [key: string]: SettingDef }
  pin: { provider?: string; model?: string; source?: string }
  projectPath?: string
  userPath?: string
  warnings?: string[]
  testMode?: boolean
  overrides?: { [key: string]: unknown }
}
type Session = { size: number; carry: string; parsed: Steps; error: string }

const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
const ONE_MIB = 1024 * 1024

// The module cache. Never drawn state: the render reads it, the handlers fill it.
export const D = {
  paths: null as null | { data: string; children: string; project: string; home: string },
  pathsError: '',
  hydrated: false,
  loading: false,
  agents: [] as Agent[],
  listError: '',
  files: {} as { [path: string]: { sig: string | null; value: unknown; raw: string } },
  sessions: {} as { [file: string]: Session },
  results: {} as { [path: string]: string },
  settings: { data: null as Snapshot | null, error: '', loading: false },
  seenSeq: {} as { [name: string]: number },
  baseline: false,
}

// Forget what a /clear or a reload must read again. The paths stay.
export function resetCache(): void {
  D.hydrated = false
  D.agents = []
  D.listError = ''
  D.files = {}
  D.sessions = {}
  D.results = {}
  D.settings = { data: null, error: '', loading: false }
  D.seenSeq = {}
  D.baseline = false
}

async function readText(io: Io, file: string): Promise<string> {
  try { return await io.read(file) } catch { return '' }
}
function parseJson(raw: string): any {
  try { return JSON.parse(raw) } catch { return {} }
}

// The data folder of this plugin's MCP server. In order:
// 1. PI_DELEGATE_VIEW_DATA, a silent override for development.
// 2. CLAUDE_PLUGIN_DATA of the MCP server that this Claude Code process started from this folder.
// 3. The rule Claude Code uses: `--plugin-dir` (or CLAUDE_CODE_PLUGIN_DIRS) gives `pi-delegate-inline`,
//    an install gives `pi-delegate-<marketplace>`, and no record gives `pi-delegate-inline`.
const PROBE = [
  'pp=$PPID',
  'echo "args=$(ps -o args= -p "$pp" 2>/dev/null)"',
  'ps -A -o pid=,ppid=,args= 2>/dev/null | while read -r pid ppid rest; do',
  '  [ "$ppid" = "$pp" ] || continue',
  '  case "$rest" in *"$1/scripts/pi-mcp-server.mjs"*) ps eww -o args= -p "$pid" 2>/dev/null | tr " " "\\n" | sed -n "s/^CLAUDE_PLUGIN_DATA=/data=/p";; esac',
  'done',
].join('\n')

export async function resolveDataDir(io: Io, project: string, home: string): Promise<string> {
  const override = await io.env('PI_DELEGATE_VIEW_DATA')
  if (override) return override
  let args = ''
  try {
    const probe = await io.run(['/bin/sh', '-c', PROBE, 'sh', io.pluginRoot], { timeoutMs: 5000 })
    const lines = String(probe.stdout ?? '').split('\n')
    const data = lines.find(l => l.startsWith('data=/'))
    if (data) return data.slice('data='.length).trim()
    args = lines.find(l => l.startsWith('args='))?.slice('args='.length) ?? ''
  } catch { /* no ps: use the rule below */ }
  const configDir = (await io.env('CLAUDE_CONFIG_DIR')) || `${home}/.claude`
  if (loadedInline(io.pluginRoot, args, (await io.env('CLAUDE_CODE_PLUGIN_DIRS')) ?? '', project)) return dataPathFor(configDir, '')
  const installed = parseJson(await readText(io, `${configDir}/plugins/installed_plugins.json`))
  const marketplaces = parseJson(await readText(io, `${configDir}/plugins/known_marketplaces.json`))
  const manifests: { [name: string]: unknown } = {}
  for (const id of Object.keys(installed?.plugins ?? {})) {
    if (!id.startsWith('pi-delegate@')) continue
    const name = id.slice('pi-delegate@'.length)
    const known = marketplaces?.[name]
    const base = known?.source?.source === 'directory' ? known.source.path || known.installLocation : undefined
    if (typeof base === 'string') manifests[name] = parseJson(await readText(io, `${base}/.claude-plugin/marketplace.json`))
  }
  return dataPathFor(configDir, installedIdentity(io.pluginRoot, installed, marketplaces, manifests))
}

let pathsPromise: Promise<void> | null = null
// Find the folders once. A failure is kept as plain words; the next call tries again.
export async function ensurePaths(io: Io): Promise<boolean> {
  if (D.paths) return true
  if (!pathsPromise) {
    pathsPromise = (async () => {
      const project = (await io.env('PI_DELEGATE_VIEW_PROJECT')) || (await io.root())
      const home = (await io.env('HOME')) ?? ''
      const data = await resolveDataDir(io, project, home)
      D.paths = { data, children: `${data}/projects/${projectSlug(project)}/children`, project: await io.root(), home }
      D.pathsError = ''
    })().catch((failure: unknown) => {
      io.debug(`pi-delegate pane: ${failure instanceof Error ? failure.stack ?? failure.message : String(failure)}`)
      D.pathsError = "The folder of this project's agents could not be found."
    }).finally(() => { pathsPromise = null })
  }
  await pathsPromise
  return D.paths !== null
}

// Read and parse a file only when its listed size or time changed. A null sig always reads.
async function readCached<T>(io: Io, path: string, sig: string | null, parse: (raw: string) => T): Promise<{ value: T; changed: boolean }> {
  const hit = D.files[path]
  if (sig && hit && hit.sig === sig) return { value: hit.value as T, changed: false }
  const raw = await io.read(path)
  const value = parse(raw)
  const changed = !hit || hit.raw !== (raw.length < 200000 ? raw : `${raw.length}:${sig}`)
  D.files[path] = { sig, value, raw: raw.length < 200000 ? raw : `${raw.length}:${sig}` }
  return { value, changed }
}
function sigOf(entries: readonly FsEntry[], name: string): string | null {
  const entry = entries.find(e => e.name === name)
  return entry && (entry.size || entry.mtimeMs) ? `${entry.size}:${entry.mtimeMs}` : null
}

// The signature of one agent for the world cell: it changes when the row must draw again.
export function sigOfAgent(a: Agent): string {
  if (a.broken) return '!'
  const top = a.events.reduce((n, e) => Math.max(n, Number(e.seq) || 0), 0)
  return [a.meta.state, a.meta.gen, a.meta.turn, a.meta.instance, a.meta.updatedAt, top, a.questions.length, a.lastActivity].join('|')
}

// Read every agent folder. Returns the lines to announce (new questions, failures, finished turns).
export async function readAgents(io: Io): Promise<string[]> {
  if (D.loading) return []
  if (!(await ensurePaths(io)) || !D.paths) return []
  D.loading = true
  try {
    let entries: FsEntry[]
    try { entries = await io.list(D.paths.children) } catch (e) {
      if (!/ENOENT|no such file|not found/i.test(String(e instanceof Error ? e.message : e))) throw e
      entries = []
    }
    const next: Agent[] = []
    for (const entry of entries.slice(0, 200)) {
      if (entry.isLink || !NAME_RE.test(entry.name)) continue
      const dir = `${D.paths.children}/${entry.name}`
      let files: FsEntry[] = []
      try { files = await io.list(dir) } catch { files = [] }
      if (!Array.isArray(files)) files = []
      let meta: Meta
      try {
        meta = (await readCached(io, `${dir}/meta.json`, sigOf(files, 'meta.json'), raw => JSON.parse(raw) as Meta)).value
      } catch {
        const previous = D.agents.find(a => a.name === entry.name && !a.broken)
        if (previous) { next.push(previous); continue }
        if (files.some(f => f.name === 'meta.json')) next.push({ name: entry.name, dir, broken: true, meta: {}, events: [], questions: [], lastActivity: 0 })
        continue
      }
      if (!meta || typeof meta !== 'object' || meta.name !== entry.name) continue
      let events: Ev[] = []
      try {
        events = (await readCached(io, `${dir}/events.jsonl`, sigOf(files, 'events.jsonl'), raw => jsonLines(raw) as Ev[])).value
      } catch { events = (D.files[`${dir}/events.jsonl`]?.value as Ev[] | undefined) ?? [] }
      const agent: Agent = { name: entry.name, dir, meta, events, questions: openQuestions(events, meta), lastActivity: files.find(f => f.name === 'events.jsonl')?.mtimeMs ?? 0 }
      if (meta.state === 'running' && typeof meta.sessionFile === 'string') {
        try { agent.lastActivity = Math.max(agent.lastActivity, (await io.stat(meta.sessionFile)).mtimeMs || 0) } catch { /* the registry still decides */ }
      }
      next.push(agent)
    }
    D.agents = next
    D.listError = ''
    return announceLines()
  } catch (failure) {
    io.debug(`pi-delegate pane: ${failure instanceof Error ? failure.stack ?? failure.message : String(failure)}`)
    D.listError = "The agents of this project could not be read. Their folder is not readable."
    return []
  } finally {
    D.loading = false
    D.hydrated = true
  }
}

// One line per new question, failure or finished turn since the last read. The first read sets the baseline.
function announceLines(): string[] {
  const fresh: string[] = []
  for (const agent of D.agents) {
    if (agent.broken) continue
    const top = agent.events.reduce((n, e) => Math.max(n, Number(e.seq) || 0), 0)
    const seen = D.seenSeq[agent.name] ?? 0
    D.seenSeq[agent.name] = Math.max(seen, top)
    if (!D.baseline) continue
    for (const e of agent.events) {
      if ((Number(e.seq) || 0) <= seen) continue
      if (e.type === 'question') fresh.push(`${agent.name} needs input · ${firstLine(e.data?.text).slice(0, 80)}`)
      else if (e.type === 'failed') fresh.push(`${agent.name} failed · ${firstLine(e.data?.errorMessage || e.data?.reason).slice(0, 80)}`)
      else if (e.type === 'done') fresh.push(`${agent.name} finished turn ${e.turn}`)
    }
  }
  D.baseline = true
  return fresh
}

// The saved result of one turn. Cached once read.
export async function loadResult(io: Io, agent: Agent, gen: number, turn: number): Promise<boolean> {
  const path = `${agent.dir}/results/${gen}-${turn}.md`
  if (D.results[path] !== undefined) return false
  D.results[path] = await readText(io, path)
  return true
}
export function resultOf(agent: Agent, gen: number, turn: number): string | undefined {
  return D.results[`${agent.dir}/results/${gen}-${turn}.md`]
}

// Activity reads the pi session file. Parse only what grew: up to 1 MiB a full read;
// past that the new bytes come from `tail -c +offset`. A failed read keeps an error in
// plain words and tries again on the next call. Returns whether anything changed.
export async function loadSession(io: Io, agent: Agent): Promise<boolean> {
  const file = agent.meta?.sessionFile
  if (typeof file !== 'string' || !file.endsWith('.jsonl')) return false
  let stat: FsStat
  try { stat = await io.stat(file) } catch { return false }
  const s = D.sessions[file]
  if (s && !s.error && s.size === stat.size) return false
  try {
    let text: string
    let state = s && !s.error ? s.parsed : undefined
    let fromStart = !s || !!s.error || stat.size < s.size
    if (!fromStart && s && stat.size > ONE_MIB) {
      const res = await io.run(['tail', '-c', `+${s.size + 1}`, file], { timeoutMs: 10000 })
      if (res.exitCode !== 0) throw new Error('tail failed')
      text = s.carry + res.stdout
    } else if (stat.size <= 4 * ONE_MIB) {
      text = await io.read(file)
      state = undefined
      fromStart = true
    } else {
      const res = await io.run(['tail', '-c', String(3 * ONE_MIB), file], { timeoutMs: 10000 })
      if (res.exitCode !== 0) throw new Error('tail failed')
      text = res.stdout.slice(res.stdout.indexOf('\n') + 1)
      state = undefined
      fromStart = true
    }
    const cutAt = text.lastIndexOf('\n') + 1
    const parsed = buildSteps(jsonLines(text.slice(0, cutAt)), fromStart || !state ? { steps: [], byId: {} } : state)
    D.sessions[file] = { size: stat.size, carry: text.slice(cutAt), parsed, error: '' }
  } catch {
    D.sessions[file] = { size: 0, carry: '', parsed: s?.parsed ?? { steps: [], byId: {} }, error: "The agent's session file could not be read. The pane tries again in a moment." }
  }
  return true
}
export function sessionOf(agent: Agent): Session | undefined {
  const file = agent.meta?.sessionFile
  return typeof file === 'string' ? D.sessions[file] : undefined
}

// ---- settings ----------------------------------------------------------------

export async function loadSettings(io: Io): Promise<void> {
  if (D.settings.loading) return
  D.settings.loading = true
  try {
    if (!(await ensurePaths(io)) || !D.paths) throw new Error(D.pathsError)
    const result = await io.run(['node', `${io.pluginRoot}/scripts/settings-view.mjs`, 'snapshot', D.paths.project], { cwd: D.paths.project, timeoutMs: 10000 })
    const data = parseJson(String(result.stdout ?? ''))
    if (result.exitCode !== 0 || !data?.ok) throw new Error('The settings reader failed.')
    if (!data.settings || !data.pin || !data.definitions) throw new Error('The settings reader gave data in a form the pane does not know.')
    D.settings.data = data as Snapshot
    D.settings.error = ''
  } catch (e) {
    D.settings.error = oneLine(e instanceof Error ? e.message : e) || 'The settings could not be read.'
  } finally { D.settings.loading = false }
}

export function shellQuote(value: unknown): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

// `whole number from 0 to 100, or unlimited`
export function rangeWords(key: string): string {
  const d = D.settings.data?.definitions?.[key] ?? {}
  const range = d.min === undefined ? '' : `whole number from ${d.min} to ${d.max}`
  return [range, ...(d.special ?? []).filter(s => s !== 'pi-default')].filter(Boolean).join(', or ')
}
// `0–100 or unlimited`: the edit hint, short enough for a 60-column pane.
export function rangeShort(key: string): string {
  const d = D.settings.data?.definitions?.[key] ?? {}
  return [d.min === undefined ? '' : `${d.min}–${d.max}`, ...(d.special ?? []).filter(s => s !== 'pi-default')].filter(Boolean).join(' or ')
}

export function declined(text: unknown): boolean {
  return /declin|denied by (the )?user|doesn't want to proceed|user rejected|permission (was )?denied/i.test(String(text))
}
export function ownedElsewhere(text: unknown): boolean {
  return /owned by another Claude session|another Claude session|no longer owned by this server/i.test(String(text))
}
export function resultText(r: ToolCallResult): string {
  if (r.deny) return r.deny
  return safeText(r.text ?? (typeof r.result === 'string' ? r.result : ''))
}

// Check a value, then write it with the companion script through Bash (the person approves the write).
// Throws an Error with plain words when the value is wrong or the write fails.
export type SaveResult = { ok: true; value: unknown } | { ok: false; why: 'invalid' | 'declined' | 'failed'; text: string }
export async function saveSetting(io: Io, scope: 'project' | 'user', key: string, raw: string): Promise<SaveResult> {
  if (!D.paths) return { ok: false, why: 'failed', text: D.pathsError || 'The project folder is not known.' }
  const checked = await io.run(['node', `${io.pluginRoot}/scripts/settings-view.mjs`, 'validate', key, raw], { cwd: D.paths.project, timeoutMs: 10000 })
  const validation = parseJson(String(checked.stdout ?? ''))
  if (!validation?.ok || checked.exitCode !== 0) return { ok: false, why: 'invalid', text: `Must be a ${rangeWords(key) || 'valid value'}. You typed "${oneLine(raw).slice(0, 40)}".` }
  const project = D.paths.project
  const command = `cd ${shellQuote(project)} && CLAUDE_PROJECT_DIR=${shellQuote(project)} node ${shellQuote(`${io.pluginRoot}/scripts/pi-companion.mjs`)} write-config --scope ${scope} --${key.replace(/_/g, '-')} ${shellQuote(validation.value)} --json`
  const result = await io.call({ tool: 'Bash', command, description: `Set pi-delegate ${scope} ${key}` })
  const output = resultText(result)
  const response = parseJson(output)
  if (result.deny || declined(output)) return { ok: false, why: 'declined', text: output }
  if (result.isError || !response?.ok) return { ok: false, why: 'failed', text: firstLine(response?.errorMessage || output) || 'the write failed' }
  return { ok: true, value: validation.value }
}

// ---- agent actions -----------------------------------------------------------

export type AgentAction = 'stop' | 'send' | 'answer'
// Call the session's own MCP tool. Throws an Error with the server's words when it fails.
export async function callAgentTool(io: Io, agent: Agent, action: AgentAction, text: string, qid: string): Promise<void> {
  const meta = parseJson(await io.read(`${agent.dir}/meta.json`)) as Meta
  if (meta.instance !== agent.meta.instance) throw new Error(`${agent.name} was restarted since you selected it. Check it and try again.`)
  const toolName = { stop: 'pi_stop', send: 'pi_send_message', answer: 'pi_answer' }[action]
  const tools = await io.tools()
  const tool = tools.find(t => t.name === `mcp__plugin_pi-delegate_pi-delegate__${toolName}`) ?? tools.find(t => t.name === `mcp__pi-delegate__${toolName}`)
  if (!tool) throw new Error("pi-delegate's tools are not connected in this session. Run /mcp to connect them again.")
  // hold:false: the pane's tool result never reaches the model, so the call
  // returns at once and leaves the child's next event queued for Claude.
  const input = action === 'stop' ? { name: agent.name, hold: false } : action === 'send' ? { to: agent.name, message: text, hold: false } : { to: agent.name, answer: text, question_id: qid, relay_user: true, hold: false }
  const result = await io.call({ tool: tool.name, ...input })
  if (result.deny) throw new Error(`declined: ${result.deny}`)
  if (result.isError) throw new Error(resultText(result) || 'the call failed')
}
