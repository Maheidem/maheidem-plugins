# mixed.journey.py: the storyboard journey of templates/mixed, variant C.
# A worked example of scripts/journey_build.py for a mod with a pane, a band, a toast, a guard and a command.
# It is the journey of templates/pane-list plus the nodes of the band, the toast and the guard.
# Copy it next to your prototype, change the nodes and edges to your screens, and run it:
#   python3 -I mixed.journey.py <out journey.json> [<skill dir>]
# It writes the journey and runs journey-lint.py. Every node and edge names its source as
# '<file>:<lines> (<symbol>)'. After an edit of the mod the lines drift: run
# scripts/audit-handlers.py <mod> journey.json, and fix each OPEN line and STALE cite it prints.
# The audit skips hooks/kit/ (the copied kit). It lists the lines of register.tsx, views.tsx and rules.ts.
# The band, the toast and the guard are not in the pane: their nodes have region 'screen'
# (the marker is searched on the whole screen).
# The scenario command opens the pane (as the mockups need). A scenario starts at its pane; Esc closes the pane
# and the band shows. Open is the key chain "C-x Tab Enter": ctrl+x tab focuses the band Button, Enter presses it.
# The word "closed" at the end of the command keeps the pane shut (use it with mods.py live to see the band at once).
# A part of a marker that starts with "!" must be absent. So a marker never starts a part with the warn glyph.
import os
import sys

SKILL = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.claude/skills/claude-code-mods')
sys.path.insert(0, os.path.join(SKILL, 'scripts'))
sys.dont_write_bytecode = True  # no __pycache__ in the skill scripts folder
from journey_build import Journey  # noqa: E402

R = 'hooks/register.tsx'
V = 'hooks/views.tsx'
G = 'hooks/rules.ts'
CMD = f'{R}:81-96 (command.run, start the scenario)'
PANE = f'{R}:134-138 (ui.render Pane), {V}:314-322 (draw)'
LIST = f'{PANE}, {V}:59, 223-228, 231-242, 244-263 (lookOf, summary, rowOf, listView)'
DETAIL = f'{PANE}, {V}:265-292 (detailView)'
ADD = f'{PANE}, {V}:294-312 (addView)'
RING = f'{R}:118 (ui.focus), {V}:124-127 (keysOf)'
CLOSE = f'{R}:115 (ui.close), {V}:130-141 (NAV)'
DELETE = f'{V}:172-176, 178-189, 220 (askDelete, deleteRow, delete key)'
SAVE = f'{V}:192-214 (saved, added, saveRow)'
BAND = f'{R}:125-132 (ui.render AbovePrompt), {V}:81-83, 88-116 (bandTarget, bandSegs, bandLine)'
OPEN = f'{R}:125-132 (ui.render AbovePrompt, bandRow, openFromBand), {V}:81-83 (bandTarget)'
TIMER = f'{V}:146-153 (startTimers, the question after 8 s, announce)'
GUARD = f'{R}:63-71, 109-112 (probeGuard, tool.call, deny), {G}:28-33 (judge)'
OUT = f'{R}:100-103 (ui.render CommandOutput), {V}:329-345 (toneOf, outputView)'

j = Journey(
    'mixed · design C storyboard',
    notes=('Size: docked, 150 x 45; the list window follows the pane (31 rows there). Variant C. Esc steps back one level '
           '(confirm -> detail -> list, add -> list); Esc at the list closes the pane and the band comes back. '
           'A notice with no timer takes the first Esc (it is dismissed), so a screen with such a notice needs two Esc to go back. '
           'The band is one row above the prompt and hides while the pane is open. Open is ctrl+x tab, then Enter. '
           'A band, a toast or a guard node has region "screen": its marker is searched on the whole screen. '
           'The working scenario: after 8 s the first item asks a question, a log line shows in the transcript and a toast shows while the pane is closed. '
           'The guarded scenario runs one refused fixture call through the guard; its reply row shows "Refused". '
           'Not in the storyboard: other sizes and variants (see the mockups), mouse, the [-] mark of the engine, a survey that holds the band, '
           'the toast alone (it leaves after about 4 s), engine prompts.'),
    crawl={'command': '/{mod} C {scenario}',
           'clearScenarios': ['normal', 'empty', 'loading', 'error', 'overflow', 'save-fails', 'one-waiting', 'many', 'failed', 'working', 'quiet', 'guarded'],
           'ringAreas': ['list']},
)

