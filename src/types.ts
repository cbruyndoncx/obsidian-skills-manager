export interface SkillMeta {
  name: string;
  description: string;
  category: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  version?: string;
  originRepo?: string;
  originUrl?: string;
  origin?: string;
  license?: string;
}

export interface SkillState {
  source: 'local' | 'zip' | 'github';
  repo?: string;
  version?: string;
  frozen: boolean;
  installedAt: string;
  lastUpdated?: string;
}

export interface PluginSettings {
  skillsDir: string;
  githubPat: string;
  autoUpdate: boolean;
  crossToolExport: string[];
}

export interface PluginData {
  settings: PluginSettings;
  skills: Record<string, SkillState>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  skillsDir: '.claude/skills',
  githubPat: '',
  autoUpdate: true,
  crossToolExport: [],
};

export const CATEGORY_ORDER: string[] = [
  'marketing',
  'seo',
  'documents',
  'diagramming',
  'obsidian',
  'notion',
  'business',
  'research',
  'utilities',
];

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

export interface InstallResult {
  success: boolean;
  skillName: string;
  errors: string[];
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
}

export const CATEGORY_DISPLAY: Record<string, string> = {
  marketing: 'Marketing',
  seo: 'SEO',
  documents: 'Documents',
  diagramming: 'Diagramming',
  obsidian: 'Obsidian',
  notion: 'Notion',
  business: 'Business',
  research: 'Research',
  utilities: 'Utilities',
};
