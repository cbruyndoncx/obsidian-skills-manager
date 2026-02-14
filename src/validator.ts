import { Vault } from 'obsidian';
import { ValidationResult } from './types';

/**
 * Validate that a skill directory has proper structure:
 * - SKILL.md exists
 * - Has YAML frontmatter
 * - Has required name + description fields
 */
export async function validateSkillDir(
  vault: Vault,
  path: string
): Promise<ValidationResult> {
  const adapter = vault.adapter;
  const errors: string[] = [];

  const dirExists = await adapter.exists(path);
  if (!dirExists) {
    return { valid: false, errors: [`Directory does not exist: ${path}`] };
  }

  const skillFile = `${path}/SKILL.md`;
  const fileExists = await adapter.exists(skillFile);
  if (!fileExists) {
    return { valid: false, errors: [`SKILL.md not found in ${path}`] };
  }

  let content: string;
  try {
    content = await adapter.read(skillFile);
  } catch {
    return { valid: false, errors: [`Could not read ${skillFile}`] };
  }

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    errors.push('SKILL.md is missing YAML frontmatter (--- delimiters)');
    return { valid: false, errors };
  }

  const fields: Record<string, string> = {};
  for (const line of fmMatch[1].split('\n')) {
    const kv = line.match(/^(\S[^:]*?):\s*(.*)/);
    if (kv) {
      fields[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  if (!fields['name']) {
    errors.push('Missing required frontmatter field: name');
  }
  if (!fields['description']) {
    errors.push('Missing required frontmatter field: description');
  }

  return { valid: errors.length === 0, errors };
}
