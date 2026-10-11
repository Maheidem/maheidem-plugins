# pane-list.journey.py: the storyboard journey of templates/pane-list, variant C, for the default domain
# (items with text and age, actions add and delete, the six scenarios of the kind).
# A worked example of scripts/journey_build.py. mods.py domain writes the journey of your domain for you.
# Edit a copy only for a screen that the schema does not hold, and put it in <wb>/journey.local.py.
#   python3 -I pane-list.journey.py <out journey.json> [<skill dir>]
# It writes the journey and runs journey-lint.py. A source cite names the code by symbol: j.cite('deleteRow')
# gives 'hooks/views.tsx:<a>-<b> (deleteRow)' from the file as it is now, so a taste edit never makes a stale cite.
# A source line with no screen of its own ends in an @skip: comment: j.auto_skips() waives it in the audit.
# The audit skips hooks/kit/ (the copied kit). Live proof: crawl of a renamed copy on 2.1.296 (references/storyboard.md 9).
import os
import sys

SKILL = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.claude/skills/claude-code-mods')
sys.path.insert(0, os.path.join(SKILL, 'scripts'))
sys.dont_write_bytecode = True  # no __pycache__ in the skill scripts folder
from journey_build import Journey  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
j = Journey(
    'pane-list · design C storyboard',
    notes=('Size: docked, 150 x 45; the list window follows the pane (31 rows there). Variant C. Esc steps back one level '
           '(confirm -> detail -> list, add -> list); Esc at the list closes the pane. '
           'A notice with no timer takes the first Esc (it is dismissed), so a screen with such a notice needs two Esc to go back. '
           'Not in the storyboard: other sizes and variants (see the mockups), mouse, engine prompts.'),
    crawl={'command': '/{mod} C {scenario}', 'clearScenarios': ['normal', 'empty', 'loading', 'error', 'overflow', 'save-fails'],
           'ringAreas': ['list']},
    mod_dir=os.path.join(HERE, 'pane-list'),
)
cite = j.cite

RENDER = cite("on('ui.render', { component: 'Pane'")
LIST = cite("on('ui.render', { component: 'Pane'", 'rowOf', 'listView', 'draw')
RING = cite("on('ui.focus'", 'keysOf')
CLOSE = cite("on('ui.close'", 'NAV')
START = cite("on('command.run'")
SAVE = cite('saveRow', 'result')
ASK = cite('askDelete', 'askNodes', 'detailView')

# ---- scenarios: one fixture world each; the reset command names it in its reply
j.scenario('normal', '4 items. Saves work.', 'list-normal', 'Data')
j.scenario('empty', 'No items. Saves work.', 'list-empty', 'Data')
j.scenario('loading', 'The items never arrive (no timer in the prototype).', 'list-loading', 'Data')
j.scenario('error', 'The items could not be read.', 'list-error', 'Data')
j.scenario('overflow', '60 items: more than the window of a 45-row dock.', 'list-overflow', 'Data')
j.scenario('save-fails', '4 items. The first save fails with a store error; the retry works.', 'list-normal', 'Errors')

# ---- nodes: every row draws <pointer> <mark> <tag> <title>; this domain has no mark and no tag, so the row is "❯ <title>"
HINT = 'Hints "a: add · d: delete" and "↑/↓ to select · Enter to view · Esc to close".'
j.node('list-normal', 'list', 'List, 4 items', f'Bold "4 items", 4 rows, first selected, the age at the right, a rule. {HINT}',
       'normal', '4 items && ❯ Call the vendor about', f'{LIST}, {START}')
j.node('list-normal-last', 'list', 'List, last item selected', f'Ring and ❯ on the 4th item. {HINT}',
       'normal', '4 items && ❯ Rename the staging', RING)
j.node('detail-normal', 'detail', 'Item detail', 'Bold "Item", the full title, the dim age. Hints "d: delete" and "Esc to go back".',
       'normal', '2m ago && d: delete && !Delete this item?', cite("on('ui.render', { component: 'Pane'", 'detailView'))
j.node('confirm-normal', 'detail', 'Delete confirm', '"! Delete this item?" and "y: delete · n: cancel", then "y to delete · Esc to cancel". The ring is on n (safe).',
       'normal', 'Delete this item? && y: delete', ASK, focus='n: cancel')
