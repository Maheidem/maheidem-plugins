# band.journey.py: the storyboard journey of templates/band, variant C, for the default domain
# (items with text, state, note and age; actions mark and refresh; the band counts the states; the four scenarios of the kind).
# A worked example of scripts/journey_build.py for a mod with a band. mods.py domain writes the journey of your domain for you.
# Edit a copy only for a screen that the schema does not hold, and put it in <wb>/journey.local.py.
#   python3 -I band.journey.py <out journey.json> [<skill dir>]
# It writes the journey and runs journey-lint.py. A source cite names the code by symbol: j.cite('markRow')
# gives 'hooks/views.tsx:<a>-<b> (markRow)' from the file as it is now, so a taste edit never makes a stale cite.
# A source line with no screen of its own ends in an @skip: comment: j.auto_skips() waives it in the audit.
# The audit skips hooks/kit/ (the copied kit).
# The band is not in the pane: its nodes have region 'screen' (the marker is searched on the whole screen).
# The scenario command opens the pane (as the mockups need). A scenario starts at its pane; Esc closes the pane
# and the band shows. Open is the key chain "C-x Tab Enter": ctrl+x tab focuses the band Button, Enter presses it.
# A key of the band is "C-x Tab <key>". The word "closed" at the end of the command keeps the pane shut.
import os
import sys

SKILL = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.claude/skills/claude-code-mods')
sys.path.insert(0, os.path.join(SKILL, 'scripts'))
sys.dont_write_bytecode = True  # no __pycache__ in the skill scripts folder
from journey_build import Journey  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
j = Journey(
    'prompt-band · design C storyboard',
    notes=('Size: docked, 150 x 45. Variant C. The band is one row above the prompt; the pane is small. The band hides while the pane is open. '
           'Each scenario starts with the pane open. Esc at the list closes the pane and the band comes back. Open is ctrl+x tab, then Enter. Esc steps back one level in the detail. '
           'A band node has region "screen": its marker is searched on the whole screen. '
           'Not in the storyboard: other sizes and variants (see the mockups), mouse, the [-] mark of the engine, a survey that holds the band, '
           'the turn: the prototype has no model turn (band idle show).'),
    crawl={'command': '/{mod} C {scenario}', 'clearScenarios': ['normal', 'empty', 'error', 'overflow'], 'ringAreas': ['list']},
    mod_dir=os.path.join(HERE, 'prompt-band'),
)
cite = j.cite

START = cite("on('command.run'")
BAND = cite("on('ui.render', { component: 'AbovePrompt'", 'bandLine')
OPEN = cite("on('ui.render', { component: 'AbovePrompt'")
PANE = cite("on('ui.render', { component: 'Pane'", 'draw')
LIST = cite("on('ui.render', { component: 'Pane'", 'rowOf', 'listView', 'draw')
DETAIL = cite("on('ui.render', { component: 'Pane'", 'detailView')
RING = cite("on('ui.focus'", 'keysOf')
CLOSE = cite("on('ui.close'", 'NAV')
MARK = cite('markRow', 'result')
REFRESH = cite('refreshRows', 'result')

# ---- scenarios: one fixture world each; the reset command names it in its reply
j.scenario('normal', '3 items: one waits, one works, one failed.', 'list-normal', 'Data')
j.scenario('empty', 'No items: the band yields.', 'list-empty', 'Data')
j.scenario('error', 'The items could not be read: the band says so.', 'list-error', 'Data')
j.scenario('overflow', '40 items: ten of each state.', 'list-overflow', 'Data')

# ---- band nodes (region screen)
OPEN_HINT = 'Dim "ctrl+x tab to ", the Button "open" and the key "r: refresh" at the right.'
j.node('band-normal', 'band', 'Band, 3 items', f'The count of each state: "1 waiting · 1 working · 1 failed". {OPEN_HINT}',
       'normal', 'Scenario C normal && 1 waiting && 1 working && 1 failed && ctrl+x tab to open && r: refresh', f'{BAND}, {CLOSE}', region='screen')
