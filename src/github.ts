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
