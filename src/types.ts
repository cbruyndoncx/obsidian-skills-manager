export interface SkillMeta {
  name: string;
  description: string;
  category: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  version?: string;
  source?: string;
  originRepo?: string;
  originUrl?: string;
  origin?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
}

export interface SkillState {
  source: 'local' | 'zip' | 'github';
  repo?: string;
  version?: string;
  frozen: boolean;
  installedAt: string;
  lastUpdated?: string;
}

export type RegistryType = 'skills-sh' | 'skillsmp' | 'tessl';

export interface RegistryConfig {
  type: RegistryType;
  name: string;
  url: string;
  apiKey?: string;
}

export interface PluginSettings {
  skillsDir: string;
  githubPat: string;
  autoUpdate: boolean;
  defaultCategory: string;
  customCategories: string[];
  generateSkillsIndex: boolean;
  crossToolExport: string[];
  crossToolExportEnabled: boolean;
  registries: RegistryConfig[];
}

export interface PluginData {
  settings: PluginSettings;
  skills: Record<string, SkillState>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  skillsDir: '.claude/skills',
  githubPat: '',
  autoUpdate: true,
  defaultCategory: 'uncategorized',
  customCategories: [],
  generateSkillsIndex: true,
  crossToolExport: [],
  crossToolExportEnabled: false,
  registries: [
    { type: 'skills-sh', name: 'Skills.sh', url: 'https://skills.sh/api/skills' },
  ],
};

export interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  published_at: string;
  assets: GitHubAsset[];
  zipball_url: string;
}

export interface GitHubAsset {
  name: string;
  url: string;
  browser_download_url: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RegistrySkill {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  description?: string;
  stars?: number;
  registryName?: string;
}

export interface SecurityThreat {
  severity: 'warning' | 'danger';
  file: string;
  pattern: string;
  description: string;
}

export interface SecurityScanResult {
  threats: SecurityThreat[];
  riskLevel: 'clean' | 'warning' | 'danger';
}

export interface InstallResult {
  success: boolean;
  skillName: string;
  errors: string[];
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
}

