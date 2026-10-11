#!/usr/bin/env bash
# Write an ugly pane mod in ./ugly-notes and three notes in ./.notes.
set -euo pipefail
mkdir -p ugly-notes/.claude-plugin ugly-notes/hooks .notes
cat > ugly-notes/.claude-plugin/plugin.json <<'EOF'
{
  "name": "ugly-notes",
  "version": "0.1.0",
  "description": "Shows my notes in a pane.",
  "author": { "name": "me" }
}
EOF
cat > ugly-notes/hooks/hooks.json <<'EOF'
{ "modules": ["./register.tsx"] }
EOF
cat > ugly-notes/hooks/register.tsx <<'EOF'
// ugly-notes: a pane that lists the notes in .notes/. It works, but it does not look native.
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ugly-notes', description: 'Show my notes' })
    return next(e)
  })

  on('command.run', { command: 'ugly-notes' }, async $ => {
    const opened = await $.ui.open({ id: 'ugly-notes', title: 'NOTES' })
    return { text: opened.isPlaced ? 'opened' : 'waiting' }
  })

  on('ui.render', { component: 'Pane', requestId: 'ugly-notes' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const entries = await $.fs.list('.notes')
    const notes = entries.filter(one => one.name.endsWith('.md'))
    return (
      <Box flexDirection="column">
        <Text color="red" bold>{`NOTES | COUNT | ${notes.length}`}</Text>
        {notes.map(one => (
          <Text key={one.name} color="red">{JSON.stringify(one)}</Text>
        ))}
      </Box>
    )
  })
}
EOF
printf '# Groceries\n\nmilk, eggs\n' > .notes/groceries.md
printf '# Ideas\n\na pane for my notes\n' > .notes/ideas.md
printf '# Todo\n\nfix the parser\n' > .notes/todo.md
