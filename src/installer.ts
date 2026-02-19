import { Vault } from 'obsidian';
import { InstallResult, SkillState } from './types';
import { validateSkillDir } from './validator';
import { fetchReleases, fetchSkillFiles, fetchLatestRelease, fetchSubpathFiles, fetchDefaultBranch, findSkillSubpath } from './github';
import { StateManager } from './state';
import { REQUIRED_FIELDS } from './frontmatter-template';
import JSZip from 'jszip';

interface FrontmatterDefaults {
  category?: string;
  version?: string;
  source?: string;
  'origin-repo'?: string;
  'origin-url'?: string;
}

/**
 * Ensure the SKILL.md frontmatter has all standard fields.
 * Fills in missing fields with sensible defaults so every skill
 * is queryable via Obsidian Bases.
 */
async function ensureFrontmatter(
  adapter: Vault['adapter'],
  skillFolder: string,
  defaults: FrontmatterDefaults = {}
): Promise<void> {
  const skillFile = `${skillFolder}/SKILL.md`;
  try {
    if (!(await adapter.exists(skillFile))) return;
    const content = await adapter.read(skillFile);
    const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
    if (!fmMatch) return;

    let frontmatter = fmMatch[2];
    let changed = false;

    const ensureField = (field: string, value: string) => {
      const regex = new RegExp(`^${field}\\s*:`, 'm');
      if (!regex.test(frontmatter)) {
        frontmatter += `\n${field}: ${value}`;
        changed = true;
      }
    };

    // Required fields from shared template
    for (const { field, defaultValue } of REQUIRED_FIELDS) {
      const override = (defaults as Record<string, string | undefined>)[field];
      ensureField(field, override || defaultValue);
    }

    // Source tracking fields
    if (defaults.source) {
      ensureField('source', defaults.source);
    }
    if (defaults['origin-repo']) {
      ensureField('origin-repo', defaults['origin-repo']);
      ensureField('origin-url', defaults['origin-url'] || `https://github.com/${defaults['origin-repo']}`);
    }

    if (changed) {
      const updated = `${fmMatch[1]}${frontmatter}${fmMatch[3]}${content.slice(fmMatch[0].length)}`;
      await adapter.write(skillFile, updated);
    }
  } catch {
    // Best-effort — don't fail the install over this
  }
}

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
      await adapter.rmdir(backupDir, true);
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
          await adapter.rmdir(stagingFolder, true);
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

    // Ensure all standard frontmatter fields exist
    const tag = release?.tag_name;
    await ensureFrontmatter(adapter, skillFolder, {
      source: 'github',
      version: tag || '1.0.0',
      'origin-repo': repo,
    });

    // Register in state
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
          await adapter.rmdir(stagingFolder, true);
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
 * Install a skill from a subdirectory of a GitHub monorepo.
 */
