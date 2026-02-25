#!/usr/bin/env python3
"""
Journey Gate Hook — blocks edits to feature code that has no journey documentation.

Reads .quality-gate.json from the project root to determine:
- Which file patterns are gated (require journey docs)
- How file paths map to feature tabs
- Where journey docs live

Called as a PreToolUse hook on Write/Edit tools.
Receives tool input as JSON on stdin.
Outputs Claude Code hook format:
  - Allow: exit 0, stdout with permissionDecision "allow"
  - Block: exit 0, stdout with permissionDecision "deny" + systemMessage
"""

import json
import sys
import os
import fnmatch
from pathlib import Path


def find_project_root():
    """Walk up from CWD to find .quality-gate.json or .git"""
    current = Path.cwd()
    for parent in [current] + list(current.parents):
        if (parent / ".quality-gate.json").exists():
            return parent
        if (parent / ".git").exists():
            return parent
    return current


def load_config(project_root):
    """Load .quality-gate.json from project root"""
    config_path = project_root / ".quality-gate.json"
    if not config_path.exists():
        return None
    with open(config_path) as f:
        return json.load(f)


def get_relative_path(file_path, project_root):
    """Get file path relative to project root"""
    try:
        return str(Path(file_path).relative_to(project_root))
    except ValueError:
        return file_path


def is_file_gated(rel_path, config):
    """Check if a file matches any gated pattern"""
    gated = config.get("gated_patterns", [])
    for entry in gated:
        pattern = entry.get("pattern", "")
        excludes = entry.get("exclude", [])

        # Check excludes first
        if any(fnmatch.fnmatch(rel_path, exc) for exc in excludes):
            continue

        if fnmatch.fnmatch(rel_path, pattern):
            return True
    return False


def resolve_tab(rel_path, config):
    """Map a file path to its feature tab"""
    tab_mapping = config.get("tab_mapping", {})
    for tab, patterns in tab_mapping.items():
        for pattern in patterns:
            if fnmatch.fnmatch(rel_path, pattern):
                return tab
            # Also try matching just the filename
            filename = os.path.basename(rel_path)
            if fnmatch.fnmatch(filename, pattern):
                return tab

    # Auto-detect from filename
    basename = os.path.basename(rel_path).lower()
    basename_no_ext = os.path.splitext(basename)[0]

    # Common mappings
    auto_map = {
        "benchmark": "benchmark",
        "tool_eval": "tool-eval",
        "tooleval": "tool-eval",
        "param_tune": "param-tune",
        "paramtune": "param-tune",
        "prompt_tune": "prompt-tune",
        "prompttune": "prompt-tune",
        "judge": "judge",
        "analytics": "analytics",
        "settings": "settings",
        "admin": "settings",
        "keys": "settings",
        "onboarding": "settings",
    }

    for key, tab in auto_map.items():
        if key in basename_no_ext:
            return tab

    return None


def has_journey_docs(tab, config, project_root):
    """Check if journey docs exist for a given tab"""
    docs_path = project_root / config.get("journey_docs_path", ".documentation/user-journeys")
    tab_path = docs_path / tab

    if not tab_path.exists():
        return False

    # Check for at least one .md file (recursively for sub-folders)
    md_files = list(tab_path.rglob("*.md"))
    return len(md_files) > 0


def allow():
    """Output allow decision"""
    print(json.dumps({
        "hookSpecificOutput": {
            "permissionDecision": "allow"
        }
    }))


def deny(message):
    """Output deny decision with system message"""
    print(json.dumps({
        "hookSpecificOutput": {
            "permissionDecision": "deny"
        },
        "systemMessage": message
    }))


def main():
    try:
        tool_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        allow()
        return

    # Extract file path from tool input
    file_path = tool_input.get("tool_input", {}).get("file_path", "")
    if not file_path:
        allow()
        return

    project_root = find_project_root()
    config = load_config(project_root)

    # No config file = no enforcement
    if config is None:
        allow()
        return

    rel_path = get_relative_path(file_path, project_root)

    # Check if file is gated
    if not is_file_gated(rel_path, config):
        allow()
        return

    # Resolve which tab this file belongs to
    tab = resolve_tab(rel_path, config)
    if tab is None:
        # Can't determine tab, allow with warning
        print(json.dumps({
            "hookSpecificOutput": {
                "permissionDecision": "allow"
            },
            "systemMessage": f"Quality Gate: Could not determine feature tab for {rel_path}. Consider updating .quality-gate.json tab_mapping."
        }))
        return

    # Check if journey docs exist for this tab
    if has_journey_docs(tab, config, project_root):
        allow()
        return

    # DENY — no journey docs found
    deny(
        f"Quality Gate BLOCKED: No journey documentation found for '{tab}' tab. "
        f"File: {rel_path}. "
        f"Expected: .documentation/user-journeys/{tab}/ (with at least one .md file). "
        f"Run /define-journey {tab}/{{journey-name}} to create the journey doc first."
    )


if __name__ == "__main__":
    main()
