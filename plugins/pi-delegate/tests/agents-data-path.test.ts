import { expect, mock, test } from 'claude-code/testing'

test('directory-source installed identity resolves from profile metadata, not source/cache shape', async ($, on) => {
  mock.clock(on)
  mock.env(on, { CLAUDE_PLUGIN_ROOT: '/market/plugins/pi-delegate', CLAUDE_CONFIG_DIR: '/profile' })
  const reads: string[] = []
  on('session.id', () => ({ value: 'own' }))
  on('session.start', () => ({ cwd: '/project/nested' }))
  on('session.root', () => ({ value: '/project' }))
  on('ui.open', () => ({ value: undefined }))
  on('fs.read', ($, e) => {
    const files = {
      '/profile/plugins/installed_plugins.json': { plugins: { 'pi-delegate@maheidem-plugins': [{ scope: 'user', installPath: '/profile/plugins/cache/maheidem-plugins/pi-delegate/0.12.0' }] } },
      '/profile/plugins/known_marketplaces.json': { 'maheidem-plugins': { source: { source: 'directory', path: '/market' } } },
      '/market/.claude-plugin/marketplace.json': { plugins: [{ name: 'pi-delegate', source: './plugins/pi-delegate' }] },
      '/profile/plugins/data/pi-delegate-maheidem-plugins/projects/--project--/children/pitui/meta.json': { name: 'pitui', state: 'running', gen: 1, turn: 3, ownerClaudeSession: 'foreign' },
    }
    return { value: JSON.stringify(files[e.path] || {}) }
  })
  on('fs.list', ($, e) => { reads.push(e.path); return { value: [{ name: 'pitui', kind: 'directory', isLink: false }] } })
  await $.session.start({ cwd: '/project/nested', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  expect(reads[0]).toBe('/profile/plugins/data/pi-delegate-maheidem-plugins/projects/--project--/children')
  expect(reads.every(path => path.startsWith('/profile/plugins/data/pi-delegate-maheidem-plugins/projects/--project--/children'))).toBe(true)
})
