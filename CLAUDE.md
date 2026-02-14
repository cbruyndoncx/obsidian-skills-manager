# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian Skills Manager — an Obsidian plugin that provides a visual GUI for managing AI agent skills (Claude Code, Cursor, Copilot, etc.). Skills are packaged instructions in `SKILL.md` format following the Agent Skills Specification.

**Status**: Design/planning phase — architecture docs exist but no source code yet. Implementation should follow the phased roadmap in DEVELOPMENT.md.

## Build & Dev Commands

```bash
npm install          # Install dependencies
npm run dev          # Watch mode (auto-rebuild via esbuild)
npm run build        # Production build
```

Build uses esbuild via `esbuild.config.mjs`. Based on the obsidian-sample-plugin template.

## Architecture

### Enable/Disable Mechanism

Skills are toggled via the `disable-model-invocation` frontmatter field in each skill's `SKILL.md` — **not** by moving folders. This matches Obsidian's own pattern where `community-plugins.json` is an array of enabled plugin IDs while plugin folders stay in place. The Obsidian plugin should maintain a similar JSON array of enabled skill names.

A reference implementation already exists as a skill itself at `.claude/skills/skill-manager/` with Python scripts:
- `scripts/list-skills.py` — lists skills with status, categories, optional SKILLS.md generation
- `scripts/toggle-skills.py` — toggles `disable-model-invocation: true/false` in SKILL.md frontmatter

Both scripts use `uv run` with inline dependencies (click, rich). The Obsidian plugin provides the GUI layer on top of this same mechanism.

### SKILL.md Frontmatter Fields

```yaml
---
name: skill-name
description: What this skill does
category: utilities          # For grouping in UI
disable-model-invocation: false  # true = disabled
user-invocable: true         # Whether user can invoke directly
---
```

### Core Data Flow

1. **Scanner** (`scanner.ts`) reads `skills/*/SKILL.md`, parses YAML frontmatter → `SkillMeta`
2. **State** (`state.ts`) persists skill state via Obsidian's `loadData()`/`saveData()`
3. **Settings UI** (`settings.ts`) renders skill list with toggles using Obsidian's `Setting` API
4. **Enable/disable** flips `disable-model-invocation` in the skill's SKILL.md frontmatter

### Skill Categories

Skills are organized by category (from frontmatter): marketing, seo, documents, diagramming, obsidian, notion, business, research, utilities. The existing Python scripts define category-to-glob mappings for bulk operations (e.g., `obsidian` → `obsidian-*`, `cro` → `*-cro`).

### Key Types (defined in `types.ts`)

- `SkillMeta`: Parsed from SKILL.md frontmatter — name, description, category, disable-model-invocation, user-invocable
- `SkillState`: Runtime state — enabled, source (`local`|`zip`|`github`), repo, version, frozen
- `PluginSettings`: Plugin config — skillsDir, githubPat, autoUpdate, crossToolExport

### Obsidian API Patterns

- Use `requestUrl` for HTTP (GitHub API) — no external HTTP dependencies needed
- Use `this.app.vault.adapter` for all file system operations (read, write, mkdir, list, stat)
- Use `Modal` for dialogs, `Notice` for toasts, `Setting` for form elements
- Plugin lifecycle via `onload()`/`onunload()` on the `Plugin` class

### Reference Implementation

Architecture modeled after [BRAT](https://github.com/TfTHacker/obsidian42-brat) — same patterns for GitHub API integration, settings panel with item toggles, semver-based update checking, and PAT token handling.

## Implementation Phases

- **Phase 1 (MVP)**: Scanner, state, settings UI, toggles, ZIP install, command palette
- **Phase 2 (GitHub)**: GitHub install/update via releases API, semver, version freezing, PAT support
- **Phase 3 (Full)**: Registry browsing (skills.sh), cross-tool export (dotagent), security scanning, bulk ops

## Key Design Decisions

- Enable/disable toggles a frontmatter field, keeping all skill folders in place (like Obsidian's community-plugins.json pattern)
- Skills are instructions-only — scripts exist but are never auto-executed
- The skill-manager skill itself (`scripts/toggle-skills.py`, `scripts/list-skills.py`) is the CLI counterpart to this GUI plugin
- Only dependency beyond devDeps is `semver` for version comparison
- Cross-tool export writes to `.cursor/rules/`, `.github/copilot-instructions.md` etc. via dotagent patterns

## Reference Vault

The developer's vault with 100+ real skills is at `/mnt/d/OBS/brncx-skills/` with skills in `00-CORE/Agents/skills/`. Use this for testing against real skill structures.
