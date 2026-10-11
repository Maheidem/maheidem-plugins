# command.journey.py: the storyboard journey of templates/command, for the default domain
# (items with a text; the part command; the two scenarios of the kind).
# A worked example of scripts/journey_build.py for a mod with no pane: every node has region 'screen' and its marker is the
# output row of the command. mods.py domain writes the journey of your domain for you.
# Edit a copy only for a screen that the schema does not hold, and put it in <wb>/journey.local.py.
#   python3 -I command.journey.py <out journey.json> [<skill dir>]
# It writes the journey and runs journey-lint.py. A source cite names the code by symbol: j.cite('outputView')
# gives 'hooks/views.tsx:<a>-<b> (outputView)' from the file as it is now. A source line with no screen of its own
# ends in an @skip: comment: j.auto_skips() waives it in the audit.
# The audit skips hooks/kit/ (the copied kit). Live proof: mods.py live and crawl of a renamed copy (references/storyboard.md 9).
# A role deny runs the probe through the guard: its node holds the text "Refused".
import os
import sys

SKILL = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.claude/skills/claude-code-mods')
sys.path.insert(0, os.path.join(SKILL, 'scripts'))
sys.dont_write_bytecode = True  # no __pycache__ in the skill scripts folder
from journey_build import Journey  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
j = Journey(
    'command-demo · design A storyboard',
    notes=('No pane. The command answers with text: the first line names the scenario (dim), then the head of the history and one line for each row. '
           'The output row is the marker of a node. The engine puts the name of the command before the first line. '
           'Not in the storyboard: a bad argument (a usage line), and the engine dialog.'),
    crawl={'command': '/{mod} A {scenario}', 'clearScenarios': ['normal', 'empty']},
    mod_dir=os.path.join(HERE, 'command-demo'),
)
cite = j.cite

RUN = cite("on('command.run'", 'outputView')
ROW = cite("on('ui.render', { component: 'CommandOutput'", 'outputView', 'toneOf')

# ---- scenarios: one fixture world each; the reset command names it in its reply
j.scenario('normal', 'Two items: the command lists them.', 'output-normal')
j.scenario('empty', 'No items: the command says so.', 'output-empty')

# ---- nodes: the output row of the command
j.node('output-normal', 'screen', 'The command lists the items', 'Dim "Scenario A normal", the head "Last 5 items:", then "1. <item>" and "2. <item>".',
       'normal', 'Scenario A normal && Last 5 items: && 1. Call the vendor about && 2. Fix the flaky login test', f'{RUN}, {ROW}', region='screen')
j.node('output-empty', 'screen', 'The command says no items', 'Dim "Scenario A empty", then "No items yet".',
       'empty', 'Scenario A empty && No items yet', f'{RUN}, {ROW}', region='screen')

# ---- exact edges: the other scenario, started from the prompt
j.edge('output-normal', 'output-empty', 'text:"/{mod} A empty" Enter', 'Run the empty scenario', RUN)
j.edge('output-empty', 'output-normal', 'text:"/{mod} A normal" Enter', 'Run the normal scenario', RUN)

# ---- source lines with no screen of their own: the lines that end in an @skip: comment (scripts/audit-handlers.py)
j.auto_skips()
sys.exit(j.write(sys.argv[1] if len(sys.argv) > 1 else 'journey.json'))
