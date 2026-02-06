# Windows Workarounds for Claude Code

## Multiline python -c Corruption

Claude Code on Windows corrupts multiline `python -c` commands with `|| goto :error` batch syntax.

**Never do this:**
```bash
python -c "
import json
data = {'key': 'value'}
print(json.dumps(data))
"
```

**Do this instead:**
```bash
cat > /tmp/script.py << 'EOF'
import json
data = {"key": "value"}
print(json.dumps(data))
EOF
python /tmp/script.py
```

Or use the scratchpad directory for temp files:
```bash
# Write with Write tool, then execute with Bash
python "${SCRATCHPAD_DIR}/my_script.py"
```

## Heredoc with Single Quotes

If your Python code contains single quotes, `cat << 'EOF'` heredocs will fail.
Use the Write tool to create the file instead of heredoc.

## File Edit "Unexpectedly Modified" Bug

Windows NTFS updates last-access timestamp when Read tool reads a file.
Claude Code's checkpoint system treats this as a content modification.

**Workaround**: Use `sed -i` via Bash instead of Edit tool for simple replacements.
For complex edits, use the Write tool to rewrite the entire file.
