# pane-simple.journey.py: the storyboard journey of templates/pane-simple, variant C, for the default domain
# (items with text, state and age, actions refresh and clear, the three scenarios of the kind).
# A worked example of scripts/journey_build.py, with the smallest graph. mods.py domain writes the journey of your domain for you.
# Edit a copy only for a screen that the schema does not hold, and put it in <wb>/journey.local.py.
#   python3 -I pane-simple.journey.py <out journey.json> [<skill dir>]
# It writes the journey and runs journey-lint.py. A source cite names the code by symbol: j.cite('refreshRows')
# gives 'hooks/views.tsx:<a>-<b> (refreshRows)' from the file as it is now, so a taste edit never makes a stale cite.
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
    'pane-simple · design C storyboard',
    notes=('Size: docked, 150 x 45; the window follows the pane. Variant C. The rows are plain Text: no row is selected and no row opens. '
           'The footer keys change the rows: r reads them again, c clears them. The data goes newest first and the pane draws the newest row last. '
           'Esc closes the pane (a notice with no timer takes the first Esc). '
           'Not in the storyboard: the loading screen (only before the first scenario), other sizes and variants (see the mockups), mouse.'),
    crawl={'command': '/{mod} C {scenario}', 'clearScenarios': ['normal', 'empty', 'overflow']},
    mod_dir=os.path.join(HERE, 'pane-simple'),
)
cite = j.cite

RENDER = cite("on('ui.render', { component: 'Pane'")
LIST = cite("on('ui.render', { component: 'Pane'", 'rowOf', 'listView', 'tallyOf', 'draw')
START = cite("on('command.run'")
CLOSE = cite("on('ui.close'")
REFRESH = cite('refreshRows', 'result')
CLEAR = cite('clearRows', 'result')

# ---- scenarios: one fixture world each; the reset command names it in its reply
j.scenario('normal', '4 items. One failed, one warns.', 'list-normal', 'Data')
j.scenario('empty', 'No items.', 'list-empty', 'Data')
j.scenario('overflow', '60 items: more than the window of a 45-row dock.', 'list-overflow', 'Data')

# ---- nodes: every row draws <mark> <tag> <title>; this domain has a mark (✓ ! ✕) and no tag
HINT = 'Hints "r: refresh · c: clear" and "Esc to close".'
j.node('list-normal', 'list', 'List, 4 items', f'Bold "4 items", the tally "✕ 1  ! 1", 4 Text rows with a glyph for each state, the age at the right. {HINT}',
       'normal', '4 items && ✓ Call the vendor about && r: refresh && c: clear', f'{START}, {LIST}')
j.node('list-normal-cleared', 'list', 'List after a clear', 'Bold "0 items", dim "No items yet", the notice "✓ Cleared" for 5 s, hint "r: refresh".',
       'normal', 'No items yet && r: refresh', cite('clearRows', 'draw'))
j.node('list-normal-refreshed', 'list', 'List after a refresh', 'The same rows; the notice "✓ Read again" shows for 5 s.',
       'normal', '4 items && ✓ Call the vendor about && Read again', REFRESH)
j.node('list-empty', 'list', 'Empty list', 'Bold "0 items", dim "No items yet", hints "r: refresh" and "Esc to close".',
       'empty', 'No items yet && r: refresh', cite("on('ui.render', { component: 'Pane'", 'draw'))
j.twin('list-normal', 'list-empty-reloaded', 'empty', title='List after a refresh of the empty list')
j.node('list-overflow', 'list', 'List, 60 items', '"60 items", the newest rows only, a dim "↑ N more" line above them.',
       'overflow', '60 items && ↑ && ✓ Call the vendor about', LIST)
j.twin('list-normal-cleared', 'list-overflow-cleared', 'overflow', title='List after a clear of 60 items')
j.twin('list-normal-refreshed', 'list-overflow-refreshed', 'overflow', title='List after a refresh of 60 items',
       marker='4 items && ✓ Call the vendor about && Read again')
CLOSED = 'Scenario C && !4 items && !No items yet'
j.node('pane-closed', 'screen', 'Pane closed', 'No pane; the transcript shows the reply of the reset command.',
       'normal', CLOSED, f'{CLOSE}, {START}', region='screen')

# ---- exact edges
j.edge('list-normal', 'list-normal-cleared', 'c', 'Clear the rows', CLEAR)
j.edge('list-normal', 'list-normal-refreshed', 'r', 'Read the rows again', REFRESH)
j.edge('list-empty', 'list-empty-reloaded', 'r', 'Read the rows again: the empty list shows the rows', REFRESH)
j.edge('list-overflow', 'list-overflow-cleared', 'c', 'Clear the rows', CLEAR)
j.edge('list-overflow', 'list-overflow-refreshed', 'r', 'Read the rows again: the fixture store holds 4 rows', REFRESH)
j.edge('list-normal', 'pane-closed', 'Escape', 'Close the pane', CLOSE)
j.edge('pane-closed', 'list-normal', 'text:"/{mod}" Enter', 'Reopen with no argument: the state is kept', START, scn='normal', history=True)

# ---- approximate edges: the same keys from every other list screen
OTHER = ['list-normal-cleared', 'list-normal-refreshed', 'list-empty', 'list-empty-reloaded', 'list-overflow', 'list-overflow-cleared', 'list-overflow-refreshed']
j.fan(['list-normal-refreshed', 'list-empty-reloaded', 'list-overflow-refreshed'], 'c', 'list-normal-cleared', 'Clear the rows', CLEAR, check='No items yet')
j.fan(['list-normal-refreshed', 'list-empty-reloaded', 'list-overflow-refreshed'], 'r', 'list-normal-refreshed', 'Read the rows again', REFRESH, check='4 items && ✓ Call the vendor about')
j.fan(['list-normal-cleared', 'list-overflow-cleared'], 'r', 'list-normal-refreshed', 'Read the rows again', REFRESH, check='4 items && ✓ Call the vendor about')
j.fan(OTHER, 'Escape', 'pane-closed', 'Close the pane', CLOSE, check='Scenario C && !4 items && !No items yet', approx='Same closed pane; the scenario differs.')

# ---- source lines with no screen of their own: the lines that end in an @skip: comment (scripts/audit-handlers.py)
j.auto_skips()
sys.exit(j.write(sys.argv[1] if len(sys.argv) > 1 else 'journey.json'))
