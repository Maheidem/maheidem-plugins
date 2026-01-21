---
description: "List all Ralph Loops in project"
allowed-tools: ["Bash(pwsh -NoProfile -Command *)"]
---

# List Ralph Loops (v2.0.0)

Shows all Ralph loops in the current project with their status.

## Status Types

- **MINE**: This session owns the loop
- **ORPHANED**: Loop has no owner (unclaimed)
- **OTHER**: Owned by another session

## Instructions

Run the following PowerShell command via Bash:

```powershell
pwsh -NoProfile -Command "
$StateFiles = Get-ChildItem '.claude/ralph-loop-*.local.md' -ErrorAction SilentlyContinue

if (-not $StateFiles -or $StateFiles.Count -eq 0) {
    Write-Output 'NO_LOOPS: No Ralph loops found in this project.'
    Write-Output ''
    Write-Output 'To start a new loop:'
    Write-Output '  /ralph-loop-windows:ralph-loop \"Your task\" --max-iterations 20'
    Write-Output '  /ralph-loop-windows:start-loop \"Your task\"'
    exit 0
}

Write-Output 'RALPH LOOPS IN PROJECT'
Write-Output '======================'
Write-Output ''

foreach ($File in $StateFiles) {
    $Content = Get-Content $File.FullName -Raw

    # Parse fields
    $LoopId = 'unknown'
    $SessionId = ''
    $Iteration = '?'
    $MaxIterations = '0'
    $CompletionPromise = 'null'
    $StartedAt = 'unknown'
    $Active = $false

    if ($Content -match 'loop_id:\s*\"?([a-f0-9]+)\"?') { $LoopId = $Matches[1] }
    if ($Content -match 'session_id:\s*\"?([^\"]*)\"?') { $SessionId = $Matches[1].Trim() }
    if ($Content -match 'iteration:\s*(\d+)') { $Iteration = $Matches[1] }
    if ($Content -match 'max_iterations:\s*(\d+)') { $MaxIterations = $Matches[1] }
    if ($Content -match 'completion_promise:\s*\"?([^\"]+)\"?') { $CompletionPromise = $Matches[1] }
    if ($Content -match 'started_at:\s*\"?([^\"]+)\"?') { $StartedAt = $Matches[1] }
    if ($Content -match 'active:\s*(true|false)') { $Active = $Matches[1] -eq 'true' }

    # Determine status
    if ([string]::IsNullOrEmpty($SessionId)) {
        $Status = 'ORPHANED'
    } else {
        # We don't know our session ID here, so mark as OWNED
        $Status = 'OWNED'
    }

    # Format max iterations display
    if ($MaxIterations -eq '0') {
        $MaxDisplay = 'unlimited'
    } else {
        $MaxDisplay = $MaxIterations
    }

    # Format completion promise display
    if ($CompletionPromise -eq 'null' -or [string]::IsNullOrEmpty($CompletionPromise)) {
        $PromiseDisplay = 'none'
    } else {
        $PromiseDisplay = $CompletionPromise
    }

    # Extract prompt (first 60 chars)
    if ($Content -match '(?s)^---\r?\n.+?\r?\n---\r?\n(.+)$') {
        $Prompt = $Matches[1].Trim()
        if ($Prompt.Length -gt 60) {
            $Prompt = $Prompt.Substring(0, 57) + '...'
        }
    } else {
        $Prompt = '(no prompt found)'
    }

    # Check for journal
    $JournalPath = \".claude/ralph-journal-$LoopId.md\"
    $HasJournal = Test-Path $JournalPath

    Write-Output \"Loop: $LoopId\"
    Write-Output \"  Status:     $Status\"
    Write-Output \"  Active:     $Active\"
    Write-Output \"  Iteration:  $Iteration / $MaxDisplay\"
    Write-Output \"  Promise:    $PromiseDisplay\"
    Write-Output \"  Started:    $StartedAt\"
    Write-Output \"  Journal:    $(if ($HasJournal) { 'Yes' } else { 'No' })\"
    Write-Output \"  Prompt:     $Prompt\"
    Write-Output ''
}

Write-Output '----------------------'
Write-Output 'Commands:'
Write-Output '  Cancel a loop:  /ralph-loop-windows:cancel-ralph <loop_id>'
Write-Output '  Start new loop: /ralph-loop-windows:ralph-loop \"task\" --max-iterations N'
"
```

Then format and present the output to the user in a clear, readable format.

## Output Interpretation

- **NO_LOOPS**: No Ralph loops are active. Suggest how to start one.
- **RALPH LOOPS IN PROJECT**: Display the formatted list of all loops.

## Additional Context

For loops marked as **ORPHANED**:
- These loops have no owning session
- The next session to try to exit will claim them
- They can be explicitly cancelled with `/cancel-ralph <loop_id>`

For loops marked as **OWNED**:
- These are claimed by a session
- Only the owning session's stop hook will block exit for them
- Can still be cancelled manually with `/cancel-ralph <loop_id>`