export async function installFromMonorepo(
  vault: Vault,
  state: StateManager,
  skillsDir: string,
  repo: string,
  subpath: string,
  pat?: string
): Promise<InstallResult> {
  const adapter = vault.adapter;
  const folderName = subpath.split('/').pop() || subpath.replace(/\//g, '-');
  const skillFolder = `${skillsDir}/${folderName}`;
  const stagingFolder = `${skillsDir}/.${folderName}.staging-${Date.now()}`;

  try {
    const ref = await fetchDefaultBranch(repo, pat);
    let files: Map<string, string>;
    let actualSubpath = subpath;

    try {
      files = await fetchSubpathFiles(repo, subpath, ref, pat);
    } catch {
      // Direct subpath failed — search the repo tree for the right directory
      console.log(`[Skills Manager] Direct subpath "${subpath}" not found, searching repo tree...`);
      const resolved = await findSkillSubpath(repo, subpath, ref, pat);
      if (resolved) {
        console.log(`[Skills Manager] Resolved subpath: "${resolved}"`);
        actualSubpath = resolved;
        files = await fetchSubpathFiles(repo, resolved, ref, pat);
      } else {
        return {
          success: false,
          skillName: folderName,
          errors: [`Could not find skill "${subpath}" in ${repo}`],
        };
      }
    }

    if (!files.has('SKILL.md')) {
      return {
        success: false,
        skillName: folderName,
        errors: [`No SKILL.md found under "${actualSubpath}" in ${repo}`],
      };
    }

    await mkdirRecursive(adapter, stagingFolder);

    for (const [fileName, content] of files) {
      const targetPath = `${stagingFolder}/${fileName}`;
      const parent = targetPath.substring(0, targetPath.lastIndexOf('/'));
      if (parent) {
        await mkdirRecursive(adapter, parent);
      }
      await adapter.write(targetPath, content);
    }

    const validation = await validateSkillDir(vault, stagingFolder);
    if (!validation.valid) {
      try {
        if (await adapter.exists(stagingFolder)) {
          await adapter.rmdir(stagingFolder, true);
        }
      } catch {
        // Best-effort cleanup
      }
      return {
        success: false,
        skillName: folderName,
        errors: validation.errors,
      };
    }

    await replaceDirWithStaging(adapter, stagingFolder, skillFolder);

    // Ensure all standard frontmatter fields exist
    await ensureFrontmatter(adapter, skillFolder, {
      source: 'github',
      'origin-repo': repo,
    });

    const skillState: SkillState = {
      source: 'github',
      repo: `${repo}/${subpath}`,
      frozen: false,
      installedAt: new Date().toISOString(),
    };

    await state.setSkillState(folderName, skillState);

    return {
      success: true,
      skillName: folderName,
      errors: [],
    };
  } catch (e) {
    if (stagingFolder) {
      try {
        if (await adapter.exists(stagingFolder)) {
          await adapter.rmdir(stagingFolder, true);
        }
      } catch {
        // Best-effort cleanup
      }
    }
    return {
      success: false,
      skillName: folderName,
      errors: [e instanceof Error ? e.message : String(e)],
    };
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
 * Install skills from a ZIP file.
 * Finds all SKILL.md files in the ZIP, identifies skill folder boundaries,
 * stages each one, validates, and installs into the configured skills directory.
 */
export async function installFromZip(
  vault: Vault,
  state: StateManager,
  skillsDir: string,
  zipData: ArrayBuffer
): Promise<{ installed: string[]; errors: string[] }> {
  const adapter = vault.adapter;
  const installed: string[] = [];
  const errors: string[] = [];

  // Parse ZIP
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipData);
  } catch {
    return { installed, errors: ['Invalid or corrupt ZIP file'] };
  }

  // Find all SKILL.md files and their parent folders
  const skillMdPaths: string[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.endsWith('SKILL.md')) {
      skillMdPaths.push(relativePath);
    }
  });

  if (skillMdPaths.length === 0) {
    return { installed, errors: ['No SKILL.md files found in ZIP'] };
  }

  // Determine skill folders (parent dir of each SKILL.md)
  const skillFolderPrefixes = skillMdPaths.map((p) => {
    const parts = p.split('/');
    parts.pop(); // remove SKILL.md
    return parts.join('/');
  });

  // Detect common prefix to strip (nested wrapper directory)
  let commonPrefix = '';
  if (skillFolderPrefixes.length > 0) {
    const first = skillFolderPrefixes[0];
    const firstParts = first.split('/');
    // Check if all skill folders share a common wrapper (depth 1)
    if (firstParts.length >= 2) {
      const candidate = firstParts[0];
      const allShare = skillFolderPrefixes.every((p) => p.startsWith(candidate + '/'));
      if (allShare) {
        commonPrefix = candidate + '/';
      }
    }
  }

  // Group files by skill folder
  const skillFolders = new Map<string, Map<string, JSZip.JSZipObject>>();
  for (const prefix of skillFolderPrefixes) {
    const folderName = commonPrefix ? prefix.slice(commonPrefix.length) : prefix;
    if (!folderName) continue; // skip if SKILL.md is at root
    skillFolders.set(folderName, new Map());
  }

  // Assign each file to its skill folder
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    const stripped = commonPrefix ? relativePath.slice(commonPrefix.length) : relativePath;
    for (const [folderName] of skillFolders) {
      if (stripped.startsWith(folderName + '/') || stripped === folderName) {
        skillFolders.get(folderName)!.set(stripped.slice(folderName.length + 1), file);
        break;
      }
    }
  });

  // Install each skill folder
  for (const [folderName, files] of skillFolders) {
    const skillFolder = `${skillsDir}/${folderName}`;
    const stagingFolder = `${skillsDir}/.${folderName}.staging-${Date.now()}`;

    try {
      await mkdirRecursive(adapter, stagingFolder);

      // Write all files to staging
      for (const [relativePath, zipObj] of files) {
        const targetPath = `${stagingFolder}/${relativePath}`;
        const parent = targetPath.substring(0, targetPath.lastIndexOf('/'));
        if (parent) {
          await mkdirRecursive(adapter, parent);
        }
        const content = await zipObj.async('string');
        await adapter.write(targetPath, content);
      }

      // Validate
      const validation = await validateSkillDir(vault, stagingFolder);
      if (!validation.valid) {
        errors.push(`${folderName}: ${validation.errors.join('; ')}`);
        try {
          if (await adapter.exists(stagingFolder)) {
            await adapter.rmdir(stagingFolder, true);
          }
        } catch { /* best-effort cleanup */ }
        continue;
      }

      // Promote staging to final
      await replaceDirWithStaging(adapter, stagingFolder, skillFolder);

      // Ensure frontmatter
      await ensureFrontmatter(adapter, skillFolder, { source: 'zip' });

      // Register state
      const skillState: SkillState = {
        source: 'zip',
        frozen: false,
        installedAt: new Date().toISOString(),
      };
      await state.setSkillState(folderName, skillState);

      installed.push(folderName);
    } catch (e) {
      errors.push(`${folderName}: ${e instanceof Error ? e.message : String(e)}`);
      try {
        if (await adapter.exists(stagingFolder)) {
          await adapter.rmdir(stagingFolder, true);
        }
      } catch { /* best-effort cleanup */ }
    }
  }

  return { installed, errors };
}

