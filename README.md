# Obsidian Skills Manager

**Manage AI agent skills visually inside Obsidian** — install, toggle, update, and organize skills for Claude Code, Cursor, Copilot, and other AI coding agents.

## What Are Skills?

Skills are packaged instructions in `SKILL.md` format that teach AI agents specialized capabilities. Each skill lives in its own folder with a `SKILL.md` file containing YAML frontmatter (metadata) and markdown instructions. This plugin provides a GUI to manage them — similar to how Obsidian manages community plugins.

## Features Overview

| Feature | Status | Notes |
|---------|--------|-------|
| Scan & list skills | Working | Reads `SKILL.md` frontmatter from skills directory |
| Toggle enable/disable | Working | Flips `disable-model-invocation` in SKILL.md |
| Collapsible categories | Working | Groups skills by category, all collapsed by default |
| Search & filter | Working | Filter by name, description, or category |
| Skill detail view | Working | Expand skill to see metadata, file tree, instructions |
| Install from GitHub | Working | Standard `owner/repo` format |
| Install from monorepo | Working | Auto-discovers skill subfolder in multi-skill repos |
| Install from local folder | Working | Register existing skill folder in vault |
| Install from ZIP | Not implemented | Type exists but no UI or extraction logic |
| Marketplace browsing | Working | Browse Skills.sh and SkillsMP from settings tab |
| Tessl registry | Not implemented | No public REST API; CLI only |
| Version checking | Working | Compares local version against GitHub releases (semver) |
| Version freezing | Working | Lock a skill to prevent auto-updates |
| Auto-update on startup | Working | Checks unfrozen GitHub skills 60s after load |
| Bulk enable/disable/update | Working | Operates on visible (filtered) skills |
| Cross-tool export | Working | Exports to Cursor, Copilot, Windsurf, Cline |
| Security scanning | Working | Detects suspicious patterns in skill files |
| Protocol handler | Working | `obsidian://skills-manager?action=install&repo=owner/repo` |
| Frontmatter normalization | Working | Auto-fills missing standard fields on install |
| Skills View panel | Working | Sidebar split-pane view (separate from settings) |

---

## Settings Tab

All management happens in **Settings > Skills Manager**. The tab has three sections:

### Configuration (collapsed by default)

Click the **Configuration** heading to expand. Contains:

- **Skills directory** — path relative to vault root (default: `.claude/skills`)
- **GitHub PAT** — Personal Access Token for private repos and higher rate limits
- **Auto-check for updates** — toggle to check on startup
- **Marketplace registries** — add/remove/configure registry sources
- **Cross-tool export** — toggle and configure export targets

### Installed Tab

Shows all skills found in your skills directory, grouped by category.

- **Categories are collapsible** — click a category header to expand/collapse
- **Search bar** — filters skills and auto-expands matching categories
- **Stats line** — total skills, enabled/disabled count
- **Bulk buttons** — Enable All, Disable All, Update All
- **Per-skill controls:**
  - Toggle switch (enable/disable)
  - Category, source, version badges
  - Lock icon (freeze/unfreeze version)
  - Refresh icon (check for update)
  - Trash icon (delete with confirmation)
  - Click skill name to expand detail panel

### Marketplace Tab

Browse and install skills from online registries.

- **Registry selector** — switch between configured registries
- **Board tabs** — sort options (All Time, Trending, Hot for Skills.sh)
- **Search/filter** — filter displayed results
- **Install button** — installs skill and shows result in activity log
- **Activity log** — shows install results with category placement
- **Clickthrough links** — skill names link to GitHub source

---

## Install Methods

### From GitHub (standard repo)

For repos where `SKILL.md` is at the root:

1. Settings > Skills Manager > Installed tab > **+ Add Skill**
2. Switch to **Remote** tab
3. Enter `owner/repo` (e.g., `kepano/obsidian-skills`)
4. Click **Fetch Versions** to see available releases
5. Click **Install**

### From GitHub (monorepo)

For repos containing multiple skills in subdirectories (e.g., `vercel-labs/agent-skills`):

1. Same as above, but enter `owner/repo/path/to/skill`
2. Or install from the Marketplace tab — monorepo detection is automatic

**How monorepo detection works:** When a skill's `skillId` from the registry doesn't match the repo name, the installer:
1. Tries the `skillId` as a direct subfolder path
2. If that fails, searches the repo tree for all `SKILL.md` files
3. Matches by folder name, partial name match, or SKILL.md `name` field
4. Installs from the resolved path

### From Local Folder

1. **+ Add Skill** > **Local** tab
2. Enter path relative to vault root
3. Validates SKILL.md structure before registering

### From Marketplace

1. Switch to **Marketplace** tab in settings
2. Browse or search for skills
3. Click **Install** — the activity log shows success/failure and category

### Via Protocol Handler

Open this URL to install directly:
```
obsidian://skills-manager?action=install&repo=owner/repo
```

---

## SKILL.md Frontmatter Template

Every skill should have these standard fields in its SKILL.md frontmatter. The installer auto-fills missing fields on install.

```yaml
---
name: skill-name
description: What this skill does
category: utilities
version: 1.0.0
disable-model-invocation: false
user-invocable: true
source: github
origin-repo: owner/repo
origin-url: https://github.com/owner/repo
---
```

