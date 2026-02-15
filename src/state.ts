import { Plugin } from 'obsidian';
import { PluginData, PluginSettings, SkillState, DEFAULT_SETTINGS } from './types';

function freshDefaults(): PluginData {
  return {
    settings: { ...DEFAULT_SETTINGS, crossToolExport: [] },
    skills: {},
  };
}

export class StateManager {
  private plugin: Plugin;
  private data: PluginData;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.data = freshDefaults();
  }

  async load(): Promise<void> {
    const saved = await this.plugin.loadData();
    if (saved) {
      this.data = {
        settings: {
          ...DEFAULT_SETTINGS,
          crossToolExport: [],
          ...saved.settings,
        },
        skills: saved.skills ? { ...saved.skills } : {},
      };
    }
  }

  async save(): Promise<void> {
    await this.plugin.saveData(this.data);
  }

  get settings(): PluginSettings {
    return this.data.settings;
  }

  async updateSettings(partial: Partial<PluginSettings>): Promise<void> {
    Object.assign(this.data.settings, partial);
    await this.save();
  }

  getSkillState(name: string): SkillState | undefined {
    return this.data.skills[name];
  }

  async setSkillState(name: string, state: SkillState): Promise<void> {
    this.data.skills[name] = state;
    await this.save();
  }

  async removeSkillState(name: string): Promise<void> {
    delete this.data.skills[name];
    await this.save();
  }

  /** Get all skills with a specific source type. */
  getSkillsBySource(source: 'local' | 'zip' | 'github'): [string, SkillState][] {
    return Object.entries(this.data.skills).filter(
      ([, state]) => state.source === source
    );
  }

  /** Get all GitHub skills that are not frozen. */
  getUpdatableGitHubSkills(): [string, SkillState][] {
    return Object.entries(this.data.skills).filter(
      ([, state]) => state.source === 'github' && !state.frozen
    );
  }

  /** Toggle the frozen state of a skill. */
  async toggleFrozen(name: string): Promise<void> {
    const skill = this.data.skills[name];
    if (skill) {
      skill.frozen = !skill.frozen;
      await this.save();
    }
  }
}
