// Bug 14: the pane reads the same data folder as the MCP server of this session.
// It never reads CLAUDE_PLUGIN_ROOT or CLAUDE_PLUGIN_DATA from the environment, and it never shows an env var name.
import { expect, test } from 'claude-code/testing'
import { RUN, agentMeta, mount, screen, stubs } from './agents-fixture'
import type { Disk } from './agents-fixture'

const files = (installPath: string): Record<string, string> => ({
  '/profile/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'pi-delegate@maheidem-plugins': [{ scope: 'user', installPath }] } }),
  '/profile/plugins/known_marketplaces.json': JSON.stringify({ 'maheidem-plugins': { source: { source: 'directory', path: '/market' } } }),
  '/market/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'pi-delegate', source: './plugins/pi-delegate' }] }),
})

function disk(installPath: string, probe: string): { d: Disk; lists: string[] } {
  const lists: string[] = []
  const d: Disk = {
    metas: { pitui: agentMeta('pitui', 'running') }, events: {}, files: files(installPath),
    run: argv => (argv[0] === '/bin/sh' ? { exitCode: 0, stdout: probe } : { exitCode: 0, stdout: '' }),
  }
  return { d, lists }
}

const env = { CLAUDE_CONFIG_DIR: '/profile', PI_DELEGATE_VIEW_DATA: '', CLAUDE_PLUGIN_DATA: '/wrong/other-plugin', CLAUDE_PLUGIN_ROOT: '/wrong/root' }

test('the folder of the running MCP server wins: its CLAUDE_PLUGIN_DATA', async ($, on) => {
  const { d } = disk('/elsewhere', 'args=claude\ndata=/profile/plugins/data/pi-delegate-inline\n')
  const { clock, host } = stubs(on, d, { env })
  await $.command.run(RUN)
  await clock.settle()
  expect(host.listPaths[0]).toBe('/profile/plugins/data/pi-delegate-inline/projects/--project--/children')
})

// The folder this test loads the plugin from.
const ROOT = new URL('..', (import.meta as { url?: string }).url ?? 'file:///').pathname.replace(/\/$/, '')

test('a --plugin-dir load with no running server: pi-delegate-inline, even when an install serves the same folder', async ($, on) => {
  const { d } = disk(ROOT, `args=claude --plugin-dir ${ROOT}\n`)
  const { clock, host } = stubs(on, d, { env })
  await $.command.run(RUN)
  await clock.settle()
  expect(host.listPaths[0]).toBe('/profile/plugins/data/pi-delegate-inline/projects/--project--/children')
})

test('an install that names this folder: pi-delegate-<marketplace>', async ($, on) => {
  const { d } = disk(ROOT, 'args=claude\n')
  const { clock, host } = stubs(on, d, { env })
  await $.command.run(RUN)
  await clock.settle()
  expect(host.listPaths[0]).toBe('/profile/plugins/data/pi-delegate-maheidem-plugins/projects/--project--/children')
})

test('a folder no record names is no error: the pane lists the agents, and no env var name shows', async ($, on) => {
  const { d } = disk('/elsewhere', '')
  const { clock } = stubs(on, d, { env })
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  const text = await screen(ui)
  expect(text).not.toMatch(/Cannot resolve|PI_DELEGATE_VIEW_DATA|CLAUDE_PLUGIN/)
  expect(await ui.find({ key: 'row:pitui' })).toBeDefined()
  await ui.unmount()
})
