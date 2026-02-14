import { Vault } from 'obsidian';
import { ValidationResult, SecurityScanResult, SecurityThreat } from './types';

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

interface ThreatPattern {
  pattern: RegExp;
  severity: 'warning' | 'danger';
  description: string;
}

const SCRIPT_PATTERNS: ThreatPattern[] = [
  // Network calls
  { pattern: /\bcurl\b/, severity: 'warning', description: 'Network call: curl' },
  { pattern: /\bwget\b/, severity: 'warning', description: 'Network call: wget' },
  { pattern: /\bfetch\s*\(/, severity: 'warning', description: 'Network call: fetch()' },
  { pattern: /\brequests\.(post|get|put)\b/, severity: 'warning', description: 'Network call: python requests' },
  { pattern: /\bnc\s+-/, severity: 'danger', description: 'Network call: netcat' },

  // Destructive commands
  { pattern: /\brm\s+-rf\b/, severity: 'danger', description: 'Destructive: rm -rf' },
  { pattern: /\bshred\b/, severity: 'danger', description: 'Destructive: shred' },
  { pattern: /\bdd\s+if=\/dev\//, severity: 'danger', description: 'Destructive: dd from device' },

  // Remote code execution
  { pattern: /curl\s.*\|\s*bash/, severity: 'danger', description: 'Remote code execution: curl pipe to bash' },
  { pattern: /\beval\s*\(/, severity: 'danger', description: 'Code execution: eval()' },
  { pattern: /\bexec\s*\(/, severity: 'warning', description: 'Code execution: exec()' },

  // Credential access
  { pattern: /~\/\.ssh/, severity: 'danger', description: 'Credential access: ~/.ssh' },
  { pattern: /~\/\.aws/, severity: 'danger', description: 'Credential access: ~/.aws' },
  { pattern: /~\/\.env/, severity: 'warning', description: 'Credential access: ~/.env' },
  { pattern: /~\/\.npmrc/, severity: 'warning', description: 'Credential access: ~/.npmrc' },
];

const PROMPT_INJECTION_PATTERNS: ThreatPattern[] = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, severity: 'danger', description: 'Prompt injection: ignore previous instructions' },
  { pattern: /you\s+are\s+now\b/i, severity: 'danger', description: 'Prompt injection: role override' },
  { pattern: /<!--[\s\S]*?(ignore|override|forget)/i, severity: 'danger', description: 'Prompt injection: hidden command in HTML comment' },
  { pattern: /\bdo\s+not\s+follow\s+(the\s+)?(above|previous)\b/i, severity: 'danger', description: 'Prompt injection: instruction override' },
];

/**
 * Scan a skill directory for security threats.
 */
export async function scanForThreats(
  vault: Vault,
  skillPath: string
): Promise<SecurityScanResult> {
  const adapter = vault.adapter;
  const threats: SecurityThreat[] = [];

  // Scan SKILL.md content
  const skillFile = `${skillPath}/SKILL.md`;
  if (await adapter.exists(skillFile)) {
    try {
      const content = await adapter.read(skillFile);
      // Extract body (after frontmatter)
      const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1] : content;

      for (const tp of PROMPT_INJECTION_PATTERNS) {
        if (tp.pattern.test(body)) {
          threats.push({
            severity: tp.severity,
            file: 'SKILL.md',
            pattern: tp.pattern.source,
            description: tp.description,
          });
        }
      }

      // Also check SKILL.md body for script patterns (instructions may reference commands)
      for (const tp of SCRIPT_PATTERNS) {
        if (tp.pattern.test(body)) {
          threats.push({
            severity: tp.severity,
            file: 'SKILL.md',
            pattern: tp.pattern.source,
            description: tp.description,
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Scan scripts/ directory
  const scriptsDir = `${skillPath}/scripts`;
  if (await adapter.exists(scriptsDir)) {
    try {
      const listing = await adapter.list(scriptsDir);
      for (const file of listing.files) {
        try {
          const content = await adapter.read(file);
          const fileName = file.split('/').pop() || file;

          for (const tp of SCRIPT_PATTERNS) {
            if (tp.pattern.test(content)) {
              threats.push({
                severity: tp.severity,
                file: `scripts/${fileName}`,
                pattern: tp.pattern.source,
                description: tp.description,
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip if scripts dir can't be listed
    }
  }

  // Determine risk level
  let riskLevel: 'clean' | 'warning' | 'danger' = 'clean';
  if (threats.some((t) => t.severity === 'danger')) {
    riskLevel = 'danger';
  } else if (threats.length > 0) {
    riskLevel = 'warning';
  }

  return { threats, riskLevel };
}
