#!/usr/bin/env python3
"""
Session Analyzer for Plugin Forge

Scans Claude Code JSONL session history to detect patterns:
errors, retries, corrections, tool failures, and successful workflows.

Usage:
    session_analyzer.py list-projects
    session_analyzer.py list-sessions <project-filter>
    session_analyzer.py scan [--project X] [--after YYYY-MM-DD] [--before YYYY-MM-DD]
    session_analyzer.py extract <session-id> <project-dir> [--context 3]
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"
HISTORY_FILE = CLAUDE_DIR / "history.jsonl"

# Pattern detection constants
CORRECTION_WORDS = re.compile(
    r"\b(no,|don't|dont|instead|wrong|actually|not that|wait,|stop|"
    r"that's not|thats not|i meant|i mean|should be|try again)\b",
    re.IGNORECASE,
)
ERROR_PATTERNS = re.compile(
    r"(Error:|Failed:|Exception:|Traceback \(|FAILED|error\[|"
    r"ERR!|FATAL|panic:|cannot find|could not|not found|permission denied)",
    re.IGNORECASE,
)
POSITIVE_PATTERNS = re.compile(
    r"\b(perfect|great|works|nice|thanks|awesome|exactly|good job|"
    r"that's it|thats it|looks good|well done)\b",
    re.IGNORECASE,
)


def decode_project_name(encoded: str) -> str:
    """Decode Claude's project directory encoding.

    Encoding: path.replace(':\\\\', '--').replace('\\\\', '-')
    Decoding is lossy (hyphens in folder names become backslashes)
    but sufficient for display and filtering purposes.
    """
    decoded = encoded.replace("--", ":" + os.sep).replace("-", os.sep)
    return decoded


def load_session_lines(session_path: Path) -> list:
    """Load and parse JSONL lines from a session file."""
    lines = []
    try:
        text = session_path.read_text(encoding="utf-8", errors="ignore")
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                lines.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except (IOError, OSError):
        pass
    return lines


def get_message_text(msg: dict) -> str:
    """Extract plain text from a message's content field."""
    content = msg.get("message", {}).get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    texts.append(block.get("text", ""))
                elif block.get("type") == "tool_result":
                    sub = block.get("content", "")
                    if isinstance(sub, str):
                        texts.append(sub)
                    elif isinstance(sub, list):
                        for s in sub:
                            if isinstance(s, dict) and s.get("type") == "text":
                                texts.append(s.get("text", ""))
        return "\n".join(texts)
    return ""


