import { Vault } from 'obsidian';

/**
 * Set a frontmatter field in a skill's SKILL.md.
 * If the field exists, replaces its value. If not, inserts it before the closing ---.
 * Returns true if the file was successfully updated.
 */
export async function setSkillField(
  vault: Vault,
  skillsDir: string,
  skillName: string,
  field: string,
  value: string
): Promise<boolean> {
  const adapter = vault.adapter;
  const skillFile = `${skillsDir}/${skillName}/SKILL.md`;

  const exists = await adapter.exists(skillFile);
  if (!exists) return false;

  const content = await adapter.read(skillFile);
  const regex = new RegExp(`^${field}:\\s*.+$`, 'm');

  let updated: string;
  if (regex.test(content)) {
    updated = content.replace(
      new RegExp(`^(${field}:\\s*).+$`, 'm'),
      `$1${value}`
    );
  } else {
    updated = content.replace(
      /^(---\r?\n[\s\S]*?)(^---)/m,
      `$1${field}: ${value}\n$2`
    );
  }

  if (updated === content) return false;

  await adapter.write(skillFile, updated);
  return true;
}

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

/**
 * Update the category field in a skill's SKILL.md frontmatter.
 * Returns true if the file was successfully updated.
 */
export async function setSkillCategory(
  vault: Vault,
  skillsDir: string,
  skillName: string,
  category: string
): Promise<boolean> {
  const adapter = vault.adapter;
  const skillFile = `${skillsDir}/${skillName}/SKILL.md`;

  const exists = await adapter.exists(skillFile);
  if (!exists) return false;

  const content = await adapter.read(skillFile);

  let updated: string;
  if (/^category:\s*.+$/m.test(content)) {
    updated = content.replace(
      /^(category:\s*).+$/m,
      `$1${category}`
    );
  } else {
    // Insert field before closing ---
    updated = content.replace(
      /^(---\r?\n[\s\S]*?)(^---)/m,
      `$1category: ${category}\n$2`
    );
  }

  if (updated === content) return false;

  await adapter.write(skillFile, updated);
  return true;
}
