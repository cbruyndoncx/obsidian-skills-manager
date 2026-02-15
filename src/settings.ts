import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SkillsManagerPlugin from './main';
import { SkillMeta, CATEGORY_ORDER, CATEGORY_DISPLAY, SecurityScanResult } from './types';
import { scanSkills } from './scanner';
import { toggleSkill } from './toggler';
import { deleteSkill, updateGitHubSkill } from './installer';
import { checkForUpdate } from './github';
import { AddSkillModal } from './ui/add-modal';
import { exportSkills, EXPORT_TARGET_LABELS } from './exporter';
import { scanForThreats } from './validator';

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as unknown as T;
}

export class SkillsManagerSettingTab extends PluginSettingTab {
  plugin: SkillsManagerPlugin;
  private skillContainers: Map<string, HTMLElement> = new Map();
  private searchQuery = '';
  private deleteConfirm: string | null = null;
  private expandedSkill: string | null = null;
  private threatCache: Map<string, SecurityScanResult> = new Map();
  private allSkills: Map<string, SkillMeta> = new Map();

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

    // --- Plugin settings section ---
    const skillsDirSetting = new Setting(containerEl)
      .setName('Skills directory')
      .setDesc('Path relative to vault root where skills are stored')
      .addText((text) =>
        text
          .setPlaceholder('.claude/skills')
          .setValue(this.plugin.state.settings.skillsDir)
          .onChange(async (value) => {
            await this.plugin.state.updateSettings({ skillsDir: value });
            // Validate directory exists
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

    // --- Cross-tool export section ---
    containerEl.createEl('h3', {
      text: 'Cross-tool export',
      cls: 'skills-manager-heading',
    });

    const exportTargets = ['cursor', 'copilot', 'windsurf', 'cline'];
    for (const target of exportTargets) {
      const label = EXPORT_TARGET_LABELS[target] || target;
      new Setting(containerEl)
        .setName(label)
        .setDesc(`Export enabled skills to ${label} config`)
        .addToggle((toggle) => {
          const current = this.plugin.state.settings.crossToolExport || [];
          toggle.setValue(current.includes(target)).onChange(async (value) => {
            // Read fresh state to avoid stale closure overwriting other toggles
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
    const debouncedFilter = debounce(() => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.filterSkills();
    }, 200);
    searchInput.addEventListener('input', debouncedFilter);

    // Scan and render
    const skills = await scanSkills(
      this.app.vault,
      this.plugin.state.settings.skillsDir
    );
    this.allSkills = skills;

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

    // Bulk operations
    const bulkRow = containerEl.createDiv('skills-manager-bulk-row');

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
            return;
          }
          // Auto-export if cross-tool targets are configured
          const targets = this.plugin.state.settings.crossToolExport || [];
          if (targets.length > 0) {
            try {
              await exportSkills(this.app.vault, this.plugin.state.settings.skillsDir, targets);
            } catch {
              // Silent — auto-export is best-effort
            }
          }
        })
      );

    // Make skill name clickable for detail view
    const nameEl = setting.nameEl;
    nameEl.addClass('skills-manager-clickable-name');
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.expandedSkill === folderName) {
        this.expandedSkill = null;
      } else {
        this.expandedSkill = folderName;
      }
      this.renderDetailPanel(row, folderName);
    });

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

      // Threat badge (async, non-blocking)
      this.renderThreatBadge(descEl, folderName);
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

    // Render detail panel if expanded
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
    // Remove any existing detail panel in this row
    const existing = row.querySelector('.skills-manager-detail-panel');
    if (existing) {
      existing.remove();
    }

    // If collapsing, stop here
    if (this.expandedSkill !== folderName) return;

    const panel = row.createDiv('skills-manager-detail-panel');
    const adapter = this.app.vault.adapter;
    const skillPath = `${this.plugin.state.settings.skillsDir}/${folderName}`;

    // Metadata
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

    // File listing
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
      // Skip if listing fails
    }

    // SKILL.md body content
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
      // Skip if read fails
    }

    // Security scan results
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
    // If no filter is active, return all skills
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
