# Obsidian Skills Manager

**Manage AI agent skills visually inside Obsidian** — install, toggle, update, and organize skills for Claude Code, Cursor, Copilot, and other AI coding agents.

## What Are Skills?

Skills are packaged instructions in `SKILL.md` format that teach AI agents specialized capabilities. Each skill lives in its own folder with a `SKILL.md` file containing YAML frontmatter (metadata) and markdown instructions. This plugin provides a GUI to manage them — similar to how Obsidian manages community plugins.

## Features

| Feature | Notes |
|---------|-------|
| Scan & list skills | Reads `SKILL.md` frontmatter from skills directory |
| Toggle enable/disable | Flips `disable-model-invocation` in SKILL.md |
| Collapsible categories | Groups skills by category, all collapsed by default |
| Search & filter | Filter by name (optionally description), auto-expands matches |
| Skill detail view | Expand to see metadata, file tree, instructions, threats |
| Install from GitHub | Standard `owner/repo` or full URL |
| Install from monorepo | Auto-discovers skill subfolder in multi-skill repos |
| Install from ZIP | Drag-and-drop or file picker with multi-skill detection |
| Install from local folder | Register existing skill folder in vault |
| Marketplace browsing | Browse Skills.sh and SkillsMP from settings tab |
| Version checking | Compares local version against GitHub releases (semver) |
| Version freezing | Lock a skill to prevent auto-updates |
| Auto-update on startup | Checks unfrozen GitHub skills 60s after load |
| Bulk enable/disable/update | Operates on visible (filtered) skills |
| Cross-tool export | Exports to Cursor, Copilot, Windsurf, Cline |
| SKILLS.md index | Auto-generates skill index with slash commands section |
| Security scanning | Detects suspicious patterns in skill files |
| Protocol handler | `obsidian://skills-manager?action=install&repo=owner/repo` |
| Frontmatter normalization | Auto-fills missing standard fields on install |
| Skills View panel | Sidebar split-pane view with source filtering |

---

## Settings Tab

All management happens in **Settings > Skills Manager**. The tab has three sections:

### Configuration (collapsed by default)

Click the **Configuration** heading to expand. Contains:

- **Skills directory** — path relative to vault root (default: `.claude/skills`)
- **GitHub PAT** — Personal Access Token for private repos and higher rate limits
- **Auto-check for updates** — toggle to check on startup
- **Default category** — category assigned to skills missing one
- **Custom categories** — comma-separated list of additional categories
- **Generate SKILLS.md** — toggle to auto-generate a skill index at vault root
- **Marketplace registries** — add/remove/configure registry sources
- **Cross-tool export** — toggle and configure export targets

### Installed Tab

Shows all skills found in your skills directory, grouped by category.

- **Categories are collapsible** — click a category header to expand/collapse
- **Per-category toggle** — enable/disable all skills in a category
- **Search bar** — filters skills by name (toggle to include description)
- **Stats line** — total skills, enabled/disabled count
- **Bulk buttons** — Enable All, Disable All, Update All (GitHub skills)
- **Per-skill controls:**
  - Toggle switch (enable/disable)
  - Category, source, version badges
  - Lock icon (freeze/unfreeze version) — GitHub skills only
  - Refresh icon (check for update) — GitHub skills only
  - Edit icon (open SKILL.md in editor)
  - Trash icon (delete with 2-click confirmation)
  - Click skill name to expand detail panel
- **Detail panel** (expanded per-skill):
  - Category dropdown
  - Auto-loading toggle
  - User-invocable toggle
  - File list
  - SKILL.md body preview
  - Security threat details

### Marketplace Tab

Browse and install skills from online registries.

- **Registry selector** — switch between configured registries
- **Board tabs** — sort options (All Time, Trending, Hot for Skills.sh)
- **Search/filter** — filter displayed results
- **Install button** — installs skill and shows result in activity log
- **Activity log** — shows install results with category placement
- **Clickthrough links** — skill names link to GitHub source
- **Load more** — pagination for large result sets

---

## Install Methods

### From GitHub (standard repo)

For repos where `SKILL.md` is at the root:

1. Settings > Skills Manager > Installed tab > **+ Add Skill**
2. Switch to the **Install** tab
3. Enter `owner/repo` (e.g., `kepano/obsidian-skills`)
4. Click **Fetch Versions** to see available releases
5. Click **Install**

Supports multiple input formats: `owner/repo`, full GitHub URLs, `owner/repo/path/to/subfolder`.

### From GitHub (monorepo)

For repos containing multiple skills in subdirectories:

1. Same as above, but enter `owner/repo/path/to/skill`
2. Or install from the Marketplace tab — monorepo detection is automatic

**How monorepo detection works:** When a skill's `skillId` from the registry doesn't match the repo name, the installer:
1. Tries the `skillId` as a direct subfolder path
2. If that fails, searches the repo tree for all `SKILL.md` files
3. Matches by folder name, partial name match, or SKILL.md `name` field
4. Installs from the resolved path

