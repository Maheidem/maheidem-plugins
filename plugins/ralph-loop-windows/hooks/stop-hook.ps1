#!/usr/bin/env pwsh

# Ralph Wiggum Stop Hook (Windows PowerShell version)
# Prevents session exit when a ralph-loop is active
# Feeds Claude's output back as input to continue the loop

$ErrorActionPreference = 'Stop'

# Read hook input from stdin (advanced stop hook API)
$HookInput = $input | Out-String

# Check if ralph-loop is active
$RalphStateFile = '.claude/ralph-loop.local.md'

if (-not (Test-Path $RalphStateFile)) {
    # No active loop - allow exit
    exit 0
}

# Read and parse state file
$StateContent = Get-Content $RalphStateFile -Raw

# Parse markdown frontmatter (YAML between ---)
# Extract content between first and second ---
if ($StateContent -match '(?s)^---\r?\n(.+?)\r?\n---') {
    $Frontmatter = $Matches[1]
} else {
    Write-Error "Ralph loop: State file has invalid format"
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Parse YAML values from frontmatter
$Iteration = 0
$MaxIterations = 0
$CompletionPromise = 'null'

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
}

# Validate numeric fields
if ($Iteration -eq 0 -and $StateContent -notmatch 'iteration:\s*0') {
    Write-Host "Ralph loop: State file corrupted" -ForegroundColor Yellow
    Write-Host "   File: $RalphStateFile"
    Write-Host "   Problem: 'iteration' field is not a valid number"
    Write-Host ""
    Write-Host "   This usually means the state file was manually edited or corrupted."
    Write-Host "   Ralph loop is stopping. Run /ralph-loop again to start fresh."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Check if max iterations reached
if ($MaxIterations -gt 0 -and $Iteration -ge $MaxIterations) {
    Write-Host "Ralph loop: Max iterations ($MaxIterations) reached."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Get transcript path from hook input
try {
    $HookData = $HookInput | ConvertFrom-Json
    $TranscriptPath = $HookData.transcript_path
} catch {
    Write-Host "Ralph loop: Failed to parse hook input JSON" -ForegroundColor Yellow
    Remove-Item $RalphStateFile -Force
    exit 0
}

if (-not (Test-Path $TranscriptPath)) {
    Write-Host "Ralph loop: Transcript file not found" -ForegroundColor Yellow
    Write-Host "   Expected: $TranscriptPath"
    Write-Host "   This is unusual and may indicate a Claude Code internal issue."
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Read transcript (JSONL format - one JSON per line)
$TranscriptLines = Get-Content $TranscriptPath

# Find all assistant messages
$AssistantLines = $TranscriptLines | Where-Object { $_ -match '"role"\s*:\s*"assistant"' }

if (-not $AssistantLines -or $AssistantLines.Count -eq 0) {
    Write-Host "Ralph loop: No assistant messages found in transcript" -ForegroundColor Yellow
    Write-Host "   Transcript: $TranscriptPath"
    Write-Host "   This is unusual and may indicate a transcript format issue"
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Get last assistant message
$LastLine = $AssistantLines | Select-Object -Last 1

if ([string]::IsNullOrEmpty($LastLine)) {
    Write-Host "Ralph loop: Failed to extract last assistant message" -ForegroundColor Yellow
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Parse JSON and extract text content
try {
    $MessageData = $LastLine | ConvertFrom-Json
    $TextContents = $MessageData.message.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
    $LastOutput = $TextContents -join "`n"
} catch {
    Write-Host "Ralph loop: Failed to parse assistant message JSON" -ForegroundColor Yellow
    Write-Host "   Error: $_"
    Write-Host "   This may indicate a transcript format issue"
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

if ([string]::IsNullOrWhiteSpace($LastOutput)) {
    Write-Host "Ralph loop: Assistant message contained no text content" -ForegroundColor Yellow
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
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
            Write-Host "Ralph loop: Detected <promise>$CompletionPromise</promise>"
            Remove-Item $RalphStateFile -Force
            exit 0
        }
    }
}

# Not complete - continue loop with SAME PROMPT
$NextIteration = $Iteration + 1

# Extract prompt (everything after the closing ---)
# Match content after the second ---
if ($StateContent -match '(?s)^---\r?\n.+?\r?\n---\r?\n(.+)$') {
    $PromptText = $Matches[1].Trim()
} else {
    Write-Host "Ralph loop: State file corrupted or incomplete" -ForegroundColor Yellow
    Write-Host "   File: $RalphStateFile"
    Write-Host "   Problem: No prompt text found"
    Write-Host ""
    Write-Host "   This usually means:"
    Write-Host "     - State file was manually edited"
    Write-Host "     - File was corrupted during writing"
    Write-Host ""
    Write-Host "   Ralph loop is stopping. Run /ralph-loop again to start fresh."
    Remove-Item $RalphStateFile -Force
    exit 0
}

if ([string]::IsNullOrWhiteSpace($PromptText)) {
    Write-Host "Ralph loop: No prompt text found in state file" -ForegroundColor Yellow
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Update iteration in state file
$UpdatedContent = $StateContent -replace 'iteration:\s*\d+', "iteration: $NextIteration"
Set-Content -Path $RalphStateFile -Value $UpdatedContent -NoNewline

# Build system message with iteration count and completion promise info
if ($CompletionPromise -ne 'null' -and -not [string]::IsNullOrEmpty($CompletionPromise)) {
    $SystemMsg = "Ralph iteration $NextIteration | To stop: output <promise>$CompletionPromise</promise> (ONLY when statement is TRUE - do not lie to exit!)"
} else {
    $SystemMsg = "Ralph iteration $NextIteration | No completion promise set - loop runs infinitely"
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
