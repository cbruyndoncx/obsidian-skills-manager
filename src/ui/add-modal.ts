import { App, Modal, Notice, Setting, getBlobArrayBuffer } from 'obsidian';
import type SkillsManagerPlugin from '../main';
import { parseSkillRef, fetchReleases, fetchSkillsShInfo, SkillRef } from '../github';
import { installFromGitHub, installFromMonorepo, installFromZip, previewZipSkills } from '../installer';
import { GitHubRelease } from '../types';

type Tab = 'zip' | 'remote';

export class AddSkillModal extends Modal {
  private plugin: SkillsManagerPlugin;
  private activeTab: Tab = 'zip';
  private onDone: () => void;

  // ZIP tab state
  private zipData: ArrayBuffer | null = null;
  private zipFileName = '';
  private zipPreview: { folder: string; name: string }[] = [];
  private zipStatus = '';
  private zipInstalling = false;

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

    const zipTab = tabBar.createEl('button', { text: 'Upload ZIP' });
    zipTab.addClass('skills-manager-tab');
    if (this.activeTab === 'zip') zipTab.addClass('is-active');
    zipTab.addEventListener('click', () => {
      this.activeTab = 'zip';
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

    if (this.activeTab === 'zip') {
      this.renderZipTab(body);
    } else {
      this.renderRemoteTab(body);
    }
  }

  private renderZipTab(container: HTMLElement): void {
    // Drop zone / file picker
    const dropZone = container.createDiv('skills-manager-drop-zone');

    if (this.zipFileName) {
      dropZone.createEl('p', {
        text: this.zipFileName,
        cls: 'skills-manager-drop-zone-filename',
      });
      dropZone.createEl('p', {
        text: 'Click or drop to replace',
        cls: 'skills-manager-drop-zone-hint',
      });
    } else {
      dropZone.createEl('p', {
        text: 'Drop a ZIP file here or click to browse',
        cls: 'skills-manager-drop-zone-hint',
      });
    }

    // Hidden file input
    const fileInput = dropZone.createEl('input', { type: 'file' });
    fileInput.accept = '.zip';
    fileInput.addClass('skills-manager-file-input');

    // Click zone to trigger file input
    dropZone.addEventListener('click', () => fileInput.click());

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.addClass('is-dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.removeClass('is-dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.removeClass('is-dragover');
      const file = e.dataTransfer?.files[0];
      if (file && file.name.endsWith('.zip')) {
        this.handleZipFile(file);
      } else {
        this.zipStatus = 'Please drop a .zip file';
        this.render();
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.handleZipFile(file);
    });

    // Preview list
    if (this.zipPreview.length > 0) {
      const previewEl = container.createDiv('skills-manager-zip-preview');
      previewEl.createEl('p', {
        text: `${this.zipPreview.length} skill(s) found:`,
        cls: 'skills-manager-zip-preview-header',
      });
      const list = previewEl.createEl('ul', { cls: 'skills-manager-zip-preview-list' });
      for (const skill of this.zipPreview) {
        const li = list.createEl('li');
        li.createEl('span', { text: skill.name, cls: 'skills-manager-zip-skill-name' });
        if (skill.name !== skill.folder) {
          li.createEl('span', { text: ` (${skill.folder})`, cls: 'skills-manager-zip-skill-folder' });
        }
      }
    }

    // Status
    if (this.zipStatus) {
      const status = container.createEl('p', { cls: 'skills-manager-modal-status' });
      status.setText(this.zipStatus);
    }

    // Install button
    if (this.zipPreview.length > 0) {
      const btnRow = container.createDiv('skills-manager-modal-buttons');
      const installBtn = btnRow.createEl('button', {
        text: this.zipInstalling ? 'Installing...' : `Install ${this.zipPreview.length} skill(s)`,
        cls: 'mod-cta',
      });
      if (this.zipInstalling) installBtn.addClass('is-disabled');

      installBtn.addEventListener('click', async () => {
        if (this.zipInstalling || !this.zipData) return;
        this.zipInstalling = true;
        this.zipStatus = 'Installing...';
        this.render();

        try {
          const result = await installFromZip(
            this.app.vault,
            this.plugin.state,
            this.plugin.state.settings.skillsDir,
            this.zipData
          );

          if (result.installed.length > 0) {
            new Notice(`Installed ${result.installed.length} skill(s): ${result.installed.join(', ')}`);
          }
          if (result.errors.length > 0) {
            this.zipStatus = `Errors: ${result.errors.join('; ')}`;
            this.zipInstalling = false;
            this.render();
          }
          if (result.installed.length > 0) {
            this.onDone();
            if (result.errors.length === 0) {
              this.close();
            }
          } else {
            this.zipInstalling = false;
            if (!this.zipStatus) {
              this.zipStatus = 'No skills were installed';
            }
            this.render();
          }
        } catch (e) {
          this.zipStatus = e instanceof Error ? e.message : String(e);
          this.zipInstalling = false;
          this.render();
        }
      });
    }
  }

  private async handleZipFile(file: File): Promise<void> {
    this.zipFileName = file.name;
    this.zipStatus = 'Reading ZIP...';
    this.zipPreview = [];
    this.render();

    try {
      const blob = new Blob([file]);
      this.zipData = await getBlobArrayBuffer(blob);

      const preview = await previewZipSkills(this.zipData);
      if (preview.error) {
        this.zipStatus = preview.error;
        this.zipPreview = [];
      } else if (preview.skills.length === 0) {
        this.zipStatus = 'No skill folders found in ZIP';
        this.zipPreview = [];
      } else {
        this.zipStatus = '';
        this.zipPreview = preview.skills;
      }
    } catch (e) {
      this.zipStatus = e instanceof Error ? e.message : String(e);
      this.zipData = null;
      this.zipPreview = [];
    }

    this.render();
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
