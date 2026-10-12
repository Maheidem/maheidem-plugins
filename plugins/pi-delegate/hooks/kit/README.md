# Kit v2 (`hooks/kit/`)

The kit is a set of small TypeScript files that a mod copies into `hooks/kit/`.
The files draw and drive a pane: list, header, footer, notice, confirm, input and band.
`mods.py new` copies the kit. `mods.py check` hashes it. Do not edit the copy in a mod.

## Three rules

1. A kit file never takes `$`. It takes handles (`k`), a context (`c`) or elements (`E`).
2. A kit file never calls `atom()`, `read()` or `update()`. The mod declares the atoms.
3. A kit file keeps no drawn state in a module variable. The cells hold the state.

## How a mod binds the handles

`hooks/register.tsx` declares three atoms: `ui`, `world` and `drafts`.
The function `bind($)` is the only function that holds `$`. It returns a `Handles` object.
The `ui` and `world` cells merge a patch. The `drafts` cell replaces the value.
`bind($)` also gives the host calls: `focus`, `open`, `close`, `panes`, `sleep`, `now`, `toast`, `log`, `status`, `invalidate`.
Every hook calls `bind($)` and passes the handles to the kit.

## Version

`KIT.version` in `defaults.ts` is the kit version. `KIT.types` is the plugin-authoring types version that the kit is proven on.

## Limits (measured live on 2.1.296, 2026-10-10)

The ring, Esc and confirm rules hold when the keys come at human speed and the placement stays the same.

1. **Same placement, no resize between the keys.** A resize that moves the pane between inline and dock (about 110 columns) removes the ring. Arrows, y, n and hotkeys then go to the prompt. A new open of the pane restores the ring. A refocus from the render hook restored it for inline to dock, but not for dock to inline (probe, not kept).
2. **A key with no binding goes to the prompt.** A key that the screen does not bind (no hotkey, not an arrow, Enter, Esc or Tab) types into the prompt, and the prompt keeps the keys. The pane loses the ring. So a key pressed before the next screen draws its hotkey is lost: `d` then `n` 20 ms later types `n` into the prompt and leaves the question open with no ring. At 50 ms apart it works. `$.ui.open` and `$.ui.focus` from the kit do not take the keys back from the prompt.
3. **Esc, then a key within about 50 ms.** The key goes to the screen that Esc leaves: Esc in the add view, then `a`, types `a` into the field. A second Esc at the list then closes the pane, as the Esc ladder says.
4. **Arrow bursts drop keys.** At 5-20 ms apart, about 30 to 45 of 59 presses move the selection. Slow presses move one row each: 10 rows for 10 presses at every gap from 50 ms to 250 ms.
5. **Very fast arrows can put the ring one row off for 80 ms.** This can happen at 10 ms apart or faster. The engine can still show an older draw than the one that `focusHook` read. Then the ring lands one row away from the pointer. Measured: 4 of about 170 bursts at 5-10 ms, and 0 of about 125 bursts at 15 ms and more. `settle` in `focus.ts` puts the ring back on the selected row 80 ms after the last arrow. Until then, Up at the top slot does nothing.
6. **Band open needs two opens.** `openFromBand` opens the pane twice, 150 ms apart. One open gave the pane with no ring (3 of 3 tries, docked 150 x 45, in two probes). One open after a 150 ms wait also gave no ring (3 of 3).
7. **Short panes.** A 30-row terminal gives 8 body rows. The footer always shows. `listWindow` shows every row without the gap row when they fit. Else it drops the edge rows, then the gap row. It keeps 3 list rows where it can: an arrow moves the ring only to a drawn row, and a window of 2 rows froze Down.
