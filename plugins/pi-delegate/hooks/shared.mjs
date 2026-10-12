// Pure helpers that the pane (hooks/register.tsx) and the text fallback
// (scripts/settings-view.mjs) share. No I/O and no imports: each caller reads
// the files and passes the parsed data in.

/** @param {string} value */
export function normalizedPath(value) {
  /** @type {string[]} */
  const parts = []
  for (const part of String(value).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

/**
 * The installed identity (`pi-delegate@<marketplace>`) whose files are this
 * plugin folder, or '' when no installed record names it.
 * A directory marketplace runs its plugins from the source folder, so its
 * manifest entry counts as a match too.
 * @param {string} pluginRoot
 * @param {any} installed the parsed installed_plugins.json
 * @param {any} marketplaces the parsed known_marketplaces.json
 * @param {Record<string, any>} manifests marketplace name -> its parsed marketplace.json
 */
export function installedIdentity(pluginRoot, installed = {}, marketplaces = {}, manifests = {}) {
  const want = normalizedPath(pluginRoot)
  const ids = Object.keys(installed?.plugins || {}).filter(id => id.startsWith('pi-delegate@')).sort()
  for (const id of ids) {
    const records = installed.plugins[id]
    if (Array.isArray(records) && records.some(r => typeof r?.installPath === 'string' && normalizedPath(r.installPath) === want)) return id
    const marketplace = id.slice('pi-delegate@'.length)
    const known = marketplaces?.[marketplace]
    if (known?.source?.source !== 'directory') continue
    const base = known.source.path || known.installLocation
    if (typeof base !== 'string') continue
    for (const entry of manifests?.[marketplace]?.plugins || []) {
      if (entry?.name !== 'pi-delegate' || typeof entry.source !== 'string' || !entry.source.startsWith('./')) continue
      if (normalizedPath(`${base}/${entry.source}`) === want) return id
    }
  }
  return ''
}

/**
 * The data folder Claude Code gives this plugin's MCP server
 * (CLAUDE_PLUGIN_DATA): `<config>/plugins/data/<name>-<marketplace>`, and
 * `pi-delegate-inline` for a `--plugin-dir` load.
 * @param {string} configDir
 * @param {string} identity `pi-delegate@<marketplace>`, or '' for an inline load
 */
export function dataPathFor(configDir, identity) {
  const id = (identity || 'pi-delegate@inline').replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${configDir}/plugins/data/${id}`
}

/**
 * True when the Claude Code command line or CLAUDE_CODE_PLUGIN_DIRS names this
 * folder: such a load is `pi-delegate@inline`, even when an installed
 * directory marketplace serves the same folder.
 * @param {string} pluginRoot
 * @param {string} claudeArgs the command line of the Claude Code process
 * @param {string} pluginDirsEnv CLAUDE_CODE_PLUGIN_DIRS
 * @param {string} cwd the folder the relative paths start from
 */
export function loadedInline(pluginRoot, claudeArgs, pluginDirsEnv, cwd) {
  const want = normalizedPath(pluginRoot)
  const abs = (/** @type {string} */ p) => normalizedPath(p.startsWith('/') ? p : `${cwd}/${p}`)
  const dirs = String(pluginDirsEnv || '').split(':').filter(Boolean)
  const words = String(claudeArgs || '').split(/\s+/)
  words.forEach((w, i) => {
    const after = words[i + 1]
    if (w === '--plugin-dir' && after) dirs.push(after)
    else if (w.startsWith('--plugin-dir=')) dirs.push(w.slice('--plugin-dir='.length))
  })
  return dirs.some(d => abs(d) === want)
}

/**
 * The folder name of a project under `<data>/projects/`, as the MCP server
 * names it (pi-companion sessionSlugForCwd, without the realpath step).
 * @param {string} project
 */
export function projectSlug(project) {
  return `--${String(project).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

export const SETTING_LABELS = /** @type {const} */ ({
  questions_per_turn: 'Questions per turn',
  turn_timeout_minutes: 'Turn time limit',
  question_wait_minutes: 'Question wait',
  max_live_children: 'Max live agents',
  idle_park_minutes: 'Park idle agents after',
  default_thinking: 'Default thinking',
})

/** @param {string} key */
export function settingLabel(key) {
  return /** @type {Record<string, string>} */ (SETTING_LABELS)[key] || 'Unknown setting'
}

/**
 * A setting value in words: `60 min`, `pi's own`, `inherit`.
 * @param {string} key
 * @param {unknown} value
 */
export function settingValue(key, value) {
  if (value === null || value === undefined) return 'inherit'
  if (value === 'pi-default') return "pi's own"
  return typeof value === 'number' && key.endsWith('_minutes') ? `${value} min` : String(value)
}

export const SOURCE_WORDS = /** @type {const} */ ({ project: 'project', user: 'user', default: 'default', 'test-env': 'test env' })

/** @param {unknown} source */
export function sourceWord(source) {
  return /** @type {Record<string, string>} */ (SOURCE_WORDS)[String(source)] || 'unknown source'
}
