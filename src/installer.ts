import { Vault } from 'obsidian';
import { InstallResult, SkillState } from './types';
import { validateSkillDir } from './validator';
import { fetchReleases, fetchSkillFiles, fetchLatestRelease } from './github';
import { StateManager } from './state';

/**
 * Create a directory and all missing parent directories.
 */
async function mkdirRecursive(adapter: Vault['adapter'], dirPath: string): Promise<void> {
  if (await adapter.exists(dirPath)) return;
  const parent = dirPath.substring(0, dirPath.lastIndexOf('/'));
  if (parent) {
    await mkdirRecursive(adapter, parent);
  }
  if (!(await adapter.exists(dirPath))) {
    await adapter.mkdir(dirPath);
  }
}

/**
 * Replace a target directory with a staged directory, with rollback support.
 */
async function replaceDirWithStaging(
  adapter: Vault['adapter'],
  stagingDir: string,
  targetDir: string
): Promise<void> {
  const backupDir = `${targetDir}.backup-${Date.now()}`;
  let backedUp = false;

  try {
    if (await adapter.exists(targetDir)) {
      await adapter.rename(targetDir, backupDir);
      backedUp = true;
    }

    await adapter.rename(stagingDir, targetDir);

    if (backedUp && (await adapter.exists(backupDir))) {
      await removeDirRecursive(adapter, backupDir);
    }
  } catch (e) {
    if (backedUp) {
      try {
        if (!(await adapter.exists(targetDir)) && (await adapter.exists(backupDir))) {
          await adapter.rename(backupDir, targetDir);
        }
      } catch {
        // Best-effort rollback
      }
    }
    throw e;
  }
}

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
  const adapter = vault.adapter;
  let stagingFolder = '';

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
    stagingFolder = `${skillsDir}/.${repoName}.staging-${Date.now()}`;

    // Create staging directory (handle nested paths)
    await mkdirRecursive(adapter, stagingFolder);

    // Write files to staging directory
    for (const [fileName, content] of files) {
      const targetPath = `${stagingFolder}/${fileName}`;
      const parent = targetPath.substring(0, targetPath.lastIndexOf('/'));
      if (parent) {
        await mkdirRecursive(adapter, parent);
      }
      await adapter.write(targetPath, content);
    }

    // Validate staged skill
    const validation = await validateSkillDir(vault, stagingFolder);
    if (!validation.valid) {
      try {
        if (await adapter.exists(stagingFolder)) {
          await removeDirRecursive(adapter, stagingFolder);
        }
      } catch {
        // Best-effort cleanup
      }
      return {
        success: false,
        skillName: repoName,
        errors: validation.errors,
      };
    }

    // Promote staged directory to live directory, with rollback
    await replaceDirWithStaging(adapter, stagingFolder, skillFolder);

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
    // Clean up staging folder on any failure in fetch/write/replace.
    if (stagingFolder) {
      try {
        if (await adapter.exists(stagingFolder)) {
          await removeDirRecursive(adapter, stagingFolder);
        }
      } catch {
        // Best-effort cleanup
      }
    }
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
    // installFromGitHub already persisted state with the correct version tag;
    // read it back and just stamp lastUpdated
    const freshState = state.getSkillState(folderName);
    if (freshState) {
      await state.setSkillState(folderName, {
        ...freshState,
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  return result;
}

/**
 * Recursively remove a directory and all its contents.
 */
async function removeDirRecursive(adapter: Vault['adapter'], dirPath: string): Promise<void> {
  const listing = await adapter.list(dirPath);
  for (const file of listing.files) {
    await adapter.remove(file);
  }
  for (const subfolder of listing.folders) {
    await removeDirRecursive(adapter, subfolder);
  }
  await adapter.rmdir(dirPath, false);
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

  try {
    if (await vault.adapter.exists(skillFolder)) {
      await removeDirRecursive(vault.adapter, skillFolder);
    }

    await state.removeSkillState(folderName);
    return true;
  } catch {
    return false;
  }
}
