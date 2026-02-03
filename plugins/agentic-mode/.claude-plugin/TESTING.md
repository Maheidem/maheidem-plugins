# Agentic Mode Plugin - Testing Guide

## Quick Test

```bash
cd plugins/agentic-mode/.claude-plugin
bash run-tests.sh
```

## Test Scenarios

### Scenario 1: Task Tool Always Passes

**Purpose:** Verify Task tool is never blocked (it's the delegation mechanism)

**Test file:** `test-allow-task.json`

```json
{
  "tool_name": "Task",
  "tool_input": {
    "agent": "general-programmer-agent",
    "task": "Update the README file"
  },
  "cwd": "/Users/maheidem/Documents/dev/test-project"
}
```

**Expected behavior:**
- Exit code: 0
- Output: Empty (silent allow)

**Run manually:**
```bash
cat test-allow-task.json | ../hooks/enforce-delegation.sh
echo "Exit code: $?"
```

---

### Scenario 2: Edit Blocked in Main Session

**Purpose:** Verify Edit tool is blocked when config enabled

**Test file:** `test-block-edit.json`

```json
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/path/to/file.py",
    "operation": "replace"
  },
  "cwd": "/path/with/enabled/config",
  "transcript_path": "/Users/maheidem/.claude/sessions/session-123.jsonl",
  "tool_use_id": "toolu_01XYZ789"
}
```

**Expected behavior:**
- Exit code: 0
- Output: JSON with `permissionDecision: "deny"`
- Message: "Use 'general-programmer-agent' for code changes..."

**Run manually:**
```bash
cat test-block-edit.json | ../hooks/enforce-delegation.sh | jq .
```

---

### Scenario 3: Tools Allowed When Config Missing

**Purpose:** Verify hook allows everything when no config exists

**Test file:** `test-allow-disabled.json`

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "ls -la"
  },
  "cwd": "/tmp/no-config-here"
}
```

**Expected behavior:**
- Exit code: 0
- Output: Empty (silent allow)

**Run manually:**
```bash
cat test-allow-disabled.json | ../hooks/enforce-delegation.sh
echo "Exit code: $?"
```

---

### Scenario 4: Subagent Write Allowed

**Purpose:** Verify subagent detection allows all tools

**Test file:** `test-subagent-write.json`

```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/output.txt",
    "content": "Test content"
  },
  "cwd": "/path/with/enabled/config",
  "transcript_path": "/Users/maheidem/.claude/sessions/session-456.jsonl",
  "tool_use_id": "toolu_subagent_ABC"
}
```

**Setup for test:**
```bash
# Create mock subagent transcript with matching tool_use_id
mkdir -p /Users/maheidem/.claude/sessions/session-456/subagents
echo '{"id":"toolu_subagent_ABC","type":"tool_use"}' > \
  /Users/maheidem/.claude/sessions/session-456/subagents/agent-001.jsonl
