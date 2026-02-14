import { Vault } from 'obsidian';

/**
 * Toggle the disable-model-invocation field in a skill's SKILL.md frontmatter.
 * Returns true if the file was successfully updated.
 */
export async function toggleSkill(
  vault: Vault,
  skillsDir: string,
  skillName: string,
  disable: boolean
): Promise<boolean> {
  const adapter = vault.adapter;
  const skillFile = `${skillsDir}/${skillName}/SKILL.md`;

  const exists = await adapter.exists(skillFile);
  if (!exists) return false;

  const content = await adapter.read(skillFile);
  const newValue = disable ? 'true' : 'false';

  let updated: string;
  if (/^disable-model-invocation:\s*.+$/m.test(content)) {
    // Replace existing field
    updated = content.replace(
      /^(disable-model-invocation:\s*).+$/m,
      `$1${newValue}`
    );
  } else {
    // Insert field before closing ---
    updated = content.replace(
      /^(---\r?\n[\s\S]*?)(^---)/m,
      `$1disable-model-invocation: ${newValue}\n$2`
    );
  }

  if (updated === content) return false;

  await adapter.write(skillFile, updated);
  return true;
}
