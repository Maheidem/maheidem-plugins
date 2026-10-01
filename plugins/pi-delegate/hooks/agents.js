// Native viewer: disk-only reads; explicit actions go through the session's MCP tools.
const PANE = 'pi-delegate-agents'
let root = ''
let children = []
let selected = ''
let tab = 'result'
let detail = ''
let error = ''
let opened = false
let loading = false
let sessionId = ''
let busy = false
let actionResult = ''
let confirmStop = ''
let draft = ''
let pluginRoot = ''
let settingsProject = ''
let settingsData = null
let settingsError = ''
let settingsLoading = false
let settingsBusy = false
let settingsScope = 'project'
let settingsDrafts = {}
let settingsResult = ''

export function pluginDataPath(pluginPath, configDir) {
  const cached = String(pluginPath).replace(/\\/g, '/').match(/\/plugins\/cache\/([^/]+)\/pi-delegate(?:\/|$)/)
  const id = `pi-delegate-${cached ? cached[1] : 'inline'}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${configDir}/plugins/data/${id}`
}

export function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

async function loadSettings($) {
  if (settingsLoading) return
  settingsLoading = true
  try {
    if (!pluginRoot || !settingsProject) throw new Error('Plugin/session paths unavailable; reopen in a fresh session.')
    const result = await $.process.run(['node', `${pluginRoot}/scripts/settings-view.mjs`, 'snapshot', settingsProject], { cwd: settingsProject, timeoutMs: 10000 })
    const data = JSON.parse(result.stdout)
    if (result.exitCode !== 0 || !data.ok) throw new Error(data.errorMessage || 'Settings read failed.')
    settingsData = data
    settingsError = ''
  } catch (e) { settingsError = safeText(e.message || e) }
  finally { settingsLoading = false; await $.ui.invalidate('ui.render') }
}

async function saveSetting($, scope, key, raw) {
  settingsBusy = true
  settingsResult = `Validating ${scope} ${key}…`
  await $.ui.invalidate('ui.render')
  try {
    const checked = await $.process.run(['node', `${pluginRoot}/scripts/settings-view.mjs`, 'validate', key, raw], { cwd: settingsProject, timeoutMs: 10000 })
    const validation = JSON.parse(checked.stdout)
    if (!validation.ok || checked.exitCode !== 0) throw new Error(validation.errorMessage || 'Invalid setting.')
    settingsResult = `Saving ${scope} ${key}; approve the Bash permission prompt if shown…`
    await $.ui.invalidate('ui.render')
    const command = `cd ${shellQuote(settingsProject)} && CLAUDE_PROJECT_DIR=${shellQuote(settingsProject)} node ${shellQuote(`${pluginRoot}/scripts/pi-companion.mjs`)} write-config --scope ${scope} --${key.replace(/_/g, '-')} ${shellQuote(validation.value)} --json`
    const result = await $.tool.call({ tool: 'Bash', command, description: `Set pi-delegate ${scope} ${key}` })
    settingsResult = safeText(result.text || (typeof result.result === 'string' ? result.result : JSON.stringify(result)))
    if (!result.isError) delete settingsDrafts[`${scope}:${key}`]
  } catch (e) { settingsResult = safeText(`Settings not saved: ${e.message || e}`) }
  finally { settingsBusy = false; await loadSettings($) }
}

function startSettingSave($, key, raw) {
  if (settingsBusy || !settingsData) return
  void saveSetting($, settingsScope, key, raw.trim())
}