```

**Expected behavior:**
- Exit code: 0
- Output: Empty (silent allow because it's a subagent)

**Run manually:**
```bash
cat test-subagent-write.json | ../hooks/enforce-delegation.sh
echo "Exit code: $?"
```

---

## Integration Testing

### Test in Real Claude Session

1. **Install plugin:**
   ```bash
   cd /Users/maheidem/Documents/dev/claude-code-management/plugin-development/maheidem-plugins
   claude plugins build plugins/agentic-mode
   claude plugins install plugins/agentic-mode/.claude-plugin
   ```

2. **Create test project:**
   ```bash
   mkdir -p /tmp/agentic-test/.claude
   cd /tmp/agentic-test

   cat > .claude/agentic-mode.local.md <<'EOF'
   ---
   enabled: true
   blocked_tools:
     - Edit
     - Write
     - Bash
   ---
   # Test project with agentic mode enabled
   EOF
   ```

3. **Test main session blocking:**
   ```bash
   cd /tmp/agentic-test
   claude
   ```

   Try: "Create a file called test.txt with 'hello world'"

   **Expected:** Hook blocks Write tool, suggests using general-programmer-agent

4. **Test subagent access:**
   ```bash
   cd /tmp/agentic-test
   claude
   ```

   Try: "Use general-programmer-agent to create test.txt with 'hello world'"

   **Expected:** Subagent successfully creates file

5. **Test Task tool allowed:**
   ```bash
   cd /tmp/agentic-test
   claude
   ```

   Try: "Delegate to data-scientist-agent: analyze this data"

   **Expected:** Task tool works without being blocked

---

## Debugging Test Failures

### Test 1 Fails (Task not allowed)

**Symptom:** `test-allow-task.json` test fails

**Debug:**
```bash
cat test-allow-task.json | ../hooks/enforce-delegation.sh 2>&1
```

**Check:**
1. Line 12 in hook script: `[[ "$TOOL_NAME" == "Task" ]] && exit 0`
2. Verify jq extracts tool_name correctly:
   ```bash
   echo '{"tool_name":"Task"}' | jq -r '.tool_name // empty'
   ```

---

### Test 2 Fails (Edit not blocked)

**Symptom:** `test-block-edit.json` test doesn't return deny

**Debug:**
```bash
# Update test to use test-config directory
TEST_INPUT=$(jq '.cwd = "'$PWD'/test-config"' test-block-edit.json)
echo "$TEST_INPUT" | ../hooks/enforce-delegation.sh | jq .
```

**Check:**
1. Config file exists: `test-config/.claude/agentic-mode.local.md`
2. Config has `enabled: true` (exactly, case-sensitive)
3. Hook parses YAML correctly:
   ```bash
   cat test-config/.claude/agentic-mode.local.md | \
     sed -n '/^---$/,/^---$/p' | \
     sed '1d;$d' | \
     grep -E '^enabled:'
   ```

---

### Test 3 Fails (Tools blocked without config)

**Symptom:** `test-allow-disabled.json` returns deny when it should allow

**Debug:**
```bash
cat test-allow-disabled.json | ../hooks/enforce-delegation.sh 2>&1
```

**Check:**
1. Test uses directory without config: `/tmp/no-config-here`
2. Hook checks config exists (line 47): `if [[ -f "$CONFIG_FILE" ]]`
3. Default ENABLED="false" (line 45)

---

### Test 4 Fails (Subagent not detected)

**Symptom:** Subagent transcript created, but tool still blocked

**Debug:**
```bash
# Add debug output to hook script
sed -i.bak '/^IS_SUBAGENT="false"/a\
echo "DEBUG: TRANSCRIPT_PATH=$TRANSCRIPT_PATH" >&2\
echo "DEBUG: TOOL_USE_ID=$TOOL_USE_ID" >&2\
echo "DEBUG: SUBAGENTS_DIR=$SUBAGENTS_DIR" >&2\
echo "DEBUG: Checking: grep -l \"id\":\"$TOOL_USE_ID\" $SUBAGENTS_DIR/agent-*.jsonl" >&2
' ../hooks/enforce-delegation.sh

cat test-subagent-write.json | ../hooks/enforce-delegation.sh
```

**Check:**
1. Transcript path extraction: `SESSION_DIR="${TRANSCRIPT_PATH%.jsonl}"`
2. Subagent directory exists: `ls -la "$SUBAGENTS_DIR"`
3. tool_use_id format matches in transcript
4. grep finds match: `grep -l "\"id\":\"toolu_subagent_ABC\"" agent-*.jsonl`

---

## Performance Testing

### Hook Execution Time

```bash
# Test hook speed
time (cat test-allow-task.json | ../hooks/enforce-delegation.sh > /dev/null)

# Expect: < 100ms
```

### Config Loading Time

```bash
# Test config parsing speed
time (for i in {1..100}; do
  cat test-block-edit.json | ../hooks/enforce-delegation.sh > /dev/null
done)