# ---- scenarios: one fixture world each; the reset command names it in its reply
j.scenario('normal', '4 items. Saves work. No item needs you.', 'list-normal', 'Data')
j.scenario('empty', 'No items. Saves work.', 'list-empty', 'Data')
j.scenario('loading', 'The items never arrive (no timer in the prototype).', 'list-loading', 'Data')
j.scenario('error', 'The items could not be read.', 'list-error', 'Data')
j.scenario('overflow', '60 items: more than the window of a 45-row dock.', 'list-overflow', 'Data')
j.scenario('save-fails', '4 items. The first save fails with a store error; the retry works.', 'list-normal', 'Errors')
j.scenario('one-waiting', '1 item waits for input, 1 works, 1 is idle.', 'list-one-waiting', 'Needs input')
j.scenario('many', '3 items wait for input, 1 works, 1 failed.', 'list-many', 'Needs input')
j.scenario('failed', '1 item failed, 1 works, 1 is idle.', 'list-failed', 'Problems')
j.scenario('working', '2 items work. After 8 s the first one asks a question.', 'list-working', 'Busy')
j.scenario('quiet', 'Every item is idle: the band stays quiet.', 'list-quiet', 'Quiet')
j.scenario('guarded', '4 items. The command runs one risky Bash call through the guard: it is refused.', 'list-guarded', 'Guard')

# ---- pane nodes: the list scenarios
HINT = 'Hints "a: add · d: delete" and "↑/↓ to select · Enter to view · Esc to close".'
j.node('list-normal', 'list', 'List, 4 items', f'Bold "4 items", dim "newest first", 4 rows, first selected, a rule. {HINT}',
       'normal', '4 items && ❯ Call the vendor', f'{LIST}, {CMD}')
j.node('list-normal-last', 'list', 'List, last item selected', f'Ring and ❯ on the 4th item. {HINT}',
       'normal', '4 items && ❯ Rename the staging bucket', RING)
j.node('detail-normal', 'detail', 'Item detail', 'Bold "Item", the full text, dim age. Hints "d: delete" and "Esc to go back".',
       'normal', 'Added 2m ago && d: delete && !Delete this item?', DETAIL)
j.node('confirm-normal', 'detail', 'Delete confirm', '"! Delete this item?" and "y: delete · n: cancel", then "y to delete · Esc to cancel". The ring is on n (safe).',
       'normal', 'Delete this item? && y: delete', f'{DELETE}, {DETAIL} (detailView with the confirm strip)', focus='n: cancel')
j.node('list-after-delete', 'list', 'List after a delete', '"3 items"; the first remaining item is selected; the notice "✓ Deleted: ..." shows for 5 s.',
       'normal', '3 items && ❯ Fix the flaky login test', DELETE)
j.node('add-normal', 'add', 'Add an item', 'Bold "New item", the field with "Type an item", hints "Enter to save · Esc to cancel".',
       'normal', 'New item && Type an item && !The item is empty && !was not saved', ADD)
j.twin('add-normal', 'add-empty', 'empty', title='Add, from the empty list')
j.node('add-refused', 'add', 'Add, empty text refused', 'Red "✕ The item is empty. Type some text, then press Enter." and "Esc to dismiss". The view stays.',
       'normal', 'The item is empty', SAVE)
j.node('add-failed', 'add', 'Add, the store write failed', 'Red "✕ The item was not saved. … Your text is kept." The draft stays in the field.',
       'save-fails', 'The item was not saved && Buy milk', SAVE)
j.node('list-added', 'list', 'List after an add', '"5 items", the new item first and selected; the notice "✓ Saved: ..." shows for 5 s.',
       'normal', '5 items && ❯ Buy milk', SAVE)
j.node('list-added-one', 'list', 'List after the first add', '"1 item", the new item selected. No "↑/↓ to select" hint: one row has nothing to select.',
       'empty', '1 item && ❯ Buy milk', SAVE)
j.node('list-fail-banner', 'list', 'List with the save error', 'Red "✕ The last item was not saved · the store write failed" under the header.',
       'save-fails', 'The last item was not saved && ❯ Call the vendor', f'{SAVE}, {LIST}')
j.node('list-empty', 'list', 'Empty list', 'Dim "No items yet", hints "a: add" and "Esc to close".',
       'empty', 'No items yet && a: add', f'{PANE}, {V}:320 (empty branch of draw)')