def get_tool_uses(msg: dict) -> list:
    """Extract tool_use blocks from assistant message."""
    content = msg.get("message", {}).get("content", [])
    if not isinstance(content, list):
        return []
    return [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"]


def get_tool_results(msg: dict) -> list:
    """Extract tool_result blocks from user message (tool responses)."""
    content = msg.get("message", {}).get("content", [])
    if not isinstance(content, list):
        return []
    return [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]


def has_error(msg: dict) -> bool:
    """Check if a tool_result message contains errors."""
    for tr in get_tool_results(msg):
        if tr.get("is_error"):
            return True
        sub = tr.get("content", "")
        text = sub if isinstance(sub, str) else ""
        if isinstance(sub, list):
            text = " ".join(
                s.get("text", "") for s in sub if isinstance(s, dict)
            )
        if ERROR_PATTERNS.search(text):
            return True
    return False


def detect_patterns(messages: list) -> dict:
    """Run all pattern detectors on a list of parsed JSONL messages."""
    errors = []
    retries = []
    corrections = []
    tool_failures = []
    successful_workflows = []

    # Filter to actual messages (skip queue-operation, summary, etc.)
    msgs = [m for m in messages if m.get("type") in ("user", "assistant")]

    for i, msg in enumerate(msgs):
        msg_type = msg.get("type")
        text = get_message_text(msg)
        ts = msg.get("timestamp", "")

        # --- Error detection ---
        if msg_type == "user" and has_error(msg):
            tool_results = get_tool_results(msg)
            for tr in tool_results:
                if tr.get("is_error"):
                    errors.append({
                        "index": i,
                        "timestamp": ts,
                        "type": "tool_error",
                        "tool_use_id": tr.get("tool_use_id", ""),
                        "snippet": get_message_text(msg)[:200],
                    })
                    break
            else:
                errors.append({
                    "index": i,
                    "timestamp": ts,
                    "type": "error_pattern",
                    "snippet": text[:200],
                })

        if msg_type == "assistant" and ERROR_PATTERNS.search(text):
            errors.append({
                "index": i,
                "timestamp": ts,
                "type": "assistant_error_mention",
                "snippet": text[:200],
            })

        # --- Correction detection ---
        if msg_type == "user" and isinstance(msg.get("message", {}).get("content"), str):
            if i > 0 and msgs[i - 1].get("type") == "assistant":
                if CORRECTION_WORDS.search(text):
                    corrections.append({
                        "index": i,
                        "timestamp": ts,
                        "snippet": text[:200],
                    })

        # --- Retry detection (same tool 2+ times in 5-msg window) ---
        if msg_type == "assistant":
            tools = get_tool_uses(msg)
            for tool in tools:
                tool_name = tool.get("name", "")
                tool_input = json.dumps(tool.get("input", {}), sort_keys=True)
                # Look back 5 messages for same tool with similar input
                window_start = max(0, i - 5)
                for j in range(window_start, i):
                    prev = msgs[j]
                    if prev.get("type") != "assistant":
                        continue
                    for pt in get_tool_uses(prev):
                        if pt.get("name") == tool_name:
                            prev_input = json.dumps(pt.get("input", {}), sort_keys=True)
                            # Similar if >60% overlap
                            overlap = len(set(tool_input) & set(prev_input))
                            total = max(len(set(tool_input) | set(prev_input)), 1)
                            if overlap / total > 0.6:
                                retries.append({
                                    "index": i,
                                    "timestamp": ts,
                                    "tool": tool_name,
                                    "first_index": j,
                                })
                                break

        # --- Tool failure detection (is_error in results) ---
        if msg_type == "user":
            for tr in get_tool_results(msg):
                if tr.get("is_error"):
                    tool_failures.append({
                        "index": i,
                        "timestamp": ts,
                        "tool_use_id": tr.get("tool_use_id", ""),
                        "snippet": str(tr.get("content", ""))[:200],
                    })

    # --- Successful workflow detection ---
    consecutive_success = 0
    workflow_start = 0
    for i, msg in enumerate(msgs):
        if msg.get("type") == "assistant" and get_tool_uses(msg):
            # Check if next message (tool result) has no errors
            if i + 1 < len(msgs) and msgs[i + 1].get("type") == "user":
                if not has_error(msgs[i + 1]):
                    if consecutive_success == 0:
                        workflow_start = i
                    consecutive_success += 1
                else:
                    if consecutive_success >= 3:
                        successful_workflows.append({
                            "start_index": workflow_start,
                            "end_index": i,
                            "length": consecutive_success,
                            "timestamp": msgs[workflow_start].get("timestamp", ""),
                        })
                    consecutive_success = 0
            else:
                if consecutive_success >= 3:
                    successful_workflows.append({
                        "start_index": workflow_start,
                        "end_index": i,
                        "length": consecutive_success,
                        "timestamp": msgs[workflow_start].get("timestamp", ""),
                    })
                consecutive_success = 0
        elif msg.get("type") == "user" and isinstance(msg.get("message", {}).get("content"), str):
            # User text message breaks the tool chain
            if consecutive_success >= 3:
                # Check for positive feedback
                text = get_message_text(msg)
                has_positive = bool(POSITIVE_PATTERNS.search(text))
                successful_workflows.append({
                    "start_index": workflow_start,
                    "end_index": i,
                    "length": consecutive_success,
                    "timestamp": msgs[workflow_start].get("timestamp", ""),
                    "positive_feedback": has_positive,
                })
            consecutive_success = 0

    # Catch trailing workflow
    if consecutive_success >= 3:
        successful_workflows.append({
            "start_index": workflow_start,
            "end_index": len(msgs) - 1,
            "length": consecutive_success,
            "timestamp": msgs[workflow_start].get("timestamp", ""),
        })

    return {
        "errors": errors,
        "retries": retries,
        "corrections": corrections,
        "tool_failures": tool_failures,
        "successful_workflows": successful_workflows,
    }


def score_session(patterns: dict) -> float:
    """Score a session by pattern density (higher = more interesting)."""
    return (
        len(patterns["errors"]) * 2
        + len(patterns["retries"]) * 3
        + len(patterns["corrections"]) * 4
        + len(patterns["tool_failures"]) * 2
        + len(patterns["successful_workflows"]) * 1
    )


# ── CLI Commands ──────────────────────────────────────────────────────────────


def cmd_list_projects():
    """List all projects with session counts."""
    if not PROJECTS_DIR.exists():
        print(json.dumps({"error": "No projects directory found", "path": str(PROJECTS_DIR)}))
        sys.exit(1)

    projects = []
    for d in sorted(PROJECTS_DIR.iterdir()):
        if not d.is_dir():
            continue
        sessions = list(d.glob("*.jsonl"))
        decoded = decode_project_name(d.name)
        projects.append({
            "encoded_name": d.name,
            "decoded_path": decoded,
            "session_count": len(sessions),
            "total_lines": sum(
                len(s.read_text(encoding="utf-8", errors="ignore").splitlines())
                for s in sessions
            ),
        })

    print(json.dumps({"projects": projects, "total": len(projects)}, indent=2))


def cmd_list_sessions(project_filter: str):
    """List sessions for a project matching the filter."""
    if not PROJECTS_DIR.exists():
        print(json.dumps({"error": "No projects directory found"}))
        sys.exit(1)

    matching = []
    for d in PROJECTS_DIR.iterdir():
        if not d.is_dir():
            continue
        decoded = decode_project_name(d.name)
        if project_filter.lower() not in d.name.lower() and project_filter.lower() not in decoded.lower():
            continue
        for s in sorted(d.glob("*.jsonl")):
            lines = load_session_lines(s)
            msg_count = len([l for l in lines if l.get("type") in ("user", "assistant")])
            # Get first user message as summary
            first_msg = ""
            for l in lines:
                if l.get("type") == "user":
                    first_msg = get_message_text(l)[:100]
                    break
            # Get timestamp
            ts = ""
            for l in lines:
                if l.get("timestamp"):
                    ts = l["timestamp"]
                    break
            matching.append({
                "session_id": s.stem,
                "project_dir": d.name,
                "decoded_project": decoded,
                "message_count": msg_count,
                "first_message": first_msg,
                "timestamp": ts,
            })

    print(json.dumps({"sessions": matching, "total": len(matching)}, indent=2))


def cmd_scan(project_filter: str = None, after: str = None, before: str = None):
    """Full pattern scan across sessions."""
    if not PROJECTS_DIR.exists():
        print(json.dumps({"error": "No projects directory found"}))
        sys.exit(1)

    after_dt = datetime.fromisoformat(after) if after else None
    before_dt = datetime.fromisoformat(before) if before else None

    all_errors = []
    all_tool_failures = []
    all_corrections = []
    per_project = {}
    session_highlights = []

    for d in sorted(PROJECTS_DIR.iterdir()):
        if not d.is_dir():
            continue
        decoded = decode_project_name(d.name)

        if project_filter:
            if (project_filter.lower() not in d.name.lower()
                    and project_filter.lower() not in decoded.lower()):
                continue

        project_stats = {
            "decoded_path": decoded,
            "sessions_scanned": 0,
            "total_errors": 0,
            "total_retries": 0,
            "total_corrections": 0,
            "total_tool_failures": 0,
            "total_successful_workflows": 0,
        }

        for s in d.glob("*.jsonl"):
            lines = load_session_lines(s)
            if not lines:
                continue

            # Date filter
            first_ts = None
            for l in lines:
                if l.get("timestamp"):
                    ts_str = l["timestamp"]
                    try:
                        if isinstance(ts_str, (int, float)):
                            first_ts = datetime.fromtimestamp(ts_str / 1000)
                        else:
                            first_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
                    except (ValueError, TypeError):
                        pass
                    break

            if first_ts:
                if after_dt and first_ts < after_dt:
                    continue
                if before_dt and first_ts > before_dt:
                    continue

            patterns = detect_patterns(lines)
            score = score_session(patterns)

            project_stats["sessions_scanned"] += 1
            project_stats["total_errors"] += len(patterns["errors"])
            project_stats["total_retries"] += len(patterns["retries"])
            project_stats["total_corrections"] += len(patterns["corrections"])
            project_stats["total_tool_failures"] += len(patterns["tool_failures"])
            project_stats["total_successful_workflows"] += len(patterns["successful_workflows"])

            all_errors.extend(patterns["errors"])
            all_tool_failures.extend(patterns["tool_failures"])
            all_corrections.extend(patterns["corrections"])

            if score > 0:
                # Get first user message
                first_msg = ""
                for l in lines:
                    if l.get("type") == "user":
                        first_msg = get_message_text(l)[:100]
                        break

                session_highlights.append({
                    "session_id": s.stem,
                    "project_dir": d.name,
                    "decoded_project": decoded,
                    "score": score,
                    "first_message": first_msg,
                    "timestamp": str(first_ts) if first_ts else "",
                    "pattern_counts": {
                        "errors": len(patterns["errors"]),
                        "retries": len(patterns["retries"]),
                        "corrections": len(patterns["corrections"]),
                        "tool_failures": len(patterns["tool_failures"]),
                        "successful_workflows": len(patterns["successful_workflows"]),
                    },
                })

        per_project[d.name] = project_stats

    # Sort highlights by score descending
    session_highlights.sort(key=lambda x: x["score"], reverse=True)

    # Build error summary: group by snippet similarity
    error_snippets = {}
    for e in all_errors:
        key = e.get("snippet", "")[:80]
        error_snippets[key] = error_snippets.get(key, 0) + 1
    top_errors = sorted(error_snippets.items(), key=lambda x: x[1], reverse=True)[:10]

    # Tool failure summary
    tool_fail_counts = {}
    for tf in all_tool_failures:
        snip = tf.get("snippet", "")[:80]
        tool_fail_counts[snip] = tool_fail_counts.get(snip, 0) + 1
    top_tool_failures = sorted(tool_fail_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    report = {
        "scan_metadata": {
            "timestamp": datetime.now().isoformat(),
            "project_filter": project_filter,
            "date_range": {"after": after, "before": before},
            "projects_scanned": len(per_project),
            "sessions_scanned": sum(p["sessions_scanned"] for p in per_project.values()),
        },
        "summary": {
            "total_errors": len(all_errors),
            "total_tool_failures": len(all_tool_failures),
            "total_corrections": len(all_corrections),
            "top_errors": [{"snippet": s, "count": c} for s, c in top_errors],
            "top_tool_failures": [{"snippet": s, "count": c} for s, c in top_tool_failures],
        },
        "per_project": per_project,
        "session_highlights": session_highlights[:20],
    }

    print(json.dumps(report, indent=2))


def cmd_extract(session_id: str, project_dir: str, context: int = 3):
    """Extract message excerpts around detected patterns for Tier 2 analysis."""
    session_path = PROJECTS_DIR / project_dir / f"{session_id}.jsonl"
    if not session_path.exists():
        # Try searching all project dirs
        found = list(PROJECTS_DIR.glob(f"*/{session_id}.jsonl"))
        if not found:
            print(json.dumps({"error": f"Session {session_id} not found"}))
            sys.exit(1)
        session_path = found[0]

    lines = load_session_lines(session_path)
    msgs = [m for m in lines if m.get("type") in ("user", "assistant")]
    patterns = detect_patterns(lines)

    # Collect unique indices to extract (with context)
    indices = set()
    for category in ["errors", "retries", "corrections", "tool_failures"]:
        for p in patterns[category]:
            idx = p.get("index", p.get("start_index", 0))
            for j in range(max(0, idx - context), min(len(msgs), idx + context + 1)):
                indices.add(j)

    for wf in patterns["successful_workflows"]:
        for j in range(wf["start_index"], min(len(msgs), wf["end_index"] + 1)):
            indices.add(j)

    # Build excerpts
    excerpts = []
    for i in sorted(indices):
        if i >= len(msgs):
            continue
        msg = msgs[i]
        text = get_message_text(msg)
        tools = get_tool_uses(msg)
        tool_names = [t.get("name", "") for t in tools]

        excerpts.append({
            "index": i,
            "type": msg.get("type"),
            "timestamp": msg.get("timestamp", ""),
            "text": text[:500] if text else "",
            "tools_used": tool_names if tool_names else None,
            "has_error": has_error(msg) if msg.get("type") == "user" else None,
        })

    result = {
        "session_id": session_id,
        "project_dir": project_dir,
        "total_messages": len(msgs),
        "excerpts_count": len(excerpts),
        "pattern_summary": {
            "errors": len(patterns["errors"]),
            "retries": len(patterns["retries"]),
            "corrections": len(patterns["corrections"]),
            "tool_failures": len(patterns["tool_failures"]),
            "successful_workflows": len(patterns["successful_workflows"]),
        },
        "excerpts": excerpts,
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: session_analyzer.py <command> [args]")
        print("Commands:")
        print("  list-projects                              List all projects with session counts")
        print("  list-sessions <project-filter>             Sessions for a project")
        print("  scan [--project X] [--after DATE] [--before DATE]  Pattern scan")
        print("  extract <session-id> <project-dir> [--context N]   Extract excerpts")
        sys.exit(1)

    command = sys.argv[1]

    if command == "list-projects":
        cmd_list_projects()

    elif command == "list-sessions":
        if len(sys.argv) < 3:
            print("Error: project filter required")
            sys.exit(1)
        cmd_list_sessions(sys.argv[2])

    elif command == "scan":
        project = None
        after = None
        before = None
        i = 2
        while i < len(sys.argv):
            if sys.argv[i] == "--project" and i + 1 < len(sys.argv):
                project = sys.argv[i + 1]
                i += 2
            elif sys.argv[i] == "--after" and i + 1 < len(sys.argv):
                after = sys.argv[i + 1]
                i += 2
            elif sys.argv[i] == "--before" and i + 1 < len(sys.argv):
                before = sys.argv[i + 1]
                i += 2
            else:
                i += 1
        cmd_scan(project, after, before)

    elif command == "extract":
        if len(sys.argv) < 4:
            print("Error: session-id and project-dir required")
            sys.exit(1)
        session_id = sys.argv[2]
        project_dir = sys.argv[3]
        ctx = 3
        if "--context" in sys.argv:
            idx = sys.argv.index("--context")
            if idx + 1 < len(sys.argv):
                ctx = int(sys.argv[idx + 1])
        cmd_extract(session_id, project_dir, ctx)

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
