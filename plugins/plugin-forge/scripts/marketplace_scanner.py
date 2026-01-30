#!/usr/bin/env python3
"""
Marketplace Scanner for Plugin Forge

Scans a marketplace directory to list existing plugins and detect conflicts.
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional


def scan_marketplace(marketplace_path: str) -> list[dict]:
    """
    Scan a marketplace and return list of plugins with metadata.

    Returns list of dicts with: name, path, description, commands, skills
    """
    plugins = []
    marketplace = Path(marketplace_path)

    # Check if this is a valid marketplace
    marketplace_json = marketplace / ".claude-plugin" / "marketplace.json"
    if not marketplace_json.exists():
        print(f"Error: Not a valid marketplace (missing {marketplace_json})", file=sys.stderr)
        return plugins

    # Look for plugins in the plugins/ directory
    plugins_dir = marketplace / "plugins"
    if not plugins_dir.exists():
        return plugins

    for plugin_dir in plugins_dir.iterdir():
        if not plugin_dir.is_dir():
            continue

        plugin_json = plugin_dir / ".claude-plugin" / "plugin.json"
        if not plugin_json.exists():
            continue

        try:
            with open(plugin_json, 'r') as f:
                manifest = json.load(f)

            plugins.append({
                "name": manifest.get("name", plugin_dir.name),
                "path": str(plugin_dir),
                "description": manifest.get("description", ""),
                "commands": manifest.get("commands", []),
                "skills": manifest.get("skills", []),
                "version": manifest.get("version", "0.0.0")
            })
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Could not read {plugin_json}: {e}", file=sys.stderr)

    return plugins


def find_conflicts(marketplace_path: str, new_name: str, new_description: str = "") -> dict:
    """
    Check if a plugin name or description conflicts with existing plugins.

    Returns dict with:
        exact_match: plugin name if exact match found
        similar: list of plugins with similar descriptions
    """
    plugins = scan_marketplace(marketplace_path)

    result = {
        "exact_match": None,
        "similar": []
    }

    new_name_lower = new_name.lower()
    new_desc_words = set(new_description.lower().split()) if new_description else set()

    for plugin in plugins:
        # Check exact name match
        if plugin["name"].lower() == new_name_lower:
            result["exact_match"] = plugin
            continue

        # Check description similarity (simple word overlap)
        if new_desc_words and plugin["description"]:
            plugin_words = set(plugin["description"].lower().split())
            overlap = len(new_desc_words & plugin_words)
            # If more than 30% word overlap, consider similar
            if overlap > len(new_desc_words) * 0.3:
                result["similar"].append(plugin)

    return result


def list_plugins_formatted(marketplace_path: str) -> str:
    """Return a formatted string listing all plugins."""
    plugins = scan_marketplace(marketplace_path)

    if not plugins:
        return "No plugins found in marketplace"

    lines = ["Existing plugins:", ""]
    for p in sorted(plugins, key=lambda x: x["name"]):
        lines.append(f"  {p['name']} (v{p['version']})")
        if p["description"]:
            # Truncate long descriptions
            desc = p["description"][:60] + "..." if len(p["description"]) > 60 else p["description"]
            lines.append(f"    {desc}")
        if p["commands"]:
            cmds = ", ".join(Path(c).stem for c in p["commands"])
            lines.append(f"    Commands: {cmds}")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: marketplace_scanner.py <marketplace_path> [check <name> [description]]")
        print("")
        print("Commands:")
        print("  <path>                          - List all plugins")
        print("  <path> check <name>             - Check for name conflicts")
        print("  <path> check <name> <desc>      - Check for name and description conflicts")
        sys.exit(1)

    marketplace_path = sys.argv[1]

    if len(sys.argv) == 2:
        # Just list plugins
        print(list_plugins_formatted(marketplace_path))

    elif sys.argv[2] == "check":
        if len(sys.argv) < 4:
            print("Error: name required for check")
            sys.exit(1)

        name = sys.argv[3]
        description = sys.argv[4] if len(sys.argv) > 4 else ""

        conflicts = find_conflicts(marketplace_path, name, description)

        if conflicts["exact_match"]:
            print(f"CONFLICT: Exact match found - '{conflicts['exact_match']['name']}'")
            print(f"  Path: {conflicts['exact_match']['path']}")
            print(f"  Description: {conflicts['exact_match']['description']}")
            sys.exit(2)

        if conflicts["similar"]:
            print(f"SIMILAR: Found {len(conflicts['similar'])} similar plugin(s):")
            for p in conflicts["similar"]:
                print(f"  - {p['name']}: {p['description'][:50]}...")
            sys.exit(1)

        print("OK: No conflicts found")
        sys.exit(0)

    else:
        print(f"Unknown command: {sys.argv[2]}")
        sys.exit(1)
