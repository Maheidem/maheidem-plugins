---
description: "View Council configuration and test tool connectivity"
argument-hint: "[--test]"
---

# Council Status Command

Shows current Council configuration and optionally tests each enabled tool.

## Step 1: Check Configuration Exists

```bash
CONFIG_FILE="$HOME/.claude/council.local.md"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "not_initialized"
else
    echo "initialized"
fi
```

**If not initialized**: Prompt user to run `/council:setup` first.

## Step 2: Read Configuration

Read `~/.claude/council.local.md` and parse the YAML frontmatter to extract:
- `enabled_tools` with their paths and status
- `default_mode`
- `thorough_settings`
- `display` preferences

## Step 3: Display Status

Present a clear status summary:

```
🤝 Council Status
═══════════════════════════════════════════════════════

📋 Configuration: ~/.claude/council.local.md

📌 Enabled Tools:
┌──────────┬─────────┬──────────────────────────┬─────────┐
│ Tool     │ Status  │ Path                     │ Timeout │
├──────────┼─────────┼──────────────────────────┼─────────┤
│ codex    │ ✅      │ /opt/homebrew/bin/codex  │ 120s    │
│ gemini   │ ✅      │ /opt/homebrew/bin/gemini │ 120s    │
│ opencode │ ❌      │ (disabled)               │ -       │
└──────────┴─────────┴──────────────────────────┴─────────┘

⚙️ Settings:
   Default mode: quick
   Max rounds (thorough): 3
   Show raw responses: yes
   Show timing: yes

🔒 Safety: All tools use READ-ONLY mode
```

## Step 4: Connectivity Test (if --test)

If `--test` flag provided, test each enabled tool:

```bash
for tool in codex gemini; do
    echo "Testing $tool..."
    "${CLAUDE_PLUGIN_ROOT}/scripts/invoke-cli.sh" "$tool" "Say 'OK' if you can hear me" "." "30"
done
```

Report results:

```
🧪 Connectivity Test
┌──────────┬────────────┬─────────┐
│ Tool     │ Status     │ Time    │
├──────────┼────────────┼─────────┤
│ codex    │ ✅ OK      │ 2.3s    │
│ gemini   │ ✅ OK      │ 1.8s    │
└──────────┴────────────┴─────────┘

All tools responding!
```

Or if failures:

```
🧪 Connectivity Test
┌──────────┬─────────────────────────┬─────────┐
│ Tool     │ Status                  │ Time    │
├──────────┼─────────────────────────┼─────────┤
│ codex    │ ✅ OK                   │ 2.3s    │
│ gemini   │ ❌ Timeout after 30s    │ -       │
└──────────┴─────────────────────────┴─────────┘

⚠️ Some tools not responding. Consider:
- Check API keys are configured
- Run /council:setup --force to reconfigure
```

## Step 5: Show Quick Help

```
📖 Quick Reference:
   /council "question"           Query all enabled tools
   /council --thorough "q"       Multi-round debate mode
   /council --tools=codex "q"    Query specific tools only
   /council:setup --force        Reconfigure tools
```