### From ZIP

1. **+ Add Skill** > **Upload ZIP** tab
2. Drag and drop a `.zip` file or click to browse
3. Preview detected skills (single or multi-skill ZIPs)
4. Click **Install** for each skill or install all

### From Local Folder

1. **+ Add Skill** > **Install** tab
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

Every skill should have these standard fields in its SKILL.md frontmatter. The installer auto-fills missing fields on install. A template file is written to the skills directory for reference.

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

Skills with unrecognized categories appear under **Other**. Custom categories can be added in settings.

### Obsidian Bases Compatibility

All frontmatter fields are queryable via Obsidian Bases for database views. You can create views showing:
- Enabled vs. disabled skills (`disable-model-invocation`)
- Skills grouped by category
- Version tracking
- Source attribution (`origin-repo`, `source`)

---

## SKILLS.md Index

When enabled in settings (**Generate SKILLS.md**), the plugin auto-generates a `SKILLS.md` file at the vault root containing:

- All enabled skills grouped by category
- Skill name, description, and file path
- **Slash commands** section listing user-invocable skills with their file paths

The index regenerates automatically when skills are toggled or updated.

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
| [Tessl](https://tessl.io) | Not available | — | No public REST API (CLI only) |

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

- **Warning** — potentially risky patterns: `curl`, `wget`, `exec()`, network requests, credential access
- **Danger** — high-risk patterns: `rm -rf`, `eval()`, `curl|bash`, prompt injection attempts

### What's Scanned

- SKILL.md body content
- Files in `scripts/` subdirectory
- Prompt injection patterns (e.g., "ignore previous instructions", role overrides, hidden comments)

### UI Indicators

- Badge on skill row: `warning` or `danger`
- Tooltip with threat details
- Full threat list in expanded detail panel

---

## Skills View Panel

Open via command palette (**Open skills view**) or the ribbon icon. Provides a split-pane sidebar view:

- **Left pane** — searchable skill list with source filter (All, Local, GitHub, ZIP)
- **Right pane** — detailed view of selected skill:
  - Metadata table (category, version, origin, repo, license, etc.)
  - Auto-loading and user-invocable toggles
  - File tree
  - Full SKILL.md body
  - Security scan results
  - Update check with update button (GitHub skills)

---

## Command Palette

| Command | Description |
|---------|-------------|
| List skills | Open settings panel |
| Rescan skills | Refresh skill list from disk |
| Add skill | Open install modal |
| Check for updates | Check all GitHub skills for new versions |
| Update all skills | Update all unfrozen GitHub skills |
| Browse registry | Open registry browsing modal |
| Open skills view | Open sidebar split-pane view |
| Export to tools | Export enabled skills to tool configs |

---

## Known Limitations

- **Tessl registry** — no public REST API available (CLI only)
- **Monorepo updates** — no release-based version tracking for monorepo skills
- **No install cancellation** — running installs cannot be cancelled
- **GitHub rate limits** — unauthenticated requests limited to 60/hour (add PAT for 5000/hour)
- **Cross-tool export format** — all targets get the same combined markdown format
- **Frozen state** — stored in plugin data only (not in SKILL.md frontmatter)
- **Registry search** — only SkillsMP supports server-side search; Skills.sh filters client-side

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

```bash
npm run dev    # Watch mode (auto-rebuild)
npm run build  # Production build
```

### Dependencies

- **Runtime**: `semver` (version comparison), `jszip` (ZIP extraction)
- **Dev**: `esbuild`, `typescript`, `obsidian` API types

### Project Structure

```
src/
├── main.ts                 # Plugin lifecycle, commands, protocol handler
├── types.ts                # Type definitions (SkillMeta, SkillState, etc.)
├── scanner.ts              # Read & parse SKILL.md files from vault
├── state.ts                # Persist skill state via Obsidian data API
├── settings.ts             # Settings tab UI (config, installed, marketplace)
├── toggler.ts              # Toggle frontmatter fields in SKILL.md
├── installer.ts            # Install/update/delete skills (local, GitHub, ZIP)
├── github.ts               # GitHub API integration (releases, trees, monorepos)
├── exporter.ts             # Cross-tool export (Cursor, Copilot, etc.)
├── registry.ts             # Marketplace registry providers
├── validator.ts            # Skill validation & security scanning
├── frontmatter-template.ts # Standard frontmatter template
└── ui/
    ├── add-modal.ts        # Add skill modal (ZIP upload + remote install)
    ├── registry-modal.ts   # Registry browsing modal
    └── skills-view.ts      # Sidebar split-pane skills view
```

## Credits

- Architecture inspired by [BRAT](https://github.com/TfTHacker/obsidian42-brat) by TfTHacker
- Skills format follows the [Agent Skills Specification](https://github.com/agentskills/agentskills)
- Cross-tool bridging inspired by [dotagent](https://github.com/johnlindquist/dotagent)

## License

MIT
