// pi agents pane, band, toasts and log lines. Disk-only reads; explicit actions
// go through the session's own pi-delegate MCP tools, which own every decision
// about ownership (the pane never guesses it).
import {
  C, STATE, GLYPHS, safeText, oneLine, firstLine, cut, kChars, when, hhmm, dayLabel, age, duration, cost,
  contextLabel, modelLabel, jsonLines, openQuestions, groupAgents, stateKey, updatedAt, isLive, canStop, rowSummary,
  rowTail, rowAge, peekLine, failureLine, eventSentence, rawEvent, resultBlocks, omittedNote, head, headLines,
  buildSteps, stepRow, editDiff, languageOf,
} from './agents-format.js'

export { safeText, jsonLines, openQuestions } from './agents-format.js'

const PANE = 'pi-agents'
const TITLE = 'pi agents'
const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
const TABS = [['result', 'Result'], ['activity', 'Activity'], ['log', 'Log'], ['questions', 'Questions']]
const ONE_MIB = 1024 * 1024

let root = ''
let pluginRoot = ''
let project = ''
let initialized = false
let initPromise = null
let refreshTimer = null
let hydrated = false
let loading = false
let agents = []
let listError = ''
let paneError = ''
let busy = null
let lastAction = null
let settingsData = null
let settingsError = ''
let settingsLoading = false
let settingsBusy = false
let lastMinute = 0
let placement = 'inline'
let paneOpen = false
let viewportColumns = 0
let baselineDone = false
const seenSeq = {}
const fileCache = {}
const resultCache = {}
const sessions = {}
const windows = {}
const layouts = {}
let ui = null

// UI state lives in $.state so a hot reload keeps the view, selection, tab and drafts.
const UI_STATE = { plugin: 'pi-delegate', key: 'ui' }
const DEFAULT_UI = {
  view: 'list', cameFrom: 'list', selected: '', tab: 'result', expandedKey: '', confirm: null, resultTurn: 0,
  drafts: {}, notice: null, foreign: {}, focusKey: '', showEnded: false, earlier: 0,
  settingsKey: 'questions_per_turn', editing: false, scope: 'project', inputFocused: false, focusAnswer: false,
}
async function getUi($) {
  if (!ui) {
    let stored
    try { stored = (await $.state.get(UI_STATE)).value } catch { stored = undefined }
    ui = { ...DEFAULT_UI, ...(stored && typeof stored === 'object' ? stored : {}) }
  }
  return ui
}
// Never called while drawing: $.state.set is refused inside ui.render.
function setUi($, patch, { redraw = true } = {}) {
  ui = { ...(ui || DEFAULT_UI), ...patch }
  void Promise.resolve().then(() => $.state.set(UI_STATE, ui)).catch(() => undefined)
  if (redraw) invalidate($)
}
function invalidate($) {
  try { $.ui.invalidate('ui.render') } catch { /* redraws on the next event */ }
}
// The engine skips this plugin's own ui.focus hook for focus it moves itself
// (re-entry), so mirror what that hook would record.
function focusSoon($, key) {
  void Promise.resolve().then(() => $.ui.focus({ requestId: PANE, key })).then(result => {
    const inputFocused = /^(answer:|compose$|edit:)/.test(key)
    if (!result?.deny && ui && inputFocused !== ui.inputFocused) setUi($, { inputFocused })
  }).catch(() => undefined)
}
function revealSoon($, key) {
  void Promise.resolve().then(() => $.ui.scroll({ in: PANE, to: { key }, block: 'start' })).catch(() => undefined)
}

async function reportPaneError($, failure) {
  const message = oneLine(failure?.message || String(failure)).slice(0, 220)
  const changed = paneError !== message
  paneError = message
  try { await $.ui.log(safeText(failure?.stack || paneError).slice(0, 8000), { to: 'debug' }) } catch { /* the pane still shows it */ }
  if (changed) invalidate($)
}

// /reload-plugins may rebuild this module without another session.start.
export async function ensureInit($) {
  if (initialized) return
  if (!initPromise) initPromise = initialize($).catch(failure => { initPromise = null; throw failure })
  await initPromise
  initialized = true
}

async function initialize($) {
  const override = await $.env.get('PI_DELEGATE_VIEW_DATA')
  pluginRoot = await $.env.get('CLAUDE_PLUGIN_ROOT') || $.plugin.root
  project = await $.session.root()
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR') || `${await $.env.get('HOME')}/.claude`
  const data = override || await $.env.get('CLAUDE_PLUGIN_DATA') || await installedDataPath($, configDir)
  if (!data) throw new Error("Couldn't find pi-delegate's data folder.")
  const viewProject = await $.env.get('PI_DELEGATE_VIEW_PROJECT') || project
  const slug = `--${viewProject.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  root = `${data}/projects/${slug}/children`
  // Module scope, always running: the band, toasts and log lines need it while the pane is closed.
  if (!refreshTimer) refreshTimer = await $.clock.every(2000, () => tick($))
}

async function tick($) {
  try {
    const changed = await refresh($)
    if ((ui?.view === 'detail' || placement === 'dock') && ui.tab === 'activity' && paneOpen) {
      const agent = agents.find(a => a.name === ui.selected)
      if (agent && await loadSession($, agent)) invalidate($)
    }
    const minute = Math.floor((await $.clock.now()) / 60000)
    if (changed || (minute !== lastMinute && (paneOpen || agents.some(isLive)))) invalidate($)
    lastMinute = minute
  } catch (failure) { await reportPaneError($, failure) }
}

// ---- settings helpers (unchanged contract with scripts/settings-view.mjs) -------------

export const settingLabels = {
  questions_per_turn: 'Questions per turn',
  turn_timeout_minutes: 'Turn time limit',
  question_wait_minutes: 'Question wait',
  max_live_children: 'Max live agents',
  idle_park_minutes: 'Park idle agents after',
  default_thinking: 'Default thinking',
}
const settingDescriptions = {
  questions_per_turn: 'How many questions one turn may ask before further asks expire.',
  turn_timeout_minutes: 'Time budget for one turn, not counting time spent waiting on a question.',
  question_wait_minutes: 'How long a question waits for an answer from you or Claude.',
  max_live_children: 'How many pi agents may run at once in this Claude session.',
  idle_park_minutes: 'Idle agents are parked after this long. A message wakes them.',
  default_thinking: 'Thinking level used when Claude starts a new agent.',
}
export function settingValue(key, value) {
  if (value === null || value === undefined) return 'inherit'
  if (value === 'pi-default') return 'pi default'
  return typeof value === 'number' && key.endsWith('_minutes') ? `${value} min` : String(value)
}
const SOURCE_WORDS = { project: 'project', user: 'user', default: 'default', 'test-env': 'test env' }

function normalizedPath(value) {
  const parts = []
  for (const part of String(value).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

// $.plugin has no provenance/data field. Resolve installed identity from the
// profile registry, including directory marketplaces whose runtime root is source.
export function pluginDataPath(pluginPath, configDir, installed = {}, marketplaces = {}, manifests = {}) {
  const pluginRootPath = normalizedPath(pluginPath)
  const matches = new Set()
  for (const [id, records] of Object.entries(installed.plugins || {})) {
    if (!id.startsWith('pi-delegate@') || !Array.isArray(records)) continue
    if (records.some(record => typeof record.installPath === 'string' && normalizedPath(record.installPath) === pluginRootPath)) matches.add(id)
    const marketplace = id.slice('pi-delegate@'.length)
    const known = marketplaces[marketplace]
    if (known?.source?.source !== 'directory') continue
    const base = known.source.path || known.installLocation
    if (typeof base !== 'string') continue
    for (const entry of manifests[marketplace]?.plugins || []) {
      if (entry.name !== 'pi-delegate' || typeof entry.source !== 'string' || !entry.source.startsWith('./')) continue
      if (normalizedPath(`${base}/${entry.source}`) === pluginRootPath) matches.add(id)
    }
  }
  if (matches.size > 1) throw new Error('Multiple installed pi-delegate identities match this root; set PI_DELEGATE_VIEW_DATA explicitly.')
  if (!matches.size && Object.keys(installed.plugins || {}).some(id => id.startsWith('pi-delegate@'))) {
    throw new Error('Cannot resolve this pi-delegate root from the installed registry; set PI_DELEGATE_VIEW_DATA explicitly.')
  }
  const id = ([...matches][0] || 'pi-delegate@inline').replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${configDir}/plugins/data/${id}`
}

async function installedDataPath($, configDir) {
  const parse = raw => { try { return JSON.parse(raw) } catch { return {} } }
  const installed = parse(await readText($, `${configDir}/plugins/installed_plugins.json`))
  const marketplaces = parse(await readText($, `${configDir}/plugins/known_marketplaces.json`))
  const manifests = {}
  for (const id of Object.keys(installed.plugins || {})) {
    if (!id.startsWith('pi-delegate@')) continue
    const marketplace = id.slice('pi-delegate@'.length)
    const known = marketplaces[marketplace]
    if (known?.source?.source !== 'directory') continue
    const base = known.source.path || known.installLocation
    if (typeof base === 'string') manifests[marketplace] = parse(await readText($, `${base}/.claude-plugin/marketplace.json`))
  }
  return pluginDataPath(pluginRoot, configDir, installed, marketplaces, manifests)
}

export function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

async function loadSettings($) {
  if (settingsLoading) return
  settingsLoading = true
  try {
    if (!pluginRoot || !project) throw new Error('Plugin or session paths unavailable; reopen in a fresh session.')
    const result = await $.process.run(['node', `${pluginRoot}/scripts/settings-view.mjs`, 'snapshot', project], { cwd: project, timeoutMs: 10000 })
    const data = JSON.parse(result.stdout)
    if (result.exitCode !== 0 || !data.ok) throw new Error(data.errorMessage || 'Settings read failed.')
    if (!data.settings || !data.pin || !data.definitions) throw new Error('Settings reader returned an unexpected shape.')
    settingsData = data
    settingsError = ''
  } catch (e) { settingsError = oneLine(e.message || e) }
  finally { settingsLoading = false; invalidate($) }
}