j.node('band-normal-marked', 'band', 'Band, after the first item is done', 'The band counts the new states: "1 working · 1 failed · 1 done".',
       'normal', '1 working && 1 failed && 1 done && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-empty', 'band', 'No band', 'No items: the band yields. The transcript shows the reply of the reset command.',
       'empty', 'Scenario C empty && !ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-error', 'band', 'Band, the read failed', f'Red "✕ The items could not be read." {OPEN_HINT}',
       'error', 'Scenario C error && The items could not be read && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')
j.node('band-overflow', 'band', 'Band, 40 items', f'The count of each state: ten of each. {OPEN_HINT}',
       'overflow', 'Scenario C overflow && 10 waiting && 10 working && 10 failed && 10 done && ctrl+x tab to open', f'{BAND}, {CLOSE}', region='screen')

# ---- pane nodes: every row draws <pointer> <mark> <tag> <title>; the mark is the glyph of the state
HINT = 'Hints "d: done · r: refresh" and "↑/↓ to select · Enter to view · Esc to close".'
j.node('list-normal', 'list', 'Pane, 3 items', f'Header "3 items", 3 rows with a state glyph, the first selected. The band is hidden. {HINT}',
       'normal', '3 items && ❯ ! Call the vendor about && d: done && r: refresh && !ctrl+x tab to open', f'{LIST}, {START}, {OPEN}', region='screen')
j.node('list-normal-last', 'list', 'Pane, 3rd item selected', 'Ring and ❯ on the 3rd item.',
       'normal', '❯ ✕ Ask for the design file && d: done', RING)
j.node('detail-normal', 'detail', 'Item detail', 'Bold "Item", the title, the note, the dim state and age. Hints "d: done" and "Esc to go back".',
       'normal', 'Book the team room && waiting · 2m ago && d: done && Esc to go back', DETAIL)
j.node('detail-normal-marked', 'detail', 'Item detail, after done', 'The notice "✓ Marked done: ..." shows for 5 s; the state line says "done".',
       'normal', 'Marked done && done · 2m ago && d: done', MARK)
j.node('list-normal-marked', 'list', 'Pane, after done', 'The notice "✓ Marked done: ..." shows for 5 s; the row has the "✓" glyph.',
       'normal', 'Marked done && ❯ ✓ Call the vendor about && 3 items', MARK)
j.node('list-normal-reopened', 'list', 'Pane, opened from the new band', 'The pane opens on the first item, which is done now.',
       'normal', '3 items && ❯ ✓ Call the vendor about && d: done', f'{LIST}, {OPEN}')
j.node('list-normal-refreshed', 'list', 'Pane, after a refresh', 'The same rows; the notice "✓ Read again" shows for 5 s.',
       'normal', 'Read again && 3 items && ❯ ! Call the vendor about', REFRESH)
j.node('list-empty', 'list', 'Empty pane', 'Dim "No items yet", hints "r: refresh" and "Esc to close".',
       'empty', 'No items yet && r: refresh', cite("on('ui.render', { component: 'Pane'", 'draw'))
j.node('list-error', 'list', 'Pane, load error', 'Red "✕ The items could not be read.", "r: refresh" and "Esc to close".',
       'error', 'The items could not be read && r: refresh', cite("on('ui.render', { component: 'Pane'", 'draw'))
j.node('list-overflow', 'list', 'Pane, 40 items', '"40 items", a window as tall as the pane, "↓ N more".',
       'overflow', '40 items && ❯ ! Call the vendor about && ↓', LIST)
j.node('list-overflow-mid', 'list', 'Pane, window moved', '"↑ 4 more", the 6th item selected.',
       'overflow', '❯ · Reply to the audit email && ↑', RING)
j.node('list-overflow-bottom', 'list', 'Pane, last of 40', '"↑ N more", the last item selected, a blank bottom edge.',
       'overflow', '❯ ✓ Older item 40 && ↑', RING)

# ---- exact edges: the band, its Open and its key, and the pane
CX = 'C-x Tab Enter'
for scn, band, lst in (('normal', 'band-normal', 'list-normal'), ('error', 'band-error', 'list-error'), ('overflow', 'band-overflow', 'list-overflow')):
    j.edge(band, lst, CX, 'Open from the band: the pane opens on the first item', OPEN, scn=scn)
    j.edge(lst, band, 'Escape', 'Close the pane: the band comes back', CLOSE, scn=scn)
