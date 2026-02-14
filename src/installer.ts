import { Vault } from 'obsidian';
import { InstallResult, SkillState } from './types';
import { validateSkillDir } from './validator';
import { fetchReleases, fetchSkillFiles, fetchLatestRelease } from './github';
import { StateManager } from './state';

/**
 * Register a local skill folder that already exists in the vault.
 */
export async function installLocalSkill(
  vault: Vault,
  state: StateManager,
  skillPath: string
): Promise<InstallResult> {
  const validation = await validateSkillDir(vault, skillPath);
  if (!validation.valid) {
    return {
      success: false,
      skillName: '',
      errors: validation.errors,
    };
  }

  const folderName = skillPath.split('/').pop() || skillPath;

  // Read SKILL.md to get the name
  const content = await vault.adapter.read(`${skillPath}/SKILL.md`);
  const nameMatch = content.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const skillName = nameMatch ? nameMatch[1] : folderName;

  const skillState: SkillState = {
    source: 'local',
    frozen: false,
    installedAt: new Date().toISOString(),
  };

  await state.setSkillState(folderName, skillState);

  return {
    success: true,
    skillName,
    errors: [],
  };
}

/**
 * Install a skill from a GitHub repository.
 * Downloads SKILL.md and any release assets, writes them to skillsDir.
 */
export async function installFromGitHub(
  vault: Vault,
  state: StateManager,
  skillsDir: string,
  repo: string,
  version?: string,
  pat?: string
): Promise<InstallResult> {
  const errors: string[] = [];

  try {
    // Determine which release to use
    let release;
    if (version) {
      const releases = await fetchReleases(repo, pat);
      release = releases.find((r) => r.tag_name === version);
      if (!release) {
        return {
          success: false,
          skillName: '',
          errors: [`Release ${version} not found for ${repo}`],
        };
      }
    } else {
      release = await fetchLatestRelease(repo, pat);
    }

    // Fetch all skill files
    const files = await fetchSkillFiles(repo, release || undefined, pat);
    if (!files.has('SKILL.md')) {
      return {
        success: false,
        skillName: '',
        errors: [`No SKILL.md found in ${repo}`],
      };
    }

    // Derive folder name from repo
    const repoName = repo.split('/').pop() || repo;
    const skillFolder = `${skillsDir}/${repoName}`;

    // Create directory
    const adapter = vault.adapter;
    if (!(await adapter.exists(skillsDir))) {
      await adapter.mkdir(skillsDir);
    }
    if (!(await adapter.exists(skillFolder))) {
      await adapter.mkdir(skillFolder);
    }

    // Write files
    for (const [fileName, content] of files) {
      await adapter.write(`${skillFolder}/${fileName}`, content);
    }

    // Validate
    const validation = await validateSkillDir(vault, skillFolder);
    if (!validation.valid) {
      return {
        success: false,
        skillName: repoName,
        errors: validation.errors,
      };
    }

    // Register in state
    const tag = release?.tag_name;
    const skillState: SkillState = {
      source: 'github',
      repo,
      version: tag,
      frozen: false,
      installedAt: new Date().toISOString(),
    };

    await state.setSkillState(repoName, skillState);

    return {
      success: true,
      skillName: repoName,
      errors: [],
    };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { success: false, skillName: '', errors };
  }
}

/**
 * Update a GitHub-installed skill to a specific version (or latest).
 */
export async function updateGitHubSkill(
  vault: Vault,
  state: StateManager,
  skillsDir: string,
  folderName: string,
  targetVersion?: string
): Promise<InstallResult> {
  const skillState = state.getSkillState(folderName);
  if (!skillState || skillState.source !== 'github' || !skillState.repo) {
    return {
      success: false,
      skillName: folderName,
      errors: ['Not a GitHub-installed skill'],
    };
  }

  if (skillState.frozen) {
    return {
      success: false,
      skillName: folderName,
      errors: ['Skill version is frozen'],
    };
  }

  const result = await installFromGitHub(
    vault,
    state,
    skillsDir,
    skillState.repo,
    targetVersion,
    state.settings.githubPat || undefined
  );

  if (result.success) {
    await state.setSkillState(folderName, {
      ...skillState,
      version: targetVersion || result.skillName,
      lastUpdated: new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Delete a skill: remove files and state.
 */
export async function deleteSkill(
  vault: Vault,
  state: StateManager,
  skillsDir: string,
  folderName: string
): Promise<boolean> {
  const skillFolder = `${skillsDir}/${folderName}`;
  const adapter = vault.adapter;

  try {
    if (await adapter.exists(skillFolder)) {
      // List and delete all files in the folder
      const listing = await adapter.list(skillFolder);
      for (const file of listing.files) {
        await adapter.remove(file);
      }
      // Remove subfolders recursively (simple single level)
      for (const subfolder of listing.folders) {
        const subListing = await adapter.list(subfolder);
        for (const file of subListing.files) {
          await adapter.remove(file);
        }
        await adapter.rmdir(subfolder, false);
      }
      await adapter.rmdir(skillFolder, false);
    }

    await state.removeSkillState(folderName);
    return true;
  } catch {
    return false;
  }
}
