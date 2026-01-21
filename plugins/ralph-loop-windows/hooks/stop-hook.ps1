#!/usr/bin/env pwsh

# Ralph Wiggum Stop Hook (Windows PowerShell version) v2.1.0
# Session-ownership model: scans for loops, claims unclaimed ones, handles owned loops
# Prevents session exit when a ralph-loop owned by THIS session is active

$ErrorActionPreference = 'Stop'

# Read hook input from stdin (advanced stop hook API)
$HookInput = $input | Out-String

# Parse hook input JSON to get session_id
try {
    $HookData = $HookInput | ConvertFrom-Json
    $MySession = $HookData.session_id
    $TranscriptPath = $HookData.transcript_path
} catch {
    # If we can't parse hook input, allow exit
    exit 0
}

# Validate we have a session ID
if ([string]::IsNullOrEmpty($MySession)) {
    # No session ID - allow exit
    exit 0
}

# Scan for all Ralph loop state files
$StateFiles = Get-ChildItem -Path '.claude/ralph-loop-*.local.md' -ErrorAction SilentlyContinue

if (-not $StateFiles -or $StateFiles.Count -eq 0) {
    # No active loops - allow exit
    exit 0
}

# Track which loop (if any) belongs to this session
$MyLoop = $null
$MyLoopPath = $null

