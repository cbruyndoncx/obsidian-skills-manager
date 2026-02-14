# Development Guide

Technical specification and roadmap for the Obsidian Skills Manager plugin.

---

## Architecture

### Overview

The plugin scans the skills directory for `SKILL.md` files, parses their YAML frontmatter, and renders a settings panel with toggles. Enable/disable flips the `disable-model-invocation` frontmatter field in each skill's `SKILL.md` — skill folders stay in place, matching Obsidian's own pattern where `community-plugins.json` tracks enabled plugins without moving folders. GitHub integration follows BRAT's patterns for fetching releases and checking updates.

### Existing CLI Counterpart

A `skill-manager` skill already exists at `.claude/skills/skill-manager/` with Python scripts that implement the same enable/disable mechanism via CLI:

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/list-skills.py` | List skills with status, filter, generate SKILLS.md | `uv run scripts/list-skills.py [--filter enabled\|disabled] [--pretty] [--generate]` |
| `scripts/toggle-skills.py` | Enable/disable by name, glob, or category | `uv run scripts/toggle-skills.py <enable\|disable> <skill\|pattern\|category>` |

Both use `uv run` with inline script dependencies (click, rich). The Obsidian plugin provides the GUI layer on top of the same frontmatter-based mechanism.

### SKILL.md Frontmatter

```yaml
---
name: skill-name                    # Required
description: What this skill does   # Required
category: utilities                 # For grouping (marketing, seo, documents, diagramming, obsidian, notion, business, research, utilities)
disable-model-invocation: false     # true = skill is disabled
user-invocable: true                # Whether user can invoke directly
---
```

### State Management

The source of truth for enabled/disabled state is each skill's `SKILL.md` frontmatter (`disable-model-invocation: true/false`). The plugin's data file tracks supplementary metadata:
```json
{
  "skills": {
    "business-x-ray": {
      "source": "github",
      "repo": "brncx/business-x-ray",
      "version": "1.2.0",
      "frozen": false,
      "installedAt": "2026-02-14T10:00:00Z",
      "lastUpdated": "2026-02-14T10:00:00Z"
    },
    "seo-audit": {
      "source": "zip",
      "version": "1.0.0",
      "frozen": false,
      "installedAt": "2026-02-10T08:00:00Z"
    }
  },
  "settings": {
    "skillsDir": ".claude/skills",
    "githubPat": "",
    "autoUpdate": true,
    "crossToolExport": []
  }
}
```

### File Structure

```
obsidian-skills-manager/
├── manifest.json              # Obsidian plugin manifest
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript config
├── esbuild.config.mjs         # Build config
├── styles.css                 # Plugin styles
├── src/
│   ├── main.ts                # Plugin lifecycle (onload/onunload)
│   ├── settings.ts            # PluginSettingTab — main settings UI
│   ├── types.ts               # Interfaces and type definitions
│   ├── scanner.ts             # Scan skills directory, parse SKILL.md frontmatter
│   ├── github.ts              # GitHub API — fetch releases, download, update checks
│   ├── installer.ts           # ZIP upload + GitHub install + extract + validate
│   ├── state.ts               # skills-config.json read/write/merge
│   ├── validator.ts           # Skill structure validation + security checks
│   ├── exporter.ts            # Cross-tool export (dotagent-style)
│   └── ui/
│       ├── skill-card.ts      # Individual skill row in settings (toggle + metadata)
│       ├── add-modal.ts       # Modal: add skill from GitHub URL or ZIP
│       └── registry-modal.ts  # Modal: browse skills.sh registry
```

### Key Interfaces

```typescript
interface SkillMeta {
  name: string;                      // From SKILL.md frontmatter (required)
  description: string;               // From SKILL.md frontmatter (required)
  category?: string;                 // For UI grouping (marketing, seo, utilities, etc.)
  disableModelInvocation: boolean;   // true = disabled — the enable/disable toggle
  userInvocable?: boolean;           // Whether user can invoke directly
}

interface SkillState {
  source: 'local' | 'zip' | 'github';
  repo?: string;          // owner/repo for GitHub-sourced skills
  version?: string;
  frozen: boolean;
  installedAt: string;
  lastUpdated?: string;
}

interface PluginSettings {
  skillsDir: string;
  githubPat: string;
  autoUpdate: boolean;
  crossToolExport: string[];  // ['cursor', 'copilot', etc.]
}
```

---

## Obsidian APIs Used

| API | Purpose |
|---|---|
| `Plugin` | Lifecycle — `onload()`, `onunload()`, `addCommand()`, `addSettingTab()` |
| `PluginSettingTab` + `Setting` | Settings panel — toggles, text inputs, buttons, dropdowns |
| `Modal` | Dialogs — add skill from GitHub/ZIP, registry browser |
| `Notice` | Toast notifications — install success, update available |
| `requestUrl` | HTTP — GitHub API calls (no external deps needed) |
| `this.app.vault.adapter` | File system — read, write, mkdir, list, stat |
| `addCommand` | Command palette registration |
| `this.loadData()` / `this.saveData()` | Plugin data persistence (skills-config.json) |

---

## Build & Dev Setup

### Prerequisites
- Node.js 18+
- npm or pnpm

### Setup
```bash
# Clone into your vault's plugins directory for development
cd /path/to/vault/.obsidian/plugins/
git clone https://github.com/brncx/obsidian-skills-manager.git
cd obsidian-skills-manager