# Expect: < 5s for 100 iterations (50ms average)
```

### Subagent Detection Time

```bash
# Create session with many subagents
mkdir -p /tmp/test-session/subagents
for i in {1..50}; do
  echo '{"id":"toolu_'$i'"}' > /tmp/test-session/subagents/agent-$i.jsonl
done

# Test grep performance
TEST_JSON=$(jq '.transcript_path = "/tmp/test-session.jsonl" | .tool_use_id = "toolu_25"' test-subagent-write.json)

time (echo "$TEST_JSON" | ../hooks/enforce-delegation.sh > /dev/null)

# Expect: < 200ms even with 50 subagents
```

---

## Edge Cases

### Empty tool_name

```bash
echo '{"session_id":"test","cwd":"/tmp"}' | ../hooks/enforce-delegation.sh
# Expected: Exit 0 (allow), empty string doesn't match blocked tools
```

### Missing cwd

```bash
echo '{"tool_name":"Edit"}' | ../hooks/enforce-delegation.sh
# Expected: Exit 0 (allow), no config found at "/.claude/agentic-mode.local.md"
```

### Malformed JSON input

```bash
echo 'invalid json' | ../hooks/enforce-delegation.sh
# Expected: jq parse error (handled gracefully)
```

### Config enabled but no blocked_tools list

```yaml
---
enabled: true
---
```

```bash
# Still blocks default tools because hook has hardcoded matcher
# Matcher in hooks.json: "Edit|Write|Bash|NotebookEdit"
```

### Very long config file

```bash
# Config with 1000 lines of comments
{ head -2 test-config/.claude/agentic-mode.local.md;
  for i in {1..1000}; do echo "# Comment $i"; done;
  tail -n +3 test-config/.claude/agentic-mode.local.md;
} > /tmp/huge-config.md

# Test parsing
TEST_JSON=$(jq '.cwd = "/tmp"' test-block-edit.json)
cat /tmp/huge-config.md > /tmp/.claude/agentic-mode.local.md
echo "$TEST_JSON" | ../hooks/enforce-delegation.sh

# Expected: Still works, sed only reads YAML frontmatter
```

---

## Continuous Testing

### Add to CI Pipeline

```yaml
# .github/workflows/test-plugins.yml
name: Test Agentic Mode Plugin

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install jq
        run: sudo apt-get update && sudo apt-get install -y jq

      - name: Run tests
        run: |
          cd plugin-development/maheidem-plugins/plugins/agentic-mode/.claude-plugin
          bash run-tests.sh
```

### Pre-commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash
cd plugin-development/maheidem-plugins/plugins/agentic-mode/.claude-plugin
bash run-tests.sh || {
  echo "Agentic mode tests failed! Fix before committing."
  exit 1
}
```

---

## Test Maintenance

### When to Update Tests

1. **Add new blocked tool** - Create new test case
2. **Change config format** - Update test config files
3. **Modify subagent detection** - Update test-subagent-write.json
4. **Change error messages** - Update expected output in run-tests.sh

### Test Coverage Checklist

- [ ] Task tool never blocked
- [ ] Edit blocked in main session
- [ ] Write blocked in main session
- [ ] Bash blocked in main session
- [ ] NotebookEdit blocked in main session
- [ ] Subagent Edit allowed
- [ ] Subagent Write allowed
- [ ] Subagent Bash allowed
- [ ] Config disabled allows all tools
- [ ] Config missing allows all tools
- [ ] Read tool always allowed
- [ ] Malformed config handled gracefully
- [ ] Missing transcript_path handled
- [ ] Missing tool_use_id handled
- [ ] Empty tool_name handled

---

## Related Documentation

- [README.md](./README.md) - Plugin overview and installation
- [Hook Script](./hooks/enforce-delegation.sh) - Implementation
- [Test Runner](../.claude-plugin/run-tests.sh) - Automated test suite