### Field Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | — | Skill identifier (kebab-case) |
| `description` | Yes | — | What the skill does |
| `category` | Yes | `utilities` | Grouping category (see list below) |
| `version` | No | `1.0.0` | Semantic version |
| `disable-model-invocation` | Yes | `false` | `true` = disabled, `false` = enabled |
| `user-invocable` | Yes | `true` | Whether users can invoke directly |
| `source` | No | — | Install source: `github`, `local`, `zip` |
| `origin-repo` | No | — | GitHub `owner/repo` reference |
| `origin-url` | No | — | Full URL to source |
| `origin` | No | — | Author/creator attribution |
| `license` | No | — | License identifier |

### Categories

`marketing`, `seo`, `documents`, `diagramming`, `obsidian`, `notion`, `business`, `research`, `development`, `productivity`, `sales`, `utilities`

Skills with unrecognized categories appear under **Other**.

### Obsidian Bases Compatibility

All frontmatter fields are queryable via Obsidian Bases for database views. You can create views showing:
- Enabled vs. disabled skills (`disable-model-invocation`)
- Skills grouped by category
- Version tracking
- Source attribution (`origin-repo`, `source`)

---

## Version Management

### How Updates Work

1. **Check for update** — compares local version tag against latest GitHub release using semver
2. **Update** — re-downloads the skill from the latest (or selected) release
3. **Version freeze** — lock icon prevents a skill from being updated

### Limitations

| Scenario | Update Support |
|----------|---------------|
| Standalone GitHub repo with releases | Full support (semver comparison) |
| Monorepo skills | Limited — no release-based versioning |
| Local skills | No update checking |
| Skills without version tags | Cannot compare versions |

**Freeze/unfreeze state** is stored in the plugin's `data.json` (not in SKILL.md frontmatter).

---

## Marketplace Registries

### Supported Registries

| Registry | Status | Auth | Boards |
|----------|--------|------|--------|
| [Skills.sh](https://skills.sh) | Working | None | All Time, Trending, Hot |
| [SkillsMP](https://skillsmp.com) | Working | API key required | Most Stars, Recent |
| [Tessl](https://tessl.io) | Not working | — | No public REST API |

### Adding a Registry

1. Expand **Configuration** in settings
2. Scroll to **Marketplace registries**
3. Click **+ Add registry**
4. Select type, set name and URL
5. For SkillsMP: enter API key (get one at skillsmp.com/settings/api)

### Default

Skills.sh is configured by default. No API key needed.

---

## Cross-Tool Export

Export enabled skills to other AI tool configurations:

| Target | Output Path | Format |
|--------|------------|--------|
| Cursor | `.cursor/rules/skills.md` | Combined markdown |
| GitHub Copilot | `.github/copilot-instructions.md` | Combined markdown |
| Windsurf | `.windsurf/rules/skills.md` | Combined markdown |
| Cline | `.clinerules/skills.md` | Combined markdown |

### How It Works

- Only **enabled** skills are exported
- All skill instructions are concatenated into a single file per target
- Directories are created automatically
- Export runs automatically when toggling skills (if enabled)
- Manual export via command palette: **Skills Manager: Export to tools**

---

## Security Scanning

Skills are scanned for suspicious patterns on install and display.

### Threat Levels

- **Warning** — potentially risky patterns: `curl`, `wget`, `exec()`, network requests
- **Danger** — high-risk patterns: `rm -rf`, `eval()`, `curl|bash`, prompt injection attempts

### What's Scanned

- SKILL.md body content
- Files in `scripts/` subdirectory
- Prompt injection patterns (e.g., "ignore previous instructions", role overrides)

### UI Indicators

- Badge on skill row: `warning` or `danger`
- Tooltip with threat details
- Full threat list in expanded detail panel

---

## Command Palette

| Command | Description |
|---------|-------------|
| List skills | Open settings panel |
| Rescan skills | Refresh skill list from disk |
| Add skill | Open install modal (local or remote) |
| Check for updates | Check all GitHub skills for new versions |
| Update all skills | Update all unfrozen GitHub skills |
| Browse registry | Open registry browsing modal |
| Open skills view | Open sidebar split-pane view |
| Export to tools | Export enabled skills to tool configs |

---

## Known Limitations

- **ZIP installation** — type defined but no implementation (no upload/extract UI)
- **Tessl registry** — no public REST API available
- **Monorepo updates** — no release-based version tracking for monorepo skills
- **No install cancellation** — running installs cannot be cancelled
- **GitHub rate limits** — unauthenticated requests limited to 60/hour (add PAT for 5000/hour)
- **Cross-tool export format** — all targets get the same combined markdown format (no customization)
- **Frozen state** — stored in plugin data only (not in SKILL.md frontmatter, not visible to Bases)

---

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from releases
2. Create `.obsidian/plugins/obsidian-skills-manager/` in your vault
3. Copy the three files there
4. Reload Obsidian and enable the plugin in Settings > Community Plugins

### Beta via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `brncx/obsidian-skills-manager`
3. Enable the plugin

### Build from Source

```bash
npm install
npm run build
```

Output: `main.js` in project root.

---

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture details and build instructions.

```bash
npm run dev    # Watch mode (auto-rebuild)
npm run build  # Production build
```

## Credits

- Architecture inspired by [BRAT](https://github.com/TfTHacker/obsidian42-brat) by TfTHacker
- Skills format follows the [Agent Skills Specification](https://github.com/agentskills/agentskills)
- Cross-tool bridging inspired by [dotagent](https://github.com/johnlindquist/dotagent)

## License

MIT
