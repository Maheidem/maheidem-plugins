#!/usr/bin/env python3
"""
Version bumper for marketplace plugins.
Handles semantic versioning (MAJOR.MINOR.PATCH) for plugins.

Usage:
    python version_bumper.py bump <plugin_path> [--type patch|minor|major]
    python version_bumper.py get <plugin_path>
    python version_bumper.py set <plugin_path> <version>

Examples:
    python version_bumper.py bump /path/to/plugin              # Bump patch (default)
    python version_bumper.py bump /path/to/plugin --type minor # Bump minor
    python version_bumper.py get /path/to/plugin               # Show current version
    python version_bumper.py set /path/to/plugin 2.0.0         # Set specific version
"""

import json
import sys
import re
from pathlib import Path


def parse_version(version_str: str) -> tuple[int, int, int]:
    """Parse semantic version string into tuple (major, minor, patch)."""
    match = re.match(r'^(\d+)\.(\d+)\.(\d+)$', version_str)
    if not match:
        raise ValueError(f"Invalid version format: {version_str}. Expected MAJOR.MINOR.PATCH")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def format_version(major: int, minor: int, patch: int) -> str:
    """Format version tuple as string."""
    return f"{major}.{minor}.{patch}"


def bump_version(version_str: str, bump_type: str = "patch") -> str:
    """Bump version by specified type."""
    major, minor, patch = parse_version(version_str)

    if bump_type == "major":
        major += 1
        minor = 0
        patch = 0
    elif bump_type == "minor":
        minor += 1
        patch = 0
    elif bump_type == "patch":
        patch += 1
    else:
        raise ValueError(f"Invalid bump type: {bump_type}. Use 'major', 'minor', or 'patch'")

    return format_version(major, minor, patch)


def find_plugin_json(plugin_path: str) -> Path:
    """Find plugin.json file in plugin directory."""
    plugin_dir = Path(plugin_path)

    # Check .claude-plugin/plugin.json (standard location)
    plugin_json = plugin_dir / ".claude-plugin" / "plugin.json"
    if plugin_json.exists():
        return plugin_json

    # Check direct plugin.json
    plugin_json = plugin_dir / "plugin.json"
    if plugin_json.exists():
        return plugin_json

    raise FileNotFoundError(f"No plugin.json found in {plugin_path}")


def get_version(plugin_path: str) -> str:
    """Get current version from plugin.json."""
    plugin_json = find_plugin_json(plugin_path)

    with open(plugin_json, 'r') as f:
        data = json.load(f)

    return data.get("version", "0.0.0")


def set_version(plugin_path: str, new_version: str) -> tuple[str, str]:
    """Set version in plugin.json. Returns (old_version, new_version)."""
    plugin_json = find_plugin_json(plugin_path)

    with open(plugin_json, 'r') as f:
        data = json.load(f)

    old_version = data.get("version", "0.0.0")

    # Validate new version format
    parse_version(new_version)

    data["version"] = new_version

    with open(plugin_json, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')  # Trailing newline

    return old_version, new_version


def bump_plugin_version(plugin_path: str, bump_type: str = "patch") -> tuple[str, str]:
    """Bump plugin version. Returns (old_version, new_version)."""
    old_version = get_version(plugin_path)
    new_version = bump_version(old_version, bump_type)
    return set_version(plugin_path, new_version)


def update_marketplace_json(marketplace_path: str, plugin_name: str, new_version: str) -> bool:
    """Update the plugin version in marketplace.json if it exists."""
    marketplace_json = Path(marketplace_path) / ".claude-plugin" / "marketplace.json"

    if not marketplace_json.exists():
        return False

    with open(marketplace_json, 'r') as f:
        data = json.load(f)

    # Find and update the plugin entry
    plugins = data.get("plugins", [])
    updated = False

    for plugin in plugins:
        if plugin.get("name") == plugin_name:
            plugin["version"] = new_version
            updated = True
            break

    if updated:
        with open(marketplace_json, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')

    return updated


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]
    plugin_path = sys.argv[2]

    try:
        if command == "get":
            version = get_version(plugin_path)
            print(f"Current version: {version}")

        elif command == "set":
            if len(sys.argv) < 4:
                print("Error: Missing version argument")
                print("Usage: python version_bumper.py set <plugin_path> <version>")
                sys.exit(1)

            new_version = sys.argv[3]
            old_version, new_version = set_version(plugin_path, new_version)
            print(f"Version changed: {old_version} -> {new_version}")

        elif command == "bump":
            bump_type = "patch"  # Default

            # Check for --type argument
            if "--type" in sys.argv:
                type_index = sys.argv.index("--type")
                if type_index + 1 < len(sys.argv):
                    bump_type = sys.argv[type_index + 1]

            old_version, new_version = bump_plugin_version(plugin_path, bump_type)
            print(f"Version bumped ({bump_type}): {old_version} -> {new_version}")

            # Also update marketplace.json if in standard structure
            plugin_dir = Path(plugin_path)
            marketplace_path = plugin_dir.parent.parent  # Go up from plugins/{name} to marketplace root
            plugin_name = plugin_dir.name

            if update_marketplace_json(str(marketplace_path), plugin_name, new_version):
                print(f"Also updated marketplace.json with version {new_version}")

        else:
            print(f"Unknown command: {command}")
            print("Use: get, set, or bump")
            sys.exit(1)

    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