function rangeWords(key) {
  const d = settingsData?.definitions?.[key] || {}
  const range = d.min === undefined ? '' : `whole number from ${d.min} to ${d.max}`
  return [range, ...(d.special || []).filter(s => s !== 'pi-default')].filter(Boolean).join(', or ')
}

async function saveSetting($, scope, key, raw) {
  settingsBusy = true
  const label = settingLabels[key] || key
  setUi($, { notice: { tone: 'warn', text: 'Saving… approve the write in the prompt if one opened.' } })
  try {
    const checked = await $.process.run(['node', `${pluginRoot}/scripts/settings-view.mjs`, 'validate', key, raw], { cwd: project, timeoutMs: 10000 })
    const validation = JSON.parse(checked.stdout)
    if (!validation.ok || checked.exitCode !== 0) {
      setUi($, { notice: { tone: 'err', text: `Must be a ${rangeWords(key) || 'valid value'}. You typed "${oneLine(raw).slice(0, 40)}".`, detail: oneLine(validation.errorMessage || '') } })
      return
    }
    const command = `cd ${shellQuote(project)} && CLAUDE_PROJECT_DIR=${shellQuote(project)} node ${shellQuote(`${pluginRoot}/scripts/pi-companion.mjs`)} write-config --scope ${scope} --${key.replace(/_/g, '-')} ${shellQuote(validation.value)} --json`
    const result = await $.tool.call({ tool: 'Bash', command, description: `Set pi-delegate ${scope} ${key}` })
    const output = result.text || (typeof result.result === 'string' ? result.result : JSON.stringify(result))
    let response
    try { response = JSON.parse(output) } catch { /* not JSON: shown below */ }
    if (result.isError || !response?.ok) {
      setUi($, { notice: declined(output) ? { tone: 'muted', text: 'Not saved. You declined the permission prompt.' } : { tone: 'err', text: `Couldn't save ${label}: ${firstLine(response?.errorMessage || output)}` } })
      return
    }
    const drafts = { ...ui.drafts }
    delete drafts[`setting:${key}`]
    await loadSettings($)
    const now = settingsData?.settings?.[key]
    const where = scope === 'project' ? 'in this project' : 'in your user settings'
    setUi($, {
      editing: false, drafts,
      notice: validation.value === 'inherit'
        ? { tone: 'ok', text: `✓ Reset · ${label} is now ${settingValue(key, now?.value)} (${SOURCE_WORDS[now?.source] || now?.source})`, clear: true }
        : { tone: 'ok', text: `✓ Saved · ${label} is now ${settingValue(key, now?.[scope] ?? validation.value)} ${where}`, clear: true },
    })
    clearNoticeLater($)
    focusSoon($, key === 'default_thinking' ? 'sel:default_thinking' : `set:${key}`)
  } catch (e) {
    setUi($, { notice: { tone: 'err', text: `Couldn't save ${label}: ${firstLine(e.message || e)}` } })
  } finally { settingsBusy = false; invalidate($) }
}

function startSettingSave($, key, raw) {
  if (settingsBusy || !settingsData) return
  void saveSetting($, ui.scope, key, String(raw).trim()).catch(failure => reportPaneError($, failure))
}

// ---- disk reads -------------------------------------------------------------------

async function readText($, file) {
  try { return await $.fs.read(file) } catch { return '' }
}
// Read and parse a file only when its listed size/mtime changed. `sig` null
// (unknown) always reads.
async function readCached($, path, sig, parse) {
  const hit = fileCache[path]
  if (sig && hit && hit.sig === sig) return { value: hit.value, changed: false }
  const raw = await $.fs.read(path)
  const value = parse(raw)
  const changed = !hit || hit.raw !== raw
  fileCache[path] = { sig, value, raw: raw.length < 200000 ? raw : String(raw.length) + ':' + sig }
  return { value, changed }
}
function sigOf(entries, name) {
  const entry = entries.find(e => e.name === name)
  return entry && (entry.size || entry.mtimeMs) ? `${entry.size}:${entry.mtimeMs}` : null
}

// Returns whether anything a drawing reads changed.
async function refresh($) {
  if (loading) return false
  loading = true
  let changed = !hydrated
  try {
    let entries
    try { entries = await $.fs.list(root) }
    catch (e) {
      if (!String(e?.message || e).includes('ENOENT')) throw e
      entries = []
    }
    const next = []
    for (const entry of entries.slice(0, 200)) {
      if (entry.isLink || !NAME_RE.test(entry.name)) continue
      const dir = `${root}/${entry.name}`
      let files = []
      try { files = await $.fs.list(dir) } catch { files = [] }
      if (!Array.isArray(files)) files = []
      let meta
      try {
        const read = await readCached($, `${dir}/meta.json`, sigOf(files, 'meta.json'), raw => JSON.parse(raw))
        meta = read.value
        if (read.changed) changed = true
      } catch {
        const previous = agents.find(a => a.name === entry.name && !a.broken)
        if (previous) { next.push(previous); continue }
        if (files.some(f => f.name === 'meta.json')) next.push({ name: entry.name, dir, broken: true, events: [], questions: [] })
        continue
      }
      if (!meta || meta.name !== entry.name) continue
      let events = []
      try {
        const read = await readCached($, `${dir}/events.jsonl`, sigOf(files, 'events.jsonl'), jsonLines)
        events = read.value
        if (read.changed) changed = true
      } catch { events = fileCache[`${dir}/events.jsonl`]?.value || [] }
      const eventsEntry = files.find(f => f.name === 'events.jsonl')
      const agent = { name: entry.name, dir, meta, events, questions: openQuestions(events, meta), lastActivity: eventsEntry?.mtimeMs || 0 }
      if (meta.state === 'running' && typeof meta.sessionFile === 'string') {
        try {
          const stat = await $.fs.stat(meta.sessionFile)
          agent.lastActivity = Math.max(agent.lastActivity, stat.mtimeMs || 0)
        } catch { /* missing session file: the registry still decides */ }
      }
      next.push(agent)
    }
    const before = agents.map(a => `${a.name}:${a.broken ? '!' : a.meta.state}`).join()
    const after = next.map(a => `${a.name}:${a.broken ? '!' : a.meta.state}`).join()
    if (before !== after) changed = true
    agents = next
    if (listError) changed = true
    listError = ''
    await announce($)
  } catch (e) {
    listError = oneLine(e.message || e)
    changed = true
  } finally { loading = false; hydrated = true }
  return changed
}

// Toasts (pane closed) and one transcript log line per waiting / failed / done event.
async function announce($) {
  const fresh = []
  for (const agent of agents) {
    if (agent.broken) continue
    const top = agent.events.reduce((n, e) => Math.max(n, Number(e.seq) || 0), 0)
    const seen = seenSeq[agent.name]
    seenSeq[agent.name] = Math.max(seen ?? 0, top)
    if (!baselineDone) continue
    for (const e of agent.events) {
      if ((Number(e.seq) || 0) <= (seen ?? 0)) continue
      if (e.type === 'question') fresh.push(`${agent.name} needs input · ${firstLine(e.data?.text).slice(0, 80)}`)
      else if (e.type === 'failed') fresh.push(`${agent.name} failed · ${firstLine(e.data?.errorMessage || e.data?.reason).slice(0, 80)}`)
      else if (e.type === 'done') fresh.push([`${agent.name} finished turn ${e.turn}`, cost(e.data?.usage?.cost)].filter(Boolean).join(' · '))
    }
  }
  baselineDone = true
  if (!fresh.length) return
  let open = paneOpen
  try { open = (await $.ui.panes()).some(p => p.id === PANE) } catch { /* keep the module's view */ }
  for (const line of fresh) {
    try { $.ui.log(line) } catch { /* best effort */ }
    if (!open) try { $.ui.toast(line) } catch { /* best effort */ }
  }
}

async function loadResult($, agent, gen, turn) {
  const path = `${agent.dir}/results/${gen}-${turn}.md`
  if (resultCache[path] !== undefined) return resultCache[path]
  const text = await readText($, path)
  if (text) resultCache[path] = text
  return text
}

// Activity reads the pi session jsonl. Re-parse only what grew: up to 1 MiB a
// full read; past that the new bytes come from `tail -c +offset`.
async function loadSession($, agent) {
  const file = agent.meta?.sessionFile
  if (typeof file !== 'string' || !file.endsWith('.jsonl')) return false
  let stat
  try { stat = await $.fs.stat(file) } catch { return false }
  const s = sessions[file]
  if (s && s.size === stat.size) return false
  try {
    let text
    let state = s?.parsed
    let fromStart = !s || stat.size < s.size
    if (!fromStart && stat.size > ONE_MIB) {
      const res = await $.process.run(['tail', '-c', `+${s.size + 1}`, file], { timeoutMs: 10000 })
      if (res.exitCode !== 0) throw new Error('tail failed')
      text = s.carry + res.stdout
    } else if (stat.size <= 4 * ONE_MIB) {
      text = await $.fs.read(file)
      state = undefined
      fromStart = true
    } else {
      const res = await $.process.run(['tail', '-c', String(3 * ONE_MIB), file], { timeoutMs: 10000 })
      if (res.exitCode !== 0) throw new Error('tail failed')
      text = res.stdout.slice(res.stdout.indexOf('\n') + 1)
      state = undefined
      fromStart = true
    }
    const cutAt = text.lastIndexOf('\n') + 1
    const complete = text.slice(0, cutAt)
    const parsed = buildSteps(jsonLines(complete), fromStart || !state ? { steps: [], byId: {} } : state)
    sessions[file] = { size: stat.size, carry: text.slice(cutAt), parsed, tooLarge: false }
  } catch {
    sessions[file] = { size: stat.size, carry: '', parsed: s?.parsed || { steps: [], byId: {} }, tooLarge: !s }
  }
  return true
}

// ---- actions ---------------------------------------------------------------------