j.node('list-after-delete', 'list', 'List after a delete', '"3 items"; the first remaining item is selected; the notice "✓ Deleted: ..." shows for 5 s.',
       'normal', '3 items && ❯ Fix the flaky login test', cite('deleteRow'))
j.node('add-normal', 'add', 'Add an item', 'Bold "New item", the field with "Type an item", hints "Enter to save · Esc to cancel".',
       'normal', 'New item && Type an item && !The item is empty && !was not saved', cite("on('ui.render', { component: 'Pane'", 'addView', 'draw'))
j.twin('add-normal', 'add-empty', 'empty', title='Add, from the empty list')
j.node('add-refused', 'add', 'Add, empty text refused', 'Red "✕ The item is empty. Type some text, then press Enter." and "Esc to dismiss". The view stays.',
       'normal', 'The item is empty', cite('saveRow'))
j.node('add-failed', 'add', 'Add, the store write failed', 'Red "✕ The item was not saved. … Your text is kept." The draft stays in the field.',
       'save-fails', 'The item was not saved && Buy milk', SAVE)
j.node('list-added', 'list', 'List after an add', '"5 items", the new item first and selected; the notice "✓ Saved: ..." shows for 5 s.',
       'normal', '5 items && ❯ Buy milk', SAVE)
j.node('list-added-one', 'list', 'List after the first add', '"1 item", the new item selected. No "↑/↓ to select" hint: one row has nothing to select.',
       'empty', '1 item && ❯ Buy milk', SAVE)
j.node('list-fail-banner', 'list', 'List with the save error', 'Red "✕ The last item was not saved · the store write failed" under the header.',
       'save-fails', 'The last item was not saved && ❯ Call the vendor about', cite('saveRow', 'listView'))
j.node('list-empty', 'list', 'Empty list', 'Dim "No items yet", hints "a: add" and "Esc to close".',
       'empty', 'No items yet && a: add', cite("on('ui.render', { component: 'Pane'", 'draw'))
j.node('list-loading', 'list', 'Loading', 'Dim "Loading items…" and "Esc to close".',
       'loading', 'Loading items', cite("on('ui.render', { component: 'Pane'", 'draw'))
j.node('list-error', 'list', 'Load error', 'Red "✕ The items could not be read." and "Esc to close".',
       'error', 'The items could not be read', cite("on('ui.render', { component: 'Pane'", 'draw'))
j.node('list-overflow', 'list', 'List, 60 items', '"60 items", a window as tall as the pane, "↓ N more".',
       'overflow', '60 items && ❯ Call the vendor about && ↓', LIST)
j.node('list-overflow-mid', 'list', 'List, window moved', '"↑ 4 more", the 6th item selected.',
       'overflow', '❯ Reply to the audit email && ↑ 4 more', RING)
j.node('list-overflow-bottom', 'list', 'List, last of 60', '"↑ N more", the last item selected, a blank bottom edge.',
       'overflow', '❯ Older item 60 && ↑', RING)
CLOSED = 'Scenario C && !4 items && !No items yet && !New item && !Delete this item && !Loading items && !could not be read'
j.node('pane-closed', 'screen', 'Pane closed', 'No pane; the transcript shows the reply of the reset command.',
       'normal', CLOSED, f'{CLOSE}, {START}', region='screen')

