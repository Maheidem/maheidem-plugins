---
name: agents-team
description: |
  This skill should be used when the user asks to "assemble a team", "create an agent team",
  "use swarm mode", "full dev team", "agents-team", "crack team", "launch dev team",
  "start team mode", "spin up agents", or mentions wanting multiple specialized agents
  working together on a task. Also trigger when user references the "full-dev" team
  profile, says "I need a team for this", or describes a task complex enough to benefit
  from parallel multi-agent coordination (e.g., "build an entire auth system with tests").
---

# Agent Teams — Swarm Mode

Assemble specialized agent teams where a Product Owner coordinates all work distribution.
Every request routes through the PO — no direct task assignment to specialists.

## Available Team Profiles

| Command | Team | Agents |
|---------|------|--------|
| `/agents-team:full-dev` | Full Development | 10 agents: PO, Architect, Frontend, Backend, QA, Librarian, Data Eng, DevOps, Security, Research |

> Only `full-dev` is currently available. More profiles can be added as new command files in the `commands/` directory.

## How It Works

1. User invokes a team profile command (e.g., `/agents-team:full-dev build auth system`)
2. Team lead (main session) creates the team via TeamCreate
3. PO agent spawns first, analyzes the request
4. PO determines which specialists are needed and creates task breakdown
5. Team lead spawns requested specialists in parallel
6. Agents self-organize via TaskList and SendMessage
7. PO coordinates, ensures quality, compiles final deliverable
8. Team shuts down when complete

## Core Principles

- **PO is the single entry point** — all requests route through PO
- **Agents are autonomous** — they figure out their work based on role and tasks
- **Spawn only what's needed** — PO decides team composition per request
- **Self-organizing** — agents coordinate via task list and messaging

## When to Suggest

Proactively suggest assembling a team when the user:
- Describes a complex, multi-faceted task
- Mentions needing multiple types of work (frontend + backend + tests)
- Asks for a thorough implementation with quality gates
- Wants architecture review alongside implementation
- Needs research combined with coding

## Agent Role Reference

For detailed agent system prompts and role definitions, consult:
- **`references/agent-roles.md`** — Full system prompts for all 10 agents

## No Profile Specified?

If the skill triggers but the user hasn't specified a team profile, suggest `/agents-team:full-dev` and confirm before proceeding. Do not create a team without explicit profile selection.

## Active Team Detection

When a team is already active (check `~/.claude/teams/full-dev/config.json` exists):
- Route new requests through the existing PO
- Do NOT create a duplicate team
- Use SendMessage to the PO with the new request
