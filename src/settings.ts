import { App, Component, MarkdownRenderer, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SkillsManagerPlugin from './main';
import {
  SkillMeta, RegistrySkill, RegistryConfig, RegistryType,
  SecurityScanResult,
} from './types';
import { scanSkills } from './scanner';
import { toggleSkill, setSkillCategory, setSkillField } from './toggler';
import { deleteSkill, updateGitHubSkill, installFromGitHub, installFromMonorepo } from './installer';
import { checkForUpdate } from './github';
import { AddSkillModal } from './ui/add-modal';
import { exportSkills, EXPORT_TARGET_LABELS } from './exporter';
import { scanForThreats } from './validator';
import {
  RegistryProvider, createProvider,
  REGISTRY_TYPE_LABELS, REGISTRY_TYPE_DEFAULTS,
} from './registry';

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as unknown as T;
}

type SettingsTab = 'installed' | 'marketplace';

class ReadmeModal extends Modal {
  private content: string;

  constructor(app: App, content: string) {
    super(app);
    this.content = content;
  }

  onOpen(): void {
    this.modalEl.addClass('skills-manager-readme-modal');
    this.titleEl.setText('Skills Manager Documentation');
    const container = this.contentEl.createDiv('skills-manager-readme-content');
    const component = new Component();
    component.load();
    MarkdownRenderer.render(this.app, this.content, container, '', component);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SkillsManagerSettingTab extends PluginSettingTab {
  plugin: SkillsManagerPlugin;
  private skillContainers: Map<string, HTMLElement> = new Map();
  private searchQuery = '';
  private deleteConfirm: string | null = null;
  private expandedSkill: string | null = null;
  private threatCache: Map<string, SecurityScanResult> = new Map();
  private allSkills: Map<string, SkillMeta> = new Map();

  // Tab state
  private activeTab: SettingsTab = 'installed';

  // Collapsible categories
  private collapsedCategories: Set<string> = new Set();
  private categoriesInitialized = false;

  // Config section collapsed state
  private configExpanded = false;

  // Marketplace state
  private registrySkills: RegistrySkill[] = [];
  private registryBoard = '';
  private registryPage = 0;
  private registryHasMore = false;
  private registryLoading = false;
  private registryError = '';
  private registrySearch = '';
  private activeRegistryIndex = 0;
  private activeProvider: RegistryProvider | null = null;
  private installLog: { text: string; success: boolean }[] = [];

  constructor(app: App, plugin: SkillsManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('skills-manager-settings');

    // Invalidate caches on rescan/redisplay
    this.threatCache.clear();
    this.skillContainers.clear();

    // --- README link ---
    const readmeLink = containerEl.createEl('a', {
      text: 'Documentation — features, limitations & usage guide',
      cls: 'skills-manager-readme-link',
      href: '#',
    });
    readmeLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const readmePath = `${this.plugin.manifest.dir}/README.md`;
        const content = await this.app.vault.adapter.read(readmePath);
        const modal = new ReadmeModal(this.app, content);
        modal.open();
      } catch {
        window.open('https://github.com/brncx/obsidian-skills-manager#readme', '_blank');
      }
    });

    // --- Configuration (collapsible, collapsed by default) ---
    const configHeading = containerEl.createEl('h3', {
      cls: 'skills-manager-heading skills-manager-collapsible-heading',
    });
    const configChevron = configHeading.createSpan('skills-manager-chevron');
    configChevron.setText(this.configExpanded ? '▾' : '▸');
    configHeading.appendText(' Configuration');

    configHeading.addEventListener('click', () => {
      this.configExpanded = !this.configExpanded;
      this.display();
    });