j.node('list-loading', 'list', 'Loading', 'Dim "Loading items…" and "Esc to close".',
       'loading', 'Loading items', f'{PANE}, {V}:318 (loading branch of draw)')
j.node('list-error', 'list', 'Load error', 'Red "✕ The items could not be read." and "Esc to close".',
       'error', 'The items could not be read', f'{PANE}, {V}:317 (error branch of draw)')
j.node('list-overflow', 'list', 'List, 60 items', '"60 items", a window as tall as the pane, "↓ N more".',
       'overflow', '60 items && ❯ Call the vendor && ↓', LIST)
j.node('list-overflow-mid', 'list', 'List, window moved', '"↑ 4 more", the 6th item selected.',
       'overflow', '❯ Reply to the audit email && ↑ 4 more', f'{RING}, {V}:231-242 (ring, window)')
j.node('list-overflow-bottom', 'list', 'List, last of 60', '"↑ N more", the last item selected, a blank bottom edge.',
       'overflow', '❯ Older item 60 && ↑', f'{RING}, {V}:231-242 (ring, window)')
CLOSED = 'Scenario C && !newest first && !No items yet && !New item && !Delete this item && !Added && !Loading items && !could not be read'
j.node('pane-closed', 'screen', 'Pane closed', 'No pane; the transcript shows the reply of the reset command.',
       'normal', CLOSED, f'{CLOSE}, {CMD}, {OUT} (ui.close at the list, command.run reply, the output row)', region='screen')

# ---- pane nodes: the band scenarios
HINT_BAND = 'Hints "a: add · d: delete" and "↑/↓ to select · Enter to view · Esc to close".'
HIDDEN = '!ctrl+x tab to open'  # the band is hidden while the pane is open
j.node('list-one-waiting', 'list', 'Pane, 1 waiting', f'Header "3 items · 1 needs input · 1 working", 3 rows, the waiting one selected with "?". The band is hidden. {HINT_BAND}',
       'one-waiting', f'3 items · 1 needs input && ❯ ? Rename the staging bucket && d: delete && {HIDDEN}', f'{LIST}, {CMD}, {OPEN}', region='screen')
j.node('detail-one-waiting', 'detail', 'Item detail, waiting', 'Bold "Item", the text, "? needs input", the question, dim age. Hints "d: delete" and "Esc to go back".',
       'one-waiting', '? needs input && Which name should I use? && Added 2m ago && d: delete && Esc to go back', DETAIL)
j.node('list-resolved', 'list', 'Pane, after the delete', 'The notice "✓ Deleted: ..." shows for 5 s; the row is gone; the header counts one less.',
       'one-waiting', 'Deleted: Rename the staging bucket && 2 items · 1 working', f'{LIST}, {DELETE}')
j.node('list-after-resolve', 'list', 'Pane, opened from the new band', 'The pane opens with the working item selected.',
       'one-waiting', '2 items · 1 working && ❯ ✻ Draft the release plan', f'{LIST}, {OPEN}')
j.node('list-many', 'list', 'Pane, 5 items', 'Header "5 items · 3 need input · 1 failed · 1 working", the first waiting item selected.',
       'many', f'5 items · 3 need input · 1 failed · 1 working && ❯ ? Rename the staging bucket && d: delete', f'{LIST}, {CMD}, {OPEN}')
j.node('list-many-last', 'list', 'Pane, 3rd item selected', 'Ring and ❯ on the 3rd item.',
       'many', '❯ ? Reply to the audit email && d: delete', RING)
j.node('list-failed', 'list', 'Pane, 1 failed', 'The failed item is selected with "✕".',
       'failed', '3 items · 1 failed · 1 working && ❯ ✕ Check disk use on the build host && d: delete', f'{LIST}, {CMD}, {OPEN}')
j.node('list-working', 'list', 'Pane, 2 working', 'Header "3 items · 2 working", the first working item selected.',
       'working', '3 items · 2 working && ❯ ✻ Fix the flaky login test && d: delete', f'{LIST}, {CMD}, {OPEN}')
j.node('list-working-asks', 'list', 'Pane, the item asks', 'Header "3 items · 1 needs input · 1 working"; the asking item is selected with "?".',
       'working', '3 items · 1 needs input · 1 working && ❯ ? Fix the flaky login test', f'{LIST}, {OPEN}')
