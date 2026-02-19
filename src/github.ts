import { requestUrl } from 'obsidian';
import { coerce, compare } from 'semver';
import { GitHubRelease, UpdateCheckResult } from './types';

const GITHUB_API = 'https://api.github.com';

function authHeaders(pat?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  if (pat) {
    headers['Authorization'] = `Token ${pat}`;
  }
  return headers;
}

/**
 * Parse a GitHub repo string into owner/repo.
 * Accepts "owner/repo" or full GitHub URLs.
 */
export function parseRepo(input: string): string | null {
  let cleaned = input.trim();
  // Strip trailing .git
  cleaned = cleaned.replace(/\.git$/, '');
  // Handle full URLs
  const urlMatch = cleaned.match(/github\.com\/([^/]+\/[^/]+)/);
  if (urlMatch) return urlMatch[1];
  // Handle owner/repo format
  if (/^[^/]+\/[^/]+$/.test(cleaned)) return cleaned;
  return null;
}

/**
 * Fetch all releases for a repo, sorted by semver descending.
 * Excludes prereleases unless none are available.
 */
export async function fetchReleases(
  repo: string,
  pat?: string
): Promise<GitHubRelease[]> {
  const url = `${GITHUB_API}/repos/${repo}/releases?per_page=25`;
  const response = await requestUrl({
    url,
    headers: authHeaders(pat),
    throw: false,
  });

  if (response.status === 403) {
    const remaining = response.headers['x-ratelimit-remaining'];
    if (remaining === '0') {
      throw new Error('GitHub API rate limit exceeded. Add a PAT in settings.');
    }
    throw new Error(`GitHub API forbidden (403) for ${repo}`);
  }

  if (response.status === 404) {
    throw new Error(`Repository not found: ${repo}`);
  }

  if (response.status !== 200) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const releases: GitHubRelease[] = response.json;

  // Filter to stable releases, fallback to all if none
  const stable = releases.filter((r) => !r.prerelease);
  const candidates = stable.length > 0 ? stable : releases;

  // Sort by semver descending
  return candidates.sort((a, b) => {
    const va = coerce(a.tag_name);
    const vb = coerce(b.tag_name);
    if (!va || !vb) return 0;
    return compare(vb, va);
  });
}

/**
 * Fetch the latest release for a repo.
 */
export async function fetchLatestRelease(
  repo: string,
  pat?: string
): Promise<GitHubRelease | null> {
  const releases = await fetchReleases(repo, pat);
  return releases.length > 0 ? releases[0] : null;
}

/**
 * Fetch a specific release by tag.
 */
export async function fetchReleaseByTag(
  repo: string,
  tag: string,
  pat?: string
): Promise<GitHubRelease | null> {
  const url = `${GITHUB_API}/repos/${repo}/releases/tags/${tag}`;
  const response = await requestUrl({
    url,
    headers: authHeaders(pat),
    throw: false,
  });

  if (response.status !== 200) return null;
  return response.json as GitHubRelease;
}

/**
 * Download a file from a release's assets by name.
 */
export async function fetchReleaseAsset(
  asset_url: string,
  pat?: string
): Promise<string> {
  const headers: Record<string, string> = {
    'Accept': 'application/octet-stream',
  };
  if (pat) {
    headers['Authorization'] = `Token ${pat}`;
  }

  const response = await requestUrl({ url: asset_url, headers });
  return response.text;
}

/**
 * Fetch SKILL.md content from a repo's release or default branch.
 * Tries release assets first, then falls back to raw content from repo.
 */
export async function fetchSkillMd(
  repo: string,
  release?: GitHubRelease,
  pat?: string
): Promise<string | null> {
  // Try release assets first
  if (release) {
    const skillAsset = release.assets.find((a) => a.name === 'SKILL.md');
    if (skillAsset) {
      return await fetchReleaseAsset(skillAsset.browser_download_url, pat);
    }
  }

  // Fallback: fetch from repo default branch
  const url = `https://raw.githubusercontent.com/${repo}/HEAD/SKILL.md`;
  const headers: Record<string, string> = {};
  if (pat) {
    headers['Authorization'] = `Token ${pat}`;
  }

  const response = await requestUrl({ url, headers, throw: false });
  if (response.status === 200) return response.text;
  return null;
}

/**
 * Fetch all files from a repo's default branch via the Git Trees API.
 * Returns a map of relative file paths to content.
 */
