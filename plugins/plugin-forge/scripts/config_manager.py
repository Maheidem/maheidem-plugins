#!/usr/bin/env python3
"""
Config Manager for Plugin Forge

Manages persistent configuration in ~/.plugin-forge-config.json
"""

import json
import os
from datetime import datetime
from pathlib import Path

CONFIG_PATH = Path.home() / ".plugin-forge-config.json"

DEFAULT_CONFIG = {
    "default_marketplace": "",
    "last_used": "",
    "history": []
}


def load_config() -> dict:
    """Load config from file, creating default if not exists."""
    if not CONFIG_PATH.exists():
        return DEFAULT_CONFIG.copy()

    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            # Ensure all keys exist
            for key, value in DEFAULT_CONFIG.items():
                if key not in config:
                    config[key] = value
            return config
    except (json.JSONDecodeError, IOError):
        return DEFAULT_CONFIG.copy()


def save_config(config: dict) -> bool:
    """Save config to file."""
    try:
        config["last_used"] = datetime.now().isoformat()[:10]
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
        return True
    except IOError as e:
        print(f"Error saving config: {e}")
        return False


def get_default_marketplace() -> str:
    """Get the default marketplace path."""
    config = load_config()
    return config.get("default_marketplace", "")


def set_default_marketplace(path: str) -> bool:
    """Set and save the default marketplace path."""
    config = load_config()

    # Validate the path is a marketplace
    marketplace_json = Path(path) / ".claude-plugin" / "marketplace.json"
    if not marketplace_json.exists():
        print(f"Warning: {path} does not appear to be a valid marketplace")
        print(f"Expected file not found: {marketplace_json}")

    # Add to history if different from current
    if config["default_marketplace"] and config["default_marketplace"] != path:
        if config["default_marketplace"] not in config["history"]:
            config["history"].append(config["default_marketplace"])
            # Keep only last 5 in history
            config["history"] = config["history"][-5:]

    config["default_marketplace"] = path
    return save_config(config)


def get_history() -> list:
    """Get list of previously used marketplace paths."""
    config = load_config()
    return config.get("history", [])


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: config_manager.py <command> [args]")
        print("Commands:")
        print("  get                 - Get default marketplace path")
        print("  set <path>          - Set default marketplace path")
        print("  history             - Show marketplace history")
        print("  show                - Show full config")
        sys.exit(1)

    command = sys.argv[1]

    if command == "get":
        path = get_default_marketplace()
        if path:
            print(path)
        else:
            print("No default marketplace configured")
            sys.exit(1)

    elif command == "set":
        if len(sys.argv) < 3:
            print("Error: path required")
            sys.exit(1)
        path = sys.argv[2]
        if set_default_marketplace(path):
            print(f"Default marketplace set to: {path}")
        else:
            sys.exit(1)

    elif command == "history":
        history = get_history()
        if history:
            for h in history:
                print(h)
        else:
            print("No history")

    elif command == "show":
        config = load_config()
        print(json.dumps(config, indent=2))

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
