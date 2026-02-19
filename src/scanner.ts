import { Vault } from 'obsidian';
import { SkillMeta } from './types';

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Uses regex — no YAML library needed for the flat key-value frontmatter we expect.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\S[^:]*?):\s*(.*)/);
    if (kv) {
      fields[kv[1].trim()] = kv[2].trim();
    }
  }
  return fields;
}

function toBool(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined) return fallback;
  const lower = val.toLowerCase();
  return lower === 'true' || lower === 'yes';
}

function stripQuotes(val: string | undefined): string {
  if (!val) return '';
  return val.replace(/^["']|["']$/g, '');
}

function toSkillMeta(fields: Record<string, string>, defaultCategory: string): SkillMeta | null {
  const name = stripQuotes(fields['name']);
  const description = stripQuotes(fields['description']);
  if (!name || !description) return null;

  return {
    name,
    description,
    category: stripQuotes(fields['category']) || defaultCategory,
    disableModelInvocation: toBool(fields['disable-model-invocation'], false),
    userInvocable: toBool(fields['user-invocable'], true),
    version: stripQuotes(fields['version']) || undefined,
    source: stripQuotes(fields['source']) || undefined,
    originRepo: stripQuotes(fields['origin-repo']) || undefined,
    originUrl: stripQuotes(fields['origin-url']) || undefined,
    origin: stripQuotes(fields['origin']) || undefined,
    license: stripQuotes(fields['license']) || undefined,
    compatibility: stripQuotes(fields['compatibility']) || undefined,
    allowedTools: stripQuotes(fields['allowed-tools']) || undefined,
  };
}

/**
 * Scan the skills directory and return metadata for each skill.
 * Returns a map keyed by folder name.
 */
export async function scanSkills(
  vault: Vault,
  skillsDir: string,
  defaultCategory = 'uncategorized'
): Promise<Map<string, SkillMeta>> {
  const results = new Map<string, SkillMeta>();
  const adapter = vault.adapter;

  const exists = await adapter.exists(skillsDir);
  if (!exists) return results;

  const listing = await adapter.list(skillsDir);

  for (const folder of listing.folders) {
    // Skip staging and backup directories left by the installer
    const baseName = folder.split('/').pop() || '';
    if (baseName.startsWith('.') || baseName.includes('.backup-') || baseName.includes('.staging-')) continue;

    const skillFile = `${folder}/SKILL.md`;
    const fileExists = await adapter.exists(skillFile);
    if (!fileExists) continue;

    try {
      const content = await adapter.read(skillFile);
      const fields = parseFrontmatter(content);
      const meta = toSkillMeta(fields, defaultCategory);
      if (meta) {
        // Use folder basename as the key
        const folderName = folder.split('/').pop() || folder;
        results.set(folderName, meta);
      }
    } catch {
      // Skip skills with unreadable files
    }
  }

  return results;
}
