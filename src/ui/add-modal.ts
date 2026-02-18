import { App, Modal, Notice, Setting } from 'obsidian';
import type SkillsManagerPlugin from '../main';
import { validateSkillDir } from '../validator';
import { parseRepo, parseSkillRef, fetchReleases, fetchSkillsShInfo, SkillRef } from '../github';
import { installLocalSkill, installFromGitHub, installFromMonorepo } from '../installer';
import { GitHubRelease } from '../types';

type Tab = 'local' | 'remote';

export class AddSkillModal extends Modal {
  private plugin: SkillsManagerPlugin;
  private activeTab: Tab = 'local';
  private onDone: () => void;

  // Local tab state
  private localPath = '';
  private localStatus = '';

  // Remote tab state
  private remoteInput = '';
  private remoteVersion = '';
  private releases: GitHubRelease[] = [];
  private remoteStatus = '';
  private parsedRef: SkillRef | null = null;

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

    const remoteTab = tabBar.createEl('button', { text: 'Install' });
    remoteTab.addClass('skills-manager-tab');
    if (this.activeTab === 'remote') remoteTab.addClass('is-active');
    remoteTab.addEventListener('click', () => {
      this.activeTab = 'remote';
      this.render();
    });

    // Tab content
    const body = contentEl.createDiv('skills-manager-modal-body');

    if (this.activeTab === 'local') {
      this.renderLocalTab(body);
    } else {
      this.renderRemoteTab(body);
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

  private renderRemoteTab(container: HTMLElement): void {
    new Setting(container)
      .setName('Skill source')
      .setDesc('GitHub repo, URL, monorepo path, or skills.sh URL')
      .addText((text) =>
        text
          .setPlaceholder('owner/repo, owner/repo/path, or URL')
          .setValue(this.remoteInput)
          .onChange((value) => {
            this.remoteInput = value;
            this.parsedRef = parseSkillRef(value);
            // Re-render to update hint
            this.updateHint(container);
          })
      );

    // Format detection hint
    const hintEl = container.createEl('p', { cls: 'skills-manager-input-hint' });
    this.setHintText(hintEl);

    // Fetch versions button (only for standard repo refs)
    if (this.parsedRef?.type === 'github' && this.parsedRef.repo) {
      const fetchRow = container.createDiv('skills-manager-modal-buttons');
      const fetchBtn = fetchRow.createEl('button', { text: 'Fetch Versions' });
      fetchBtn.addEventListener('click', async () => {
        const repo = this.parsedRef?.repo;
        if (!repo) return;
        try {
          this.remoteStatus = 'Fetching releases...';
          this.render();
          const pat = this.plugin.state.settings.githubPat || undefined;
          this.releases = await fetchReleases(repo, pat);
          if (this.releases.length === 0) {
            this.remoteStatus = 'No releases found';
          } else {
            this.remoteStatus = `Found ${this.releases.length} release(s)`;
            this.remoteVersion = this.releases[0].tag_name;
          }
        } catch (e) {
          this.remoteStatus = e instanceof Error ? e.message : String(e);
          this.releases = [];
        }
        this.render();
      });
    }

    // Version dropdown (only if releases loaded)
    if (this.releases.length > 0) {
      new Setting(container)
        .setName('Version')
        .setDesc('Select a release version')
        .addDropdown((dropdown) => {
          for (const release of this.releases) {
            dropdown.addOption(release.tag_name, release.tag_name);
          }
          dropdown.setValue(this.remoteVersion);
          dropdown.onChange((value) => {
            this.remoteVersion = value;
          });
        });
    }

    // Status
    if (this.remoteStatus) {
      const status = container.createEl('p', { cls: 'skills-manager-modal-status' });
      status.setText(this.remoteStatus);
    }

    // Install button
    const btnRow = container.createDiv('skills-manager-modal-buttons');
    const installBtn = btnRow.createEl('button', {
      text: 'Install',
      cls: 'mod-cta',
    });

    installBtn.addEventListener('click', async () => {
      const ref = parseSkillRef(this.remoteInput);
      if (!ref) {
        this.remoteStatus = 'Unrecognized format. Use owner/repo, a GitHub URL, or a skills.sh URL.';
        this.render();
        return;
      }

      this.remoteStatus = 'Installing...';
      this.render();

      const pat = this.plugin.state.settings.githubPat || undefined;

      try {
        let result;

        if (ref.type === 'skills-sh') {
          // Resolve skills.sh to GitHub source
          const info = await fetchSkillsShInfo(ref.skillsShId!);
          if (!info) {
            this.remoteStatus = 'Could not resolve skills.sh skill to a GitHub source';
            this.render();
            return;
          }
          if (info.subpath) {
            result = await installFromMonorepo(
              this.app.vault,
              this.plugin.state,
              this.plugin.state.settings.skillsDir,
              info.repo,
              info.subpath,
              pat
            );
          } else {
            result = await installFromGitHub(
              this.app.vault,
              this.plugin.state,
              this.plugin.state.settings.skillsDir,
              info.repo,
              undefined,
              pat
            );
          }
        } else if (ref.type === 'github-monorepo') {
          result = await installFromMonorepo(
            this.app.vault,
            this.plugin.state,
            this.plugin.state.settings.skillsDir,
            ref.repo!,
            ref.subpath!,
            pat
          );
        } else {
          // Standard GitHub repo
          result = await installFromGitHub(
            this.app.vault,
            this.plugin.state,
            this.plugin.state.settings.skillsDir,
            ref.repo!,
            this.remoteVersion || undefined,
            pat
          );
        }

        if (result.success) {
          new Notice(`Installed skill: ${result.skillName}`);
          this.onDone();
          this.close();
        } else {
          this.remoteStatus = result.errors.join('; ');
          this.render();
        }
      } catch (e) {
        this.remoteStatus = e instanceof Error ? e.message : String(e);
        this.render();
      }
    });
  }

  private setHintText(el: HTMLElement): void {
    if (!this.remoteInput.trim()) {
      el.setText('');
      el.removeClass('skills-manager-hint-error');
      return;
    }

    const ref = this.parsedRef;
    if (!ref) {
      el.setText('Unrecognized format');
      el.addClass('skills-manager-hint-error');
      return;
    }

    el.removeClass('skills-manager-hint-error');
    switch (ref.type) {
      case 'github':
        el.setText(`GitHub repo: ${ref.repo}`);
        break;
      case 'github-monorepo':
        el.setText(`Monorepo: ${ref.repo} → ${ref.subpath}`);
        break;
      case 'skills-sh':
        el.setText(`skills.sh: ${ref.skillsShId}`);
        break;
    }
  }

  private updateHint(container: HTMLElement): void {
    const hintEl = container.querySelector('.skills-manager-input-hint');
    if (hintEl instanceof HTMLElement) {
      this.setHintText(hintEl);
    }
  }
}
