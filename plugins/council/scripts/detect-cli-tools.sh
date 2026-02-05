#!/bin/bash
# detect-cli-tools.sh - Detect available AI CLI tools
# Output: JSON array of discovered tools with metadata
#
# SAFETY: This script only detects - it does NOT invoke any tools

set -e

# Function to check if a command exists
command_exists() {
    command -v "$1" &>/dev/null
}

# Function to get version (safely)
get_version() {
    local tool="$1"
    local version_cmd="$2"

    # Timeout after 5 seconds to prevent hanging
    timeout 5 $version_cmd 2>/dev/null | head -1 || echo "unknown"
}

# Check each known tool
check_codex() {
    if command_exists "codex"; then
        local path=$(which codex)
        local version=$(get_version "codex" "codex --version")
        local has_sandbox=false

        # Check if codex supports sandbox mode
        if codex exec --help 2>&1 | grep -q "sandbox"; then
            has_sandbox=true
        fi

        echo "{\"name\":\"codex\",\"found\":true,\"path\":\"$path\",\"version\":\"$version\",\"has_readonly\":$has_sandbox,\"supported\":$has_sandbox,\"command_template\":\"codex exec --skip-git-repo-check -s read-only -C \\\"\${CWD}\\\" \\\"\${PROMPT}\\\"\",\"notes\":\"OpenAI Codex CLI\"}"
    else
        echo "{\"name\":\"codex\",\"found\":false,\"supported\":false}"
    fi
}

check_gemini() {
    if command_exists "gemini"; then
        local path=$(which gemini)
        local version=$(get_version "gemini" "gemini --version")

        # Gemini CLI's -p flag is query-only (read-only by design)
        echo "{\"name\":\"gemini\",\"found\":true,\"path\":\"$path\",\"version\":\"$version\",\"has_readonly\":true,\"supported\":true,\"command_template\":\"gemini -p \\\"\${PROMPT}\\\" 2>&1\",\"notes\":\"Google Gemini CLI\"}"
    else
        echo "{\"name\":\"gemini\",\"found\":false,\"supported\":false}"
    fi
}

check_opencode() {
    if command_exists "opencode"; then
        local path=$(which opencode)
        local version=$(get_version "opencode" "opencode --version")
        local has_json=false

        # Check if opencode supports json output format
        if opencode run --help 2>&1 | grep -q "format"; then
            has_json=true
        fi

        echo "{\"name\":\"opencode\",\"found\":true,\"path\":\"$path\",\"version\":\"$version\",\"has_readonly\":$has_json,\"supported\":$has_json,\"command_template\":\"opencode run --format json \\\"\${PROMPT}\\\" 2>&1\",\"notes\":\"OpenCode CLI\"}"
    else
        echo "{\"name\":\"opencode\",\"found\":false,\"supported\":false}"
    fi
}

check_agent() {
    # Cursor's CLI is called "agent"
    if command_exists "agent"; then
        local path=$(which agent)
        local version=$(get_version "agent" "agent --version")
        local has_readonly=false

        # Check if agent supports --mode ask (read-only)
        if agent --help 2>&1 | grep -q "\-\-mode"; then
            has_readonly=true
        fi

        echo "{\"name\":\"agent\",\"found\":true,\"path\":\"$path\",\"version\":\"$version\",\"has_readonly\":$has_readonly,\"supported\":$has_readonly,\"command_template\":\"agent --mode ask -p --output-format text \\\"\${PROMPT}\\\" 2>&1\",\"notes\":\"Cursor Agent CLI\"}"
    else
        echo "{\"name\":\"agent\",\"found\":false,\"supported\":false}"
    fi
}

check_aider() {
    if command_exists "aider"; then
        local path=$(which aider)
        local version=$(get_version "aider" "aider --version")

        # Aider's --message flag allows single-shot queries
        # But it can still modify files unless we use --no-auto-commits --dry-run
        echo "{\"name\":\"aider\",\"found\":true,\"path\":\"$path\",\"version\":\"$version\",\"has_readonly\":true,\"supported\":true,\"command_template\":\"aider --no-auto-commits --yes --message \\\"\${PROMPT}\\\" 2>&1\",\"notes\":\"Aider AI pair programming\"}"
    else
        echo "{\"name\":\"aider\",\"found\":false,\"supported\":false}"
    fi
}

check_cline() {
    # Cline (formerly Continue) - check for CLI mode
    if command_exists "cline"; then
        local path=$(which cline)
        echo "{\"name\":\"cline\",\"found\":true,\"path\":\"$path\",\"version\":\"unknown\",\"has_readonly\":false,\"supported\":false,\"notes\":\"Cline may not support non-interactive CLI mode\"}"
    else
        echo "{\"name\":\"cline\",\"found\":false,\"supported\":false}"
    fi
}

# Main execution
echo "["
check_codex
echo ","
check_gemini
echo ","
check_opencode
echo ","
check_agent
echo ","
check_aider
echo ","
check_cline
echo "]"