async function renderSettings($, e) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const nodes = [
    Button({ key: 'back-agents', label: 'Back to agents', hotkey: '1', onPress: async () => { tab = 'result'; await refresh($) } }),
    Text({ children: [`SETTINGS — ${settingsProject}`] }),
    Text({ children: ['Edits target this Claude session project, NOT the viewer live-data override. Enter saves; inherit removes only the selected scope value.'] }),
  ]
  if (settingsError) nodes.push(Text({ children: [`Settings unavailable: ${settingsError}`] }))
  if (!settingsData) {
    nodes.push(Text({ children: ['Loading settings…'] }))
    return Box({ flexDirection: 'column', children: nodes })
  }
  const data = settingsData
  nodes.push(Text({ children: [safeText(`Model pin (read-only): ${data.pin.provider || '(not pinned)'}/${data.pin.model || '(not pinned)'} • source: ${data.pin.source}`)] }))
  nodes.push(Text({ children: [safeText(`Project file: ${data.projectPath}\nUser file: ${data.userPath}`)] }))
  if (data.testMode) nodes.push(Text({ children: [`NOTICE: TEST MODE ACTIVE — environment overrides: ${JSON.stringify(data.overrides)} (saved values may not be effective).`] }))
  for (const warning of data.warnings) nodes.push(Text({ children: [safeText(`Warning: ${warning}`)] }))
  nodes.push(Box({ flexDirection: 'row', columnGap: 2, children: ['project', 'user'].map(scope => Button({ key: `scope-${scope}`, label: `Edit ${scope} scope`, dimColor: settingsScope !== scope, onPress: () => { if (!settingsBusy) { settingsScope = scope; void $.ui.invalidate('ui.render') } } })) }))
  if (settingsScope === 'user') nodes.push(Text({ children: ['User scope affects all projects. Project values still take precedence.'] }))
  if (settingsBusy) nodes.push(Text({ children: ['Settings write in progress; editing disabled.'] }))
  for (const [index, [key, setting]] of Object.entries(data.settings).entries()) {
    const definition = data.definitions[key]
    const allowed = [definition.min === undefined ? '' : `integer ${definition.min}–${definition.max}`, ...(definition.special || []), 'inherit'].filter(Boolean).join(' / ')
    nodes.push(Text({ children: [safeText(`${key}: ${setting.value} (${setting.source}) • project: ${setting.project ?? 'inherit'} • user: ${setting.user ?? 'inherit'}`)] }))
    if (!settingsBusy) {
      const draftKey = `${settingsScope}:${key}`
      nodes.push(Input({ key: `setting-${key}`, label: `Set ${settingsScope}`, placeholder: allowed, value: settingsDrafts[draftKey] ?? '', submitLabel: 'save', onInput: value => { settingsDrafts[draftKey] = value }, onSubmit: value => { startSettingSave($, key, value) } }))
      nodes.push(Button({ key: `inherit-${key}`, label: `Reset ${settingsScope} ${key} to inherit`, hotkey: String(index + 2), onPress: () => { startSettingSave($, key, 'inherit') } }))
    }
  }
  if (settingsResult) nodes.push(Text({ children: [`Last settings action:\n${settingsResult}`] }))
  return Box({ flexDirection: 'column', children: nodes })
}

export function actionReason(meta, ownSession) {
  if (!ownSession || !meta.ownerClaudeSession) return 'Read-only: Claude session ownership is not recorded.'
  if (meta.ownerClaudeSession !== ownSession) return 'Read-only: owned by another Claude session.'
  return ''
}

async function runAction($, child, action, text, questionId) {
  busy = true
  actionResult = `${action}: waiting for permission/tool result…`
  await $.ui.invalidate('ui.render')
  try {
    const meta = JSON.parse(await $.fs.read(`${child.dir}/meta.json`))
    const reason = actionReason(meta, sessionId)
    if (reason) throw new Error(reason)
    if (meta.instance !== child.meta.instance || meta.gen !== child.meta.gen || meta.turn !== child.meta.turn) throw new Error('Child changed since selection; refresh and retry.')
    const toolName = { stop: 'pi_stop', send: 'pi_send_message', answer: 'pi_answer' }[action]
    const tools = await $.tool.list()
    const tool = tools.find(t => t.name === `mcp__plugin_pi-delegate_pi-delegate__${toolName}`) || tools.find(t => t.name === `mcp__pi-delegate__${toolName}`)
    if (!tool) throw new Error(`The session's ${toolName} MCP tool is unavailable.`)
    const input = action === 'stop' ? { name: meta.name } : action === 'send' ? { to: meta.name, message: text } : { to: meta.name, answer: text, question_id: questionId, relay_user: true }
    const result = await $.tool.call({ tool: tool.name, ...input })
    actionResult = safeText(result.text || (typeof result.result === 'string' ? result.result : JSON.stringify(result)))
    draft = ''
  } catch (e) { actionResult = safeText(`${action} refused/failed: ${e.message || e}`) }
  finally { busy = false; confirmStop = ''; await refresh($) }
}