    if (this.configExpanded) {
      // --- Plugin settings ---
      const skillsDirSetting = new Setting(containerEl)
        .setName('Skills directory')
        .setDesc('Path relative to vault root where skills are stored')
        .addText((text) =>
          text
            .setPlaceholder('.claude/skills')
            .setValue(this.plugin.state.settings.skillsDir)
            .onChange(async (value) => {
              await this.plugin.state.updateSettings({ skillsDir: value });
              const exists = await this.app.vault.adapter.exists(value);
              const warningEl = skillsDirSetting.descEl.querySelector('.skills-manager-dir-warning');
              if (!exists && value) {
                if (!warningEl) {
                  const warn = skillsDirSetting.descEl.createEl('div', {
                    text: `Directory "${value}" does not exist`,
                    cls: 'skills-manager-dir-warning mod-warning',
                  });
                  warn.style.color = 'var(--text-error)';
                  warn.style.fontSize = '0.8em';
                  warn.style.marginTop = '4px';
                }
              } else if (warningEl) {
                warningEl.remove();
              }
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

      new Setting(containerEl)
        .setName('Default category')
        .setDesc('Category assigned to skills that don\'t specify one in their frontmatter')
        .addText((text) =>
          text
            .setPlaceholder('uncategorized')
            .setValue(this.plugin.state.settings.defaultCategory || 'uncategorized')
            .onChange(async (value) => {
              await this.plugin.state.updateSettings({ defaultCategory: value.trim() || 'uncategorized' });
              this.allSkills = new Map(); // invalidate cache so rescan picks up new default
            })
        );

      new Setting(containerEl)
        .setName('Auto-generate SKILLS.md')
        .setDesc('Regenerate SKILLS.md at vault root whenever skills are toggled, installed, or deleted')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.state.settings.generateSkillsIndex)
            .onChange(async (value) => {
              await this.plugin.state.updateSettings({ generateSkillsIndex: value });
              if (value) {
                await this.plugin.regenerateIndex();
              }
            })
        );

      // --- Custom categories ---
      const customCats = this.plugin.state.settings.customCategories || [];
      new Setting(containerEl)
        .setName('Custom categories')
        .setDesc('Comma-separated list of additional categories for the dropdown')
        .addText((text) => {
          text
            .setPlaceholder('e.g. analytics, design, devops')
            .setValue(customCats.join(', '))
            .onChange(async (value) => {
              const cats = value.split(',').map((c) => c.trim()).filter(Boolean);
              await this.plugin.state.updateSettings({ customCategories: cats });
            });
          text.inputEl.style.width = '300px';
        });

      // --- Marketplace registries ---
      const registries = this.plugin.state.settings.registries || [];

      containerEl.createEl('h4', {
        text: 'Marketplace registries',
        cls: 'skills-manager-heading',
      });

      for (let i = 0; i < registries.length; i++) {
        const reg = registries[i];
        const regContainer = containerEl.createDiv('skills-manager-registry-config');

        const typeSetting = new Setting(regContainer)
          .setName(reg.name || REGISTRY_TYPE_LABELS[reg.type] || reg.type)
          .setDesc(reg.url);

        typeSetting.addDropdown((dd) => {
          for (const [type, label] of Object.entries(REGISTRY_TYPE_LABELS)) {
            dd.addOption(type, label);
          }
          dd.setValue(reg.type);
          dd.onChange(async (value) => {
            const updated = [...registries];
            const newType = value as RegistryType;
            updated[i] = {
              ...updated[i],
              type: newType,
              url: REGISTRY_TYPE_DEFAULTS[newType] || updated[i].url,
              name: REGISTRY_TYPE_LABELS[newType] || updated[i].name,
            };
            await this.plugin.state.updateSettings({ registries: updated });
            this.display();
          });
        });

        typeSetting.addExtraButton((btn) => {
          btn.setIcon('trash')
            .setTooltip('Remove registry')
            .onClick(async () => {
              const updated = registries.filter((_, idx) => idx !== i);
              await this.plugin.state.updateSettings({ registries: updated });
              if (this.activeRegistryIndex >= updated.length) {
                this.activeRegistryIndex = Math.max(0, updated.length - 1);
              }
              this.resetMarketplaceState();
              this.display();
            });
        });

        new Setting(regContainer)
          .setName('URL')
          .addText((text) => {
            text
              .setPlaceholder(REGISTRY_TYPE_DEFAULTS[reg.type] || 'https://...')
              .setValue(reg.url)
              .onChange(async (value) => {
                const updated = [...registries];
                updated[i] = { ...updated[i], url: value };
                await this.plugin.state.updateSettings({ registries: updated });
              });
            text.inputEl.style.width = '350px';
          });

        const provider = createProvider(reg);
        if (provider.needsApiKey()) {
          new Setting(regContainer)
            .setName('API Key')
            .setDesc(reg.type === 'skillsmp' ? 'Get one at skillsmp.com/settings/api' : 'API key for authentication')
            .addText((text) => {
              text
                .setPlaceholder('sk_live_...')
                .setValue(reg.apiKey || '')
                .onChange(async (value) => {
                  const updated = [...registries];
                  updated[i] = { ...updated[i], apiKey: value };
                  await this.plugin.state.updateSettings({ registries: updated });
                });
              text.inputEl.type = 'password';
              text.inputEl.style.width = '300px';
            });
        }
      }

      new Setting(containerEl)
        .addButton((btn) =>
          btn.setButtonText('+ Add registry').onClick(async () => {
            const updated = [...registries, {
              type: 'skills-sh' as RegistryType,
              name: 'Skills.sh',
              url: REGISTRY_TYPE_DEFAULTS['skills-sh'],
            }];
            await this.plugin.state.updateSettings({ registries: updated });
            this.display();
          })
        );

      // --- Cross-tool export (nested collapsible) ---
      const isExportEnabled = this.plugin.state.settings.crossToolExportEnabled;
      const exportHeading = containerEl.createEl('h4', {
        cls: 'skills-manager-heading skills-manager-collapsible-heading',
      });
      const chevron = exportHeading.createSpan('skills-manager-chevron');
      chevron.setText(isExportEnabled ? '▾' : '▸');
      exportHeading.appendText(' Cross-tool export');

      exportHeading.addEventListener('click', async () => {
        await this.plugin.state.updateSettings({
          crossToolExportEnabled: !isExportEnabled,
        });
        this.display();
      });

      if (isExportEnabled) {
        const exportTargets = ['cursor', 'copilot', 'windsurf', 'cline'];
        for (const target of exportTargets) {
          const label = EXPORT_TARGET_LABELS[target] || target;
          new Setting(containerEl)
            .setName(label)
            .setDesc(`Export enabled skills to ${label} config`)
            .addToggle((toggle) => {
              const current = this.plugin.state.settings.crossToolExport || [];
              toggle.setValue(current.includes(target)).onChange(async (value) => {
                const fresh = this.plugin.state.settings.crossToolExport || [];
                const updated = value
                  ? [...fresh.filter((t) => t !== target), target]
                  : fresh.filter((t) => t !== target);
                await this.plugin.state.updateSettings({ crossToolExport: updated });
              });
            });
        }

        new Setting(containerEl)
          .setName('Export now')
          .setDesc('Write enabled skills to selected tool configs')
          .addButton((btn) =>
            btn.setButtonText('Export').onClick(async () => {
              const targets = this.plugin.state.settings.crossToolExport || [];
              if (targets.length === 0) {
                new Notice('No export targets selected');
                return;
              }
              const result = await exportSkills(
                this.app.vault,
                this.plugin.state.settings.skillsDir,
                targets
              );
              if (result.exported.length > 0) {
                new Notice(`Exported to: ${result.exported.join(', ')}`);
              }
              if (result.errors.length > 0) {
                new Notice(`Errors: ${result.errors.join('; ')}`);
              }
            })
          );
      }
    }

    // --- Tab bar: Installed | Marketplace ---
    const tabBar = containerEl.createDiv('skills-manager-tab-bar');
    const tabs: { id: SettingsTab; label: string }[] = [
      { id: 'installed', label: 'Installed' },
      { id: 'marketplace', label: 'Marketplace' },
    ];

    for (const tab of tabs) {
      const btn = tabBar.createEl('button', { text: tab.label });
      btn.addClass('skills-manager-tab');
      if (this.activeTab === tab.id) btn.addClass('is-active');
      btn.addEventListener('click', () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        tabBar.querySelectorAll('.skills-manager-tab').forEach(el => el.removeClass('is-active'));
        btn.addClass('is-active');
        this.renderTabContent(tabContent);
      });
    }

