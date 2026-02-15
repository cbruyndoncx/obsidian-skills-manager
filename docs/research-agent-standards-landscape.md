---
title: Agent Configuration Standards & Skills Manager Landscape
type: research
status: DRAFT
share: false
created: 2026-02-14
tags:
  - ai-coding
  - agent-skills
  - standards
  - obsidian-plugin
  - skills-manager
  - dotagent
  - claude-code
aliases:
  - Agent Skills Standards
  - Skills Manager Research
---

# Agent Configuration Standards & Skills Manager Landscape (2026)

Research into the current state of agent configuration file standards, the Agent Skills specification, universal bridging tools, and GUI-based skills management solutions. Conducted to evaluate feasibility of building an Obsidian Skills Manager plugin.

---

## 1. Agent Config File Standards per Tool

Every AI coding tool created its own configuration format:

| Tool | Config Location | Format |
|---|---|---|
| Claude Code | `CLAUDE.md`, `.claude/skills/` | Markdown |
| Cursor | `.cursor/rules/`, `.cursorrules` | Markdown/MDC |
| GitHub Copilot | `.github/copilot-instructions.md` | Markdown |
| GitHub Agents | `.github/agents/*.agent.md` | Markdown |
| Windsurf | `.windsurfrules` | Markdown |
| Cline | `.clinerules` | Markdown |
| Amazon Q | `.amazon-q/` | Various |
| Zed | `.zed/` | Various |

### AGENTS.md (Agentic AI Foundation / Linux Foundation, Aug 2025)

