# Full Code Review

## Findings (Prioritized)

1. **High**: GitHub skill updates persist the wrong `version`, which can break future update checks.  
`src/installer.ts:177` writes `version: targetVersion || result.skillName`; `result.skillName` is folder/repo name, not a semver tag. `checkForUpdate` then fails semver coercion at `src/github.ts:205`.

2. **High**: Cross-tool export toggles can overwrite each other due to stale closure state.  
`src/settings.ts:106` captures `current` once; `src/settings.ts:109` computes updates from that stale array, so enabling target B can drop target A.

3. **High**: GitHub installs are often incomplete (missing scripts/references) unless release assets include everything.  
`src/github.ts:160` + `src/github.ts:173` only fetch `SKILL.md` and release assets; no repo-tree/archive fetch path is implemented.

4. **Medium**: “Install” is disabled when a repo has no releases, even though installer has a fallback path.  
`src/ui/add-modal.ts:204` blocks install if `releases.length === 0`.

5. **Medium**: Install is non-atomic and can leave partial files behind on validation failure.  
Writes happen first at `src/installer.ts:100`, validation happens afterward at `src/installer.ts:106`, with no rollback.

6. **Medium**: Type-checking is broken in current dependency setup.  
`npx tsc --noEmit` fails for missing `tslib` helpers and missing `semver` typings. `package.json:10` / `package.json:17` do not include `tslib` and `@types/semver`.

7. **Medium**: Directory creation may fail on fresh vaults if parent folders do not already exist.  
`src/installer.ts:94` and `src/exporter.ts:80` call single-step `mkdir` on nested paths.

8. **Medium**: State initialization uses shallow copy of defaults, sharing nested object references.  
`src/state.ts:15` (`this.data = { ...DEFAULT_DATA }`) shares `skills`/`settings` object references from constant defaults.

9. **Low**: Auto-export on toggle is fire-and-forget with no error handling.  
`src/settings.ts:320` calls `exportSkills(...)` without `await` or catch.

10. **Low**: Threat scan cache is not invalidated after skill updates/rescans.  
Cache defined at `src/settings.ts:26`; reused at `src/settings.ts:463` with no clear strategy.

11. **Low**: Protocol install path skips repo normalization/validation.  
`src/main.ts:23` and `src/main.ts:30` pass `params.repo` directly to installer (unlike modal flow).

12. **Low**: Docs and implementation are out of sync on ZIP support.  
Docs claim ZIP install (`README.md:56`, `README.md:107`), but UI/installer only implement local+GitHub (`src/ui/add-modal.ts:8`, `src/installer.ts:10`).

## Verification Run

- `npm run build`: passes.
- `npx tsc --noEmit`: fails (missing `tslib`, missing `@types/semver`).
- No automated tests were found/executed.
