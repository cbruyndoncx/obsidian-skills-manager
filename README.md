# Obsidian Skills Manager

**Manage AI agent skills visually inside Obsidian** — install, toggle, update, and organize skills for Claude Code, Cursor, Copilot, and other AI coding agents.

---

## The Problem

AI coding agents use **skills** (packaged instructions in `SKILL.md` format) to learn specialized capabilities. But managing 50+ skills means:
- Manually editing frontmatter to enable/disable
- No overview of what's installed or active
- No easy way to install skills from GitHub or register local skill folders
- No update mechanism — you manually re-download
- No visibility across tools (Claude vs. Cursor vs. Copilot)

## The Solution

An Obsidian plugin that brings the **community plugins UX** to agent skills:

```
┌─────────────────────────────────────────────────────────┐
│  Skills Manager                              [+ Add]    │
├─────────────────────────────────────────────────────────┤
│  [Filter skills...                              ]       │
│  [Enable All] [Disable All] [Update All]                │
│                                                         │
│  ┌─ Marketing (3) ──────────────────────────────────┐   │
│  │  ☑ seo-audit              v2.0.1  [GitHub]  ⚠   │   │
│  │    Comprehensive SEO audit    [🔒] [↻] [🗑]      │   │
│  │  ☑ copywriting             v1.1.0  [Local]       │   │
│  │    Write marketing copy       [🗑]                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Business (2) ───────────────────────────────────┐   │
│  │  ☑ business-x-ray         v1.2.0  [GitHub]      │   │
│  │    ▼ Detail: Source: github · Repo: brncx/...    │   │
│  │      Files: SKILL.md, scripts/analyze.py         │   │
│  │      Security (safe): No threats detected        │   │
│  │  ☐ code-audit-web-full    v1.0.0  [Local]       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Settings ───────────────────────────────────────┐   │
│  │  Skills directory    .claude/skills/             │   │
│  │  GitHub PAT          ••••••••••••                │   │
│  │  Auto-update         ☑ Check on startup          │   │
│  │  Cross-tool export   ☑ Cursor  ☐ Copilot        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Features

- **Scan & list** all skills from `.claude/skills/` with name + description from YAML frontmatter
- **Toggle enable/disable** — flips `disable-model-invocation` in SKILL.md frontmatter (skills stay in place, like Obsidian's community-plugins.json pattern)
- **Install from GitHub** — provide `owner/repo`, downloads skill to `.claude/skills/`
- **Register local skills** — point to an existing skill folder in your vault
- **Auto-update** — checks for new versions on Obsidian startup
- **Version freezing** — pin a skill to a specific release tag
- **Private repos** — GitHub Personal Access Token support
- **Registry browsing** — browse skills.sh catalog from within Obsidian
- **Cross-tool export** — export enabled skills to Cursor, Copilot, Windsurf, Cline via dotagent patterns
- **Security scanning** — detect suspicious patterns (shell commands, network calls) in skill scripts
- **Bulk operations** — enable/disable all, update all (respects active search filter)
- **Search & filter** — find skills by name, description, or category
- **Skill detail view** — expand to see full SKILL.md content, file tree, metadata, and security scan results
- **Protocol handler** — install skills via `obsidian://skills-manager?action=install&repo=owner/repo`
- **Configurable skills path** — default `.claude/skills/`, customizable per vault

## Commands

| Command | Description |
|---|---|
| **List skills** | Open settings panel with skill overview |
| **Rescan skills** | Refresh the skills list from disk |
| **Add skill** | Open modal to install from GitHub or register local folder |
| **Check for updates** | Check all GitHub skills for new versions |
| **Update all skills** | Update all non-frozen GitHub skills to latest |
| **Browse registry** | Browse and install from skills.sh catalog |
| **Export to tools** | Write enabled skills to configured tool configs |

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

**From GitHub:**
1. Command palette → "Skills Manager: Add skill"
2. Enter `owner/repo` (e.g., `kepano/obsidian-skills`)
3. Plugin downloads and installs

**From Local Folder:**
1. Command palette → "Skills Manager: Add skill"
2. Enter the path to an existing skill folder (e.g., `.claude/skills/my-skill`)
3. Plugin validates structure (checks for `SKILL.md` with required frontmatter)

**Via Protocol Handler:**
Open `obsidian://skills-manager?action=install&repo=owner/repo` to install directly.

### Managing Skills

- Open Settings → Skills Manager to see all installed skills
- Toggle the checkbox to enable/disable (sets `disable-model-invocation` in SKILL.md frontmatter)
- Skills are grouped by category (marketing, obsidian, docs, etc.)
- Click a skill name to view full description, file tree, and security scan results
- Use search bar to filter by name, description, or category
- Use bulk buttons to enable/disable/update all visible skills

### Configuration

| Setting | Default | Description |
|---|---|---|
| Skills directory | `.claude/skills/` | Where skills are stored |
| GitHub PAT | — | Personal access token for private repos |
| Auto-update | On startup | When to check for skill updates |
| Cross-tool export | Off | Export skill state to Cursor/Copilot/Windsurf/Cline configs |

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