j.node('list-quiet', 'list', 'Pane, nothing needs you', 'Header "3 items" with the dim "newest first"; no row has a glyph.',
       'quiet', '3 items && newest first && ❯ Fix the flaky login test', f'{LIST}, {CMD}')

# ---- pane node: the guard scenario
j.node('list-guarded', 'list', 'Pane, guarded', f'Same pane as the normal scenario: "4 items", first selected. {HINT}',
       'guarded', '4 items && ❯ Call the vendor', f'{LIST}, {CMD}')

# ---- band nodes (region screen)
OPEN_HINT = 'Dim "ctrl+x tab to " and the Button "open" at the right.'
j.node('band-one-waiting', 'band', 'Band, 1 waiting', f'Yellow "? ", bold name, "needs input", dim question. {OPEN_HINT}',
       'one-waiting', 'Scenario C one-waiting && ? Rename the staging bucket needs input && Which name should I use? && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-after-delete', 'band', 'Band, after the item is deleted', 'The band names the next item: "✻ 1 item working" and its name. The waiting item is gone.',
       'one-waiting', '✻ 1 item working && Draft the release plan && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-many', 'band', 'Band, 3 waiting', f'Yellow "? ", "3 items need input", dim names. {OPEN_HINT}',
       'many', 'Scenario C many && ? 3 items need input && Rename the staging bucket, Book the team room && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-failed', 'band', 'Band, 1 failed', f'Red "✕ ", bold name, "failed", dim reason. {OPEN_HINT}',
       'failed', 'Scenario C failed && ✕ Check disk use on the build host failed && The build host refused the key. && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-working', 'band', 'Band, 2 working', f'Dim "✻ 2 items working". {OPEN_HINT}',
       'working', 'Scenario C working && ✻ 2 items working && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-working-asks', 'band', 'Band and toast, a working item asks',
       f'The timer fired: yellow "? ", the first item "needs input", dim question. {OPEN_HINT} The transcript keeps the news line "! <item> asks: <question>"; a toast shows the same text for about 4 s.',
       'working', '? Fix the flaky login test needs input && Keep the old test data? && ctrl+x tab to open && Fix the flaky login test asks: Keep the old test data?',
       f'{BAND}, {TIMER}', region='screen')
j.node('band-quiet', 'band', 'No band', 'Nothing needs you: the band yields. The transcript shows the reply of the reset command.',
       'quiet', 'Scenario C quiet && !ctrl+x tab to open && !newest first', f'{BAND}, {CLOSE}', region='screen')

# ---- guard node (region screen)
j.node('output-guarded', 'screen', 'The guard refused the fixture call', 'Dim "Scenario C guarded", green "✓ Refused: <plugin>: recursive rm is refused here. …" in the transcript.',
       'guarded', 'Scenario C guarded && ✓ Refused: mixed: recursive rm is refused here && !newest first', f'{CMD}, {GUARD}, {OUT}', region='screen')