j.edge('band-normal', 'band-normal', 'C-x Tab r', 'The band key: read the rows again', cite("on('ui.render', { component: 'AbovePrompt'", 'refreshRows'), check='1 waiting && 1 working && 1 failed && ctrl+x tab to open')
j.edge('band-empty', 'list-empty', 'text:"/{mod} C empty" Enter', 'Open the pane with the command (no band to open it)', START)
j.edge('list-empty', 'band-empty', 'Escape', 'Close the pane', CLOSE)
j.edge('list-normal', 'list-normal-last', 'Down*2', 'Move to the 3rd item', RING)
j.edge('list-normal-last', 'list-normal', 'Up*2', 'Move back to the first item', RING)
j.edge('list-normal-last', 'band-normal', 'Escape', 'Close the pane: the band comes back', CLOSE)
j.edge('list-normal', 'detail-normal', 'Enter', 'Open the selected item', cite('openDetail', 'rowOf'))
j.edge('detail-normal', 'list-normal', 'Escape', 'Back to the list', CLOSE)
j.edge('detail-normal', 'detail-normal-marked', 'd', 'Mark the item done (1.5 s)', MARK)
j.edge('list-normal', 'list-normal-marked', 'd', 'Mark the selected item done (1.5 s)', MARK)
j.edge('list-normal', 'list-normal-refreshed', 'r', 'Read the rows again (1.5 s)', REFRESH)
j.edge('list-normal-marked', 'band-normal-marked', 'Escape Escape', 'Close the pane: the first Esc does nothing to a timed notice, the band names the new counts', CLOSE)
j.edge('band-normal-marked', 'list-normal-reopened', CX, 'Open from the band: the pane opens on the first item', OPEN)
j.edge('list-normal-reopened', 'band-normal-marked', 'Escape', 'Close the pane: the band comes back', CLOSE)
j.edge('detail-normal-marked', 'list-normal-marked', 'Escape', 'Back to the list', CLOSE)
j.edge('list-overflow', 'list-overflow-mid', 'Down*5', 'Move down 5 items', RING)
j.edge('list-overflow-mid', 'list-overflow-bottom', 'Down*34', 'Move to the last item', RING)
j.edge('list-overflow-mid', 'list-overflow', 'Up*5', 'Move back to the first item', RING)
j.edge('list-overflow-bottom', 'list-overflow', 'Up*39', 'Move back to the first item', RING)

# ---- self-loops: the arrows move the selection by one row
j.edge('list-normal-marked', 'list-normal-marked', 'Down', 'Move to the next item', RING, check='Marked done && ❯ · Fix the flaky login test')
j.edge('list-normal-refreshed', 'list-normal-refreshed', 'Down', 'Move to the next item', RING, check='Read again && ❯ · Fix the flaky login test')

# ---- approximate edges: the same keys from every other list screen
OTHER = ['list-normal-last', 'list-normal-marked', 'list-normal-refreshed', 'list-overflow', 'list-overflow-mid', 'list-overflow-bottom']
j.fan(OTHER, 'Enter', 'detail-normal', 'Open the selected item', cite('openDetail', 'rowOf'), check='d: done && Esc to go back')
j.fan(OTHER, 'd', 'list-normal-marked', 'Mark the selected item done', MARK, check='Marked done')
j.fan(OTHER + ['list-empty', 'list-error'], 'r', 'list-normal-refreshed', 'Read the rows again', REFRESH, check='Read again')
j.fan(['list-overflow-mid', 'list-overflow-bottom'], 'Escape', 'band-overflow', 'Close the pane: the band comes back', CLOSE, check='Scenario C overflow && ctrl+x tab to open')
j.fan(['list-normal-refreshed'], 'Escape', 'band-normal', 'Close the pane: the band comes back', CLOSE, check='Scenario C normal && ctrl+x tab to open', approx='Same band; the first Esc dismisses nothing (the notice has a timer).')

# ---- source lines with no screen of their own: the lines that end in an @skip: comment (scripts/audit-handlers.py)
j.auto_skips()
sys.exit(j.write(sys.argv[1] if len(sys.argv) > 1 else 'journey.json'))
