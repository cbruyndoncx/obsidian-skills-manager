# Changelog

## 0.1.0

Initial release of Obsidian Skills Manager.

### Features

- **Skill scanning** — automatically discovers `SKILL.md` files and parses YAML frontmatter
- **Enable/disable toggles** — flips `disable-model-invocation` frontmatter field, keeping skill folders in place
- **Install from GitHub** — provide `owner/repo` to download and install skills from GitHub releases
- **Install from ZIP** — upload and extract skill archives with structure validation
- **Auto-update** — checks GitHub skills for new versions on Obsidian startup
- **Version freezing** — pin skills to specific release tags to prevent auto-updates
- **GitHub PAT support** — authenticate for private repos and higher rate limits
- **Registry browsing** — browse and install skills from the skills.sh catalog (all-time, trending, hot)
- **Cross-tool export** — export enabled skills to Cursor, Copilot, Windsurf, and Cline configs
- **Security scanning** — detect suspicious patterns (shell commands, network calls, file deletion) in skill scripts
- **Bulk operations** — enable all, disable all, update all (respects active search filter)
- **Search & filter** — filter skills by name, description, or category with debounced input
- **Skill detail view** — expand skill rows to see full SKILL.md body, file tree, metadata, and security results
- **Protocol handler** — install via `obsidian://skills-manager?action=install&repo=owner/repo`
- **Category grouping** — skills organized by category with collapsible sections
- **Two-click delete** — delete skills with confirmation to prevent accidents
- **7 command palette commands** — list, rescan, add, check updates, update all, browse registry, export