/**
 * Parse a ZIP file and return discovered skill folder names with their SKILL.md frontmatter name field.
 */
export async function previewZipSkills(
  zipData: ArrayBuffer
): Promise<{ skills: { folder: string; name: string }[]; error?: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipData);
  } catch {
    return { skills: [], error: 'Invalid or corrupt ZIP file' };
  }

  // Find all SKILL.md files
  const skillMdPaths: string[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.endsWith('SKILL.md')) {
      skillMdPaths.push(relativePath);
    }
  });

  if (skillMdPaths.length === 0) {
    return { skills: [], error: 'No SKILL.md files found in ZIP' };
  }

  // Determine common prefix
  const skillFolderPrefixes = skillMdPaths.map((p) => {
    const parts = p.split('/');
    parts.pop();
    return parts.join('/');
  });

  let commonPrefix = '';
  if (skillFolderPrefixes.length > 0 && skillFolderPrefixes[0].includes('/')) {
    const candidate = skillFolderPrefixes[0].split('/')[0];
    if (skillFolderPrefixes.every((p) => p.startsWith(candidate + '/'))) {
      commonPrefix = candidate + '/';
    }
  }

  const skills: { folder: string; name: string }[] = [];
  for (let i = 0; i < skillMdPaths.length; i++) {
    const prefix = skillFolderPrefixes[i];
    const folderName = commonPrefix ? prefix.slice(commonPrefix.length) : prefix;
    if (!folderName) continue;

    // Read SKILL.md content to extract name
    const zipObj = zip.file(skillMdPaths[i]);
    let name = folderName;
    if (zipObj) {
      try {
        const content = await zipObj.async('string');
        const nameMatch = content.match(/^name:\s*["']?(.+?)["']?\s*$/m);
        if (nameMatch) name = nameMatch[1];
      } catch { /* use folder name */ }
    }
    skills.push({ folder: folderName, name });
  }

  return { skills };
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
      // Use recursive rmdir — removeDirRecursive + adapter.list() can miss
      // dotfiles and non-indexed files, leaving the directory non-empty.
      await vault.adapter.rmdir(skillFolder, true);
    }

    await state.removeSkillState(folderName);
    return true;
  } catch (e) {
    console.error(`[Skills Manager] Failed to delete skill "${folderName}":`, e);
    return false;
  }
}