foreach ($StateFile in $StateFiles) {
    $StateContent = Get-Content $StateFile.FullName -Raw

    # Parse markdown frontmatter (YAML between ---)
    if ($StateContent -notmatch '(?s)^---\r?\n(.+?)\r?\n---') {
        # Invalid format - skip this file
        continue
    }

    $Frontmatter = $Matches[1]

    # Parse session_id from frontmatter
    $SessionId = ''
    $LoopId = ''
    $Active = $false

    foreach ($line in $Frontmatter -split '\r?\n') {
        if ($line -match '^session_id:\s*"?([^"]*)"?') {
            $SessionId = $Matches[1].Trim()
        }
        elseif ($line -match '^loop_id:\s*"?([^"]*)"?') {
            $LoopId = $Matches[1].Trim()
        }
        elseif ($line -match '^active:\s*(true|false)') {
            $Active = $Matches[1] -eq 'true'
        }
    }

    # Skip inactive loops
    if (-not $Active) {
        continue
    }

    # Check ownership
    if ([string]::IsNullOrEmpty($SessionId)) {
        # UNCLAIMED LOOP - Claim it!
        $UpdatedContent = $StateContent -replace 'session_id:\s*""', "session_id: `"$MySession`""
        Set-Content -Path $StateFile.FullName -Value $UpdatedContent -NoNewline

        # This is now my loop
        $MyLoop = @{
            Path = $StateFile.FullName
            Content = $UpdatedContent
            LoopId = $LoopId
        }
        $MyLoopPath = $StateFile.FullName
        break
    }
    elseif ($SessionId -eq $MySession) {
        # OWNED BY ME
        $MyLoop = @{
            Path = $StateFile.FullName
            Content = $StateContent
            LoopId = $LoopId
        }
        $MyLoopPath = $StateFile.FullName
        break
    }
    # else: Owned by another session - skip
}

# If no loop belongs to this session, allow exit
if (-not $MyLoop) {
    exit 0
}

# We have a loop - handle it
$StateContent = $MyLoop.Content
$LoopId = $MyLoop.LoopId
$JournalPath = ".claude/ralph-journal-$LoopId.md"

# Re-parse full state from our loop
if ($StateContent -notmatch '(?s)^---\r?\n(.+?)\r?\n---') {
    Write-Host "Ralph loop: State file has invalid format"
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

$Frontmatter = $Matches[1]

# Parse YAML values from frontmatter
$Iteration = 0
$MaxIterations = 0
$CompletionPromise = 'null'
$StuckCount = 0
$LastFileHash = ''

foreach ($line in $Frontmatter -split '\r?\n') {
    if ($line -match '^iteration:\s*(\d+)') {
        $Iteration = [int]$Matches[1]
    }
    elseif ($line -match '^max_iterations:\s*(\d+)') {
        $MaxIterations = [int]$Matches[1]
    }
    elseif ($line -match '^completion_promise:\s*"?([^"]*)"?') {
        $CompletionPromise = $Matches[1]
    }
    elseif ($line -match '^stuck_count:\s*(\d+)') {
        $StuckCount = [int]$Matches[1]
    }
    elseif ($line -match '^last_file_hash:\s*"?([^"]*)"?') {
        $LastFileHash = $Matches[1].Trim()
    }
}

# Validate numeric fields
if ($Iteration -eq 0 -and $StateContent -notmatch 'iteration:\s*0') {
    Write-Host "Ralph loop [$LoopId]: State file corrupted" -ForegroundColor Yellow
    Write-Host "   File: $MyLoopPath"
    Write-Host "   Problem: 'iteration' field is not a valid number"
    Write-Host ""
    Write-Host "   This usually means the state file was manually edited or corrupted."
    Write-Host "   Ralph loop is stopping. Run /ralph-loop again to start fresh."
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

# Check if max iterations reached
if ($MaxIterations -gt 0 -and $Iteration -ge $MaxIterations) {
    Write-Host "Ralph loop [$LoopId]: Max iterations ($MaxIterations) reached."
    Remove-Item $MyLoopPath -Force
    # Keep journal for reference
    exit 0
}

# Validate transcript path
if (-not (Test-Path $TranscriptPath)) {
    Write-Host "Ralph loop [$LoopId]: Transcript file not found" -ForegroundColor Yellow
    Write-Host "   Expected: $TranscriptPath"
    Write-Host "   This is unusual and may indicate a Claude Code internal issue."
    Write-Host "   Ralph loop is stopping."
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

# Read transcript (JSONL format - one JSON per line)
$TranscriptLines = Get-Content $TranscriptPath

# Find all assistant messages
$AssistantLines = $TranscriptLines | Where-Object { $_ -match '"role"\s*:\s*"assistant"' }

if (-not $AssistantLines -or $AssistantLines.Count -eq 0) {
    Write-Host "Ralph loop [$LoopId]: No assistant messages found in transcript" -ForegroundColor Yellow
    Write-Host "   Transcript: $TranscriptPath"
    Write-Host "   This is unusual and may indicate a transcript format issue"
    Write-Host "   Ralph loop is stopping."
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

# Get last assistant message
$LastLine = $AssistantLines | Select-Object -Last 1

if ([string]::IsNullOrEmpty($LastLine)) {
    Write-Host "Ralph loop [$LoopId]: Failed to extract last assistant message" -ForegroundColor Yellow
    Write-Host "   Ralph loop is stopping."
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

# Parse JSON and extract text content
try {
    $MessageData = $LastLine | ConvertFrom-Json
    $TextContents = $MessageData.message.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
    $LastOutput = $TextContents -join "`n"
} catch {
    Write-Host "Ralph loop [$LoopId]: Failed to parse assistant message JSON" -ForegroundColor Yellow
    Write-Host "   Error: $_"
    Write-Host "   This may indicate a transcript format issue"
    Write-Host "   Ralph loop is stopping."
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($LastOutput)) {
    Write-Host "Ralph loop [$LoopId]: Assistant message contained no text content" -ForegroundColor Yellow
    Write-Host "   Ralph loop is stopping."
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

# Check for completion promise (only if set)
if ($CompletionPromise -ne 'null' -and -not [string]::IsNullOrEmpty($CompletionPromise)) {
    # Extract text from <promise> tags using regex
    # (?s) makes . match newlines, .*? is non-greedy
    if ($LastOutput -match '(?s)<promise>(.*?)</promise>') {
        $PromiseText = $Matches[1].Trim() -replace '\s+', ' '

        # Literal string comparison
        if ($PromiseText -eq $CompletionPromise) {
            Write-Host "Ralph loop [$LoopId]: Detected <promise>$CompletionPromise</promise>"
            Remove-Item $MyLoopPath -Force
            # Keep journal for reference
            exit 0
        }
    }
}

# === STUCK DETECTION ===
# Compute current state hash (what files changed since last commit)
$GitDiff = git diff --stat 2>$null
if ($GitDiff) {
    $CurrentHash = [System.BitConverter]::ToString(
        [System.Security.Cryptography.MD5]::Create().ComputeHash(
            [System.Text.Encoding]::UTF8.GetBytes($GitDiff -join "`n")
        )
    ).Replace("-", "").ToLower()
} else {
    $CurrentHash = "no-changes"
}

# Compare with previous hash
if ($LastFileHash -and $CurrentHash -eq $LastFileHash) {
    $StuckCount++
} else {
    $StuckCount = 0  # Progress made, reset
}

# Build stuck warning if stuck for 2+ iterations
$StuckWarning = ''
if ($StuckCount -ge 2) {
    $StuckWarning = " | STUCK: No file changes for $StuckCount iterations - try a DIFFERENT approach!"
}

# Not complete - continue loop with SAME PROMPT
$NextIteration = $Iteration + 1

# Extract prompt (everything after the closing ---)
# Match content after the second ---
if ($StateContent -match '(?s)^---\r?\n.+?\r?\n---\r?\n(.+)$') {
    $PromptText = $Matches[1].Trim()
} else {
    Write-Host "Ralph loop [$LoopId]: State file corrupted or incomplete" -ForegroundColor Yellow
    Write-Host "   File: $MyLoopPath"
    Write-Host "   Problem: No prompt text found"
    Write-Host ""
    Write-Host "   This usually means:"
    Write-Host "     - State file was manually edited"
    Write-Host "     - File was corrupted during writing"
    Write-Host ""
    Write-Host "   Ralph loop is stopping. Run /ralph-loop again to start fresh."
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($PromptText)) {
    Write-Host "Ralph loop [$LoopId]: No prompt text found in state file" -ForegroundColor Yellow
    Remove-Item $MyLoopPath -Force
    if (Test-Path $JournalPath) { Remove-Item $JournalPath -Force }
    exit 0
}

# Update iteration and stuck detection fields in state file
$UpdatedContent = $StateContent -replace 'iteration:\s*\d+', "iteration: $NextIteration"
$UpdatedContent = $UpdatedContent -replace 'stuck_count:\s*\d+', "stuck_count: $StuckCount"
$UpdatedContent = $UpdatedContent -replace 'last_file_hash:\s*"[^"]*"', "last_file_hash: `"$CurrentHash`""
Set-Content -Path $MyLoopPath -Value $UpdatedContent -NoNewline

# Append to journal file
$JournalEntry = @"

## Iteration $Iteration - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

_Iteration completed. Review files and continue with the task._

---
"@

if (Test-Path $JournalPath) {
    Add-Content -Path $JournalPath -Value $JournalEntry
}

# Build system message with iteration count, loop ID, completion promise info, and stuck warning
if ($CompletionPromise -ne 'null' -and -not [string]::IsNullOrEmpty($CompletionPromise)) {
    $SystemMsg = "Ralph iteration $NextIteration [Loop: $LoopId] | Journal: $JournalPath | To stop: output <promise>$CompletionPromise</promise> (ONLY when statement is TRUE - do not lie to exit!)$StuckWarning"
} else {
    $SystemMsg = "Ralph iteration $NextIteration [Loop: $LoopId] | Journal: $JournalPath | No completion promise set - loop runs infinitely$StuckWarning"
}

# Output JSON to block the stop and feed prompt back
$OutputObject = @{
    decision = 'block'
    reason = $PromptText
    systemMessage = $SystemMsg
}

$OutputObject | ConvertTo-Json -Compress

# Exit 0 for successful hook execution
exit 0
