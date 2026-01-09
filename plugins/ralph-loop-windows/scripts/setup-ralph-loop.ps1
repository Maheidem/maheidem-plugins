#!/usr/bin/env pwsh

# Ralph Loop Setup Script (Windows PowerShell version)
# Creates state file for in-session Ralph loop

$ErrorActionPreference = 'Stop'

# Parse arguments
$PromptParts = @()
$MaxIterations = 0
$CompletionPromise = "null"

$i = 0
:argloop while ($i -lt $args.Count) {
    $arg = $args[$i]

    switch ($arg) {
        { $_ -in '-h', '--help' } {
            @"
Ralph Loop - Interactive self-referential development loop

USAGE:
  /ralph-loop [PROMPT...] [OPTIONS]

ARGUMENTS:
  PROMPT...    Initial prompt to start the loop (can be multiple words without quotes)

OPTIONS:
  --max-iterations <n>           Maximum iterations before auto-stop (default: unlimited)
  --completion-promise '<text>'  Promise phrase (USE QUOTES for multi-word)
  -h, --help                     Show this help message

DESCRIPTION:
  Starts a Ralph loop in your CURRENT session. The stop hook prevents
  exit and feeds your output back as input until completion or iteration limit.

  To signal completion, you must output: <promise>YOUR_PHRASE</promise>

  Use this for:
  - Interactive iteration where you want to see progress
  - Tasks requiring self-correction and refinement
  - Learning how Ralph works

EXAMPLES:
  /ralph-loop Build a todo API --completion-promise 'DONE' --max-iterations 20
  /ralph-loop --max-iterations 10 Fix the auth bug
  /ralph-loop Refactor cache layer  (runs forever)
  /ralph-loop --completion-promise 'TASK COMPLETE' Create a REST API

STOPPING:
  Only by reaching --max-iterations or detecting --completion-promise
  No manual stop - Ralph runs infinitely by default!

MONITORING:
  # View current iteration:
  Select-String '^iteration:' .claude/ralph-loop.local.md

  # View full state:
  Get-Content .claude/ralph-loop.local.md -Head 10
"@
            exit 0
        }
        '--max-iterations' {
            $i++
            if ($i -ge $args.Count -or [string]::IsNullOrEmpty($args[$i])) {
                Write-Error @"
Error: --max-iterations requires a number argument

   Valid examples:
     --max-iterations 10
     --max-iterations 50
     --max-iterations 0  (unlimited)

   You provided: --max-iterations (with no number)
"@
                exit 1
            }
            $value = $args[$i]
            if ($value -notmatch '^\d+$') {
                Write-Error @"
Error: --max-iterations must be a positive integer or 0, got: $value

   Valid examples:
     --max-iterations 10
     --max-iterations 50
     --max-iterations 0  (unlimited)

   Invalid: decimals (10.5), negative numbers (-5), text
"@
                exit 1
            }
            $MaxIterations = [int]$value
            $i++
            continue argloop
        }
        '--completion-promise' {
            $i++
            if ($i -ge $args.Count -or [string]::IsNullOrEmpty($args[$i])) {
                Write-Error @"
Error: --completion-promise requires a text argument

   Valid examples:
     --completion-promise 'DONE'
     --completion-promise 'TASK COMPLETE'
     --completion-promise 'All tests passing'

   You provided: --completion-promise (with no text)

   Note: Multi-word promises must be quoted!
"@
                exit 1
            }
            $CompletionPromise = $args[$i]
            $i++
            continue argloop
        }
        default {
            # Non-option argument - collect as prompt part
            $PromptParts += $arg
            $i++
            continue argloop
        }
    }
}

# Join all prompt parts with spaces
$Prompt = $PromptParts -join ' '

# Validate prompt is non-empty
if ([string]::IsNullOrWhiteSpace($Prompt)) {
    Write-Error @"
Error: No prompt provided

   Ralph needs a task description to work on.

   Examples:
     /ralph-loop Build a REST API for todos
     /ralph-loop Fix the auth bug --max-iterations 20
     /ralph-loop --completion-promise 'DONE' Refactor code

   For all options: /ralph-loop --help
"@
    exit 1
}

# Create state file directory
if (-not (Test-Path '.claude')) {
    New-Item -ItemType Directory -Path '.claude' -Force | Out-Null
}

# Quote completion promise for YAML if it contains special chars or is not null
if (-not [string]::IsNullOrEmpty($CompletionPromise) -and $CompletionPromise -ne 'null') {
    $CompletionPromiseYaml = "`"$CompletionPromise`""
} else {
    $CompletionPromiseYaml = 'null'
}

# Get UTC timestamp
$StartedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

# Create state file with YAML frontmatter
$StateContent = @"
---
active: true
iteration: 1
max_iterations: $MaxIterations
completion_promise: $CompletionPromiseYaml
started_at: "$StartedAt"
---

$Prompt
"@

Set-Content -Path '.claude/ralph-loop.local.md' -Value $StateContent -NoNewline

# Output setup message
$MaxIterationsDisplay = if ($MaxIterations -gt 0) { $MaxIterations } else { 'unlimited' }
$CompletionPromiseDisplay = if ($CompletionPromise -ne 'null') {
    "$($CompletionPromise -replace '"', '') (ONLY output when TRUE - do not lie!)"
} else {
    'none (runs forever)'
}

@"
Ralph loop activated in this session!

Iteration: 1
Max iterations: $MaxIterationsDisplay
Completion promise: $CompletionPromiseDisplay

The stop hook is now active. When you try to exit, the SAME PROMPT will be
fed back to you. You'll see your previous work in files, creating a
self-referential loop where you iteratively improve on the same task.

To monitor: Get-Content .claude/ralph-loop.local.md -Head 10

WARNING: This loop cannot be stopped manually! It will run infinitely
    unless you set --max-iterations or --completion-promise.

"@

# Output the initial prompt
if (-not [string]::IsNullOrWhiteSpace($Prompt)) {
    Write-Output ""
    Write-Output $Prompt
}

# Display completion promise requirements if set
if ($CompletionPromise -ne 'null') {
    @"

===============================================================
CRITICAL - Ralph Loop Completion Promise
===============================================================

To complete this loop, output this EXACT text:
  <promise>$CompletionPromise</promise>

STRICT REQUIREMENTS (DO NOT VIOLATE):
  Use <promise> XML tags EXACTLY as shown above
  The statement MUST be completely and unequivocally TRUE
  Do NOT output false statements to exit the loop
  Do NOT lie even if you think you should exit

IMPORTANT - Do not circumvent the loop:
  Even if you believe you're stuck, the task is impossible,
  or you've been running too long - you MUST NOT output a
  false promise statement. The loop is designed to continue
  until the promise is GENUINELY TRUE. Trust the process.

  If the loop should stop, the promise statement will become
  true naturally. Do not force it by lying.
===============================================================
"@
}
