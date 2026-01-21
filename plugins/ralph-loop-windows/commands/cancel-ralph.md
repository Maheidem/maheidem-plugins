---
description: "Cancel active Ralph Loop"
argument-hint: "[loop_id]"
allowed-tools: ["Bash(pwsh -NoProfile -Command *)"]
---

# Cancel Ralph (v2.0.0)

Cancel a Ralph loop. Supports cancelling by loop_id or auto-detecting your session's loop.

## Arguments

- **No argument**: Cancel this session's loop (if any)
- **loop_id**: Cancel a specific loop by its 8-character ID

## Instructions

### Step 1: Parse Arguments

If `$ARGUMENTS` is provided and non-empty, use it as the `loop_id`.
Otherwise, we'll scan for loops owned by this session.

### Step 2: Execute Cancellation

**If loop_id is provided:**

Run via Bash:
```powershell
pwsh -NoProfile -Command "
$LoopId = '$ARGUMENTS'
$StateFile = \".claude/ralph-loop-$LoopId.local.md\"
$JournalFile = \".claude/ralph-journal-$LoopId.md\"

if (-not (Test-Path $StateFile)) {
    Write-Output \"NOT_FOUND: No Ralph loop found with ID: $LoopId\"
    Write-Output ''
    Write-Output 'Available loops:'
    Get-ChildItem '.claude/ralph-loop-*.local.md' -ErrorAction SilentlyContinue | ForEach-Object {
        if (\$_.Name -match 'ralph-loop-([a-f0-9]+)\\.local\\.md') {
            Write-Output \"  - \$(\$Matches[1])\"
        }
    }
    exit 0
}

# Read iteration from file
\$Content = Get-Content $StateFile -Raw
if (\$Content -match 'iteration:\\s*(\\d+)') {
    \$Iteration = \$Matches[1]
} else {
    \$Iteration = '?'
}

Remove-Item $StateFile -Force
Write-Output \"CANCELLED: Ralph loop $LoopId (was at iteration \$Iteration)\"

if (Test-Path $JournalFile) {
    Write-Output \"Journal preserved: $JournalFile\"
}
"
```

**If no loop_id provided:**

Run via Bash:
```powershell
pwsh -NoProfile -Command "
\$StateFiles = Get-ChildItem '.claude/ralph-loop-*.local.md' -ErrorAction SilentlyContinue

if (-not \$StateFiles -or \$StateFiles.Count -eq 0) {
    Write-Output 'NOT_FOUND: No active Ralph loops found.'
    exit 0
}

if (\$StateFiles.Count -eq 1) {
    # Only one loop - cancel it
    \$StateFile = \$StateFiles[0]
    \$Content = Get-Content \$StateFile.FullName -Raw

    if (\$Content -match 'loop_id:\\s*\"?([a-f0-9]+)\"?') {
        \$LoopId = \$Matches[1]
    } else {
        \$LoopId = 'unknown'
    }

    if (\$Content -match 'iteration:\\s*(\\d+)') {
        \$Iteration = \$Matches[1]
    } else {
        \$Iteration = '?'
    }

    Remove-Item \$StateFile.FullName -Force
    Write-Output \"CANCELLED: Ralph loop \$LoopId (was at iteration \$Iteration)\"

    \$JournalFile = \".claude/ralph-journal-\$LoopId.md\"
    if (Test-Path \$JournalFile) {
        Write-Output \"Journal preserved: \$JournalFile\"
    }
} else {
    # Multiple loops - list them
    Write-Output 'MULTIPLE_LOOPS: Found multiple Ralph loops. Please specify which one to cancel:'
    Write-Output ''
    foreach (\$File in \$StateFiles) {
        \$Content = Get-Content \$File.FullName -Raw
        if (\$Content -match 'loop_id:\\s*\"?([a-f0-9]+)\"?') {
            \$LoopId = \$Matches[1]
        } else {
            \$LoopId = 'unknown'
        }
        if (\$Content -match 'iteration:\\s*(\\d+)') {
            \$Iteration = \$Matches[1]
        } else {
            \$Iteration = '?'
        }
        if (\$Content -match 'session_id:\\s*\"?([^\"]*)\"?') {
            \$SessionId = \$Matches[1]
            if ([string]::IsNullOrEmpty(\$SessionId)) {
                \$Status = 'UNCLAIMED'
            } else {
                \$Status = 'OWNED'
            }
        } else {
            \$Status = 'UNKNOWN'
        }
        Write-Output \"  - \$LoopId (iteration \$Iteration, \$Status)\"
    }
    Write-Output ''
    Write-Output 'Usage: /ralph-loop-windows:cancel-ralph <loop_id>'
}
"
```

### Step 3: Report Result

Based on the output:

- **NOT_FOUND**: Say "No active Ralph loop found." (or show available loops if listing them)
- **CANCELLED**: Say "Cancelled Ralph loop [loop_id] (was at iteration N)"
- **MULTIPLE_LOOPS**: Show the list and ask user to specify which loop to cancel
