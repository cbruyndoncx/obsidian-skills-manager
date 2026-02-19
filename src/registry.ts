import { requestUrl } from 'obsidian';
import { RegistryConfig, RegistrySkill } from './types';

export interface RegistryFetchResult {
  skills: RegistrySkill[];
  hasMore: boolean;
  page: number;
}

export interface RegistryBrowseOptions {
  board: string;
  page: number;
  search?: string;
  perPage?: number;
}

export interface BoardOption {
  id: string;
  label: string;
}

export interface RegistryProvider {
  readonly type: string;
  readonly config: RegistryConfig;

  /** Available board/sort options for browsing */
  getBoards(): BoardOption[];

  /** Whether this provider requires an API key */
  needsApiKey(): boolean;

  /** Fetch skills from the registry */
  fetchSkills(options: RegistryBrowseOptions): Promise<RegistryFetchResult>;
}

// ─── Skills.sh Provider ───────────────────────────────────────

export class SkillsShProvider implements RegistryProvider {
  readonly type = 'skills-sh';
  readonly config: RegistryConfig;

  constructor(config: RegistryConfig) {
    this.config = config;
  }

  getBoards(): BoardOption[] {
    return [
      { id: 'all-time', label: 'All Time' },
      { id: 'trending', label: 'Trending' },
      { id: 'hot', label: 'Hot' },
    ];
  }

  needsApiKey(): boolean {
    return false;
  }

  async fetchSkills(options: RegistryBrowseOptions): Promise<RegistryFetchResult> {
    const url = `${this.config.url}/${options.board}/${options.page}`;
    const response = await requestUrl({ url, throw: false });

    if (response.status !== 200) {
      throw new Error(`Registry returned status ${response.status}`);
    }

    const data = response.json as {
      skills: RegistrySkill[];
      hasMore: boolean;
      page: number;
    };

    return {
      skills: data.skills.map(s => ({
        ...s,
        registryName: this.config.name,
      })),
      hasMore: data.hasMore,
      page: data.page,
    };
  }
}

// ─── SkillsMP Provider ────────────────────────────────────────

export class SkillsMPProvider implements RegistryProvider {
  readonly type = 'skillsmp';
  readonly config: RegistryConfig;

  constructor(config: RegistryConfig) {
    this.config = config;
  }

  getBoards(): BoardOption[] {
    return [
      { id: 'stars', label: 'Most Stars' },
      { id: 'recent', label: 'Recent' },
    ];
  }

  needsApiKey(): boolean {
    return true;
  }

  async fetchSkills(options: RegistryBrowseOptions): Promise<RegistryFetchResult> {
    if (!this.config.apiKey) {
      throw new Error('SkillsMP requires an API key. Get one at skillsmp.com/settings/api');
    }

    const baseUrl = this.config.url.replace(/\/$/, '');
    const perPage = options.perPage || 20;
    // SkillsMP uses 1-based pages
    const page = options.page + 1;

    const params = new URLSearchParams({
      q: options.search || '*',
      page: String(page),
      per_page: String(perPage),
      sort: options.board,
    });

    const url = `${baseUrl}/search?${params.toString()}`;
    const response = await requestUrl({
      url,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      throw: false,
    });

    if (response.status !== 200) {
      const body = response.json;
      const msg = body?.error?.message || `SkillsMP returned status ${response.status}`;
      throw new Error(msg);
    }

    const data = response.json as {
      success: boolean;
      data: {
        skills: Array<{
          name?: string;
          skill_name?: string;
          repo?: string;
          source?: string;
          github_url?: string;
          stars?: number;
          description?: string;
          install_count?: number;
        }>;
        total?: number;
        totalPages?: number;
        hasNext?: boolean;
        page?: number;
      };
    };

    if (!data.success) {
      throw new Error('SkillsMP returned unsuccessful response');
    }

    const skills: RegistrySkill[] = (data.data.skills || []).map(s => ({
      name: s.name || s.skill_name || 'Unknown',
      source: s.source || s.repo || s.github_url || '',
      skillId: s.name || s.skill_name || '',
      installs: s.install_count || 0,
      description: s.description,
      stars: s.stars,
      registryName: this.config.name,
    }));

    return {
      skills,
      hasMore: data.data.hasNext ?? (data.data.totalPages ? page < data.data.totalPages : false),
      page: options.page,
    };
  }
}

// ─── Tessl Provider (stub) ────────────────────────────────────

export class TesslProvider implements RegistryProvider {
  readonly type = 'tessl';
  readonly config: RegistryConfig;

  constructor(config: RegistryConfig) {
    this.config = config;
  }

  getBoards(): BoardOption[] {
    return [
      { id: 'all', label: 'All' },
    ];
  }

  needsApiKey(): boolean {
    return false;
  }

  async fetchSkills(_options: RegistryBrowseOptions): Promise<RegistryFetchResult> {
    throw new Error(
      'Tessl does not have a public REST API yet. Use the Tessl CLI (tessl search) to browse skills.'
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────

export function createProvider(config: RegistryConfig): RegistryProvider {
  switch (config.type) {
    case 'skills-sh':
      return new SkillsShProvider(config);
    case 'skillsmp':
      return new SkillsMPProvider(config);
    case 'tessl':
      return new TesslProvider(config);
    default:
      throw new Error(`Unknown registry type: ${config.type}`);
  }
}

export const REGISTRY_TYPE_LABELS: Record<string, string> = {
  'skills-sh': 'Skills.sh',
  'skillsmp': 'SkillsMP',
  'tessl': 'Tessl (CLI only)',
};

export const REGISTRY_TYPE_DEFAULTS: Record<string, string> = {
  'skills-sh': 'https://skills.sh/api/skills',
  'skillsmp': 'https://skillsmp.com/api/v1/skills',
  'tessl': 'https://tessl.io/registry',
};
