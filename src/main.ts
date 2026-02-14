import { Plugin } from 'obsidian';
import { StateManager } from './state';
import { SkillsManagerSettingTab } from './settings';

export default class SkillsManagerPlugin extends Plugin {
  state!: StateManager;
  private settingsTab!: SkillsManagerSettingTab;

  async onload(): Promise<void> {
    this.state = new StateManager(this);
    await this.state.load();

    this.settingsTab = new SkillsManagerSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.addCommand({
      id: 'skills-manager-list',
      name: 'List skills',
      callback: () => {
        // Open settings tab — Obsidian API: open plugin settings
        (this.app as any).setting.open();
        (this.app as any).setting.openTabById(this.manifest.id);
      },
    });

    this.addCommand({
      id: 'skills-manager-rescan',
      name: 'Rescan skills',
      callback: () => {
        this.settingsTab.display();
      },
    });
  }

  onunload(): void {
    // Cleanup if needed
  }
}
