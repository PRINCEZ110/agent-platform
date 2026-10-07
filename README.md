# Agent Platform

A modular, model-agnostic autonomous AI agent platform for collaborative software development.

## Overview

This platform enables two cooperating AI agents to work on the same project without conflicts:

- **Agent A (Lead Architect)**: Architecture, core logic, integration, review
- **Agent B (Specialist Engineer)**: Implementation, testing, documentation, UI/UX

## Features

- **Model-Agnostic**: Pluggable LLM providers (OpenAI, Anthropic, Azure, Local/Ollama)
- **Tool System**: Terminal, Filesystem, Git, Web Search, Code Analysis
- **Git Worktree Isolation**: Each agent works in isolated worktrees
- **Inter-Agent Communication**: Structured message bus with persistence
- **Task Ownership**: File-level ownership with lock coordination
- **Project Memory**: Vector + structured memory with codebase indexing
- **Safety & Permissions**: Capability-based permissions with approval gates
- **Observability**: Structured logging, Prometheus metrics, OpenTelemetry traces

## Architecture

```
src/
├── core/           # Core types, errors, utilities
├── providers/      # LLM provider abstraction
├── tools/          # Tool system (terminal, fs, git, web, code)
├── git/            # Worktree & branch management
├── comm/           # Inter-agent communication
├── memory/         # Project memory & context
├── tasks/          # Task ownership & coordination
├── safety/         # Permissions & audit
├── obs/            # Observability
├── agents/         # Agent implementations
│   ├── base/       # BaseAgent, execution loop, lifecycle
│   ├── interfaces/ # Shared interfaces
│   ├── lead/       # LeadArchitectAgent (Agent A)
│   └── specialist/ # SpecialistAgent (Agent B)
├── app/            # Application entry point
└── types/          # Shared type definitions
```

## Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Run tests
npm test

# Start the platform
npm start
```

## Configuration

1. Copy `.env.example` to `.env` and add your API keys
2. Configure providers in `.ai/config/app.json`
3. Set agent permissions in `.ai/permissions/agent-a.json` and `.ai/permissions/agent-b.json`

## Development

### Project Structure

- `worktrees/agent-a/project` - Agent A's worktree
- `worktrees/agent-b/project` - Agent B's worktree
- `.ai/` - Collaboration control center
  - `ownership.json` - File ownership registry
  - `active-tasks.json` - Task registry
  - `decisions.md` - Architecture Decision Records
  - `changelog.md` - Cross-agent changelog
  - `communication/` - Inter-agent messages
  - `locks/` - File locks

### Commands

```bash
# Task management
npx agent-tasks claim TASK-001 --agent agent_a
npx agent-tasks complete TASK-001 --agent agent_a
npx agent-tasks list --owner agent_a

# Git worktrees
npx agent-platform worktree --list
npx agent-platform worktree --create worktrees/agent-a/feature feature/agent-a/task

# Health check
npx agent-platform health

# Configuration
npx agent-platform config --show
```

## Collaboration Protocol

See `AGENTS.md` for the full collaboration protocol including:

- Ownership rules
- Task lifecycle
- Git workflow
- Communication patterns
- Integration process

## License

MIT