# ---- exact edges: the list scenarios
j.edge('list-normal', 'list-normal-last', 'Down*3', 'Move to the last item', RING)
j.edge('list-normal-last', 'list-normal', 'Up*3', 'Move back to the first item', RING)
j.edge('list-normal', 'detail-normal', 'Enter', 'Open the selected item', f'{V}:157-160, 231-242 (openDetail, row onPress)')
j.edge('list-normal', 'confirm-normal', 'd', 'Ask to delete the selected item', DELETE)
j.edge('list-normal', 'add-normal', 'a', 'Add an item', f'{V}:162-169, 219, 294-312 (openAdd, add key, addView)')
j.edge('list-normal', 'pane-closed', 'Escape', 'Close the pane', CLOSE)
j.edge('detail-normal', 'confirm-normal', 'd', 'Ask to delete', DELETE)
j.edge('detail-normal', 'list-normal', 'Escape', 'Back to the list', CLOSE)
j.edge('confirm-normal', 'list-after-delete', 'y', 'Delete the item', DELETE)
j.edge('confirm-normal', 'detail-normal', 'n', 'Keep the item', f'{V}:265-292 (confirm strip, Cancel)')
j.edge('confirm-normal', 'detail-normal', 'Escape', 'Cancel the delete', CLOSE)
j.edge('add-normal', 'list-added', 'text:"Buy milk" Enter', 'Type an item and save it', SAVE, notIn=['save-fails'])
j.edge('add-normal', 'add-failed', 'text:"Buy milk" Enter', 'Save: the store write fails', SAVE, scn='save-fails', onlyIn=['save-fails'])
j.edge('add-normal', 'add-refused', 'Enter', 'Save with no text', SAVE)
j.edge('add-normal', 'list-normal', 'Escape', 'Cancel the add', CLOSE)
j.edge('add-refused', 'add-refused', 'Enter', 'Save with no text again: the same message (a self-loop)', SAVE, check='The item is empty')
j.edge('add-refused', 'list-added', 'text:"Buy milk" Enter', 'Type an item and save it', SAVE, notIn=['save-fails'])
j.edge('add-refused', 'list-normal', 'Escape Escape', 'Cancel the add: the first Esc dismisses the message', CLOSE)
j.edge('add-failed', 'list-added', 'Enter', 'Retry: the text is kept, the write works now', SAVE, scn='save-fails')
j.edge('add-failed', 'list-fail-banner', 'Escape Escape', 'Cancel: the first Esc dismisses the message, the list shows the error', f'{CLOSE}, {SAVE}', scn='save-fails')
j.edge('list-empty', 'add-empty', 'a', 'Add an item', f'{V}:162-169, 219, 294-312 (openAdd, add key, addView)')
j.edge('add-empty', 'list-empty', 'Escape', 'Cancel: back to the empty list', CLOSE)
j.edge('add-empty', 'list-added-one', 'text:"Buy milk" Enter', 'Type an item and save it', SAVE)
j.edge('add-empty', 'add-refused', 'Enter', 'Save with no text', SAVE, scn='empty', approx='Same message; Esc goes back to the empty list.', check='The item is empty')
j.edge('list-overflow', 'list-overflow-mid', 'Down*5', 'Move down 5 items', RING)
j.edge('list-overflow-mid', 'list-overflow-bottom', 'Down*54', 'Move to the last item', RING)
j.edge('list-overflow-mid', 'list-overflow', 'Up*5', 'Move back to the first item', RING)
j.edge('list-overflow-bottom', 'list-overflow', 'Up*59', 'Move back to the first item', RING)
# The arrow hint shows on every list of 2 or more rows, so each such screen has a Down edge (storyboard gate "hint keys").
# A list of one row shows no arrow hint (views.tsx listView), so list-added-one has none.
j.edge('list-after-delete', 'list-after-delete', 'Down', 'Move to the next item', RING, check='3 items && ❯ Ask for the design file')
j.edge('list-added', 'list-added', 'Down', 'Move to the next item', RING, check='5 items && ❯ Call the vendor')
j.edge('list-fail-banner', 'list-fail-banner', 'Down', 'Move to the next item', RING, check='The last item was not saved && ❯ Fix the flaky login test')
j.edge('pane-closed', 'list-normal', 'text:"/{mod}" Enter', 'Reopen with no argument: the state is kept', CMD, scn='normal', history=True)

# ---- exact edges: the band, its Open, and the pane
CX = 'C-x Tab Enter'
for scn, band, lst in (('one-waiting', 'band-one-waiting', 'list-one-waiting'), ('many', 'band-many', 'list-many'), ('failed', 'band-failed', 'list-failed'),
                       ('working', 'band-working', 'list-working'), ('working', 'band-working-asks', 'list-working-asks'),
                       ('one-waiting', 'band-after-delete', 'list-after-resolve')):
    j.edge(band, lst, CX, 'Open from the band: the pane opens on the item the band names', OPEN, scn=scn)
    j.edge(lst, band, 'Escape', 'Close the pane: the band comes back', CLOSE, scn=scn)
j.edge('band-working', 'band-working-asks', 'wait', 'After 8 s the first item asks a question', TIMER)
j.edge('band-quiet', 'list-quiet', 'text:"/{mod} C quiet" Enter', 'Open the pane with the command (no band to open it)', CMD)
j.edge('list-quiet', 'band-quiet', 'Escape', 'Close the pane', CLOSE)
j.edge('list-one-waiting', 'detail-one-waiting', 'Enter', 'Open the selected item', f'{V}:157-160, 231-242 (openDetail, row onPress)')
j.edge('detail-one-waiting', 'list-one-waiting', 'Escape', 'Back to the list', CLOSE)
j.edge('list-one-waiting', 'list-resolved', 'd y', 'Ask to delete the selected item, then confirm (1.5 s)', DELETE)
j.edge('list-resolved', 'band-after-delete', 'Escape', 'Close the pane: the band names the next item', CLOSE)
j.edge('list-many', 'list-many-last', 'Down*2', 'Move to the 3rd item', RING)
j.edge('list-many-last', 'list-many', 'Up*2', 'Move back to the first item', RING)
j.edge('list-many-last', 'band-many', 'Escape', 'Close the pane: the band comes back', CLOSE)