const VERBS = { stop: 'stop', send: 'message', answer: 'answer' }
function declined(text) {
  return /declin|denied by (the )?user|doesn't want to proceed|user rejected|permission (was )?denied/i.test(String(text))
}
function ownedElsewhere(text) {
  return /owned by another Claude session|another Claude session|no longer owned by this server/i.test(String(text))
}
function clearNoticeLater($) {
  const stamp = ui?.notice
  void Promise.resolve().then(() => $.clock.sleep(5000)).then(() => {
    if (ui?.notice && ui.notice === stamp) setUi($, { notice: null })
  }).catch(() => undefined)
}

async function runAction($, agent, action, text, questionId) {
  const name = agent.name
  busy = { name, action }
  lastAction = { name, action, text, questionId }
  setUi($, { notice: { tone: 'warn', text: action === 'stop' ? `Stopping ${name}…` : action === 'answer' ? 'Sending your answer…' : 'Sending your message…', detail: 'If a permission prompt opened, approve it there. The pane stays put.' } })
  try {
    const meta = JSON.parse(await $.fs.read(`${agent.dir}/meta.json`))
    if (meta.instance !== agent.meta.instance) throw new Error(`${name} was restarted since you selected it. Check it and try again.`)
    const toolName = { stop: 'pi_stop', send: 'pi_send_message', answer: 'pi_answer' }[action]
    const tools = await $.tool.list()
    const tool = tools.find(t => t.name === `mcp__plugin_pi-delegate_pi-delegate__${toolName}`) || tools.find(t => t.name === `mcp__pi-delegate__${toolName}`)
    if (!tool) throw new Error("pi-delegate's tools aren't connected in this session. Run /mcp to reconnect.")
    const input = action === 'stop' ? { name } : action === 'send' ? { to: name, message: text } : { to: name, answer: text, question_id: questionId, relay_user: true }
    const result = await $.tool.call({ tool: tool.name, ...input })
    const output = safeText(result.text || (typeof result.result === 'string' ? result.result : JSON.stringify(result)))
    if (result.isError) throw Object.assign(new Error(output), { fromServer: true })
    const drafts = { ...ui.drafts }
    delete drafts[`${name}:${action === 'answer' ? questionId : 'msg'}`]
    const foreign = { ...ui.foreign }
    delete foreign[name]
    setUi($, {
      drafts, foreign, confirm: null,
      notice: { tone: 'ok', clear: true, text: action === 'stop' ? `✓ Stopped ${name} · its session is kept` : action === 'answer' ? `✓ Answer sent · ${name} is working again` : `✓ Message sent · ${name} is on it` },
    })
    clearNoticeLater($)
  } catch (e) {
    const message = String(e?.message || e)
    if (ownedElsewhere(message)) {
      setUi($, { confirm: null, foreign: { ...ui.foreign, [name]: true }, notice: { tone: 'err', text: `✕ Couldn't ${VERBS[action]} ${name}. It belongs to another Claude session.`, detail: 'Open that session to steer it, or ask Claude here to start a new agent for the same task.' } })
    } else if (declined(message)) {
      setUi($, { confirm: null, notice: { tone: 'muted', text: 'Not sent. You declined the permission prompt.', detail: action === 'stop' ? '' : 'Your message is still in the box.' } })
    } else {
      setUi($, { confirm: null, notice: { tone: 'err', text: `✕ Couldn't ${VERBS[action]} ${name}: ${firstLine(message) || 'the call failed'}`, retry: true } })
    }
  } finally {
    busy = null
    await refresh($)
    invalidate($)
  }
}

function startAction($, agent, action, text = '', questionId) {
  if (busy) return
  // Permission prompts and wake waits can outlive the ui.press budget: detach.
  void runAction($, agent, action, text, questionId).catch(failure => reportPaneError($, failure))
}

// ---- small element helpers ----------------------------------------------------------