- Repo: [github.com/agentsmd/agents.md](https://github.com/agentsmd/agents.md)
- Universal, tool-agnostic "README for agents"
- 60,000+ repos adopted
- Stewarded by Agentic AI Foundation under the Linux Foundation (not solely OpenAI)
- Supported by: Cursor, Devin, GitHub Copilot, VS Code, Codex
- Claude Code also reads it alongside CLAUDE.md
- Content: coding rules, conventions, build commands, architecture, file structure

### .github/agents/ (GitHub Official)

- Custom agents as markdown: `.github/agents/my-agent.agent.md`
- Scopes: repo, org (`.github-private`), enterprise
- Versioned by Git commit SHA
- Lowest-level config takes precedence

---

## 2. Agent Skills Specification (Anthropic, Dec 2025 — Open Standard)

Released as an open format, now adopted by **20+ platforms** including Claude, Codex, Gemini CLI, Copilot, Cursor, VS Code.

- Spec repo: [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills)
- Anthropic's skills: [github.com/anthropics/skills](https://github.com/anthropics/skills)

### Required Structure

```
my-skill/
├── SKILL.md          # Required
├── scripts/          # Optional - executable code
├── references/       # Optional - REFERENCE.md, FORMS.md
└── assets/           # Optional - templates, images, lookup tables
```

### SKILL.md Frontmatter

**Required fields**:
- `name`: 1-64 chars, lowercase, hyphens only, must match folder name
- `description`: 1-1024 chars, what it does + when to use (trigger keywords)

**Optional fields**:
- `license`: License identifier
- `compatibility`: Environment requirements (max 500 chars)
- `metadata`: Arbitrary key-value pairs
- `allowed-tools`: Pre-approved tools (experimental)

### Progressive Disclosure (3 Levels)

| Level | What Loads | When | Size Target |
|---|---|---|---|
| Metadata | `name` + `description` | Always at startup | ~100 tokens |
| Instructions | Full SKILL.md body | When skill activates | <5,000 tokens |
| Resources | scripts/, references/, assets/ | On demand | As needed |

### Key Design Principles

- Explicit branching with numbered sequential steps
- Low freedom for compliance tasks, high freedom for creative tasks
- Decision tables for tribal knowledge
- Skills with explicit instructions: **95%+ trigger rate**, **79% pass rate** (26pt improvement over baseline)

---

## 3. Universal Bridge Tools

### dotagent — `.agent/` Directory Standard

- Repo: [github.com/johnlindquist/dotagent](https://github.com/johnlindquist/dotagent)
- The most comprehensive universal bridge
- Converts between all tool-specific formats via a unified `.agent/` directory

**How it works**:
```bash
dotagent import .                              # Auto-detect and import from any format
dotagent export --formats copilot,claude,cursor # Export to multiple formats
dotagent import . --dry-run                     # Preview without changes
```

**Unified format**: Markdown with YAML frontmatter
```yaml
---
id: core-style
title: Core Style Guidelines
alwaysApply: true
priority: high
scope: src/components/**
private: false
---
```

**Features**:
- Import/export all major formats (Claude, Cursor, Copilot, Cline, Windsurf, Zed, Amazon Q)
- Nested folder support for organization
- Private rules handling (`.local.md`, `/private/`, `private: true` frontmatter)
- Auto-updates `.gitignore` for private files
- TypeScript API for programmatic access
- CLI with color-coded output, dry-run mode

### agent-config-adapter (by PrashamTrivedi)

- Repo: [github.com/PrashamTrivedi/agent-config-adapter](https://github.com/PrashamTrivedi/agent-config-adapter)
- Web UI: [agent-config.prashamhtrivedi.app](https://agent-config.prashamhtrivedi.app)
- Stores MCP configs and commands **once**, deploys to Claude Code, Codex, Jules, Gemini CLI
- Pre-built workflows, slash commands, skills, prompts
- Focus: MCP configuration portability (not rules/instructions)

### Skills CLI (skills.sh by Vercel Labs)

- Repo: [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills)
- Skills registry: [skills.sh](https://skills.sh)
- Install skills via `npx skills add` across multiple agents (Claude Code, Cursor, OpenCode)
- Discovery directory with categories and popularity

### Vercel Agent Skills Collection

- Repo: [github.com/vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)
- Pre-built skills: React Best Practices (40+ rules), Web Design Guidelines (100+ rules), Vercel Deployment

---

## 4. Skills Manager GUI Solutions

### What Exists

| Solution | GUI? | Toggle On/Off | ZIP Upload | Platform |
|---|---|---|---|---|
| claude.ai Web (Settings > Capabilities) | Yes | Yes | Yes | Web only |
| VS Code `/plugins` panel | Yes | Yes | Via manifest | VS Code only |
| Skills CLI (skills.sh) | No (CLI) | No | No | Terminal |
| Agent Skills Registry (vercel-labs) | No (CLI) | No | No | Terminal |
| **Obsidian plugin** | **Does not exist** | — | — | — |

### claude.ai Web (Gold Standard UX)

- Toggle individual skills on/off
- Upload ZIP to install custom skills
- View descriptions and metadata per skill
- Org-level deployment (since Dec 2025) for workspace-wide management
- API endpoint (`/v1/skills`) for programmatic management

### VS Code Plugin Manager

- Type `/plugins` for graphical panel with Plugins + Marketplaces tabs
- Toggle switches for plugins (which bundle skills)
- CLI: `claude plugin list`, `claude plugin update`, `claude plugin remove`
- Manages plugins, not individual skills directly

### kepano/obsidian-skills

- Repo: [github.com/kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) (9.8k stars)
- Kepano's (Obsidian CEO) skills repository — not a manager UI
- Skills for Obsidian vault operations following Agent Skills spec
- Drop into `.claude/` and they auto-load

---

## 5. The Gap: Obsidian Skills Manager Plugin

No plugin exists that provides a GUI for managing Claude Code skills inside Obsidian or as a standalone tool for the CLI.

### What It Would Do

- Scan `.claude/skills/` directory structure
- Parse `SKILL.md` frontmatter for name, description, compatibility
- Render a settings-like panel with toggle switches (similar to Obsidian's plugin manager)
- "Disable" = move folder to `.claude/skills-disabled/` or use a JSON config
- "Install" = accept ZIP, extract to `.claude/skills/` directory
- Optionally integrate with `/v1/skills` API
- Optionally use dotagent bridging for cross-tool export

### Architecture (Straightforward)

- Core logic is file-system operations + Obsidian settings UI
- SKILL.md frontmatter is already machine-parseable YAML
- Progressive disclosure levels map naturally to a detail view
- Could extend to show skill usage stats, last-activated timestamps

### Security Consideration

- 341 malicious skills found on skill repositories by Feb 2026
- Any upload/install mechanism needs validation
- Consider: checksum verification, skill source tracking, sandbox testing

---

## 6. BRAT as Architectural Reference

BRAT (Beta Reviewers Auto-update Tool) is an existing Obsidian plugin that solves a near-identical problem for plugins — installing, managing, and updating items from GitHub repos via a settings UI. It serves as the ideal blueprint for a skills manager.

- Repo: [github.com/TfTHacker/obsidian42-brat](https://github.com/TfTHacker/obsidian42-brat) (869 stars, MIT license)
- Built in TypeScript (96.2%), uses Obsidian API + `semver`
- 12 contributors, actively maintained

### How BRAT Works

1. User provides a GitHub repo path (e.g., `TfTHacker/obsidian42-brat`)
2. BRAT downloads release files via GitHub API, places them in `.obsidian/plugins/`
3. Installed plugins appear in BRAT's settings panel **and** Obsidian's native Community Plugins tab
4. Auto-checks for updates, supports **version freezing** to pin a specific release
5. Supports **private repos** via GitHub personal access tokens
6. Command palette: "Add a beta plugin for testing", "Check for updates to all beta plugins"
7. Non-destructive removal — removing from BRAT keeps the plugin installed, just stops beta tracking

### BRAT → Skills Manager Mapping

| BRAT (Plugins) | Skills Manager (Skills) |
|---|---|
| Input: GitHub repo path `owner/repo` | Input: GitHub repo URL or ZIP upload |
| Downloads to `.obsidian/plugins/` | Downloads/extracts to `.claude/skills/` |
| Reads `manifest.json` for metadata | Reads `SKILL.md` YAML frontmatter for metadata |
| Toggle enable/disable in settings panel | Toggle enable/disable (move to `skills-disabled/` or JSON config) |
| Auto-update from GitHub releases | Auto-update from GitHub releases/commits |
| Version freezing via semver | Version freezing via release tags |
| GitHub PAT for private repos | Same — private skill repos |
| Shows in Community Plugins tab | Could surface in a custom Skills tab |
| Command palette integration | Same — "Add skill from GitHub", "Check for skill updates" |

### What BRAT's Codebase Provides

Key patterns to study and reuse:
- **GitHub API integration** — fetching releases, downloading assets, checking for updates
- **Settings tab rendering** — `PluginSettingTab` API, list of items with toggles and actions
- **Install/update lifecycle** — download → extract → place → enable → reload
- **Version management** — semver comparison, frozen versions, update notifications
- **PAT handling** — token validation, private repo access, rate limit management

### What's New Beyond BRAT

Features a skills manager would add that BRAT doesn't have:
- **ZIP upload** — BRAT is GitHub-only; skills manager should also accept local ZIP files
- **YAML frontmatter parsing** — instead of `manifest.json`, parse SKILL.md frontmatter
- **Skill validation** — check for required `name` + `description` fields, valid folder structure
- **Cross-tool awareness** — optionally integrate with dotagent to export enabled skills to Cursor/Copilot
- **Security scanning** — validate skill structure and check against known malicious patterns before enabling
- **Skills registry browsing** — integrate with skills.sh or a custom registry for discovery

---

## Sources & References

| Resource | URL |
|---|---|
| Agent Skills Spec | [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills) |
| Anthropic Skills | [github.com/anthropics/skills](https://github.com/anthropics/skills) |
| AGENTS.md Spec | [github.com/agentsmd/agents.md](https://github.com/agentsmd/agents.md) |
| dotagent | [github.com/johnlindquist/dotagent](https://github.com/johnlindquist/dotagent) |
| agent-config-adapter | [github.com/PrashamTrivedi/agent-config-adapter](https://github.com/PrashamTrivedi/agent-config-adapter) |
| Skills CLI | [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills) |
| Vercel Agent Skills | [github.com/vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| kepano/obsidian-skills | [github.com/kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) |
| BRAT | [github.com/TfTHacker/obsidian42-brat](https://github.com/TfTHacker/obsidian42-brat) |
