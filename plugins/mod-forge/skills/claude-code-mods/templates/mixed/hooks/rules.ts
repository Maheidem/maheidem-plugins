// The rules of the mod. This file holds no $: it takes plain values (the kit rule).
// A rule is a row in RULES. To adapt: change the rows. Keep judge() and keep the order of the checks.
// The rules are a starter. They stop the usual mistake. They do not stop a hostile command
// (for example `bash -c "rm -rf x"` or a script that runs rm). For that, use a sandbox.
import type { Rule } from '../types'

// A segment starts at the word of the command, so `echo "rm -rf x"` does not match.
export const RULES: readonly Rule[] = [
  {
    id: 'rm-recursive',
    test: /^(?:sudo\s+)?rm\s+(?:-\S+\s+)*-(?:[a-zA-Z]*[rR][a-zA-Z]*|-recursive)\b/,
    why: 'recursive rm is refused here. Name each file, or ask the person.',
  },
  {
    id: 'force-push',
    test: /^git\s+push\b.*\s(?:--force(?!-with-lease)\b|-f\b)/,
    why: 'a forced push is refused here. Use --force-with-lease, or ask the person.',
  },
]

// One command line can hold many commands. Judge each one.
const SEGMENT = /&&|\|\||[;|&\n]/

// The first rule that matches, or undefined when the command is clean.
// A command that is not a string makes split() throw. The hook then fails closed (.catch in register.tsx).
export function judge(command: string): Rule | undefined {
  for (const part of command.split(SEGMENT)) {
    const segment = part.trim()
    const hit = RULES.find(r => r.test.test(segment))
    if (hit) return hit
  }
  return undefined
}
