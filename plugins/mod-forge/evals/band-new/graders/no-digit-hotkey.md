---
type: regex
target: {source: file, path: .mods/turn-meter/src/turn-meter-proto/hooks/register.tsx}
match: not_contains
weight: 1
---

hotkey=\{?\s*["'][0-9]["']