function el($, c) {
  const { Box, Text, Button, Input, Select, Markdown, Code } = c.E
  const T = (props, ...kids) => Text({ ...props, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') })
  const row = (props, ...kids) => Box({ flexDirection: 'row', ...props, children: kids.flat().filter(Boolean) })
  const col = (props, ...kids) => Box({ flexDirection: 'column', ...props, children: kids.flat().filter(Boolean) })
  const grow = () => Box({ flexGrow: 1 })
  const rule = () => T({ dimColor: true, wrap: 'truncate-end' }, '─'.repeat(Math.max(1, c.cols)))
  const key = (hotkey, label, onPress, extra = {}) => Button({ key: extra.key || `key:${hotkey}`, label, hotkey, plain: true, dimColor: extra.dim === false ? undefined : true, autoFocus: extra.autoFocus, onPress })
  return { Box, Text, Button, Input, Select, Markdown, Code, T, row, col, grow, rule, key }
}

function selectedAgent(list) {
  const named = list.find(a => a.name === ui.selected)
  if (named) return named
  const waiting = list.find(a => !a.broken && a.meta.state === 'waiting')
  if (waiting) return waiting
  return [...list].filter(a => !a.broken).sort((a, b) => updatedAt(b) - updatedAt(a))[0] || list[0]
}

function windowed($, c, id, lines, focusKey, cap) {
  const { Button } = el($, c)
  if (lines.length <= cap || cap < 4) { layouts[id] = null; return lines.map(l => l.node) }
  const room = cap - 2
  let start = Math.min(windows[id] ?? (id === 'list' ? 0 : lines.length - room), lines.length - room)
  const fi = lines.findIndex(l => l.key && l.key === focusKey)
  if (fi >= 0 && fi < start) start = fi
  if (fi >= 0 && fi >= start + room) start = fi - room + 1
  start = Math.max(0, Math.min(start, lines.length - room))
  windows[id] = start
  // An edge row is drawn only where rows are hidden; its room goes to a row.
  let from = start, to = start + room
  if (from === 0) to = Math.min(lines.length, to + 1)
  if (to === lines.length) from = Math.max(0, from - 1)
  layouts[id] = { keys: lines.map(l => l.key), start: from, room: to - from }
  const edge = (dir, n) => Button({ key: `win:${id}:${dir}`, label: `… ${n} ${dir === 'up' ? 'above' : 'below'}`, plain: true, dimColor: true, onPress: () => {} })
  return [from > 0 ? edge('up', from) : null, ...lines.slice(from, to).map(l => l.node), to < lines.length ? edge('down', lines.length - to) : null].filter(Boolean)
}

function noticeNodes($, c) {
  const n = ui.notice
  if (!n) return []
  const { T, row, grow, key } = el($, c)
  const color = n.tone === 'ok' ? C.ok : n.tone === 'err' ? C.err : n.tone === 'warn' ? C.warn : undefined
  const nodes = [T({ color, dimColor: n.tone === 'muted' || undefined, italic: n.tone === 'muted' || undefined, wrap: 'wrap' }, safeText(n.text).slice(0, 2000))]
  if (n.detail) nodes.push(T({ dimColor: true, wrap: 'wrap' }, '  ' + safeText(n.detail).slice(0, 2000)))
  if (n.retry && lastAction && !ui.confirm && ui.view !== 'settings') {
    nodes.push(row({}, T({ dimColor: true }, '  Esc to back'), grow(), key('r', 'retry', () => {
      const agent = agents.find(a => a.name === lastAction.name)
      if (agent) startAction($, agent, lastAction.action, lastAction.text, lastAction.questionId)
    }, { key: 'retry' })))
  }
  return nodes
}

function footer($, c, left, buttons) {
  const { T, row, grow } = el($, c)
  return row({ columnGap: 2 }, T({ dimColor: true, wrap: 'truncate-end' }, left), grow(), ...buttons)
}

function inputHint() {
  return 'Enter sends · Tab to leave the field · Esc leaves the field'
}

// ---- list view ----------------------------------------------------------------------

function titleRow($, c, subtitle, warnPart) {
  const { T, row } = el($, c)
  // paddingRight keeps the engine's close mark (drawn over the first row's last cells) clear.
  return row({ columnGap: 2, paddingRight: 2 }, el($, c).Box({ flexShrink: 0, children: [T({ bold: true }, TITLE)] }), T({ dimColor: true, wrap: 'truncate-end' }, subtitle, warnPart ? T({ color: C.warn }, warnPart) : null))
}

function countSubtitle($, c) {
  const total = agents.length
  const waiting = agents.filter(a => !a.broken && a.meta.state === 'waiting').length
  if (!total) return { text: 'no agents yet', warn: '' }
  const base = c.cols < 60 ? `${total}` : `${total} agent${total === 1 ? '' : 's'}`
  return waiting ? { text: `${base} · `, warn: `${waiting} need${waiting === 1 ? 's' : ''} input` } : { text: base, warn: '' }
}

function staleMinutes(agent) {
  const ms = Number(agent.meta?.launch?.turnTimeoutMs)
  return Math.max(Number.isFinite(ms) && ms > 0 ? ms / 60000 : 60, 10)
}

function agentRow($, c, agent, { selected, nameWidth, autoFocus, compact }) {
  const { T, row, Box, Button } = el($, c)
  const st = STATE[stateKey(agent)]
  const dimRow = agent.meta?.state === 'parked' || agent.meta?.state === 'stopped'
  const stale = stateKey(agent) === 'working' && agent.lastActivity && c.now - agent.lastActivity > staleMinutes(agent) * 60000
  const summary = rowSummary(agent, c.now, staleMinutes(agent))
  const tail = rowTail(agent)
  const cells = [
    Box({ width: 2, flexShrink: 0, children: [T({}, selected ? GLYPHS.pointer : ' ')] }),
    Box({ width: 2, flexShrink: 0, children: [T({ color: st.color, bold: st.bold }, st.glyph)] }),
    Box({ width: nameWidth, flexShrink: 0, overflow: 'hidden', children: [Button({ key: `row:${agent.name}`, label: cut(agent.name, nameWidth - 1), plain: true, dimColor: dimRow || undefined, autoFocus, onPress: () => openDetail($, agent.name) })] }),
  ]
  if (!compact && c.cols >= 44) {
    const summaryNode = agent.meta?.state === 'failed'
      ? T({ wrap: 'truncate-end' }, T({ color: C.err }, 'Failed'), T({ dimColor: true }, ` · ${failureLine(agent)}`))
      : stale ? T({ color: C.warn, wrap: 'truncate-end' }, summary) : T({ dimColor: true, wrap: 'truncate-end' }, summary)
    cells.push(Box({ flexGrow: 1, flexShrink: 1, paddingRight: 1, children: [summaryNode] }))
    if (c.cols >= 60 && tail) cells.push(Box({ flexShrink: 0, paddingRight: 1, children: [T({ dimColor: true }, tail)] }))
  } else cells.push(Box({ flexGrow: 1 }))
  cells.push(Box({ width: 4, flexShrink: 0, justifyContent: 'flex-end', children: [T({ dimColor: true }, rowAge(agent, c.now))] }))
  return row({}, cells)
}

function listLines($, c, { compact = false } = {}) {
  const { T, Button } = el($, c)
  const groups = groupAgents(agents)
  const selected = selectedAgent(agents)
  const longest = agents.reduce((n, a) => Math.max(n, a.name.length), 4)
  const nameWidth = Math.min(longest + 2, compact ? 14 : 16)
  const showHeaders = !(groups.length === 1 && groups[0].rows.length === 1)
  const lines = []
  for (const g of groups) {
    let rows = g.rows
    let hidden = 0
    if (g.name === 'Ended' && !ui.showEnded) {
      const recent = rows.filter(a => a === selected || c.now - updatedAt(a) < 86400000).slice(0, 3)
      hidden = rows.length - recent.length
      rows = recent
    }
    if (showHeaders) lines.push({ node: T({ dimColor: true, bold: true }, g.name) })
    for (const a of rows) {
      const isSel = a === selected
      lines.push({ key: `row:${a.name}`, node: agentRow($, c, a, { selected: isSel, nameWidth, compact, autoFocus: isSel && !ui.confirm && !ui.focusAnswer ? true : undefined }) })
    }
    if (hidden) lines.push({ key: 'more-ended', node: Button({ key: 'more-ended', label: `  … ${hidden} more ended · show`, plain: true, dimColor: true, onPress: () => setUi($, { showEnded: true }) }) })
  }
  return { lines, selected }
}

function answerCard($, c, agent, q, { index = 0, total = 1, withName = true } = {}) {
  const { T, row, col, grow, Input, Markdown } = el($, c)
  const qid = q.data?.question_id || q.data?.toolCallId
  const draftKey = `${agent.name}:${qid}`
  const topic = oneLine(q.data?.topic)
  const title = [total > 1 ? `${index + 1} of ${total}` : '', withName ? `${agent.name} asks` : '', topic].filter(Boolean).join(' · ') || 'question'
  const md = head(safeText(q.data?.text || ''), 9000)
  const sending = busy && busy.name === agent.name && busy.action === 'answer'
  return col({ borderStyle: 'round', borderColor: index === 0 ? C.warn : undefined, borderDimColor: index === 0 ? undefined : true, paddingX: 1 },
    row({}, T({ bold: true, wrap: 'truncate-end' }, title), grow(), T({ dimColor: true }, `waiting ${age(q.ts, c.now)}`)),
    md.text ? Markdown({ text: md.text }) : null,
    md.cut ? T({ dimColor: true, italic: true }, `… ${kChars(md.cut)} more characters not shown.`) : null,
    sending
      ? T({ color: C.warn, wrap: 'wrap' }, 'Sending your answer… if a permission prompt opened, approve it there.')
      : Input({ key: `answer:${agent.name}:${qid}`, label: 'Answer', submitLabel: 'Send', value: ui.drafts[draftKey] || '', autoFocus: ui.focusAnswer && index === 0 ? true : undefined,
        onInput: value => setUi($, { drafts: { ...ui.drafts, [draftKey]: value } }, { redraw: false }),
        onSubmit: value => { if (String(value).trim()) startAction($, agent, 'answer', value, qid) } }),
  )
}

function stopStrip($, c, agent) {
  const { T, row, key } = el($, c)
  return [
    T({ color: C.warn, wrap: 'wrap' }, `Stop ${agent.name}? Its session is kept, and a message wakes it.`),
    row({ columnGap: 4 },
      key('y', `Stop ${cut(agent.name, 20)}`, () => startAction($, agent, 'stop'), { key: 'confirm:yes', dim: false }),
      key('n', 'Cancel', () => { setUi($, { confirm: null }); focusSoon($, ui.view === 'list' ? `row:${agent.name}` : `tab:${ui.tab}`) }, { key: 'confirm:no', dim: false, autoFocus: true })),
    T({ dimColor: true }, 'y to stop · Esc to cancel'),
  ]
}

function askStop($, agent) {
  if (busy || !canStop(agent)) return
  setUi($, { confirm: { kind: 'stop', name: agent.name } })
  focusSoon($, 'confirm:no')
}
function openDetail($, name, tab) {
  setUi($, { view: 'detail', selected: name, tab: tab || ui.tab || 'result', expandedKey: '', resultTurn: 0, confirm: null, earlier: 0, focusKey: '' })
  focusSoon($, `tab:${tab || ui.tab || 'result'}`)
}
function openSettings($) {
  setUi($, { view: 'settings', cameFrom: ui.view === 'settings' ? ui.cameFrom : ui.view, confirm: null, editing: false })
  if (!settingsData) void loadSettings($)
  focusSoon($, 'set:questions_per_turn')
}
function goBack($) {
  if (ui.view === 'settings') {
    const to = ui.cameFrom === 'detail' && agents.some(a => a.name === ui.selected) ? 'detail' : 'list'
    setUi($, { view: to, editing: false, confirm: null })
    focusSoon($, to === 'detail' ? `tab:${ui.tab}` : `row:${ui.selected}`)
  } else {
    setUi($, { view: 'list', confirm: null, expandedKey: '' })
    focusSoon($, `row:${ui.selected}`)
  }
}
function focusComposer($, agent) {
  if (ui.view !== 'detail') openDetail($, agent.name)
  focusSoon($, agent.questions.length ? `answer:${agent.name}:${agent.questions[0].data?.question_id || agent.questions[0].data?.toolCallId}` : 'compose')
}

function listView($, c) {
  const { T, col, rule, key } = el($, c)
  const sub = countSubtitle($, c)
  const nodes = [titleRow($, c, sub.text, sub.warn), rule()]
  if (!agents.length) {
    nodes.push(T({ dimColor: true }, 'No pi agents in this project.'), T({ dimColor: true }, 'Ask Claude to hand off a task, for example'), T({ dimColor: true, italic: true }, '"have pi fix the failing test in parser.ts".'))
    nodes.push(...noticeNodes($, c), rule(), footer($, c, 'Esc to close', [key('s', 'settings', () => openSettings($))]))
    return col({}, nodes)
  }
  const { lines, selected } = listLines($, c)
  const waiting = selected && !selected.broken && selected.meta.state === 'waiting' && selected.questions.length
  const fixed = 4 + (waiting ? 6 : 1) + (ui.confirm ? 3 : 0) + (ui.notice ? 2 : 0)
  nodes.push(...windowed($, c, 'list', lines, `row:${selected?.name}`, Math.max(4, c.rows - fixed)))
  if (ui.confirm?.kind === 'stop' && selected && ui.confirm.name === selected.name) {
    nodes.push(rule(), ...stopStrip($, c, selected), ...noticeNodes($, c))
    return col({}, nodes)
  }
  if (waiting) nodes.push(answerCard($, c, selected, selected.questions[0]))
  else if (selected) nodes.push(T({ dimColor: true, wrap: selected.broken ? 'truncate-start' : 'truncate-end' }, peekLine(selected, c.now) || ' '))
  nodes.push(...noticeNodes($, c), rule())
  const buttons = []
  if (selected && !selected.broken) {
    if (waiting) buttons.push(key('a', 'answer', () => focusComposer($, selected)))
    else if (c.cols >= 44) buttons.push(key('m', selected.meta.state === 'running' ? 'steer' : 'message', () => focusComposer($, selected)))
    if (canStop(selected) && c.cols >= 44) buttons.push(key('x', 'stop', () => askStop($, selected)))
  }
  buttons.push(key('s', 'settings', () => openSettings($)))
  const left = ui.inputFocused ? inputHint() : c.placement === 'dock' ? '↑/↓ to select · Enter to view' : '↑/↓ to select · Enter to view · Esc to close'
  nodes.push(footer($, c, left, buttons))
  return col({}, nodes)
}

// ---- detail view --------------------------------------------------------------------

function factsLine($, c, agent) {
  const m = agent.meta
  const lt = m.lastTurn
  const parts = [modelLabel(m.model)]
  if (settingsData?.pin?.model && m.model && settingsData.pin.model !== m.model) parts[0] += ' (not the pinned model)'
  if (m.gen > 1) parts.push(`run ${m.gen}`)
  if (m.state === 'waiting') {
    parts.push(`turn ${m.turn}`)
    const q = agent.questions[0]?.data
    if (q?.n) parts.push(q.max ? `question ${q.n} of ${q.max} this turn` : `question ${q.n} this turn`)
  } else if (m.state === 'running' || m.state === 'spawning') parts.push(`turn ${m.turn} running`)
  else if (lt) {
    const done = agent.events.filter(e => e.type === 'done' && e.turn === lt.turn && e.gen === lt.gen).at(-1)
    parts.push(lt.ok === false ? `turn ${lt.turn} · ${firstLine(lt.errorMessage || lt.reason || 'failed')}` : `turn ${lt.turn} done ${when(lt.endedAt, c.now)}`)
    if (done?.data?.durationMs) parts.push(duration(done.data.durationMs))
  }
  if (lt?.usage?.cost) parts.push(cost(lt.usage.cost))
  if (lt?.usage?.contextTokens) parts.push(contextLabel(lt.usage.contextTokens))
  if (ui.foreign[agent.name]) parts.push('other session')
  return parts.filter(Boolean).join(' · ')
}

const COMPOSER = {
  running: ['Steer', 'adds to the current turn'],
  spawning: ['Steer', 'adds to the current turn'],
  idle: ['Next turn', null],
  parked: ['Wake and send', 'restarts the process, same session'],
  stopped: ['Wake and send', null],
  failed: ['Restart and send', null],
}

function composer($, c, agent) {
  const { T, row, Input } = el($, c)
  const m = agent.meta
  const spec = COMPOSER[m.state]
  if (!spec) return []
  const [label, hint] = spec
  const placeholder = m.state === 'failed' ? `last run failed: ${failureLine(agent)}` : hint || `message ${agent.name}`
  const draftKey = `${agent.name}:msg`
  const sending = busy && busy.name === agent.name && busy.action === 'send'
  const nodes = [row({ columnGap: 1 }, el($, c).Box({ flexShrink: 0, children: [T({ dimColor: true }, label)] }),
    sending ? T({ color: C.warn }, 'Sending… approve the prompt if one opened.')
      : Input({ key: 'compose', placeholder: cut(placeholder, Math.max(10, c.cols - label.length - 12)), submitLabel: 'Send', value: ui.drafts[draftKey] || '',
        onInput: value => setUi($, { drafts: { ...ui.drafts, [draftKey]: value } }, { redraw: false }),
        onSubmit: value => { if (String(value).trim()) startAction($, agent, 'send', value) } }))]
  if (m.state === 'failed') nodes.push(T({ color: C.warn, wrap: 'truncate-end' }, `last run failed: ${failureLine(agent)}`))
  return nodes
}

function tabRow($, c, agent) {
  const { T, row, grow, Button, key } = el($, c)
  const pending = agent.questions.length
  const tabs = TABS.map(([id, label], i) => {
    const active = ui.tab === id
    // While a confirm strip is up, only y/n carry hotkeys.
    const button = Button({ key: `tab:${id}`, label, hotkey: ui.confirm ? undefined : String(i + 1), plain: true, dimColor: active ? undefined : true, autoFocus: active && !ui.confirm && !ui.focusAnswer ? true : undefined, onPress: () => {
      setUi($, { tab: id, expandedKey: '', focusKey: '', earlier: 0 })
      if (id === 'activity') void loadSession($, agent).then(changed => changed && invalidate($))
    } })
    return id === 'questions' && pending ? row({ columnGap: 1 }, button, T({ color: C.warn }, String(pending))) : button
  })
  const narrow = c.cols < 70
  const right = []
  if (!ui.confirm) {
    if (pending) right.push(key('a', 'answer', () => focusComposer($, agent)))
    else if (COMPOSER[agent.meta.state]) right.push(key('m', agent.meta.state === 'running' ? 'steer' : 'message', () => focusComposer($, agent)))
    if (!narrow && canStop(agent)) right.push(key('x', 'stop', () => askStop($, agent)))
    if (!narrow) right.push(key('s', 'settings', () => openSettings($)))
    if (!c.split) right.push(key('b', 'back', () => goBack($)))
  }
  return row({ columnGap: 2, flexWrap: 'wrap' }, ...tabs, grow(), ...right)
}

function detailHeader($, c, agent) {
  const { T, row, Box } = el($, c)
  const st = STATE[stateKey(agent)]
  const fixed = (...kids) => Box({ flexShrink: 0, children: kids })
  return [
    row({ columnGap: 1, paddingRight: c.split ? 0 : 2 },
      c.split || c.cols < 60 ? null : fixed(T({ dimColor: true }, `${TITLE} ›`)),
      fixed(T({ bold: true }, cut(agent.name, 24))),
      fixed(T({ color: st.color, bold: st.bold }, `${st.glyph} ${st.word}`)),
      Box({ flexGrow: 1, flexShrink: 1, children: [T({ dimColor: true, wrap: 'truncate-end' }, oneLine(agent.meta.description) || ' ')] }),
      fixed(T({ dimColor: true }, rowAge(agent, c.now)))),
    T({ dimColor: true, wrap: 'truncate-end' }, factsLine($, c, agent)),
  ]
}

// Rows the detail header takes, so a windowed body plus header fits the pane
// and the arrows keep moving the selection instead of scrolling.
function headerRows(c, agent) {
  const width = Math.max(10, c.cols - 4)
  let n = 2
  if (agent.questions.length) n += agent.questions.reduce((sum, q) => sum + 4 + Math.ceil(String(q.data?.text || '').length / width), 0) + 1
  else if (COMPOSER[agent.meta.state]) n += agent.meta.state === 'failed' ? 2 : 1
  if (ui.confirm) n += 4
  if (ui.notice) n += 2 + (ui.notice.retry ? 1 : 0)
  n += c.cols >= 90 ? 1 : 2
  return n + 1
}

function detailView($, c, agent) {
  const { T, col, rule } = el($, c)
  if (!agent) return col({}, T({ dimColor: true }, 'That agent is gone. b: back'), footer($, c, 'Esc to back', [el($, c).key('b', 'back', () => goBack($))]))
  if (agent.broken) {
    return col({}, titleRow($, c, `› ${agent.name}`, ''), rule(), T({ color: C.warn }, "! Couldn't read this agent's record."), T({ dimColor: true, wrap: 'truncate-start' }, `${agent.dir}/meta.json`), rule(), footer($, c, 'Esc to back', [el($, c).key('b', 'back', () => goBack($))]))
  }
  const nodes = [...detailHeader($, c, agent)]
  if (agent.questions.length) {
    agent.questions.forEach((q, i) => nodes.push(answerCard($, c, agent, q, { index: i, total: agent.questions.length, withName: false })))
    nodes.push(T({ dimColor: true }, 'Claude also sees this question and may answer it first.'))
  } else if (!ui.confirm) nodes.push(...composer($, c, agent))
  if (ui.confirm?.kind === 'stop' && ui.confirm.name === agent.name) nodes.push(...stopStrip($, c, agent))
  nodes.push(...noticeNodes($, c), tabRow($, c, agent), rule())
  const body = ui.tab === 'activity' ? activityBody($, c, agent) : ui.tab === 'log' ? logBody($, c, agent) : ui.tab === 'questions' ? questionsBody($, c, agent) : resultBody($, c, agent)
  nodes.push(...body)
  return col({}, nodes)
}

function markdownBlocks($, c, text, name, { dim = false, keyPrefix = 'result' } = {}) {
  const { T, Markdown, Code } = el($, c)
  const { blocks, omitted } = resultBlocks(text)
  const nodes = blocks.map((b, i) => b.kind === 'code'
    ? Code({ source: b.text || ' ', language: b.language || undefined, wrap: 'truncate-end' })
    : Markdown({ key: `${keyPrefix}-${i}`, text: b.text, dimColor: dim || undefined }))
  if (omitted) nodes.push(T({ dimColor: true, italic: true, wrap: 'wrap' }, omittedNote(omitted, name)))
  return nodes
}

function resultBody($, c, agent) {
  const { T, row, key, Code } = el($, c)
  const m = agent.meta
  const lt = m.lastTurn
  const last = Number.isInteger(lt?.turn) ? lt.turn : 0
  const nodes = []
  if ((m.state === 'running' || m.state === 'spawning' || m.state === 'waiting') && (!lt || lt.turn < m.turn)) {
    const started = [...agent.events].reverse().find(e => e.turn === m.turn && e.gen === m.gen)
    nodes.push(T({ dimColor: true }, `Working on turn ${m.turn || 1}${started ? ` for ${age(started.ts, c.now)}` : ''}. The result lands here when it ends.`))
    nodes.push(T({ dimColor: true, italic: true }, 'Watch progress in 2: Activity.'))
    if (last && c.prevResult) {
      nodes.push(T({ dimColor: true }, `── turn ${last} · finished ${age(lt.endedAt, c.now)} ago ──`))
      nodes.push(...markdownBlocks($, c, c.prevResult, agent.name, { dim: true }))
    }
    return nodes
  }
  if (lt && lt.ok === false && !ui.resultTurn) {
    const failed = agent.events.filter(e => e.type === 'failed' && e.turn === lt.turn).at(-1)
    const tailLines = String(failed?.data?.stderrTail || failed?.data?.errorMessage || lt.errorMessage || lt.reason || '').split('\n').filter(Boolean).slice(-20).join('\n')
    nodes.push(T({ color: C.err }, `✕ Turn ${lt.turn} failed${failed?.data?.durationMs ? ` after ${duration(failed.data.durationMs)}` : ''}`))
    if (tailLines) nodes.push(Code({ source: head(safeText(tailLines), 4000).text, language: 'text', wrap: 'truncate-end' }))
    nodes.push(T({ dimColor: true }, 'Message it to retry, or ask Claude what went wrong.'))
    return nodes
  }
  if (!last) return [T({ dimColor: true }, 'No finished turn yet. Watch progress in 2: Activity.')]
  const turn = ui.resultTurn && ui.resultTurn <= last ? ui.resultTurn : last
  if (last > 1 && !ui.confirm) {
    nodes.push(row({ columnGap: 2 }, T({ dimColor: true }, `Result of turn ${turn}`),
      turn > 1 ? key('p', 'previous turn', () => setUi($, { resultTurn: turn - 1 })) : null,
      turn < last ? key('n', 'next turn', () => setUi($, { resultTurn: turn + 1 === last ? 0 : turn + 1 })) : null))
  }
  if (!c.result) nodes.push(T({ dimColor: true }, `No result was saved for turn ${turn}.`))
  else nodes.push(...markdownBlocks($, c, c.result, agent.name))
  return nodes
}

function pointerCell($, c, focused) {
  const { Box, T } = el($, c)
  return Box({ width: 2, flexShrink: 0, children: [T({}, focused ? GLYPHS.pointer : ' ')] })
}

function activityBody($, c, agent) {
  const { T, row, col, Box, Button, Code, Markdown } = el($, c)
  const file = agent.meta.sessionFile
  const s = typeof file === 'string' ? sessions[file] : undefined
  if (!s) return [T({ dimColor: true, italic: true }, typeof file === 'string' ? 'Loading activity…' : 'No session recorded for this agent yet.')]
  if (s.tooLarge) return [T({ dimColor: true, wrap: 'wrap' }, `This session is too large to show here. Ask Claude for ${agent.name}'s recent steps.`)]
  const steps = s.parsed.steps
  if (!steps.length) return [T({ dimColor: true }, 'No steps yet.')]
  const shown = Math.min(steps.length, 40 + ui.earlier)
  const visible = steps.slice(steps.length - shown)
  const lines = []
  if (shown < steps.length) lines.push({ key: 'earlier', node: Button({ key: 'earlier', label: `… ${steps.length - shown} earlier steps · show earlier`, plain: true, dimColor: true, onPress: () => setUi($, { earlier: ui.earlier + 40 }) }) })
  const width = Math.max(10, c.cols - 4)
  visible.forEach((step, i) => {
    const idx = steps.length - shown + i
    const k = `step:${idx}`
    const focused = ui.focusKey === k
    const expanded = ui.expandedKey === k
    const toggle = () => { setUi($, { expandedKey: expanded ? '' : k, focusKey: k }); revealSoon($, k) }
    if (step.kind === 'thinking') { lines.push({ node: T({ dimColor: true, italic: true }, `${GLYPHS.thinking} thinking`) }); return }
    if (step.kind === 'user') { lines.push({ node: T({ dimColor: true, wrap: 'truncate-end' }, `${GLYPHS.you} you: ${step.text}`) }); return }
    if (step.kind === 'prose') {
      lines.push({ key: k, node: row({}, pointerCell($, c, focused), Button({ key: k, label: cut(`${GLYPHS.you} ${oneLine(step.text)}`, width), plain: true, dimColor: true, onPress: toggle })) })
      if (expanded) lines.push({ node: col({ paddingLeft: 2 }, Markdown({ key: `${k}-md`, text: step.text }), step.more ? T({ dimColor: true }, `… ${kChars(step.more)} more characters`) : null) })
      return
    }
    const r = stepRow(step)
    const tail = r.add !== undefined
      ? row({ columnGap: 1 }, T({ color: C.add }, `+${r.add}`), T({ color: C.del }, `−${r.del}`))
      : r.tail ? T({ color: r.tailColor, dimColor: r.tailColor ? undefined : true }, r.tail) : null
    lines.push({ key: k, node: row({}, pointerCell($, c, focused),
      Box({ width: 2, flexShrink: 0, children: [T({ color: r.color, dimColor: r.color ? undefined : true }, r.glyph)] }),
      Box({ width: 7, flexShrink: 0, overflow: 'hidden', children: [Button({ key: k, label: r.name, plain: true, onPress: toggle })] }),
      Box({ flexGrow: 1, flexShrink: 1, paddingRight: 1, children: [T({ dimColor: true, wrap: r.argWrap }, r.arg || ' ')] }),
      tail ? Box({ flexShrink: 0, children: [tail] }) : null) })
    if (expanded) {
      const inputSource = step.name === 'bash' ? String(step.args.command || '') : JSON.stringify(step.args, null, 2)
      const input = headLines(safeText(inputSource), 60)
      const out = step.result ? headLines(step.result.text, 12) : null
      const isEdit = ['edit', 'write'].includes(step.name)
      const diff = isEdit ? editDiff(step.args) : ''
      lines.push({ node: col({ borderStyle: 'round', borderDimColor: true, paddingX: 1, marginLeft: 2 },
        T({ dimColor: true }, 'input'),
        isEdit && diff ? Code({ source: head(diff, 4000).text, format: 'diff', wrap: 'truncate-end' })
          : Code({ source: head(input.text, 4000).text || ' ', language: step.name === 'bash' ? 'bash' : 'json', wrap: 'truncate-end' }),
        out ? T({ dimColor: true, wrap: 'truncate-end' }, `─ output · ${out.more ? `first 12 of ${out.total} lines` : `${out.total} line${out.total === 1 ? '' : 's'}`} ─`) : T({ dimColor: true }, 'no output yet'),
        out && out.text ? Code({ source: head(out.text, 4000).text, language: step.name === 'read' ? languageOf(step.args.path) : 'text', wrap: 'truncate-end' }) : null,
        out && out.more ? T({ dimColor: true }, `… ${out.more} more lines`) : null) })
    }
  })
  const nodes = ui.expandedKey ? lines.map(l => l.node) : windowed($, c, 'activity', lines, ui.focusKey, Math.max(6, c.rows - headerRows(c, agent) - (c.cols < 60 ? 4 : 3)))
  const thinking = visible.filter(st => st.kind === 'thinking').reduce((n, st) => n + st.count, 0)
  nodes.push(T({ dimColor: true }, [thinking ? `${thinking} thinking block${thinking === 1 ? '' : 's'} hidden` : '', `showing last ${shown} of ${steps.length} steps`].filter(Boolean).join(' · ')))
  nodes.push(T({ dimColor: true }, ui.inputFocused ? inputHint() : ui.expandedKey ? 'Tab to select · ↑/↓ to scroll' : '↑/↓ to select · Enter to expand · Esc to back'))
  return nodes
}

function logBody($, c, agent) {
  const { T, row, col, Box, Button, Code, Markdown } = el($, c)
  const events = agent.events.slice(-60)
  if (!events.length) return [T({ dimColor: true }, 'Nothing logged yet.')]
  const lines = []
  let day = ''
  const width = Math.max(10, c.cols - 12)
  const idle = {}
  for (const e of agent.events) if (e.type === 'parked') {
    const done = agent.events.filter(x => (x.type === 'done' || x.type === 'failed') && x.seq < e.seq).at(-1)
    if (done) idle[e.seq] = Math.round((Date.parse(e.ts) - Date.parse(done.ts)) / 60000)
  }
  for (const e of events) {
    const label = dayLabel(e.ts, c.now)
    if (label !== day) { day = label; lines.push({ node: T({ dimColor: true }, label) }) }
    const s = eventSentence(e, { idleMinutes: idle[e.seq] })
    const k = `ev:${e.seq}`
    const focused = ui.focusKey === k
    const expanded = ui.expandedKey === k
    const text = s.topic ? `${s.topic}  ${s.text}` : s.text
    lines.push({ key: k, node: row({}, pointerCell($, c, focused), Box({ width: 7, flexShrink: 0, children: [T({ dimColor: true }, hhmm(e.ts))] }),
      Box({ width: 2, flexShrink: 0, children: [T({ color: s.color, dimColor: s.dim || undefined }, s.glyph)] }),
      Button({ key: k, label: cut(text, width), plain: true, dimColor: s.dim || undefined, onPress: () => { setUi($, { expandedKey: expanded ? '' : k, focusKey: k }); revealSoon($, k) } })) })
    if (expanded) {
      const d = new Date(e.ts)
      const stamp = Number.isNaN(d.getTime()) ? '' : `${when(e.ts, c.now + 86400000 * 400)}:${String(d.getSeconds()).padStart(2, '0')}`
      lines.push({ node: col({ borderStyle: 'round', borderDimColor: true, paddingX: 1, marginLeft: 2 },
        T({ dimColor: true }, [stamp, `event ${e.seq}`].filter(Boolean).join(' · ')),
        e.type === 'note' || e.type === 'question' ? Markdown({ key: `${k}-md`, text: head(safeText(e.data?.text || ''), 6000).text || ' ' }) : null,
        Code({ source: head(rawEvent(e), 4000).text, language: 'json', wrap: 'truncate-end' })) })
    }
  }
  const nodes = ui.expandedKey ? lines.map(l => l.node) : windowed($, c, 'log', lines, ui.focusKey, Math.max(6, c.rows - headerRows(c, agent) - 3))
  nodes.push(T({ dimColor: true }, `showing last ${events.length} of ${agent.events.length} events`))
  nodes.push(T({ dimColor: true }, ui.inputFocused ? inputHint() : '↑/↓ to select · Enter to show raw · Esc to back'))
  return nodes
}

function questionsBody($, c, agent) {
  const { T } = el($, c)
  const asked = agent.events.filter(e => e.type === 'question')
  if (!asked.length) {
    return [T({ dimColor: true }, `${agent.name} hasn't asked anything.`), T({ dimColor: true, wrap: 'wrap' }, 'When an agent needs a decision, it shows here and above your prompt, and the agent waits for an answer from you or Claude.')]
  }
  const open = new Set(agent.questions.map(q => q.data?.toolCallId))
  const closing = {}
  for (const e of agent.events) if ((e.type === 'answered' || e.type === 'question_expired') && e.data?.toolCallId) closing[e.data.toolCallId] = e
  const history = asked.filter(q => !open.has(q.data?.toolCallId))
  if (!history.length) return [T({ dimColor: true }, 'Nothing answered yet. Answer it in the card above, or ask Claude to answer it.')]
  const m = agent.meta
  const nodes = []
  for (const [label, items] of [['Earlier this turn', history.filter(q => q.gen === m.gen && q.turn === m.turn)], ['Earlier turns', history.filter(q => !(q.gen === m.gen && q.turn === m.turn))]]) {
    if (!items.length) continue
    nodes.push(T({ dimColor: true, bold: true }, label))
    for (const q of items.slice(-30).reverse()) {
      const end = closing[q.data?.toolCallId]
      const expired = end?.type === 'question_expired'
      nodes.push(T({ wrap: 'truncate-end' }, T({ color: expired ? C.warn : C.ok }, `  ${expired ? GLYPHS.expired : GLYPHS.ok} `), firstLine(q.data?.text)))
      const why = expired ? eventSentence(end).text.replace(/^Question expired · /, '') : ''
      const by = end ? eventSentence(end).text.replace(' answered', '').toLowerCase() : ''
      nodes.push(T({ dimColor: true, wrap: 'truncate-end' }, expired ? `    → expired · ${why}` : end ? `    → answered by ${by === 'you' ? 'you' : 'Claude'} · ${when(end.ts, c.now)}` : '    → closed'))
    }
  }
  return nodes
}

// ---- settings view ------------------------------------------------------------------

function settingsView($, c) {
  const { T, row, col, grow, rule, key, Box, Button, Select, Input } = el($, c)
  const nodes = [row({ columnGap: 1, paddingRight: 2 }, T({ dimColor: true }, `${TITLE} ›`), T({ bold: true }, 'Settings')), rule()]
  if (settingsError) nodes.push(T({ color: C.err, wrap: 'wrap' }, `✕ Couldn't read settings: ${settingsError}`))
  if (!settingsData) {
    nodes.push(T({ dimColor: true, italic: true }, 'Loading settings…'), rule(), footer($, c, 'Esc to back', [key('b', 'back', () => goBack($))]))
    return col({}, nodes)
  }
  const data = settingsData
  const status = [data.testMode ? `Test mode: environment overrides active (${Object.keys(data.overrides || {}).join(', ')})` : '', ...(data.warnings || [])].filter(Boolean).join(' · ')
  if (status) nodes.push(T({ color: C.warn, wrap: 'truncate-end' }, safeText(status)))
  const focusedKey = ui.settingsKey in data.settings ? ui.settingsKey : Object.keys(data.settings)[0]
  let first = true
  for (const [k, setting] of Object.entries(data.settings)) {
    const isFocused = k === focusedKey
    const def = data.definitions[k] || {}
    const label = settingLabels[k] || k
    const valueBold = setting.source !== 'default' || undefined
    const sourceCell = Box({ width: 9, flexShrink: 0, paddingLeft: 1, children: [T({ dimColor: true, color: setting.source === 'default' ? C.off : undefined }, SOURCE_WORDS[setting.source] || setting.source)] })
    if (k === 'default_thinking') {
      nodes.push(row({}, pointerCell($, c, isFocused), T({}, label), grow(),
        Box({ flexShrink: 0, children: [Select({ key: 'sel:default_thinking', options: (def.special || ['pi-default']).map(v => ({ value: v, label: settingValue(k, v) })), value: String(setting[ui.scope] ?? setting.value), autoFocus: first && !ui.confirm ? true : undefined, onSelect: value => startSettingSave($, k, value) })] }),
        sourceCell))
    } else if (ui.editing && isFocused && !ui.confirm) {
      const draftKey = `setting:${k}`
      nodes.push(row({ columnGap: 1 }, pointerCell($, c, true), T({}, label),
        Input({ key: `edit:${k}`, value: ui.drafts[draftKey] ?? String(setting[ui.scope] ?? setting.value), submitLabel: 'Save', autoFocus: true,
          onInput: value => setUi($, { drafts: { ...ui.drafts, [draftKey]: value } }, { redraw: false }),
          onSubmit: value => startSettingSave($, k, value) })))
      nodes.push(T({ dimColor: true, wrap: 'truncate-end' }, `  ${rangeWords(k).replace(/^w/, 'W')} · now ${settingValue(k, setting.value)} from ${SOURCE_WORDS[setting.source] || setting.source} · default ${settingValue(k, def.default)}`))
      nodes.push(T({ dimColor: true }, '  Enter to save · Esc to cancel'))
    } else {
      nodes.push(row({}, pointerCell($, c, isFocused),
        Button({ key: `set:${k}`, label, plain: true, autoFocus: first && !ui.confirm ? true : undefined, onPress: () => {
          if (settingsBusy) return
          setUi($, { settingsKey: k, editing: true, confirm: null })
          focusSoon($, `edit:${k}`)
        } }),
        grow(),
        Box({ width: 12, flexShrink: 0, justifyContent: 'flex-end', children: [T({ bold: valueBold }, settingValue(k, setting.value))] }),
        sourceCell))
    }
    first = false
  }
  const pin = data.pin || {}
  nodes.push(row({}, pointerCell($, c, false), T({ dimColor: true }, 'pi model'), grow(), T({ dimColor: true, wrap: 'truncate-end' }, pin.source === 'none' || !pin.model ? 'not pinned' : `${modelLabel(pin.model)} · from the project pin`)))
  nodes.push(row({}, pointerCell($, c, false), T({}, 'Save to'), grow(), Select({ key: 'scope', options: [{ value: 'project', label: 'This project' }, { value: 'user', label: 'Your user settings' }], value: ui.scope, onSelect: value => setUi($, { scope: value === 'user' ? 'user' : 'project', editing: false }) })))
  nodes.push(rule())
  const s = data.settings[focusedKey]
  if (s) {
    const def = data.definitions[focusedKey] || {}
    const winner = s.source
    nodes.push(T({ wrap: 'wrap' }, settingDescriptions[focusedKey] || ''))
    nodes.push(T({ dimColor: true, wrap: 'truncate-end' },
      T({ bold: winner === 'project' || undefined }, `this project ${s.project === null ? '—' : settingValue(focusedKey, s.project)}`), ' · ',
      T({ bold: winner === 'user' || undefined }, `your settings ${s.user === null ? '—' : settingValue(focusedKey, s.user)}`), ' · ',
      T({ bold: winner === 'default' || undefined }, `default ${settingValue(focusedKey, def.default)}`)))
    nodes.push(T({ dimColor: true }, ui.scope === 'project' ? 'Saves to the pin file in this project.' : 'Saves to your user settings, for every project. Project values still win.'))
  }
  if (ui.confirm?.kind === 'reset') {
    const k = ui.confirm.key
    const cur = data.settings[k] || {}
    const fallback = ui.scope === 'project' ? (cur.user ?? null) : (cur.project ?? null)
    const fallbackText = fallback !== null ? `${settingValue(k, fallback)} (${ui.scope === 'project' ? 'your settings' : 'this project'})` : `${settingValue(k, data.definitions[k]?.default)} (default)`
    nodes.push(T({ color: C.warn, wrap: 'wrap' }, `Reset ${settingLabels[k] || k} ${ui.scope === 'project' ? 'here' : 'in your settings'}? It falls back to ${fallbackText}.`))
    nodes.push(row({ columnGap: 4 },
      key('y', 'Reset', () => { setUi($, { confirm: null }); startSettingSave($, k, 'inherit') }, { key: 'confirm:yes', dim: false }),
      key('n', 'Cancel', () => { setUi($, { confirm: null }); focusSoon($, k === 'default_thinking' ? 'sel:default_thinking' : `set:${k}`) }, { key: 'confirm:no', dim: false, autoFocus: true })))
  }
  nodes.push(...noticeNodes($, c))
  const buttons = []
  if (!ui.confirm && !ui.editing && !settingsBusy) buttons.push(key('r', 'reset', () => { setUi($, { confirm: { kind: 'reset', key: focusedKey } }); focusSoon($, 'confirm:no') }, { key: 'reset' }))
  if (!ui.confirm) buttons.push(key('b', 'back', () => goBack($)))
  nodes.push(footer($, c, ui.inputFocused ? 'Enter to save · Esc to cancel' : '↑/↓ to select · Enter to change · Esc to back', buttons))
  return col({}, nodes)
}

// ---- error, split, band ------------------------------------------------------------

function errorView($, c, message) {
  const { T, col, rule, key } = el($, c)
  return col({},
    row2($, c, T({ bold: true }, TITLE), T({ color: C.warn }, "can't read agents")),
    rule(),
    T({ color: C.err, wrap: 'wrap' }, `✕ ${message}`),
    T({ dimColor: true, wrap: 'wrap' }, /data folder/i.test(message) ? '  Run /pi-delegate:setup, then reopen this pane.' : '  Press r to try again. Details are in the debug log.'),
    footer($, c, 'Esc to close', [key('r', 'retry', () => retryPane($), { key: 'retry' }), key('s', 'settings', () => openSettings($))]))
}
function row2($, c, ...kids) {
  return el($, c).row({ columnGap: 2 }, ...kids)
}
function retryPane($) {
  paneError = ''
  listError = ''
  initialized = false
  hydrated = false
  void ensureInit($).then(() => refresh($)).then(() => invalidate($)).catch(failure => reportPaneError($, failure))
  invalidate($)
}

// W1: wide docked pane, list left and the focused agent's detail right.
function splitView($, c) {
  const { T, row, key, Box } = el($, c)
  const leftWidth = Math.min(36, Math.max(28, Math.floor(c.cols * 0.3)))
  const left = { ...c, cols: leftWidth - 1 }
  const sub = countSubtitle($, left)
  const { lines, selected } = listLines($, left, { compact: true })
  const listNodes = [titleRow($, left, sub.text, sub.warn), el($, left).rule(), ...windowed($, left, 'list', lines, `row:${selected?.name}`, Math.max(4, c.rows - 4))]
  if (!agents.length) listNodes.push(T({ dimColor: true, wrap: 'wrap' }, 'No pi agents in this project.'))
  // The detail's tab row owns `s` while an agent is shown; one owner per hotkey.
  if (!selected || selected.broken) listNodes.push(footer($, left, '', [key('s', 'settings', () => openSettings($))]))
  // Inner width: the gap, the border and its padding, and room for the engine's close mark.
  const right = { ...c, cols: c.cols - leftWidth - 7, split: true }
  const detail = selected ? detailView($, right, selected) : T({ dimColor: true }, 'Select an agent.')
  return row({ columnGap: 1, paddingRight: 2 },
    Box({ width: leftWidth, flexShrink: 0, flexDirection: 'column', children: listNodes }),
    Box({ flexGrow: 1, flexShrink: 1, flexDirection: 'column', borderStyle: 'single', borderDimColor: true, paddingX: 1, children: [detail] }))
}

async function bandView($, e, next) {
  if (e.props.hasSurvey || !hydrated) return next(e)
  let open = paneOpen
  try { open = (await $.ui.panes()).some(p => p.id === PANE) } catch { /* module flag */ }
  if (open) return next(e)
  const now = await $.clock.now()
  const waiting = agents.filter(a => !a.broken && a.meta.state === 'waiting')
  const failed = agents.filter(a => !a.broken && a.meta.state === 'failed' && now - updatedAt(a) < 60000)
  const working = agents.filter(a => !a.broken && (a.meta.state === 'running' || a.meta.state === 'spawning'))
  if (!waiting.length && !failed.length && !working.length) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  const T = (props, ...kids) => Text({ ...props, children: kids.filter(Boolean) })
  let line
  if (waiting.length === 1) line = [T({ color: C.warn, bold: true }, '? '), T({ bold: true }, waiting[0].name), T({ color: C.warn }, ' needs input'), T({ dimColor: true }, ` · ${firstLine(waiting[0].questions[0]?.data?.text)}`)]
  else if (waiting.length > 1) line = [T({ color: C.warn, bold: true }, '? '), T({ color: C.warn }, `${waiting.length} pi agents need input`), T({ dimColor: true }, ` · ${waiting.map(a => a.name).join(', ')}`)]
  else if (failed.length) line = [T({ color: C.err }, `${GLYPHS.err} `), T({ bold: true }, failed[0].name), T({ color: C.err }, ' failed'), T({ dimColor: true }, ` · ${failureLine(failed[0])}`)]
  else line = [T({ dimColor: true }, `✻ ${working.length} pi agent${working.length === 1 ? '' : 's'} working${working.length === 1 ? ` · ${working[0].name}` : ''}`)]
  const target = waiting[0] || failed[0] || working[0]
  return Box({ flexDirection: 'row', paddingRight: 4, children: [
    Box({ flexGrow: 1, flexShrink: 1, children: [Text({ wrap: 'truncate-end', children: line })] }),
    // No hotkey: a band digit answers a bare digit typed into an empty prompt,
    // which swallowed the "1" of prompts like "1. fix the parser" (verified live).
    // The button is reached with ctrl+x tab (or a click) and pressed with Enter.
    Box({ flexShrink: 0, paddingLeft: 2, columnGap: 1, flexDirection: 'row', children: [Text({ dimColor: true, children: ['ctrl+x tab'] }), Button({ key: 'band:open', label: 'Open', plain: true, onPress: () => openFromBand($, target, !!waiting.length) })] }),
  ] })
}

async function openFromBand($, agent, answer) {
  await getUi($)
  setUi($, { view: 'list', selected: agent?.name || ui.selected, confirm: null, focusAnswer: !!answer })
  paneOpen = true
  await $.ui.open(paneArgs())
  // `focus` is refused while the band holds the keys (ctrl+x tab). The band
  // hides once the pane is up and the keys go back to the prompt, so ask again.
  invalidate($)
  void (async () => {
    await $.clock.sleep(150)
    await $.ui.open(paneArgs())
    if (answer && agent?.questions[0]) await $.ui.focus({ requestId: PANE, key: `answer:${agent.name}:${agent.questions[0].data?.question_id || agent.questions[0].data?.toolCallId}` })
  })().catch(() => undefined)
}

// On a very wide terminal, ask the dock for room for the split view (W1);
// the transcript keeps at least ~125 columns. A width the person set wins.
function paneArgs() {
  return { id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows: Math.min(agents.length + 14, 30), ...(viewportColumns >= 240 ? { columns: 112 } : {}) }
}

async function openPane($) {
  paneOpen = true
  paneError = ''
  await getUi($)
  try { await ensureInit($); if (!hydrated) await refresh($) }
  catch (failure) { await reportPaneError($, failure) }
  // The command always lands on the list; selection, tab and drafts are kept.
  if (ui.view !== 'list' || ui.confirm || ui.editing) setUi($, { view: 'list', confirm: null, editing: false, focusAnswer: false })
  await $.ui.open(paneArgs())
  invalidate($)
}

// ---- register -----------------------------------------------------------------------

export function register(on) {
  on('session.start', async ($, e, next) => {
    try { await ensureInit($); await getUi($) } catch (failure) { await reportPaneError($, failure) }
    return next(e)
  })
  on('command.run', { command: 'pi-delegate:agents' }, async ($) => {
    await openPane($)
    return {}
  })
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE) return next(e)
    await getUi($)
    const steps = e.origin?.kind === 'person' && placement === 'inline' && (ui.inputFocused || ui.confirm || ui.editing || ui.view !== 'list')
    if (steps) {
      let refocus = ''
      if (ui.inputFocused) {
        setUi($, { inputFocused: false, focusAnswer: false })
        refocus = ui.view === 'detail' ? `tab:${ui.tab}` : ui.view === 'settings' ? `set:${ui.settingsKey}` : `row:${ui.selected}`
      } else if (ui.confirm) {
        setUi($, { confirm: null })
        refocus = ui.view === 'detail' ? `tab:${ui.tab}` : ui.view === 'settings' ? `set:${ui.settingsKey}` : `row:${ui.selected}`
      } else if (ui.editing) {
        setUi($, { editing: false })
        refocus = `set:${ui.settingsKey}`
      } else goBack($)
      void $.ui.open(paneArgs()).then(() => refocus && $.ui.focus({ requestId: PANE, key: refocus })).catch(() => undefined)
      return { deny: 'back one level' }
    }
    const result = await next(e)
    if (!result?.deny) {
      paneOpen = false
      if (ui.focusAnswer || ui.inputFocused) setUi($, { focusAnswer: false, inputFocused: false })
      invalidate($)
    }
    return result
  })
  on('ui.press', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    try {
      await ensureInit($)
      await getUi($)
      if (ui.notice && !ui.notice.clear && !busy && !settingsBusy && e.element !== 'retry' && ui.notice.tone !== 'warn') setUi($, { notice: null }, { redraw: false })
      if (ui.focusAnswer) setUi($, { focusAnswer: false }, { redraw: false })
      return await next(e)
    } catch (failure) { await reportPaneError($, failure); return { element: e.element } }
  })
  on('ui.input', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    try { await ensureInit($); await getUi($); return await next(e) }
    catch (failure) { await reportPaneError($, failure); return { element: e.element } }
  })
  on('ui.select', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    try { await ensureInit($); await getUi($); return await next(e) }
    catch (failure) { await reportPaneError($, failure); return { element: e.element } }
  })
  on('ui.focus', async ($, e, next) => {
    if (e.requestId !== PANE || !e.element) return next(e)
    await getUi($)
    const element = e.element
    const patch = {}
    const inputFocused = /^(answer:|compose$|edit:)/.test(element)
    if (inputFocused !== ui.inputFocused) patch.inputFocused = inputFocused
    if (element.startsWith('row:')) {
      const name = element.slice(4)
      if (name !== ui.selected) Object.assign(patch, { selected: name, resultTurn: 0, expandedKey: '', focusKey: '' })
    } else if (element.startsWith('set:')) patch.settingsKey = element.slice(4)
    else if (element === 'sel:default_thinking') patch.settingsKey = 'default_thinking'
    else if (/^(step|ev):/.test(element)) { if (element !== ui.focusKey) patch.focusKey = element }
    else if (element.startsWith('win:')) {
      // Arrowing onto a window edge reveals the next row and moves the ring onto it.
      const [, id, dir] = element.split(':')
      const layout = layouts[id]
      if (layout) {
        const step = dir === 'up' ? -1 : 1
        let i = dir === 'up' ? layout.start - 1 : layout.start + layout.room
        while (i >= 0 && i < layout.keys.length && !layout.keys[i]) i += step
        windows[id] = Math.max(0, layout.start + step)
        const target = layout.keys[i]
        if (target) {
          if (target.startsWith('row:')) patch.selected = target.slice(4)
          else patch.focusKey = target
          focusSoon($, target)
        }
        invalidate($)
      }
    }
    if (Object.keys(patch).length) setUi($, patch)
    return next(e)
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    viewportColumns = e.viewport?.columns || viewportColumns
    try { await ensureInit($) } catch { return next(e) }
    return bandView($, e, next)
  })
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    try {
      paneOpen = true
      await ensureInit($)
      await getUi($)
      if (!hydrated) await refresh($)
      placement = e.props.placement
      viewportColumns = e.viewport?.columns || viewportColumns
      const c = { E: $.ui.resolve(e), now: await $.clock.now(), cols: Math.max(20, e.props.bodyColumns || 70), rows: Math.max(8, e.props.scroll?.bodyRows || 24), placement }
      if (paneError) return errorView($, c, paneError)
      if (listError) return errorView($, c, listError)
      if (ui.view === 'settings') {
        // A hot reload drops the module's settings snapshot; fetch it again.
        if (!settingsData && !settingsLoading && !settingsError) void loadSettings($)
        return settingsView($, c)
      }
      const split = placement === 'dock' && c.cols >= 110
      const agent = (ui.view === 'detail' || split) ? selectedAgent(agents) : undefined
      if (agent && !agent.broken) {
        const lt = agent.meta.lastTurn
        const gen = Number.isInteger(lt?.gen) ? lt.gen : agent.meta.gen
        const last = Number.isInteger(lt?.turn) ? lt.turn : 0
        if (ui.tab === 'result' && last) {
          const working = ['running', 'spawning', 'waiting'].includes(agent.meta.state) && lt.turn < agent.meta.turn
          const turn = ui.resultTurn && ui.resultTurn <= last ? ui.resultTurn : last
          if (working) c.prevResult = await loadResult($, agent, gen, last)
          else c.result = await loadResult($, agent, gen, turn)
        }
        if (ui.tab === 'activity' && !sessions[agent.meta.sessionFile]) await loadSession($, agent)
      }
      if (split) return splitView($, c)
      if (ui.view === 'detail') return detailView($, c, agent)
      return listView($, c)
    } catch (failure) {
      await reportPaneError($, failure)
      const c = { E: $.ui.resolve(e), now: Date.now(), cols: e.props.bodyColumns || 70, rows: 24, placement }
      return errorView($, c, paneError)
    }
  })
}
