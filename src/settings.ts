import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SkillsManagerPlugin from './main';
import { SkillMeta, CATEGORY_ORDER, CATEGORY_DISPLAY } from './types';
import { scanSkills } from './scanner';
import { toggleSkill } from './toggler';
import { deleteSkill, updateGitHubSkill } from './installer';
import { checkForUpdate } from './github';
import { AddSkillModal } from './ui/add-modal';

export class SkillsManagerSettingTab extends PluginSettingTab {
  plugin: SkillsManagerPlugin;
  private skillContainers: Map<string, HTMLElement> = new Map();
  private searchQuery = '';
  private deleteConfirm: string | null = null;

  constructor(app: App, plugin: SkillsManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('skills-manager-settings');

    // --- Plugin settings section ---
    new Setting(containerEl)
      .setName('Skills directory')
      .setDesc('Path relative to vault root where skills are stored')
      .addText((text) =>
        text
          .setPlaceholder('.claude/skills')
          .setValue(this.plugin.state.settings.skillsDir)
          .onChange(async (value) => {
            await this.plugin.state.updateSettings({ skillsDir: value });
          })
      );

    new Setting(containerEl)
      .setName('GitHub Personal Access Token')
      .setDesc('For private repos and higher rate limits. Stored locally.')
      .addText((text) => {
        text
          .setPlaceholder('ghp_...')
          .setValue(this.plugin.state.settings.githubPat)
          .onChange(async (value) => {
            await this.plugin.state.updateSettings({ githubPat: value });
          });
        text.inputEl.type = 'password';
        text.inputEl.style.width = '300px';
      });

    new Setting(containerEl)
      .setName('Auto-check for updates')
      .setDesc('Check for skill updates on startup (GitHub skills only)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.state.settings.autoUpdate)
          .onChange(async (value) => {
            await this.plugin.state.updateSettings({ autoUpdate: value });
          })
      );

    // --- Skills list ---
    const skillsHeader = containerEl.createDiv('skills-manager-header-row');
    const skillsHeading = skillsHeader.createEl('h3', { text: 'Skills' });
    skillsHeading.addClass('skills-manager-heading');

    const addBtn = skillsHeader.createEl('button', { text: '+ Add Skill' });
    addBtn.addClass('skills-manager-add-btn');
    addBtn.addEventListener('click', () => {
      new AddSkillModal(this.app, this.plugin, () => this.display()).open();
    });

    // Search/filter
    const searchContainer = containerEl.createDiv('skills-manager-search');
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Filter skills...',
    });
    searchInput.addClass('skills-manager-search-input');
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.filterSkills();
    });

    // Scan and render
    const skills = await scanSkills(
      this.app.vault,
      this.plugin.state.settings.skillsDir
    );

    if (skills.size === 0) {
      containerEl.createEl('p', {
        text: `No skills found in "${this.plugin.state.settings.skillsDir}". Check that the directory exists and contains skill folders with SKILL.md files.`,
        cls: 'skills-manager-empty',
      });
      return;
    }

    // Stats
    const enabled = Array.from(skills.values()).filter(
      (s) => !s.disableModelInvocation
    ).length;
    containerEl.createEl('p', {
      text: `${skills.size} skills found — ${enabled} enabled, ${skills.size - enabled} disabled`,
      cls: 'skills-manager-stats',
    });

    // Group by category
    const grouped = this.groupByCategory(skills);

    for (const category of CATEGORY_ORDER) {
      const entries = grouped.get(category);
      if (!entries || entries.length === 0) continue;

      const displayName = CATEGORY_DISPLAY[category] || category;
      const categoryContainer = containerEl.createDiv('skills-manager-category');

      categoryContainer.createEl('h4', {
        text: `${displayName} (${entries.length})`,
        cls: 'skills-manager-category-header',
      });

      for (const [folderName, meta] of entries) {
        this.renderSkillRow(categoryContainer, folderName, meta);
      }
    }

    // Uncategorized
    const uncategorized = grouped.get('_other');
    if (uncategorized && uncategorized.length > 0) {
      const categoryContainer = containerEl.createDiv('skills-manager-category');
      categoryContainer.createEl('h4', {
        text: `Other (${uncategorized.length})`,
        cls: 'skills-manager-category-header',
      });
      for (const [folderName, meta] of uncategorized) {
        this.renderSkillRow(categoryContainer, folderName, meta);
      }
    }
  }

  private renderSkillRow(
    container: HTMLElement,
    folderName: string,
    meta: SkillMeta
  ): void {
    const row = container.createDiv('skills-manager-skill-row');
    this.skillContainers.set(folderName, row);
    row.dataset.skillName = folderName;
    row.dataset.searchText = `${meta.name} ${meta.description} ${meta.category}`.toLowerCase();

    const skillState = this.plugin.state.getSkillState(folderName);
    const isGitHub = skillState?.source === 'github';

    const setting = new Setting(row)
      .setName(meta.name)
      .setDesc(meta.description)
      .addToggle((toggle) =>
        toggle.setValue(!meta.disableModelInvocation).onChange(async (value) => {
          const success = await toggleSkill(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            !value
          );
          if (!success) {
            toggle.setValue(!value);
          }
        })
      );

    // Source badge + version badge
    const descEl = setting.descEl;
    if (descEl) {
      const badge = descEl.createSpan('skills-manager-badge');
      badge.setText(CATEGORY_DISPLAY[meta.category] || meta.category);

      if (skillState) {
        const sourceBadge = descEl.createSpan('skills-manager-badge skills-manager-badge-source');
        sourceBadge.setText(skillState.source);
      }

      if (meta.version || skillState?.version) {
        const versionBadge = descEl.createSpan(
          'skills-manager-badge skills-manager-badge-version'
        );
        versionBadge.setText(`v${meta.version || skillState?.version}`);
      }

      if (skillState?.frozen) {
        const frozenBadge = descEl.createSpan('skills-manager-badge skills-manager-badge-frozen');
        frozenBadge.setText('frozen');
      }
    }

    // GitHub skill actions: freeze toggle, update button
    if (isGitHub) {
      setting.addExtraButton((btn) => {
        btn.setIcon(skillState?.frozen ? 'lock' : 'unlock')
          .setTooltip(skillState?.frozen ? 'Unfreeze version' : 'Freeze version')
          .onClick(async () => {
            await this.plugin.state.toggleFrozen(folderName);
            this.display();
          });
      });

      setting.addExtraButton((btn) => {
        btn.setIcon('refresh-cw')
          .setTooltip('Check for update')
          .onClick(async () => {
            if (!skillState?.repo || !skillState?.version) {
              new Notice('No repo or version info available');
              return;
            }
            const pat = this.plugin.state.settings.githubPat || undefined;
            const result = await checkForUpdate(
              skillState.repo,
              skillState.version,
              pat
            );
            if (!result) {
              new Notice('Could not check for updates');
            } else if (result.hasUpdate) {
              new Notice(`Update available: ${result.latestVersion}`);
              const updated = await updateGitHubSkill(
                this.app.vault,
                this.plugin.state,
                this.plugin.state.settings.skillsDir,
                folderName
              );
              if (updated.success) {
                new Notice(`Updated ${folderName}`);
                this.display();
              } else {
                new Notice(`Update failed: ${updated.errors.join('; ')}`);
              }
            } else {
              new Notice('Already up to date');
            }
          });
      });
    }

    // Delete button (two-click confirmation)
    setting.addExtraButton((btn) => {
      const isConfirming = this.deleteConfirm === folderName;
      btn.setIcon('trash')
        .setTooltip(isConfirming ? 'Click again to confirm delete' : 'Delete skill')
        .onClick(async () => {
          if (this.deleteConfirm === folderName) {
            // Second click — actually delete
            const success = await deleteSkill(
              this.app.vault,
              this.plugin.state,
              this.plugin.state.settings.skillsDir,
              folderName
            );
            if (success) {
              new Notice(`Deleted skill: ${folderName}`);
            } else {
              new Notice('Failed to delete skill');
            }
            this.deleteConfirm = null;
            this.display();
          } else {
            // First click — enter confirmation
            this.deleteConfirm = folderName;
            btn.extraSettingsEl.addClass('skills-manager-delete-confirm');
            new Notice('Click delete again to confirm');
            // Reset after 3s
            setTimeout(() => {
              if (this.deleteConfirm === folderName) {
                this.deleteConfirm = null;
                btn.extraSettingsEl.removeClass('skills-manager-delete-confirm');
              }
            }, 3000);
          }
        });

      if (this.deleteConfirm === folderName) {
        btn.extraSettingsEl.addClass('skills-manager-delete-confirm');
      }
    });
  }

  private groupByCategory(
    skills: Map<string, SkillMeta>
  ): Map<string, [string, SkillMeta][]> {
    const grouped = new Map<string, [string, SkillMeta][]>();

    for (const [folderName, meta] of skills) {
      const cat = CATEGORY_ORDER.includes(meta.category)
        ? meta.category
        : '_other';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push([folderName, meta]);
    }

    // Sort within each category
    for (const entries of grouped.values()) {
      entries.sort((a, b) => a[1].name.localeCompare(b[1].name));
    }

    return grouped;
  }

  private filterSkills(): void {
    for (const [, el] of this.skillContainers) {
      const searchText = el.dataset.searchText || '';
      if (!this.searchQuery || searchText.includes(this.searchQuery)) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }

    // Hide empty category headers
    const categories = this.containerEl.querySelectorAll('.skills-manager-category');
    categories.forEach((cat) => {
      const rows = cat.querySelectorAll('.skills-manager-skill-row');
      const visibleRows = Array.from(rows).filter(
        (r) => (r as HTMLElement).style.display !== 'none'
      );
      (cat as HTMLElement).style.display = visibleRows.length > 0 ? '' : 'none';
    });
  }
}