function startAction($, child, action, text = '', questionId) {
  if (busy) return
  // Permission prompts and fallback wake waits can outlive the ui.press budget.
  // Return immediately; the detached task owns its error handling and status.
  void runAction($, child, action, text, questionId)
}

export function jsonLines(raw) {
  return String(raw).split('\n').flatMap(line => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

export function openQuestions(events, meta) {
  const closed = new Set(events.filter(e => ['answered', 'question_expired'].includes(e.type)).map(e => e.data?.toolCallId))
  return events.filter(e => e.type === 'question' && e.gen === meta.gen && e.turn === meta.turn && !closed.has(e.data?.toolCallId))
}

export function safeText(value) {
  // Disk text is untrusted: never let ANSI/control sequences reach the terminal.
  return String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

export function ageLabel(timestamp, now) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000))
  if (!Number.isFinite(seconds)) return '?'
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`
}

async function readText($, file) {
  try { return await $.fs.read(file) } catch { return '' }
}

async function loadDetail($) {
  const child = children.find(c => c.meta.name === selected)
  if (!child) { detail = ''; return }
  if (tab === 'events') {
    detail = child.events.slice(-30).map(e => `${e.ts || e.at || e.timestamp || ''} ${e.type} ${JSON.stringify(e.data || {})}`).join('\n')
  } else if (tab === 'questions') {
    detail = child.questions.map(e => `${e.data?.question_id || e.data?.toolCallId}: ${e.data?.text || ''}`).join('\n') || 'No pending questions.'
  } else if (tab === 'transcript') {
    const file = child.meta.sessionFile
    if (typeof file !== 'string' || !file.endsWith('.jsonl')) { detail = 'No recorded session file.'; return }
    const entries = jsonLines(await readText($, file)).filter(e => e.type === 'message')
    detail = entries.slice(-20).map(e => {
      const m = e.message || {}
      const text = typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || (c.type === 'toolCall' ? `[tool ${c.name}] ${JSON.stringify(c.arguments)}` : '')).join('\n')
      return `${m.role || 'message'}: ${text}`
    }).join('\n\n') || 'No transcript messages yet.'
  } else {
    const last = child.meta.lastTurn
    const gen = Number.isInteger(last?.gen) ? last.gen : child.meta.gen
    const turn = Number.isInteger(last?.turn) ? last.turn : child.meta.turn
    detail = await readText($, `${child.dir}/results/${gen}-${turn}.md`) || 'No completed result yet. See Transcript for recent work.'
  }
  detail = safeText(detail).slice(-24000)
}

async function refresh($) {
  if (loading) return
  loading = true
  try {
    const entries = await $.fs.list(root)
    const next = []
    for (const entry of entries.slice(0, 200)) {
      if (entry.isLink || !/^[a-z][a-z0-9_-]{0,31}$/.test(entry.name)) continue
      const dir = `${root}/${entry.name}`
      try {
        const meta = JSON.parse(await $.fs.read(`${dir}/meta.json`))
        if (meta.name !== entry.name) continue
        const events = jsonLines(await readText($, `${dir}/events.jsonl`))
        next.push({ dir, meta, events, questions: openQuestions(events, meta) })
      } catch { /* Atomic replacement, deletion, or malformed child: try next refresh. */ }
    }
    children = next.sort((a, b) => a.meta.name.localeCompare(b.meta.name))
    if (!children.some(c => c.meta.name === selected)) selected = children[0]?.meta.name || ''
    error = ''
    await loadDetail($)
  } catch (e) {
    if (String(e.message || e).includes('ENOENT')) { children = []; selected = ''; detail = ''; error = '' }
    else error = `Cannot read children: ${safeText(e.message || e)}`
  }
  finally { loading = false; await $.ui.invalidate('ui.render') }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const override = await $.env.get('PI_DELEGATE_VIEW_DATA')
    sessionId = await $.session.id()
    pluginRoot = await $.env.get('CLAUDE_PLUGIN_ROOT') || $.plugin.root
    const configDir = await $.env.get('CLAUDE_CONFIG_DIR') || `${await $.env.get('HOME')}/.claude`
    const data = await $.env.get('CLAUDE_PLUGIN_DATA') || pluginDataPath(pluginRoot, configDir)
    settingsProject = e.cwd || await $.session.cwd()
    const cwd = await $.env.get('PI_DELEGATE_VIEW_PROJECT') || settingsProject
    const slug = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
    root = `${override || data}/projects/${slug}/children`
    await $.clock.every(2000, async () => { if (opened) { if (tab === 'settings') await loadSettings($); else await refresh($) } })
    return next(e)
  })
  on('command.run', { command: 'pi-delegate:agents' }, async ($) => {
    opened = true
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Pi agents', focus: true, closeOnEscape: true })
    return {}
  })
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) opened = false
    return next(e)
  })
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    if (tab === 'settings') return renderSettings($, e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const now = await $.clock.now()
    const rows = children.map(child => {
      const m = child.meta
      const last = child.events.at(-1)
      const label = `${m.name} | ${m.state || '?'} | ${m.provider || '?'}/${m.model || '?'} | g${m.gen}/t${m.turn} | age ${ageLabel(m.createdAt, now)} | ${last?.type || '-'} | Q:${child.questions.length}`
      return Button({ key: m.name, label: safeText(label), plain: true, dimColor: selected !== m.name, onPress: async () => { selected = m.name; confirmStop = ''; draft = ''; await loadDetail($); await $.ui.invalidate('ui.render') } })
    })
    const child = children.find(c => c.meta.name === selected)
    const reason = child ? actionReason(child.meta, sessionId) : 'Select a child.'
    const controls = []
    if (reason) controls.push(Text({ children: [reason] }))
    else if (busy) controls.push(Text({ children: ['Action in progress. Other actions disabled.'] }))
    else {
      const m = child.meta
      if (['spawning', 'running', 'waiting', 'idle'].includes(m.state)) {
        controls.push(Button({ key: 'stop', label: confirmStop === selected ? `Confirm STOP ${selected}` : 'Stop (keeps session)', onPress: () => {
          if (confirmStop === selected) startAction($, child, 'stop')
          else { confirmStop = selected; void $.ui.invalidate('ui.render') }
        } }))
        if (confirmStop) controls.push(Button({ key: 'cancel-stop', label: 'Cancel stop', onPress: () => { confirmStop = ''; void $.ui.invalidate('ui.render') } }))
      }
      if (child.questions.length) {
        for (const q of child.questions) {
          const id = q.data?.question_id || q.data?.toolCallId
          controls.push(Text({ children: [safeText(`Question ${id}: ${q.data?.text || ''}`)] }))
          controls.push(Input({ key: `answer-${id}`, label: 'Answer', placeholder: 'Type reply, Enter submits to pi', value: draft, onInput: value => { draft = value }, onSubmit: value => { if (value.trim()) startAction($, child, 'answer', value, id) } }))
        }
      } else if (['running', 'idle', 'parked', 'stopped', 'failed'].includes(m.state)) {
        controls.push(Input({ key: 'send', label: 'Message', placeholder: 'Type message, Enter sends (may resume child)', value: draft, onInput: value => { draft = value }, onSubmit: value => { if (value.trim()) startAction($, child, 'send', value) } }))
      } else controls.push(Text({ children: [`Send unavailable in ${m.state}; pending dialogs must be answered through pi_answer.`] }))
    }
    return Box({ flexDirection: 'column', children: [
      Text({ children: ['Project-wide • disk snapshot • refresh 2s • Tab selects controls, Esc closes'] }),
      ...(error ? [Text({ children: [error] })] : []),
      ...(rows.length ? rows : [Text({ children: ['No children recorded in this project.'] })]),
      ...controls,
      ...(actionResult ? [Text({ children: [actionResult] })] : []),
      Box({ flexDirection: 'row', columnGap: 2, children: ['result', 'transcript', 'events', 'questions', 'settings'].map((name, i) => Button({ key: name, label: name, hotkey: String(i + 1), plain: true, dimColor: tab !== name, onPress: async () => { tab = name; if (name === 'settings') await loadSettings($); else await loadDetail($); await $.ui.invalidate('ui.render') } })) }),
      Text({ children: [selected ? `${selected} — ${tab}\n${detail}` : 'Select a child.'] }),
    ] })
  })
}
