#!/usr/bin/env bash
# Write an old pane mod in ./old-mod and three notes in ./.notes.
set -euo pipefail
mkdir -p old-mod/.claude-plugin old-mod/hooks .notes
cat > old-mod/.claude-plugin/plugin.json <<'EOF'
{
  "name": "old-notes",
  "version": "0.3.0",
  "description": "Lists the notes of this project in a pane.",
  "author": { "name": "me" }
}
EOF
cat > old-mod/hooks/hooks.json <<'EOF'
{ "modules": ["./register.tsx"] }
EOF
cat > old-mod/hooks/register.tsx <<'EOF'
// old-notes: the data source is .notes/*.md. The pane is an old design: a pipe table with raw numbers.
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'old-notes', description: 'List the notes of this project' })
    return next(e)
  })

  on('command.run', { command: 'old-notes' }, async $ => {
    const opened = await $.ui.open({ id: 'old-notes', title: 'old-notes' })
    return { text: opened.isPlaced ? 'old-notes opened' : `old-notes waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: 'old-notes' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const entries = await $.fs.list('.notes')
    const notes = entries.filter(one => one.kind === 'file' && one.name.endsWith('.md'))
    return (
      <Box flexDirection="column">
        <Text>{'NAME | SIZE | MTIME'}</Text>
        {notes.map(one => (
          <Text key={one.name}>{`${one.name} | ${one.size} | ${one.mtimeMs}`}</Text>
        ))}
      </Box>
    )
  })
}
EOF
printf '# Groceries\n\nmilk, eggs\n' > .notes/groceries.md
printf '# Ideas\n\na pane for my notes\n' > .notes/ideas.md
printf '# Todo\n\nfix the parser\n' > .notes/todo.md