async function fetchRepoTree(
  repo: string,
  ref: string,
  pat?: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const encodedRef = encodeURIComponent(ref);
  const url = `${GITHUB_API}/repos/${repo}/git/trees/${encodedRef}?recursive=1`;
  const response = await requestUrl({
    url,
    headers: authHeaders(pat),
    throw: false,
  });

  if (response.status !== 200) return files;

  const tree = (response.json as { tree: { path: string; type: string }[] }).tree;
  const blobs = tree.filter((entry) => entry.type === 'blob');

  for (const blob of blobs) {
    try {
      const encodedPath = blob.path.split('/').map((part) => encodeURIComponent(part)).join('/');
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${encodedRef}/${encodedPath}`;
      const headers: Record<string, string> = {};
      if (pat) headers['Authorization'] = `Token ${pat}`;
      const fileResp = await requestUrl({ url: rawUrl, headers, throw: false });
      if (fileResp.status === 200) {
        files.set(blob.path, fileResp.text);
      }
    } catch {
      // Skip files that can't be fetched
    }
  }

  return files;
}

/**
 * Fetch all skill files from a release or repo.
 * Returns a map of relative paths to content.
 * Tries release assets first, then falls back to full repo tree.
 */
export async function fetchSkillFiles(
  repo: string,
  release?: GitHubRelease,
  pat?: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  // Get SKILL.md
  const skillMd = await fetchSkillMd(repo, release, pat);
  if (skillMd) {
    files.set('SKILL.md', skillMd);
  }

  // Check for other common skill files in release assets
  if (release) {
    for (const asset of release.assets) {
      if (asset.name !== 'SKILL.md' && !asset.name.endsWith('.zip')) {
        try {
          const content = await fetchReleaseAsset(
            asset.browser_download_url,
            pat
          );
          files.set(asset.name, content);
        } catch {
          // Skip failed asset downloads
        }
      }
    }
  }

  // Always try to merge in the repo tree so nested skill assets (scripts/,
  // references/, templates, etc.) are included even when releases are sparse.
  // For tagged installs, read from the selected tag; otherwise use HEAD.
  const ref = release?.tag_name || 'HEAD';
  const treeFiles = await fetchRepoTree(repo, ref, pat);
  for (const [path, content] of treeFiles) {
    if (!files.has(path)) {
      files.set(path, content);
    }
  }

  return files;
}

/**
 * Parsed skill reference from user input.
 */
export interface SkillRef {
  type: 'github' | 'github-monorepo' | 'skills-sh';
  repo?: string;
  subpath?: string;
  skillsShId?: string;
}

/**
 * Parse a variety of skill input formats into a structured reference.
 * Supports:
 *   - owner/repo (standard GitHub)
 *   - owner/repo/path/to/skill (monorepo shorthand, 3+ segments)
 *   - https://github.com/owner/repo (standard GitHub URL)
 *   - https://github.com/owner/repo/tree/branch/path/to/skill (monorepo URL)
 *   - https://skills.sh/... (skills.sh URL)
 */
export function parseSkillRef(input: string): SkillRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // skills.sh URL
  if (/^https?:\/\/(www\.)?skills\.sh\//i.test(trimmed)) {
    const match = trimmed.match(/skills\.sh\/(.+)/i);
    if (match) {
      return { type: 'skills-sh', skillsShId: match[1].replace(/\/+$/, '') };
    }
    return null;
  }

  // GitHub URL with tree path (monorepo)
  const treeMatch = trimmed.match(
    /github\.com\/([^/]+\/[^/]+)\/tree\/[^/]+\/(.+)/
  );
  if (treeMatch) {
    return {
      type: 'github-monorepo',
      repo: treeMatch[1],
      subpath: treeMatch[2].replace(/\/+$/, ''),
    };
  }

  // GitHub URL (standard repo)
  const urlMatch = trimmed.match(/github\.com\/([^/]+\/[^/]+)\/?$/);
  if (urlMatch) {
    return { type: 'github', repo: urlMatch[1].replace(/\.git$/, '') };
  }

  // Shorthand: owner/repo/path/to/skill (3+ segments = monorepo)
  const segments = trimmed.split('/');
  if (segments.length > 2 && !trimmed.includes('://')) {
    return {
      type: 'github-monorepo',
      repo: `${segments[0]}/${segments[1]}`,
      subpath: segments.slice(2).join('/'),
    };
  }

  // Shorthand: owner/repo
  if (/^[^/]+\/[^/]+$/.test(trimmed)) {
    return { type: 'github', repo: trimmed };
  }

  return null;
}

/**
 * Fetch files from a specific subdirectory of a GitHub repo.
 * Used for installing skills from monorepos.
 */
export async function fetchSubpathFiles(
  repo: string,
  subpath: string,
  ref: string,
  pat?: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const encodedRef = encodeURIComponent(ref);
  const url = `${GITHUB_API}/repos/${repo}/git/trees/${encodedRef}?recursive=1`;
  const response = await requestUrl({
    url,
    headers: authHeaders(pat),
    throw: false,
  });

  if (response.status !== 200) {
    throw new Error(`Failed to fetch repo tree: HTTP ${response.status}`);
  }

  const tree = (response.json as { tree: { path: string; type: string }[] }).tree;
  const prefix = subpath.endsWith('/') ? subpath : `${subpath}/`;
  const blobs = tree.filter(
    (entry) => entry.type === 'blob' && (entry.path.startsWith(prefix) || entry.path === subpath)
  );

  if (blobs.length === 0) {
    throw new Error(`No files found under "${subpath}" in ${repo}`);
  }

  for (const blob of blobs) {
    try {
      const encodedPath = blob.path.split('/').map((part) => encodeURIComponent(part)).join('/');
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${encodedRef}/${encodedPath}`;
      const headers: Record<string, string> = {};
      if (pat) headers['Authorization'] = `Token ${pat}`;
      const fileResp = await requestUrl({ url: rawUrl, headers, throw: false });
      if (fileResp.status === 200) {
        // Store path relative to the subpath
        const relativePath = blob.path.startsWith(prefix)
          ? blob.path.slice(prefix.length)
          : blob.path.split('/').pop() || blob.path;
        files.set(relativePath, fileResp.text);
      }
    } catch {
      // Skip files that can't be fetched
    }
  }

  return files;
}

