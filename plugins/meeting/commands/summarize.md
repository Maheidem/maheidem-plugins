---
description: "Summarize a transcription with different styles (action items, brief, minutes, detailed)"
argument-hint: "[FILE] [--style STYLE] [--output PATH]"
---

# Summarize Command

You are executing the `/meeting:summarize` command to create a meeting summary.

## Your Mission

Help the user create a useful summary from a transcription file. Use Claude's capabilities to analyze and summarize.

## Execution Flow

### Step 1: Parse Arguments

Check what the user provided:
- `FILE` - Path to transcription file (.txt, .srt, .vtt, .json)
- `--style` - Summary style (action-items, brief, minutes, detailed)
- `--output` - Custom output path

### Step 2: Interactive Mode (for missing parameters)

**File Selection** (if FILE not provided):
```
Question: "Which transcription do you want to summarize?"
Options:
- Search for recent .txt files
- Search for recent .srt files
- Let me paste a path
```

Look for transcription files:
```bash
find . -maxdepth 2 -name "*.txt" -o -name "*.srt" -o -name "*.vtt" -mtime -7 | head -10
```

**Style Selection** (if --style not provided):
```
Question: "What type of summary do you need?"
Options:
- Action Items (Recommended) - Extract tasks, decisions, and follow-ups
- Brief - 2-3 paragraph overview
- Meeting Minutes - Formal format with structure
- Detailed - Section-by-section breakdown
```

### Step 3: Read Transcription

Read the file content:
```bash
cat "USER_FILE"
```

Handle different formats:
- `.txt` - Read directly
- `.srt/.vtt` - Strip timestamps, extract text
- `.json` - Parse and extract text segments

### Step 4: Generate Summary

Based on selected style, create the appropriate summary:

**Action Items Style:**
```
## Action Items

### Decisions Made
- [List key decisions]

### Tasks Assigned
- [ ] Task 1 - Owner (if mentioned)
- [ ] Task 2 - Owner

### Follow-ups Needed
- [List items requiring follow-up]

### Key Points
- [Main discussion points]
```

**Brief Style:**
```
## Meeting Summary

[2-3 paragraph summary covering main topics, outcomes, and next steps]

**Key Takeaways:**
- Point 1
- Point 2
- Point 3
```

**Meeting Minutes Style:**
```
## Meeting Minutes

**Date:** [If detectable]
**Duration:** [If known]
**Participants:** [If mentioned in transcript]

### Agenda Items Discussed

1. **Topic 1**
   - Discussion summary
   - Decision/outcome

2. **Topic 2**
   - Discussion summary
   - Decision/outcome

### Action Items
- [ ] Item 1
- [ ] Item 2

### Next Steps
- [Future meeting/follow-up plans]
```

**Detailed Style:**
```
## Detailed Meeting Analysis

### Overview
[Comprehensive meeting summary]

### Topic Breakdown

#### Topic 1: [Name]
- **Context:** [Background]
- **Discussion:** [Key points discussed]
- **Outcome:** [Result/decision]

[Repeat for each major topic]

### Sentiment Analysis
- Overall tone: [Positive/Neutral/Concerned]
- Key concerns raised: [If any]

### Recommendations
- [Based on discussion]
```

### Step 5: Output Results

1. Display summary in the chat
2. If `--output` specified, save to file:
```bash
echo "SUMMARY_CONTENT" > "OUTPUT_PATH"
```

Default output naming:
- Input: `meeting.txt`
- Output: `meeting-summary.md`

### Step 6: Offer Next Steps

After generating summary:
```
Summary complete!

Would you like me to:
- Refine any section of this summary
- Export to a different format
- Create a follow-up email draft based on action items
```

## Summary Quality Guidelines

When generating summaries:
- Focus on actionable information
- Identify speakers if labeled in transcript
- Extract dates, deadlines, and commitments
- Note any unresolved questions or concerns
- Keep summaries concise but comprehensive

## Error Handling

| Error | Solution |
|-------|----------|
| File not found | Ask user to verify path |
| Empty file | Report no content to summarize |
| Unreadable format | Try parsing as plain text |
| Very long transcript | Summarize in sections |