# Install dependencies
npm install

# Build (one-time)
npm run build

# Watch mode (auto-rebuild on change)
npm run dev
```

### Scripts
```json
{
  "dev": "node esbuild.config.mjs",
  "build": "node esbuild.config.mjs production"
}
```

### Dependencies
```json
{
  "devDependencies": {
    "@types/node": "^18.0.0",
    "esbuild": "^0.25.0",
    "obsidian": "latest",
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "semver": "^7.7.0"
  }
}
```

### Starter Template

Based on [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin). Copy `manifest.json`, `tsconfig.json`, `esbuild.config.mjs` from there as starting point.

---

## Phased Roadmap

### Phase 1 — MVP (Local Only)

**Goal**: Functional settings panel that lists skills with toggles and supports ZIP install.

**Tasks**:
1. Scaffold plugin from obsidian-sample-plugin template
2. Implement `scanner.ts` — read `skills/*/SKILL.md`, parse YAML frontmatter (name, description, category, disable-model-invocation, user-invocable)
3. Implement `state.ts` — plugin data persistence for supplementary metadata (source, version, timestamps)
4. Implement `settings.ts` — render skill list grouped by category with toggles using `Setting` API
5. Implement `skill-card.ts` — individual skill row (name, description, category badge, enabled toggle, source badge)
6. Implement enable/disable — toggle `disable-model-invocation` field in skill's SKILL.md frontmatter via `vault.adapter`
7. Implement `validator.ts` — check SKILL.md exists, has required `name` + `description` frontmatter
8. Implement `installer.ts` (ZIP only) — file picker, validate, extract
9. Implement `add-modal.ts` (ZIP tab only)
10. Register command palette commands: "List skills", "Add skill from ZIP"
11. Add `styles.css` for skill cards layout
12. Test with real skills from vault's skills directory

**Deliverable**: Working plugin that scans, lists, toggles, and installs skills from ZIP.

### Phase 2 — GitHub Integration

**Goal**: Install skills from GitHub repos, auto-update on startup.

**Tasks**:
1. Implement `github.ts` — fetch releases via `requestUrl`, download ZIP assets, parse manifest
2. Extend `installer.ts` — GitHub download + extract flow
3. Extend `add-modal.ts` — GitHub URL tab (input `owner/repo`)
4. Implement update checking — compare local version with latest GitHub release via semver
5. Add version freezing — option to pin specific release tag per skill
6. Add GitHub PAT setting — token input in settings, pass to `requestUrl` headers
7. Add startup hook — check for updates on `onload()`, show `Notice` for available updates
8. Register commands: "Add skill from GitHub", "Check for skill updates", "Update all skills"

**Deliverable**: BRAT-equivalent for skills. Install from GitHub, auto-update, version freeze.

### Phase 3 — Full Vision

**Goal**: Registry browsing, cross-tool export, security, bulk ops.

**Tasks**:
1. Implement `registry-modal.ts` — fetch skills.sh catalog, render browsable list with install buttons
2. Implement `exporter.ts` — write enabled skills to `.cursor/rules/`, `.github/copilot-instructions.md`, etc.
3. Add cross-tool export settings — checkboxes for which tools to export to
4. Add security scanning in `validator.ts` — check for suspicious patterns (shell commands, network calls in scripts/)
5. Add bulk operations — "Enable all", "Disable all", "Update all" buttons in settings
6. Add search/filter bar in settings panel
7. Add skill detail view — expand card to show full SKILL.md content, file tree, metadata

**Deliverable**: Complete skills management platform with registry, cross-tool support, and security.

---

## Reference Architecture: BRAT

Key patterns to study in [BRAT's source](https://github.com/TfTHacker/obsidian42-brat):

| BRAT Pattern | Our Equivalent |
|---|---|
| `manifest.json` parsing from GitHub | `SKILL.md` YAML frontmatter parsing |
| `community-plugins.json` enabled list | `disable-model-invocation` frontmatter field per skill |
| `PluginSettingTab` with plugin list | Settings tab with skill cards grouped by category |
| GitHub releases API integration | Same — download skill ZIP from releases |
| semver comparison for updates | Same — compare local vs. remote version |
| PAT token handling + rate limits | Same — store in settings, pass in headers |
| Protocol handler for `obsidian://brat` | Optional: `obsidian://skills-manager?install=owner/repo` |

---

## Security Considerations

- Validate SKILL.md structure before enabling (required fields, sane values)
- Check `scripts/` for suspicious patterns (network calls, system commands, file deletion)
- Track skill source (local/zip/github) in state for audit trail
- Never execute scripts automatically — skills are instructions, not code
- Consider: checksum verification for GitHub-sourced skills
- Reference: 341 malicious skills found on skill repositories by Feb 2026

---

## Resources

| Resource | URL |
|---|---|
| Obsidian Plugin Docs | https://docs.obsidian.md/Plugins |
| Obsidian Sample Plugin | https://github.com/obsidianmd/obsidian-sample-plugin |
| BRAT (architecture ref) | https://github.com/TfTHacker/obsidian42-brat |
| Agent Skills Spec | https://github.com/agentskills/agentskills |
| Anthropic Skills | https://github.com/anthropics/skills |
| dotagent (cross-tool) | https://github.com/johnlindquist/dotagent |
| Skills CLI / skills.sh | https://github.com/vercel-labs/skills |
| kepano/obsidian-skills | https://github.com/kepano/obsidian-skills |