/**
 * Find the actual subdirectory path for a skill in a monorepo.
 * The skillId from registries often doesn't match the folder name exactly
 * (e.g. skillId "remotion-best-practices" lives at "skills/remotion/").
 * Searches the tree for SKILL.md files and returns the directory containing
 * the best match.
 */
export async function findSkillSubpath(
  repo: string,
  skillId: string,
  ref: string,
  pat?: string
): Promise<string | null> {
  const encodedRef = encodeURIComponent(ref);
  const url = `${GITHUB_API}/repos/${repo}/git/trees/${encodedRef}?recursive=1`;
  const response = await requestUrl({
    url,
    headers: authHeaders(pat),
    throw: false,
  });

  if (response.status !== 200) return null;

  const tree = (response.json as { tree: { path: string; type: string }[] }).tree;
  const skillMdPaths = tree
    .filter((e) => e.type === 'blob' && e.path.endsWith('/SKILL.md'))
    .map((e) => e.path);

  if (skillMdPaths.length === 0) return null;

  // If there's only one SKILL.md, use its directory
  if (skillMdPaths.length === 1) {
    return skillMdPaths[0].replace(/\/SKILL\.md$/, '');
  }

  // Try exact folder name match first
  const exactMatch = skillMdPaths.find((p) => {
    const dir = p.replace(/\/SKILL\.md$/, '');
    const folderName = dir.split('/').pop() || '';
    return folderName === skillId;
  });
  if (exactMatch) return exactMatch.replace(/\/SKILL\.md$/, '');

  // Try partial match: skillId contains the folder name or vice versa
  const partialMatch = skillMdPaths.find((p) => {
    const dir = p.replace(/\/SKILL\.md$/, '');
    const folderName = dir.split('/').pop() || '';
    return skillId.includes(folderName) || folderName.includes(skillId);
  });
  if (partialMatch) return partialMatch.replace(/\/SKILL\.md$/, '');

  // Try reading SKILL.md frontmatter to match by name field
  for (const mdPath of skillMdPaths) {
    try {
      const encodedPath = mdPath.split('/').map((part) => encodeURIComponent(part)).join('/');
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${encodedRef}/${encodedPath}`;
      const headers: Record<string, string> = {};
      if (pat) headers['Authorization'] = `Token ${pat}`;
      const fileResp = await requestUrl({ url: rawUrl, headers, throw: false });
      if (fileResp.status === 200) {
        const nameMatch = fileResp.text.match(/^name:\s*["']?(.+?)["']?\s*$/m);
        if (nameMatch) {
          const name = nameMatch[1].toLowerCase().replace(/\s+/g, '-');
          if (name === skillId.toLowerCase() || skillId.toLowerCase().includes(name)) {
            return mdPath.replace(/\/SKILL\.md$/, '');
          }
        }
      }
    } catch {
      // Skip
    }
  }

  return null;
}

/**
 * Resolve a skills.sh skill ID to its GitHub source repo.
 */
export async function fetchSkillsShInfo(
  skillId: string
): Promise<{ repo: string; subpath?: string } | null> {
  try {
    const url = `https://skills.sh/api/skills/${encodeURIComponent(skillId)}`;
    const response = await requestUrl({ url, throw: false });
    if (response.status !== 200) return null;
    const data = response.json as { source?: string; repo?: string; subpath?: string };
    const repo = data.repo || data.source;
    if (!repo) return null;
    return { repo, subpath: data.subpath };
  } catch {
    return null;
  }
}

/**
 * Get the default branch for a GitHub repo.
 */
export async function fetchDefaultBranch(
  repo: string,
  pat?: string
): Promise<string> {
  const url = `${GITHUB_API}/repos/${repo}`;
  const response = await requestUrl({
    url,
    headers: authHeaders(pat),
    throw: false,
  });
  if (response.status === 200) {
    return (response.json as { default_branch: string }).default_branch || 'main';
  }
  return 'main';
}

/**
 * Check if a newer version is available for a skill.
 */
export async function checkForUpdate(
  repo: string,
  localVersion: string,
  pat?: string
): Promise<UpdateCheckResult | null> {
  try {
    const latest = await fetchLatestRelease(repo, pat);
    if (!latest) return null;

    const local = coerce(localVersion);
    const remote = coerce(latest.tag_name);
    if (!local || !remote) return null;

    return {
      hasUpdate: compare(remote, local) > 0,
      latestVersion: latest.tag_name,
    };
  } catch {
    return null;
  }
}
