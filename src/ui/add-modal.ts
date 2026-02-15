import { App, Modal, Notice, Setting } from 'obsidian';
import type SkillsManagerPlugin from '../main';
import { validateSkillDir } from '../validator';
import { parseRepo, fetchReleases } from '../github';
import { installLocalSkill, installFromGitHub } from '../installer';
import { GitHubRelease } from '../types';

type Tab = 'local' | 'github';

export class AddSkillModal extends Modal {
  private plugin: SkillsManagerPlugin;
  private activeTab: Tab = 'local';
  private onDone: () => void;

  // Local tab state
  private localPath = '';
  private localStatus = '';

  // GitHub tab state
  private githubRepo = '';
  private githubVersion = '';
  private releases: GitHubRelease[] = [];
  private githubStatus = '';

  constructor(app: App, plugin: SkillsManagerPlugin, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  onOpen(): void {
    this.modalEl.addClass('skills-manager-add-modal');
    this.titleEl.setText('Add Skill');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Tab buttons
    const tabBar = contentEl.createDiv('skills-manager-tab-bar');

    const localTab = tabBar.createEl('button', { text: 'Local Folder' });
    localTab.addClass('skills-manager-tab');
    if (this.activeTab === 'local') localTab.addClass('is-active');
    localTab.addEventListener('click', () => {
      this.activeTab = 'local';
      this.render();
    });

    const githubTab = tabBar.createEl('button', { text: 'GitHub' });
    githubTab.addClass('skills-manager-tab');
    if (this.activeTab === 'github') githubTab.addClass('is-active');
    githubTab.addEventListener('click', () => {
      this.activeTab = 'github';
      this.render();
    });

    // Tab content
    const body = contentEl.createDiv('skills-manager-modal-body');

    if (this.activeTab === 'local') {
      this.renderLocalTab(body);
    } else {
      this.renderGitHubTab(body);
    }
  }

  private renderLocalTab(container: HTMLElement): void {
    new Setting(container)
      .setName('Skill folder path')
      .setDesc('Relative to vault root (e.g., .claude/skills/my-skill)')
      .addText((text) =>
        text
          .setPlaceholder('.claude/skills/my-skill')
          .setValue(this.localPath)
          .onChange((value) => {
            this.localPath = value;
          })
      );

    // Status message
    if (this.localStatus) {
      const status = container.createEl('p', { cls: 'skills-manager-modal-status' });
      status.setText(this.localStatus);
    }

    // Buttons
    const btnRow = container.createDiv('skills-manager-modal-buttons');

    const validateBtn = btnRow.createEl('button', { text: 'Validate' });
    validateBtn.addEventListener('click', async () => {
      if (!this.localPath) {
        this.localStatus = 'Enter a folder path first';
        this.render();
        return;
      }
      const result = await validateSkillDir(this.app.vault, this.localPath);
      if (result.valid) {
        this.localStatus = 'Valid skill directory';
      } else {
        this.localStatus = result.errors.join('; ');
      }
      this.render();
    });

    const addBtn = btnRow.createEl('button', { text: 'Add Skill', cls: 'mod-cta' });
    addBtn.addEventListener('click', async () => {
      if (!this.localPath) {
        this.localStatus = 'Enter a folder path first';
        this.render();
        return;
      }
      const result = await installLocalSkill(
        this.app.vault,
        this.plugin.state,
        this.localPath
      );
      if (result.success) {
        new Notice(`Added skill: ${result.skillName}`);
        this.onDone();
        this.close();
      } else {
        this.localStatus = result.errors.join('; ');
        this.render();
      }
    });
  }

  private renderGitHubTab(container: HTMLElement): void {
    new Setting(container)
      .setName('GitHub repository')
      .setDesc('owner/repo or full GitHub URL')
      .addText((text) =>
        text
          .setPlaceholder('owner/repo')
          .setValue(this.githubRepo)
          .onChange((value) => {
            this.githubRepo = value;
          })
      );

    // Fetch versions button
    const fetchRow = container.createDiv('skills-manager-modal-buttons');
    const fetchBtn = fetchRow.createEl('button', { text: 'Fetch Versions' });
    fetchBtn.addEventListener('click', async () => {
      const repo = parseRepo(this.githubRepo);
      if (!repo) {
        this.githubStatus = 'Invalid repository format. Use owner/repo';
        this.render();
        return;
      }
      try {
        this.githubStatus = 'Fetching releases...';
        this.render();
        const pat = this.plugin.state.settings.githubPat || undefined;
        this.releases = await fetchReleases(repo, pat);
        if (this.releases.length === 0) {
          this.githubStatus = 'No releases found';
        } else {
          this.githubStatus = `Found ${this.releases.length} release(s)`;
          this.githubVersion = this.releases[0].tag_name;
        }
      } catch (e) {
        this.githubStatus = e instanceof Error ? e.message : String(e);
        this.releases = [];
      }
      this.render();
    });

    // Version dropdown (only if releases loaded)
    if (this.releases.length > 0) {
      new Setting(container)
        .setName('Version')
        .setDesc('Select a release version')
        .addDropdown((dropdown) => {
          for (const release of this.releases) {
            dropdown.addOption(release.tag_name, release.tag_name);
          }
          dropdown.setValue(this.githubVersion);
          dropdown.onChange((value) => {
            this.githubVersion = value;
          });
        });
    }

    // Status
    if (this.githubStatus) {
      const status = container.createEl('p', { cls: 'skills-manager-modal-status' });
      status.setText(this.githubStatus);
    }

    // Install button
    const btnRow = container.createDiv('skills-manager-modal-buttons');
    const installBtn = btnRow.createEl('button', {
      text: 'Install',
      cls: 'mod-cta',
    });

    installBtn.addEventListener('click', async () => {
      const repo = parseRepo(this.githubRepo);
      if (!repo) {
        this.githubStatus = 'Invalid repository format';
        this.render();
        return;
      }

      this.githubStatus = 'Installing...';
      this.render();

      const pat = this.plugin.state.settings.githubPat || undefined;
      const result = await installFromGitHub(
        this.app.vault,
        this.plugin.state,
        this.plugin.state.settings.skillsDir,
        repo,
        this.githubVersion || undefined,
        pat
      );

      if (result.success) {
        new Notice(`Installed skill: ${result.skillName}`);
        this.onDone();
        this.close();
      } else {
        this.githubStatus = result.errors.join('; ');
        this.render();
      }
    });
  }
}
