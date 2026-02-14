import { Plugin } from 'obsidian';
import { PluginData, PluginSettings, SkillState, DEFAULT_SETTINGS } from './types';

const DEFAULT_DATA: PluginData = {
  settings: { ...DEFAULT_SETTINGS },
  skills: {},
};

export class StateManager {
  private plugin: Plugin;
  private data: PluginData;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.data = { ...DEFAULT_DATA };
  }

  async load(): Promise<void> {
    const saved = await this.plugin.loadData();
    if (saved) {
      this.data = {
        settings: { ...DEFAULT_SETTINGS, ...saved.settings },
        skills: saved.skills || {},
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
}