# ---- exact edges: the guard
j.edge('list-guarded', 'output-guarded', 'Escape', 'Close the pane: the transcript shows the refusal', CLOSE)
j.edge('output-guarded', 'list-guarded', 'text:"/{mod}" Enter', 'Reopen with no argument: the state is kept', CMD, scn='guarded', history=True)

# ---- self-loops: the arrows move the selection by one row
j.edge('list-one-waiting', 'list-one-waiting', 'Down', 'Move to the next item', RING, check='❯ ✻ Draft the release plan')
j.edge('list-resolved', 'list-resolved', 'Down', 'Move to the next item', RING, check='❯ Fix the flaky login test')
j.edge('list-after-resolve', 'list-after-resolve', 'Down', 'Move to the next item', RING, check='❯ Fix the flaky login test')
j.edge('list-failed', 'list-failed', 'Down', 'Move to the next item', RING, check='❯ ✻ Draft the release plan')
j.edge('list-working', 'list-working', 'Down', 'Move to the next item', RING, check='❯ ✻ Draft the release plan')
j.edge('list-working-asks', 'list-working-asks', 'Down', 'Move to the next item', RING, check='❯ ✻ Draft the release plan')
j.edge('list-quiet', 'list-quiet', 'Down', 'Move to the next item', RING, check='❯ Update the onboarding page')

# ---- approximate edges: the same keys from every other list screen
OTHER = ['list-normal-last', 'list-after-delete', 'list-added', 'list-added-one', 'list-fail-banner',
         'list-overflow', 'list-overflow-mid', 'list-overflow-bottom']
j.fan(OTHER, 'a', 'add-normal', 'Add an item', f'{V}:162-169, 219, 294-312 (openAdd, add key, addView)', check='New item && Type an item')
j.fan(OTHER, 'd', 'confirm-normal', 'Ask to delete the selected item', DELETE, check='Delete this item? && y: delete')
j.fan(OTHER, 'Enter', 'detail-normal', 'Open the selected item', f'{V}:157-160, 231-242 (openDetail, row onPress)', check='d: delete && Esc to go back && !Delete this item?')
CLOSED_CHECK = 'Scenario C && !newest first && !No items yet && !Loading items && !could not be read'
j.fan(OTHER + ['list-empty', 'list-loading', 'list-error'], 'Escape', 'pane-closed', 'Close the pane', CLOSE,
      check=CLOSED_CHECK, approx='Same closed pane; the scenario differs.')
BANDED = ['list-resolved', 'list-after-resolve', 'list-many', 'list-many-last', 'list-failed', 'list-working', 'list-working-asks', 'list-quiet']
j.fan(BANDED, 'Enter', 'detail-one-waiting', 'Open the selected item', f'{V}:157-160, 231-242 (openDetail, row onPress)', check='d: delete && Esc to go back && Added')

# ---- source lines with no screen of their own (scripts/audit-handlers.py)
j.skip("on('session.start'", 'registers the command; draws nothing')
j.skip("e.surface === 'mobile'", 'mobile surface; the storyboard is the terminal only')
j.skip("on('ui.press'", 'clears a notice with no timer on a press; the crawl presses no Button while one shows (tests/kit.press.test.ts)')
j.skip('close: () => $.ui.close', 'bind(): the host handles; the Esc ladder is the ui.close hook')
j.skip('sleep: ms => $.clock.sleep', 'bind(): the host handles; the kit waits with them')
j.skip('The fixture call was NOT refused', 'a guard that fails to refuse; tests/mixed.test.ts holds the refusal')
j.skip('if (e.props.isErrored)', 'a command that threw gets the engine row; tests/mixed.test.ts holds it')
j.skip('if (line.startsWith(GLYPHS.ok))', 'the colour of a line; the guarded node shows it, tests/mixed.test.ts holds it')
j.skip('if (line.startsWith(GLYPHS.err))', 'the colour of a line; tests/mixed.test.ts holds it')

sys.exit(j.write(sys.argv[1] if len(sys.argv) > 1 else 'journey.json'))
