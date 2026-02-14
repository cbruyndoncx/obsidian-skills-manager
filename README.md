# Obsidian Skills Manager

**Manage AI agent skills visually inside Obsidian** — install, toggle, update, and organize skills for Claude Code, Cursor, Copilot, and other AI coding agents.

---

## The Problem

AI coding agents use **skills** (packaged instructions in `SKILL.md` format) to learn specialized capabilities. But managing 50+ skills means:
- Manually editing frontmatter to enable/disable
- No overview of what's installed or active
- No easy way to install skills from GitHub or ZIP files
- No update mechanism — you manually re-download
- No visibility across tools (Claude vs. Cursor vs. Copilot)

## The Solution

An Obsidian plugin that brings the **community plugins UX** to agent skills:

```
┌─────────────────────────────────────────────────────────┐
│  Skills Manager                              [+ Add]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Installed Skills ─────────────────────────────────┐ │
│  │                                                     │ │
│  │  ☑ business-x-ray              v1.2.0  [GitHub]   │ │
│  │    Map and diagnose business operations             │ │
│  │                                                     │ │
│  │  ☑ seo-audit                   v2.0.1  [GitHub]   │ │
│  │    Comprehensive SEO audit with technical checks    │ │
│  │                                                     │ │
│  │  ☐ code-audit-web-full         v1.0.0  [Local]    │ │
│  │    Static code audit for web application quality    │ │
│  │                                                     │ │
│  │  ☑ copywriting                 v1.1.0  [ZIP]      │ │
│  │    Write marketing copy for any page type           │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Settings ─────────────────────────────────────────┐ │
│  │  Skills directory    .claude/skills/               │ │
│  │  GitHub PAT          ••••••••••••                  │ │
│  │  Auto-update         ☑ Check on startup            │ │
│  │  Cross-tool export   ☐ Cursor  ☐ Copilot          │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Features

### Core (Phase 1)
- **Scan & list** all skills from `.claude/skills/` with name + description from YAML frontmatter
- **Toggle enable/disable** — flips `disable-model-invocation` in SKILL.md frontmatter (skills stay in place, like Obsidian's community-plugins.json pattern)
- **ZIP upload** — upload a skill ZIP, validate structure, extract to skills directory
- **Command palette** — "List skills", "Enable/disable skill", "Add skill from ZIP"
- **Configurable skills path** — default `.claude/skills/`, customizable per vault

### GitHub Integration (Phase 2)
- **Install from GitHub** — provide `owner/repo`, downloads skill to `.claude/skills/`
- **Auto-update** — checks for new versions on Obsidian startup
- **Version freezing** — pin a skill to a specific release tag
- **Private repos** — GitHub Personal Access Token support
- **Update notifications** — badge or notice when updates are available

### Full Vision (Phase 3)
- **Registry browsing** — browse skills.sh or custom registries from within Obsidian
- **Cross-tool export** — export enabled skills to Cursor, Copilot, Windsurf via dotagent patterns
- **Security scanning** — validate skill structure before enabling
- **Bulk operations** — enable/disable all, update all
- **Search & filter** — find skills by name, tag, or description

## Installation

### From Community Plugins (when published)
1. Open Settings → Community Plugins → Browse
2. Search "Skills Manager"
3. Install and enable

### Beta via BRAT
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `brncx/obsidian-skills-manager`
3. Enable the plugin

### Manual
1. Download the latest release from [Releases](https://github.com/brncx/obsidian-skills-manager/releases)
2. Extract to `.obsidian/plugins/obsidian-skills-manager/`
3. Reload Obsidian and enable the plugin

## Usage

### Adding Skills

**From ZIP:**
1. Command palette → "Skills Manager: Add skill from ZIP"
2. Select ZIP file
3. Plugin validates structure (checks for `SKILL.md` with required frontmatter)
4. Extracts to `.claude/skills/`

**From GitHub (Phase 2):**
1. Command palette → "Skills Manager: Add skill from GitHub"
2. Enter `owner/repo` (e.g., `kepano/obsidian-skills`)
3. Plugin downloads and installs

### Managing Skills

- Open Settings → Skills Manager to see all installed skills
- Toggle the checkbox to enable/disable (sets `disable-model-invocation` in SKILL.md frontmatter)
- Skills are grouped by category (marketing, obsidian, docs, etc.)
- Click a skill name to view full description and metadata

### Configuration

| Setting | Default | Description |
|---|---|---|
| Skills directory | `.claude/skills/` | Where skills are stored |
| GitHub PAT | — | Personal access token for private repos |
| Auto-update | On startup | When to check for skill updates |
| Cross-tool export | Off | Export skill state to Cursor/Copilot configs |

## Compatibility

This plugin manages skills following the [Agent Skills Specification](https://github.com/agentskills/agentskills) — an open standard adopted by 20+ platforms:

- **Claude Code** — native `.claude/skills/` support
- **Cursor** — via dotagent export to `.cursor/rules/`
- **GitHub Copilot** — via dotagent export to `.github/copilot-instructions.md`
- **Codex, Gemini CLI, Windsurf** — via dotagent cross-tool export

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture, build instructions, and roadmap.

## License

MIT

## Credits

- Architecture inspired by [BRAT](https://github.com/TfTHacker/obsidian42-brat) by TfTHacker
- Skills format follows the [Agent Skills Specification](https://github.com/agentskills/agentskills) by Anthropic
- Cross-tool bridging inspired by [dotagent](https://github.com/johnlindquist/dotagent)
