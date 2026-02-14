import { App, PluginSettingTab, Setting } from 'obsidian';
import type SkillsManagerPlugin from './main';
import { SkillMeta, CATEGORY_ORDER, CATEGORY_DISPLAY } from './types';
import { scanSkills } from './scanner';
import { toggleSkill } from './toggler';

export class SkillsManagerSettingTab extends PluginSettingTab {
  plugin: SkillsManagerPlugin;
  private skillContainers: Map<string, HTMLElement> = new Map();
  private searchQuery = '';

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

    // --- Skills list ---
    const skillsHeading = containerEl.createEl('h3', { text: 'Skills' });
    skillsHeading.addClass('skills-manager-heading');

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

    // Add category badge to the description
    const descEl = setting.descEl;
    if (descEl) {
      const badge = descEl.createSpan('skills-manager-badge');
      badge.setText(CATEGORY_DISPLAY[meta.category] || meta.category);
      if (meta.version) {
        const versionBadge = descEl.createSpan('skills-manager-badge skills-manager-badge-version');
        versionBadge.setText(`v${meta.version}`);
      }
    }
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