# ---- exact edges
j.edge('list-normal', 'list-normal-last', 'Down*3', 'Move to the last item', RING)
j.edge('list-normal-last', 'list-normal', 'Up*3', 'Move back to the first item', RING)
j.edge('list-normal', 'detail-normal', 'Enter', 'Open the selected item', cite('openDetail', 'rowOf'))
j.edge('list-normal', 'confirm-normal', 'd', 'Ask to delete the selected item', ASK)
j.edge('list-normal', 'add-normal', 'a', 'Add an item', cite('openAdd', 'addView'))
j.edge('list-normal', 'pane-closed', 'Escape', 'Close the pane', CLOSE)
j.edge('detail-normal', 'confirm-normal', 'd', 'Ask to delete', ASK)
j.edge('detail-normal', 'list-normal', 'Escape', 'Back to the list', CLOSE)
j.edge('confirm-normal', 'list-after-delete', 'y', 'Delete the item', cite('deleteRow'))
j.edge('confirm-normal', 'detail-normal', 'n', 'Keep the item', ASK)
j.edge('confirm-normal', 'detail-normal', 'Escape', 'Cancel the delete', CLOSE)
j.edge('add-normal', 'list-added', 'text:"Buy milk" Enter', 'Type an item and save it', SAVE, notIn=['save-fails'])
j.edge('add-normal', 'add-failed', 'text:"Buy milk" Enter', 'Save: the store write fails', SAVE, scn='save-fails', onlyIn=['save-fails'])
j.edge('add-normal', 'add-refused', 'Enter', 'Save with no text', cite('saveRow'))
j.edge('add-normal', 'list-normal', 'Escape', 'Cancel the add', CLOSE)
j.edge('add-refused', 'add-refused', 'Enter', 'Save with no text again: the same message (a self-loop)', cite('saveRow'), check='The item is empty')
j.edge('add-refused', 'list-added', 'text:"Buy milk" Enter', 'Type an item and save it', SAVE, notIn=['save-fails'])
j.edge('add-refused', 'list-normal', 'Escape Escape', 'Cancel the add: the first Esc dismisses the message', CLOSE)
j.edge('add-failed', 'list-added', 'Enter', 'Retry: the text is kept, the write works now', SAVE, scn='save-fails')
j.edge('add-failed', 'list-fail-banner', 'Escape Escape', 'Cancel: the first Esc dismisses the message, the list shows the error', cite('saveRow', "on('ui.close'"), scn='save-fails')
j.edge('list-empty', 'add-empty', 'a', 'Add an item', cite('openAdd', 'addView'))
j.edge('add-empty', 'list-empty', 'Escape', 'Cancel: back to the empty list', CLOSE)
j.edge('add-empty', 'list-added-one', 'text:"Buy milk" Enter', 'Type an item and save it', SAVE)
j.edge('add-empty', 'add-refused', 'Enter', 'Save with no text', cite('saveRow'), scn='empty', approx='Same message; Esc goes back to the empty list.', check='The item is empty')
j.edge('list-overflow', 'list-overflow-mid', 'Down*5', 'Move down 5 items', RING)
j.edge('list-overflow-mid', 'list-overflow-bottom', 'Down*54', 'Move to the last item', RING)
j.edge('list-overflow-mid', 'list-overflow', 'Up*5', 'Move back to the first item', RING)
j.edge('list-overflow-bottom', 'list-overflow', 'Up*59', 'Move back to the first item', RING)
# The arrow hint shows on every list of 2 or more rows, so each such screen has a Down edge (storyboard gate "hint keys").
# A list of one row shows no arrow hint (views.tsx listView), so list-added-one has none.
j.edge('list-after-delete', 'list-after-delete', 'Down', 'Move to the next item', RING, check='3 items && ❯ Ask for the design file')
j.edge('list-added', 'list-added', 'Down', 'Move to the next item', RING, check='5 items && ❯ Call the vendor about')
j.edge('list-fail-banner', 'list-fail-banner', 'Down', 'Move to the next item', RING, check='The last item was not saved && ❯ Fix the flaky login test')
j.edge('pane-closed', 'list-normal', 'text:"/{mod}" Enter', 'Reopen with no argument: the state is kept', START, scn='normal', history=True)

# ---- approximate edges: the same keys from every other list screen
OTHER = ['list-normal-last', 'list-after-delete', 'list-added', 'list-added-one', 'list-fail-banner',
         'list-overflow', 'list-overflow-mid', 'list-overflow-bottom']
j.fan(OTHER, 'a', 'add-normal', 'Add an item', cite('openAdd', 'addView'), check='New item && Type an item')
j.fan(OTHER, 'd', 'confirm-normal', 'Ask to delete the selected item', ASK, check='Delete this item? && y: delete')
j.fan(OTHER, 'Enter', 'detail-normal', 'Open the selected item', cite('openDetail', 'rowOf'), check='d: delete && Esc to go back && !Delete this item?')
CLOSED_CHECK = 'Scenario C && !No items yet && !Loading items && !could not be read'
j.fan(OTHER + ['list-empty', 'list-loading', 'list-error'], 'Escape', 'pane-closed', 'Close the pane', CLOSE,
      check=CLOSED_CHECK, approx='Same closed pane; the scenario differs.')

# ---- source lines with no screen of their own: the lines that end in an @skip: comment (scripts/audit-handlers.py)
j.auto_skips()
sys.exit(j.write(sys.argv[1] if len(sys.argv) > 1 else 'journey.json'))
