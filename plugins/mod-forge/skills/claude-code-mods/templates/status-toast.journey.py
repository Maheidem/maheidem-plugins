# status-toast.journey.py: the storyboard journey of templates/status-toast, for the default domain
# (events with a text; the part toast only; the one scenario of the kind).
# A worked example of scripts/journey_build.py for a mod with no pane: every node has region 'screen'
# and its marker is the transcript line that the mod logs (the toast holds the same text). mods.py domain writes the journey of
# your domain for you. Edit a copy only for a screen that the schema does not hold, and put it in <wb>/journey.local.py.
#   python3 -I status-toast.journey.py <out journey.json> [<skill dir>]
# It writes the journey and runs journey-lint.py. A source cite names the code by symbol: j.cite("on('command.run'")
# gives 'hooks/register.tsx:<a>-<b> (on('command.run')' from the file as it is now. A source line with no screen of its own
# ends in an @skip: comment: j.auto_skips() waives it in the audit.
# The audit skips hooks/kit/ (the copied kit). Live proof: mods.py live and crawl of a renamed copy (references/storyboard.md 9).
# A part command adds the history lines to the reply. A role deny runs the probe through the guard: its node holds the text "Refused".
import os
import sys

SKILL = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.claude/skills/claude-code-mods')
sys.path.insert(0, os.path.join(SKILL, 'scripts'))
sys.dont_write_bytecode = True  # no __pycache__ in the skill scripts folder
from journey_build import Journey  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
j = Journey(
    'status-toast · design A storyboard',
    notes=('No pane. The mod logs one transcript line for each row, and shows the same text as a toast (about 4 s). '
           'The reset command sends the fixture rows of the scenario to the mod, as an event would. '
           'The marker of a node is the transcript line (it stays). '
           'Not in the storyboard: the toast alone (it leaves after about 4 s), a bad argument (a usage line), and the engine dialog.'),
    crawl={'command': '/{mod} A {scenario}', 'clearScenarios': ['normal']},
    mod_dir=os.path.join(HERE, 'status-toast'),
)
cite = j.cite

RUN = cite("on('command.run'")

# ---- scenarios: one fixture world each; the reset command names it in its reply
j.scenario('normal', 'One event: the mod says its row.', 'toast-normal')

# ---- nodes: the screens with no pane
j.node('toast-normal', 'screen', 'An event arrived', 'Transcript line with the text of the row, the same text as a toast at the top right.',
       'normal', 'Scenario A normal && Call the vendor about the invoice before Friday', RUN, region='screen')

# ---- exact edges: the scenario again, started from the prompt (a scenario that is alone loops on itself)
j.edge('toast-normal', 'toast-normal', 'text:"/{mod} A normal" Enter', 'Run the scenario again', RUN, check='Scenario A normal && Call the vendor about the invoice before Friday')

# ---- source lines with no screen of their own: the lines that end in an @skip: comment (scripts/audit-handlers.py)
j.auto_skips()
sys.exit(j.write(sys.argv[1] if len(sys.argv) > 1 else 'journey.json'))
