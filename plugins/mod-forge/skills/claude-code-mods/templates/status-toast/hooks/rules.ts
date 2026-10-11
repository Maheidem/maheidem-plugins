// The rules of the guard part. This file holds no $: it takes plain values and a call function (the kit rule).
// A rule is a row in RULES. To adapt: change the rows. Keep judge() and keep the order of the checks.
// The rules are a starter. They stop the usual mistake. They do not stop a hostile command
// (for example `bash -c "rm -rf x"` or a script that runs rm). For that, use a sandbox.
import { PROBE, TEXT } from './domain'
import { GLYPHS } from './kit/defaults'
import { clean, cut, oneLine } from './kit/format'

export type Rule = { id: string; test: RegExp; why: string }

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
// root is the session folder ($.session.root()). A rule that allows what lies inside it writes
// `if (paths.every(p => inside(p, root))) continue`, where paths are the path words of the segment. The starter rules do not use it.
// A command that is not a string makes split() throw. The hook then fails closed (.catch in register.tsx).
export function judge(command: string, _root: string): Rule | undefined {
  for (const part of command.split(SEGMENT)) {
    const segment = part.trim()
    const hit = RULES.find(r => r.test.test(segment))
    if (hit) return hit
  }
  return undefined
}

// The parts of a path, with `.` and `..` resolved against root (a relative path starts at root).
function resolve(path: string, root: string): string[] {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${root}/${path}`).split('/')) { // @skip: path helper of the guard; the tests of inside() prove it
    if (part === '' || part === '.') continue // @skip: path helper of the guard; the tests of inside() prove it
    if (part === '..') parts.pop() // @skip: path helper of the guard; the tests of inside() prove it
    else parts.push(part) // @skip: path helper of the guard; the tests of inside() prove it
  }
  return parts
}

// True when path lies inside root. A path that starts with ~, $ or a backtick is outside: the shell expands it, so the guard cannot know where it goes.
export function inside(path: string, root: string): boolean {
  const bare = path.replace(/^["']|["']$/g, '')
  if (/^[~$`]/.test(bare)) return false // @skip: path helper of the guard; the tests of inside() prove it
  const at = resolve(bare, root)
  return resolve(root, '/').every((part, i) => at[i] === part)
}

// ---- the proof of the guard: the proof command and the prototype run it

const REPLY_COLS = 100 // the text of a refusal in the reply: the reason is short, a long one is cut

// A folder that lies outside root (the session folder) and does not exist.
export const outsideOf = (root: string): string => `/${root.split('/').filter(Boolean).slice(0, -1).concat('mod-fixture-missing-dir').join('/')}`

// The probe: a harmless command that the rules must refuse. Its folder lies outside the session folder and does not exist,
// so the call is harmless even when the rules fail, and a root-aware rule (inside(path, root)) refuses it too.
export const probe = (root = '/'): string => PROBE.replace('{dir}', outsideOf(root))

// Run the probe through the hooks of the mod (call goes through the hooks, as a model call does) and say what happened.
// The reply starts with the ok glyph when the guard refused the probe. That text is the marker of mods.py live.
export async function proof(call: (command: string) => Promise<{ readonly deny?: string }>, root = '/'): Promise<string> {
  const command = probe(root)
  try {
    const r = await call(command)
    if (r.deny === undefined) return `${GLYPHS.err} The probe was NOT refused: ${command}`
    // The engine puts `<plugin>: ` before a reply and before a deny, so the name leaves the deny here: the reply shows it once.
    return `${GLYPHS.ok} ${TEXT.refused}: ${cut(oneLine(clean(r.deny.replace(/^[a-z][a-z0-9-]*: /, ''))), REPLY_COLS)}`
  } catch (err) {
    return `${GLYPHS.err} The probe did not run: ${err instanceof Error ? err.message : String(err)}`
  }
}
