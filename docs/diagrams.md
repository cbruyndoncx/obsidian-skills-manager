# Flow Schematics

## Plugin Startup and Settings Flow

```mermaid
flowchart TD
A[Plugin onload] --> B[StateManager.load]
B --> C[Register commands + protocol handler + settings tab]
C --> D{autoUpdate enabled}
D -- yes --> E[setTimeout 60s -> checkAllUpdates]
C --> F[SettingsTab.display]
F --> G[scanSkills(skillsDir)]
G --> H[Render grouped skill rows]
H --> I[User actions: toggle, update, delete, add, export]
```

## Install and Update Flow

```mermaid
flowchart TD
A[Install trigger: Add Modal / Registry / Protocol] --> B[installFromGitHub]
B --> C{version provided}
C -- yes --> D[fetchReleases + pick tag]
C -- no --> E[fetchLatestRelease]
D --> F[fetchSkillFiles]
E --> F
F --> G[Write files to skillsDir/repoName]
G --> H[validateSkillDir]
H -- valid --> I[state.setSkillState(repoName)]
H -- invalid --> J[Return error (partial files may remain)]

K[updateGitHubSkill] --> L[installFromGitHub(skillState.repo, targetVersion)]
L --> M[state.setSkillState(folderName, version=targetVersion || result.skillName)]
M --> N[Risk: version can become non-semver folder name]
```

## Toggle, Scan, and Export Flow

```mermaid
flowchart TD
A[Settings row toggle] --> B[toggleSkill writes SKILL.md frontmatter]
B --> C{crossToolExport targets exist}
C -- yes --> D[exportSkills]
C -- no --> E[Done]

F[Settings render] --> G[renderThreatBadge]
G --> H[scanForThreats(skillPath)]
H --> I[Store in threatCache]
I --> J[Detail panel reads cached scan]
```

## Cross-Tool Toggle State Flow

```mermaid
flowchart TD
A[Cross-tool target toggle UI] --> B[Read current targets once in closure]
B --> C[User toggles target]
C --> D[Compute updated list from captured current]
D --> E[updateSettings(crossToolExport)]
E --> F[Risk: stale closure can overwrite prior selections]
```