    // Tab content container
    const tabContent = containerEl.createDiv('skills-manager-tab-content');
    await this.renderTabContent(tabContent);
  }

  private async renderTabContent(container: HTMLElement): Promise<void> {
    container.empty();
    if (this.activeTab === 'installed') {
      await this.renderInstalledTab(container);
    } else {
      await this.renderMarketplaceTab(container);
    }
  }

  // ─── Installed Tab ──────────────────────────────────────────

  private async renderInstalledTab(container: HTMLElement): Promise<void> {
    this.skillContainers.clear();

    // Header row: heading + add button
    const skillsHeader = container.createDiv('skills-manager-header-row');
    const skillsHeading = skillsHeader.createEl('h3', { text: 'Skills' });
    skillsHeading.addClass('skills-manager-heading');

    const addBtn = skillsHeader.createEl('button', { text: '+ Add Skill' });
    addBtn.addClass('skills-manager-add-btn');
    addBtn.addEventListener('click', () => {
      new AddSkillModal(this.app, this.plugin, () => {
        this.plugin.regenerateIndex();
        this.display();
      }).open();
    });

    // Search/filter
    const searchContainer = container.createDiv('skills-manager-search');
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Filter skills...',
    });
    searchInput.addClass('skills-manager-search-input');
    searchInput.value = this.searchQuery;
    const debouncedFilter = debounce(() => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.autoExpandForSearch();
      this.filterSkills(container);
    }, 200);
    searchInput.addEventListener('input', debouncedFilter);

    // Scan skills (use cache if available, full display() clears it)
    if (this.allSkills.size === 0) {
      this.allSkills = await scanSkills(
        this.app.vault,
        this.plugin.state.settings.skillsDir,
        this.plugin.state.settings.defaultCategory || 'uncategorized'
      );
    }
    const skills = this.allSkills;

    if (skills.size === 0) {
      container.createEl('p', {
        text: `No skills found in "${this.plugin.state.settings.skillsDir}". Check that the directory exists and contains skill folders with SKILL.md files.`,
        cls: 'skills-manager-empty',
      });
      return;
    }

    // Initialize collapsed state on first load (all collapsed)
    if (!this.categoriesInitialized) {
      const grouped = this.groupByCategory(skills);
      for (const category of grouped.keys()) {
        this.collapsedCategories.add(category);
      }
      this.categoriesInitialized = true;
    }

    // Stats
    const enabled = Array.from(skills.values()).filter(
      (s) => !s.disableModelInvocation
    ).length;
    container.createEl('p', {
      text: `${skills.size} skills found — ${enabled} enabled, ${skills.size - enabled} disabled`,
      cls: 'skills-manager-stats',
    });

    // Bulk operations
    const bulkRow = container.createDiv('skills-manager-bulk-row');

    const enableAllBtn = bulkRow.createEl('button', {
      text: 'Enable All',
      cls: 'skills-manager-bulk-btn',
    });
    enableAllBtn.addEventListener('click', async () => {
      for (const [folderName, meta] of this.getVisibleSkills()) {
        if (meta.disableModelInvocation) {
          await toggleSkill(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            false
          );
        }
      }
      new Notice('All visible skills enabled');
      this.plugin.regenerateIndex();
      this.display();
    });

    const disableAllBtn = bulkRow.createEl('button', {
      text: 'Disable All',
      cls: 'skills-manager-bulk-btn',
    });
    disableAllBtn.addEventListener('click', async () => {
      for (const [folderName, meta] of this.getVisibleSkills()) {
        if (!meta.disableModelInvocation) {
          await toggleSkill(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            true
          );
        }
      }
      new Notice('All visible skills disabled');
      this.plugin.regenerateIndex();
      this.display();
    });

    const updateAllBtn = bulkRow.createEl('button', {
      text: 'Update All',
      cls: 'skills-manager-bulk-btn',
    });
    updateAllBtn.addEventListener('click', async () => {
      const updatable = this.plugin.state.getUpdatableGitHubSkills();
      if (updatable.length === 0) {
        new Notice('No updatable GitHub skills');
        return;
      }
      let updated = 0;
      let failed = 0;
      for (const [name] of updatable) {
        const result = await updateGitHubSkill(
          this.app.vault,
          this.plugin.state,
          this.plugin.state.settings.skillsDir,
          name
        );
        if (result.success) updated++;
        else failed++;
      }
      new Notice(`Updated ${updated} skill(s)${failed > 0 ? `, ${failed} failed` : ''}`);
      this.display();
    });

    // Group by category — collapsible
    const grouped = this.groupByCategory(skills);

    // Render categories alphabetically by display name
    const categoryKeys = Array.from(grouped.keys()).sort((a, b) => {
      const nameA = a.toLowerCase();
      const nameB = b.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    for (const category of categoryKeys) {
      const entries = grouped.get(category);
      if (!entries || entries.length === 0) continue;

      const displayName = category;
      const isCollapsed = this.collapsedCategories.has(category);

      const categoryContainer = container.createDiv('skills-manager-category');

      // Clickable collapsible header
      const headerEl = categoryContainer.createEl('h4', {
        cls: 'skills-manager-category-header skills-manager-collapsible-heading',
      });

      const catChevron = headerEl.createSpan('skills-manager-chevron');
      catChevron.setText(isCollapsed ? '▸' : '▾');
      headerEl.appendText(` ${displayName} (${entries.length})`);

      headerEl.addEventListener('click', () => {
        if (this.collapsedCategories.has(category)) {
          this.collapsedCategories.delete(category);
        } else {
          this.collapsedCategories.add(category);
        }
        this.renderTabContent(container);
      });

      // Skill rows (only if expanded)
      if (!isCollapsed) {
        for (const [folderName, meta] of entries) {
          this.renderSkillRow(categoryContainer, folderName, meta);
        }
      }
    }
  }

  private autoExpandForSearch(): void {
    if (!this.searchQuery) return;
    for (const [, meta] of this.allSkills) {
      const text = `${meta.name} ${meta.description} ${meta.category}`.toLowerCase();
      if (text.includes(this.searchQuery)) {
        this.collapsedCategories.delete(meta.category || this.plugin.state.settings.defaultCategory || 'uncategorized');
      }
    }
  }

  // ─── Marketplace Tab ────────────────────────────────────────

  private getActiveProvider(): RegistryProvider | null {
    const registries = this.plugin.state.settings.registries || [];
    if (registries.length === 0) return null;
    const idx = Math.min(this.activeRegistryIndex, registries.length - 1);
    try {
      return createProvider(registries[idx]);
    } catch {
      return null;
    }
  }

  private resetMarketplaceState(): void {
    this.registrySkills = [];
    this.registryBoard = '';
    this.registryPage = 0;
    this.registryHasMore = false;
    this.registryLoading = false;
    this.registryError = '';
    this.registrySearch = '';
    this.activeProvider = null;
  }

  private async renderMarketplaceTab(container: HTMLElement): Promise<void> {
    const registries = this.plugin.state.settings.registries || [];

    if (registries.length === 0) {
      container.createEl('p', {
        text: 'No registries configured. Add one in the Marketplace registries section above.',
        cls: 'skills-manager-empty',
      });
      return;
    }

    // Ensure valid index
    if (this.activeRegistryIndex >= registries.length) {
      this.activeRegistryIndex = 0;
      this.resetMarketplaceState();
    }

    // Initialize provider
    const provider = this.getActiveProvider();
    if (!provider) {
      container.createEl('p', {
        text: 'Could not initialize registry provider.',
        cls: 'skills-manager-registry-error',
      });
      return;
    }
    this.activeProvider = provider;

    // Initialize board if needed
    const boards = provider.getBoards();
    if (!this.registryBoard || !boards.find(b => b.id === this.registryBoard)) {
      this.registryBoard = boards[0]?.id || '';
    }

    // Registry selector (if multiple registries)
    if (registries.length > 1) {
      const registryRow = container.createDiv('skills-manager-view-toolbar');
      const registrySelect = registryRow.createEl('select');
      registrySelect.addClass('skills-manager-view-filter');
      registrySelect.style.width = '100%';
      for (let i = 0; i < registries.length; i++) {
        const reg = registries[i];
        const label = reg.name || REGISTRY_TYPE_LABELS[reg.type] || reg.url;
        const option = registrySelect.createEl('option', { text: label });
        option.value = String(i);
        if (i === this.activeRegistryIndex) option.selected = true;
      }
      registrySelect.addEventListener('change', () => {
        this.activeRegistryIndex = parseInt(registrySelect.value, 10);
        this.resetMarketplaceState();
        this.renderTabContent(container);
      });
    }

    // Board tabs (from provider)
    if (boards.length > 1) {
      const boardBar = container.createDiv('skills-manager-tab-bar');
      for (const board of boards) {
        const btn = boardBar.createEl('button', { text: board.label });
        btn.addClass('skills-manager-tab');
        if (this.registryBoard === board.id) btn.addClass('is-active');
        btn.addEventListener('click', () => {
          if (this.registryBoard === board.id) return;
          this.registryBoard = board.id;
          this.registrySearch = '';
          this.loadRegistrySkills(true, container);
        });
      }
    }

    // Search
    const searchContainer = container.createDiv('skills-manager-search');
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Filter marketplace skills...',
    });
    searchInput.addClass('skills-manager-search-input');
    searchInput.value = this.registrySearch;
    searchInput.addEventListener('input', () => {
      this.registrySearch = searchInput.value.toLowerCase();
      this.filterRegistryList(listContainer);
    });

    // Install activity log
    if (this.installLog.length > 0) {
      const logContainer = container.createDiv('skills-manager-install-log');
      for (const entry of this.installLog) {
        const logItem = logContainer.createDiv('skills-manager-install-log-item');
        logItem.addClass(entry.success ? 'is-success' : 'is-error');
        logItem.setText(entry.text);
      }
    }

    // API key warning
    if (provider.needsApiKey()) {
      const reg = registries[this.activeRegistryIndex];
      if (!reg.apiKey) {
        container.createEl('p', {
          text: `${reg.name || reg.type} requires an API key. Configure it in the Marketplace registries section above.`,
          cls: 'skills-manager-registry-error',
        });
      }
    }

    // List container
    const listContainer = container.createDiv('skills-manager-registry-list');

    if (this.registryError) {
      listContainer.createEl('p', {
        text: this.registryError,
        cls: 'skills-manager-registry-error',
      });
    }

    if (this.registryLoading && this.registrySkills.length === 0) {
      listContainer.createEl('p', {
        text: 'Loading...',
        cls: 'skills-manager-registry-loading',
      });
    }

    for (const skill of this.registrySkills) {
      this.renderRegistryItem(listContainer, skill);
    }

    // Skill count
    if (!this.registryLoading && this.registrySkills.length > 0) {
      container.createEl('p', {
        text: `Showing ${this.registrySkills.length} skills`,
        cls: 'skills-manager-stats',
      });
    }

    // Load more
    if (this.registryHasMore && !this.registryLoading) {
      const loadMoreBtn = container.createEl('button', {
        text: 'Load more',
        cls: 'skills-manager-load-more',
      });
      loadMoreBtn.addEventListener('click', () => {
        this.registryPage++;
        this.loadRegistrySkills(false, container);
      });
    }

    if (this.registryLoading && this.registrySkills.length > 0) {
      container.createEl('p', {
        text: 'Loading more...',
        cls: 'skills-manager-registry-loading',
      });
    }

    // Auto-load on first visit
    if (this.registrySkills.length === 0 && !this.registryLoading && !this.registryError) {
      this.loadRegistrySkills(true, container);
    }
  }

  private renderRegistryItem(container: HTMLElement, skill: RegistrySkill): void {
    const row = container.createDiv('skills-manager-registry-item');
    row.dataset.searchText = `${skill.name} ${skill.source} ${skill.description || ''}`.toLowerCase();

    const info = row.createDiv('skills-manager-registry-info');

    // Clickable name → opens GitHub page
    const githubUrl = this.getSkillGitHubUrl(skill);
    const nameEl = info.createEl('a', {
      text: skill.name,
      cls: 'skills-manager-registry-name skills-manager-clickable-name',
      href: githubUrl,
    });
    nameEl.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(githubUrl, '_blank');
    });

    info.createEl('span', { text: skill.source, cls: 'skills-manager-registry-source' });

    // Show stats line based on available data
    const statsparts: string[] = [];
    if (skill.installs > 0) statsparts.push(`${skill.installs} installs`);
    if (skill.stars && skill.stars > 0) statsparts.push(`${skill.stars} stars`);
    if (statsparts.length > 0) {
      info.createEl('span', {
        text: statsparts.join(' · '),
        cls: 'skills-manager-registry-installs',
      });
    }

    if (skill.description) {
      info.createEl('span', {
        text: skill.description,
        cls: 'skills-manager-registry-source',
      });
    }

    // Check if already installed
    const isInstalled = this.isRegistrySkillInstalled(skill);

    if (isInstalled) {
      const badge = row.createEl('span', {
        text: 'Installed',
        cls: 'skills-manager-badge skills-manager-badge-source',
      });
      badge.style.marginLeft = '12px';
    } else {
      const installBtn = row.createEl('button', {
        text: 'Install',
        cls: 'skills-manager-registry-install-btn',
      });
      installBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.installRegistrySkill(skill, installBtn);
      });
    }
  }

  private getSkillGitHubUrl(skill: RegistrySkill): string {
    const repo = skill.source;
    // If skillId differs from repo name, it's likely a monorepo subfolder
    if (skill.skillId && skill.skillId !== repo.split('/').pop()) {
      return `https://github.com/${repo}/tree/main/${skill.skillId}`;
    }
    return `https://github.com/${repo}`;
  }

  private async installRegistrySkill(skill: RegistrySkill, installBtn: HTMLButtonElement): Promise<void> {
    installBtn.setText('Installing...');
    installBtn.disabled = true;

    const pat = this.plugin.state.settings.githubPat || undefined;
    const repo = skill.source;
    const skillId = skill.skillId;

    // Determine if this is a monorepo skill:
    // If skillId exists and doesn't match the repo name, it's a subfolder
    const repoName = repo.split('/').pop() || '';
    const isMonorepo = skillId && skillId !== repoName;

    console.log(`[Skills Manager] Installing: repo=${repo}, skillId=${skillId}, isMonorepo=${isMonorepo}`);

    let result;
    try {
      if (isMonorepo) {
        // Install from a subdirectory of the repo
        console.log(`[Skills Manager] Using monorepo install: ${repo} subpath=${skillId}`);
        result = await installFromMonorepo(
          this.app.vault,
          this.plugin.state,
          this.plugin.state.settings.skillsDir,
          repo,
          skillId,
          pat
        );
      } else {
        console.log(`[Skills Manager] Using standard GitHub install: ${repo}`);
        result = await installFromGitHub(
          this.app.vault,
          this.plugin.state,
          this.plugin.state.settings.skillsDir,
          repo,
          undefined,
          pat
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Skills Manager] Install exception:`, e);
      new Notice(`Install error: ${msg}`);
      installBtn.setText('Install');
      installBtn.disabled = false;
      return;
    }

    console.log(`[Skills Manager] Install result:`, result);

    if (result.success) {
      // Read the installed skill's category
      let installedCategory = '';
      try {
        const skillsDir = this.plugin.state.settings.skillsDir;
        const skillFile = `${skillsDir}/${result.skillName}/SKILL.md`;
        if (await this.app.vault.adapter.exists(skillFile)) {
          const content = await this.app.vault.adapter.read(skillFile);
          const catMatch = content.match(/^category:\s*["']?(.+?)["']?\s*$/m);
          if (catMatch) {
            installedCategory = catMatch[1].trim();
          }
        }
      } catch {
        // Best-effort
      }

      this.installLog.push({
        text: `Installed "${result.skillName}"${installedCategory ? ` → ${installedCategory}` : ''}`,
        success: true,
      });
      installBtn.setText('Installed');
      // Invalidate scan cache so Installed tab picks up the new skill
      this.allSkills = new Map();
      this.refreshInstallLog();
    } else {
      const errorMsg = result.errors.join('; ');
      console.error(`[Skills Manager] Install failed: ${errorMsg}`);
      this.installLog.push({
        text: `Failed: ${skill.name} — ${errorMsg}`,
        success: false,
      });
      installBtn.setText('Install');
      installBtn.disabled = false;
      this.refreshInstallLog();
    }
  }

  private refreshInstallLog(): void {
    const existing = this.containerEl.querySelector('.skills-manager-install-log');
    if (existing) existing.remove();

    if (this.installLog.length === 0) return;

    // Find the marketplace tab content to insert the log
    const tabContent = this.containerEl.querySelector('.skills-manager-tab-content');
    if (!tabContent) return;

    const logContainer = document.createElement('div');
    logContainer.addClass('skills-manager-install-log');

    for (const entry of this.installLog) {
      const logItem = document.createElement('div');
      logItem.addClass('skills-manager-install-log-item');
      logItem.addClass(entry.success ? 'is-success' : 'is-error');
      logItem.setText(entry.text);
      logContainer.appendChild(logItem);
    }

    // Insert at the top of the tab content
    tabContent.insertBefore(logContainer, tabContent.firstChild);
  }

  private isRegistrySkillInstalled(skill: RegistrySkill): boolean {
    for (const [, state] of Object.entries(this.plugin.state.data.skills)) {
      if (state.repo && skill.source.toLowerCase() === state.repo.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  private async loadRegistrySkills(reset: boolean, container: HTMLElement): Promise<void> {
    if (!this.activeProvider) return;

    if (reset) {
      this.registrySkills = [];
      this.registryPage = 0;
      this.registryHasMore = false;
    }

    this.registryLoading = true;
    this.registryError = '';

    try {
      const result = await this.activeProvider.fetchSkills({
        board: this.registryBoard,
        page: this.registryPage,
        search: this.registrySearch || undefined,
      });

      if (reset) {
        this.registrySkills = result.skills;
      } else {
        this.registrySkills = [...this.registrySkills, ...result.skills];
      }
      this.registryHasMore = result.hasMore;
      this.registryPage = result.page;
    } catch (e) {
      this.registryError = e instanceof Error ? e.message : String(e);
    }

    this.registryLoading = false;
    this.renderTabContent(container);
  }

  private filterRegistryList(container: HTMLElement): void {
    const items = container.querySelectorAll('.skills-manager-registry-item');
    items.forEach((item) => {
      const el = item as HTMLElement;
      const text = el.dataset.searchText || '';
      el.style.display =
        !this.registrySearch || text.includes(this.registrySearch) ? '' : 'none';
    });
  }

  // ─── Shared helpers ─────────────────────────────────────────

  /**
   * Get merged category list: predefined + custom from settings + discovered from loaded skills.
   * Deduplicated and sorted alphabetically by display name.
   */
  private getAllCategories(): string[] {
    const categories = new Set<string>();

    // Add custom categories from settings
    const custom = this.plugin.state.settings.customCategories || [];
    for (const c of custom) {
      if (c.trim()) categories.add(c.trim());
    }

    // Add categories discovered from loaded skills
    for (const [, meta] of this.allSkills) {
      if (meta.category) categories.add(meta.category);
    }

    return Array.from(categories).sort((a, b) => {
      const nameA = a.toLowerCase();
      const nameB = b.toLowerCase();
      return nameA.localeCompare(nameB);
    });
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
            return;
          }
          const targets = this.plugin.state.settings.crossToolExport || [];
          if (this.plugin.state.settings.crossToolExportEnabled && targets.length > 0) {
            try {
              await exportSkills(this.app.vault, this.plugin.state.settings.skillsDir, targets);
            } catch {
              // Silent — auto-export is best-effort
            }
          }
          this.plugin.regenerateIndex();
        })
      );

    // Make skill name clickable for detail view (toggle expand/collapse)
    const nameEl = setting.nameEl;
    nameEl.addClass('skills-manager-clickable-name');
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const wasExpanded = this.expandedSkill === folderName;
      this.expandedSkill = wasExpanded ? null : folderName;

      // Remove any existing panel in this row
      const existing = row.querySelector('.skills-manager-detail-panel');
      if (existing) {
        existing.remove();
      }

      // If expanding, render the detail panel
      if (!wasExpanded) {
        this.renderDetailPanel(row, folderName);
      }
    });

    // Source badge + version badge
    const descEl = setting.descEl;
    if (descEl) {
      const badge = descEl.createSpan('skills-manager-badge');
      badge.setText(meta.category);

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

      this.renderThreatBadge(descEl, folderName);
    }

    // Edit button — opens SKILL.md in the editor
    setting.addExtraButton((btn) => {
      btn.setIcon('pencil')
        .setTooltip('Edit SKILL.md')
        .onClick(async () => {
          const skillFile = `${this.plugin.state.settings.skillsDir}/${folderName}/SKILL.md`;
          const file = this.app.vault.getAbstractFileByPath(skillFile);
          if (file) {
            await this.app.workspace.openLinkText(skillFile, '', false);
          }
        });
    });

    // GitHub skill actions
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
    if (this.deleteConfirm === folderName) {
      // Confirm state: show label + red button
      const controlEl = setting.controlEl;
      const label = controlEl.createSpan('skills-manager-delete-confirm-label');
      label.setText('Delete?');

      setting.addExtraButton((btn) => {
        btn.setIcon('trash-2')
          .setTooltip('Click to confirm delete');
        btn.extraSettingsEl.addClass('skills-manager-delete-confirm');

        btn.onClick(async () => {
          const success = await deleteSkill(
            this.app.vault,
            this.plugin.state,
            this.plugin.state.settings.skillsDir,
            folderName
          );
          if (!success) {
            console.error(`[Skills Manager] Failed to delete "${folderName}"`);
          }
          this.deleteConfirm = null;
          this.allSkills = new Map();
          this.plugin.regenerateIndex();
          this.display();
        });
      });
    } else {
      setting.addExtraButton((btn) => {
        btn.setIcon('trash')
          .setTooltip('Delete skill');

        btn.onClick(() => {
          this.deleteConfirm = folderName;
          this.collapsedCategories.delete(meta.category);
          this.display();
          setTimeout(() => {
            if (this.deleteConfirm === folderName) {
              this.deleteConfirm = null;
              this.display();
            }
          }, 5000);
        });
      });
    }

    if (this.expandedSkill === folderName) {
      this.renderDetailPanel(row, folderName);
    }
  }

  private async renderThreatBadge(descEl: HTMLElement, folderName: string): Promise<void> {
    const skillPath = `${this.plugin.state.settings.skillsDir}/${folderName}`;

    let scanResult = this.threatCache.get(folderName);
    if (!scanResult) {
      scanResult = await scanForThreats(this.app.vault, skillPath);
      this.threatCache.set(folderName, scanResult);
    }

    if (scanResult.riskLevel === 'danger') {
      const badge = descEl.createSpan('skills-manager-badge skills-manager-badge-danger');
      badge.setText('⚠ danger');
      badge.title = scanResult.threats.map((t) => t.description).join('\n');
    } else if (scanResult.riskLevel === 'warning') {
      const badge = descEl.createSpan('skills-manager-badge skills-manager-badge-warning');
      badge.setText('⚠ warning');
      badge.title = scanResult.threats.map((t) => t.description).join('\n');
    }
  }

  private async renderDetailPanel(row: HTMLElement, folderName: string): Promise<void> {
    const existing = row.querySelector('.skills-manager-detail-panel');
    if (existing) {
      existing.remove();
    }

    if (this.expandedSkill !== folderName) return;

    const panel = row.createDiv('skills-manager-detail-panel');
    const adapter = this.app.vault.adapter;
    const skillPath = `${this.plugin.state.settings.skillsDir}/${folderName}`;

    const skillState = this.plugin.state.getSkillState(folderName);
    if (skillState) {
      const metaDiv = panel.createDiv('skills-manager-detail-meta');
      const items: string[] = [];
      if (skillState.source) items.push(`Source: ${skillState.source}`);
      if (skillState.repo) items.push(`Repo: ${skillState.repo}`);
      if (skillState.version) items.push(`Version: ${skillState.version}`);
      if (skillState.installedAt) items.push(`Installed: ${skillState.installedAt.split('T')[0]}`);
      if (skillState.lastUpdated) items.push(`Updated: ${skillState.lastUpdated.split('T')[0]}`);
      metaDiv.createEl('p', { text: items.join(' · '), cls: 'skills-manager-detail-meta-text' });
    }

    // Category dropdown
    const currentMeta = this.allSkills.get(folderName);
    const categories = this.getAllCategories();
    new Setting(panel)
      .setName('Category')
      .addDropdown((dd) => {
        for (const cat of categories) {
          dd.addOption(cat, cat);
        }
        dd.setValue(currentMeta?.category || this.plugin.state.settings.defaultCategory || 'uncategorized');
        dd.onChange(async (value) => {
          const success = await setSkillCategory(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            value
          );
          if (success) {
            // Persist new category to custom list if not already known
            const custom = this.plugin.state.settings.customCategories || [];
            if (!custom.includes(value)) {
              await this.plugin.state.updateSettings({
                customCategories: [...custom, value],
              });
            }
            this.allSkills = new Map(); // invalidate cache
            this.plugin.regenerateIndex();
            this.display();
          }
        });
      });

    // Auto-loading toggle (disable-model-invocation)
    new Setting(panel)
      .setName('Auto-loading')
      .setDesc('Allow the model to load this skill automatically')
      .addToggle((toggle) =>
        toggle.setValue(!currentMeta?.disableModelInvocation).onChange(async (value) => {
          const success = await toggleSkill(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            !value
          );
          if (success) {
            this.allSkills = new Map();
            this.plugin.regenerateIndex();
            this.display();
          }
        })
      );

    // User-invocable toggle (command)
    new Setting(panel)
      .setName('User-invocable command')
      .setDesc('Allow the user to invoke this skill as a slash command')
      .addToggle((toggle) =>
        toggle.setValue(currentMeta?.userInvocable ?? true).onChange(async (value) => {
          const success = await setSkillField(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            'user-invocable',
            value ? 'true' : 'false'
          );
          if (success) {
            this.allSkills = new Map();
            this.display();
          }
        })
      );

    try {
      const listing = await adapter.list(skillPath);
      if (listing.files.length > 0 || listing.folders.length > 0) {
        const fileDiv = panel.createDiv('skills-manager-detail-files');
        fileDiv.createEl('strong', { text: 'Files:' });
        const ul = fileDiv.createEl('ul');
        for (const file of listing.files) {
          ul.createEl('li', { text: file.split('/').pop() || file });
        }
        for (const folder of listing.folders) {
          ul.createEl('li', { text: `${folder.split('/').pop()}/` });
        }
      }
    } catch {
      // Skip
    }

    const skillFile = `${skillPath}/SKILL.md`;
    try {
      if (await adapter.exists(skillFile)) {
        const content = await adapter.read(skillFile);
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1].trim() : content.trim();
        if (body) {
          const contentDiv = panel.createDiv('skills-manager-detail-content');
          contentDiv.createEl('strong', { text: 'Instructions:' });
          const pre = contentDiv.createEl('pre');
          pre.createEl('code', { text: body });
        }
      }
    } catch {
      // Skip
    }

    const scanResult = this.threatCache.get(folderName);
    if (scanResult && scanResult.threats.length > 0) {
      const threatDiv = panel.createDiv('skills-manager-detail-threats');
      threatDiv.createEl('strong', { text: `Security (${scanResult.riskLevel}):` });
      const ul = threatDiv.createEl('ul');
      for (const threat of scanResult.threats) {
        const li = ul.createEl('li');
        li.createSpan({
          text: `[${threat.severity}] `,
          cls: threat.severity === 'danger' ? 'skills-manager-threat-danger' : 'skills-manager-threat-warning',
        });
        li.createSpan({ text: `${threat.file}: ${threat.description}` });
      }
    }
  }

  private getVisibleSkills(): [string, SkillMeta][] {
    const visible: [string, SkillMeta][] = [];
    for (const [folderName, meta] of this.allSkills) {
      const el = this.skillContainers.get(folderName);
      if (el && el.style.display !== 'none') {
        visible.push([folderName, meta]);
      }
    }
    if (visible.length === 0 && !this.searchQuery) {
      return Array.from(this.allSkills.entries());
    }
    return visible;
  }

  private groupByCategory(
    skills: Map<string, SkillMeta>
  ): Map<string, [string, SkillMeta][]> {
    const grouped = new Map<string, [string, SkillMeta][]>();

    for (const [folderName, meta] of skills) {
      const cat = meta.category || this.plugin.state.settings.defaultCategory || 'uncategorized';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push([folderName, meta]);
    }

    for (const entries of grouped.values()) {
      entries.sort((a, b) => a[1].name.localeCompare(b[1].name));
    }

    return grouped;
  }

  private filterSkills(tabContainer: HTMLElement): void {
    if (this.searchQuery) {
      this.renderTabContent(tabContainer);
      return;
    }

    for (const [, el] of this.skillContainers) {
      const searchText = el.dataset.searchText || '';
      if (!this.searchQuery || searchText.includes(this.searchQuery)) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }

    const categories = tabContainer.querySelectorAll('.skills-manager-category');
    categories.forEach((cat) => {
      const rows = cat.querySelectorAll('.skills-manager-skill-row');
      const visibleRows = Array.from(rows).filter(
        (r) => (r as HTMLElement).style.display !== 'none'
      );
      (cat as HTMLElement).style.display = visibleRows.length > 0 ? '' : 'none';
    });
  }
}
