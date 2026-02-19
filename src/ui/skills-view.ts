import { ItemView, WorkspaceLeaf, Notice, Setting } from 'obsidian';
import type SkillsManagerPlugin from '../main';
import { SkillMeta, SecurityScanResult } from '../types';
import { scanSkills } from '../scanner';
import { toggleSkill, setSkillField } from '../toggler';
import { checkForUpdate } from '../github';
import { updateGitHubSkill } from '../installer';
import { scanForThreats } from '../validator';

export const VIEW_TYPE_SKILLS = 'skills-manager-view';

export class SkillsView extends ItemView {
  private plugin: SkillsManagerPlugin;
  private allSkills: Map<string, SkillMeta> = new Map();
  private selectedSkill: string | null = null;
  private searchQuery = '';
  private sourceFilter: 'all' | 'local' | 'github' | 'zip' = 'all';
  private threatCache: Map<string, SecurityScanResult> = new Map();
  private listPane!: HTMLElement;
  private detailPane!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: SkillsManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SKILLS;
  }

  getDisplayText(): string {
    return 'Skills Manager';
  }

  getIcon(): string {
    return 'wand-2';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('skills-manager-view-wrapper');

    this.listPane = container.createDiv('skills-manager-view-list-pane');
    this.detailPane = container.createDiv('skills-manager-view-detail-pane');

    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.threatCache.clear();
  }

  async refresh(): Promise<void> {
    this.allSkills = await scanSkills(
      this.app.vault,
      this.plugin.state.settings.skillsDir,
      this.plugin.state.settings.defaultCategory || 'uncategorized'
    );
    this.threatCache.clear();
    this.renderList();
    this.renderDetail();
  }

  private renderList(): void {
    this.listPane.empty();

    // Toolbar: search + filter
    const toolbar = this.listPane.createDiv('skills-manager-view-toolbar');

    const searchInput = toolbar.createEl('input', {
      type: 'text',
      placeholder: 'Search skills...',
    });
    searchInput.addClass('skills-manager-search-input');
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.renderList();
    });

    const filterSelect = toolbar.createEl('select');
    filterSelect.addClass('skills-manager-view-filter');
    const filterOptions = [
      { value: 'all', label: 'All sources' },
      { value: 'local', label: 'Local' },
      { value: 'github', label: 'GitHub' },
      { value: 'zip', label: 'ZIP' },
    ];
    for (const opt of filterOptions) {
      const option = filterSelect.createEl('option', { text: opt.label });
      option.value = opt.value;
      if (opt.value === this.sourceFilter) option.selected = true;
    }
    filterSelect.addEventListener('change', () => {
      this.sourceFilter = filterSelect.value as typeof this.sourceFilter;
      this.renderList();
    });

    // Stats
    const filtered = this.getFilteredSkills();
    const enabled = filtered.filter(([, m]) => !m.disableModelInvocation).length;
    const statsEl = this.listPane.createDiv('skills-manager-view-stats');
    statsEl.setText(`${filtered.length} skills — ${enabled} enabled`);

    // Group by category
    const grouped = new Map<string, [string, SkillMeta][]>();
    for (const [name, meta] of filtered) {
      const cat = meta.category || 'uncategorized';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push([name, meta]);
    }

    const sortedCategories = Array.from(grouped.keys()).sort((a, b) => {
      const nameA = a.toLowerCase();
      const nameB = b.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    for (const category of sortedCategories) {
      const entries = grouped.get(category);
      if (!entries || entries.length === 0) continue;

      const displayName = category;
      const catEl = this.listPane.createDiv('skills-manager-view-category');
      const catLabel = catEl.createEl('div', {
        cls: 'skills-manager-view-category-label',
      });
      catLabel.createSpan({ text: `${displayName} (${entries.length})` });

      // Category toggle
      const enabledInCat = entries.filter(([, m]) => !m.disableModelInvocation).length;
      const allEnabled = enabledInCat === entries.length;
      const catToggle = catLabel.createEl('input', { type: 'checkbox' });
      catToggle.addClass('skills-manager-category-toggle');
      catToggle.checked = allEnabled;
      catToggle.indeterminate = enabledInCat > 0 && !allEnabled;
      catToggle.addEventListener('click', (e) => e.stopPropagation());
      catToggle.addEventListener('change', async () => {
        const disable = allEnabled;
        for (const [folderName] of entries) {
          await toggleSkill(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            disable
          );
        }
        await this.refresh();
      });

      for (const [folderName, meta] of entries.sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        const item = catEl.createDiv('skills-manager-view-skill-item');
        if (folderName === this.selectedSkill) item.addClass('is-selected');

        const nameEl = item.createDiv('skills-manager-view-skill-name');
        nameEl.setText(meta.name);

        const descEl = item.createDiv('skills-manager-view-skill-desc');
        descEl.setText(meta.description);

        if (meta.disableModelInvocation) {
          item.addClass('is-disabled');
        }

        item.addEventListener('click', () => {
          this.selectedSkill = folderName;
          // Update selection highlight
          this.listPane.querySelectorAll('.skills-manager-view-skill-item').forEach((el) => {
            el.removeClass('is-selected');
          });
          item.addClass('is-selected');
          this.renderDetail();
        });
      }
    }

    if (filtered.length === 0) {
      this.listPane.createEl('p', {
        text: 'No skills found',
        cls: 'skills-manager-empty',
      });
    }
  }

  private renderDetail(): void {
    this.detailPane.empty();

    if (!this.selectedSkill) {
      this.detailPane.createEl('p', {
        text: 'Select a skill to view details',
        cls: 'skills-manager-view-detail-placeholder',
      });
      return;
    }

    const meta = this.allSkills.get(this.selectedSkill);
    if (!meta) return;

    const folderName = this.selectedSkill;
    const skillState = this.plugin.state.getSkillState(folderName);

    // Header
    const header = this.detailPane.createDiv('skills-manager-view-detail-header');
    header.createEl('h3', { text: meta.name });

    const descP = header.createEl('p', { text: meta.description });
    descP.addClass('skills-manager-view-detail-desc');

    // Toggles
    const toggleRow = this.detailPane.createDiv('skills-manager-view-detail-toggle');
    new Setting(toggleRow)
      .setName('Auto-loading')
      .setDesc('Allow the model to load this skill automatically')
      .addToggle((toggle) =>
        toggle.setValue(!meta.disableModelInvocation).onChange(async (value) => {
          const success = await toggleSkill(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            !value
          );
          if (success) {
            await this.refresh();
            this.selectedSkill = folderName;
            this.renderDetail();
          }
        })
      );

    new Setting(toggleRow)
      .setName('User-invocable command')
      .setDesc('Allow the user to invoke this skill as a slash command')
      .addToggle((toggle) =>
        toggle.setValue(meta.userInvocable).onChange(async (value) => {
          const success = await setSkillField(
            this.app.vault,
            this.plugin.state.settings.skillsDir,
            folderName,
            'user-invocable',
            value ? 'true' : 'false'
          );
          if (success) {
            await this.refresh();
            this.selectedSkill = folderName;
            this.renderDetail();
          }
        })
      );

    // Metadata table
    const table = this.detailPane.createEl('table', { cls: 'skills-manager-meta-table' });
    const addRow = (label: string, value: string) => {
      const tr = table.createEl('tr');
      tr.createEl('td', { text: label, cls: 'skills-manager-meta-label' });
      tr.createEl('td', { text: value });
    };

    addRow('Category', meta.category);
    if (meta.version) addRow('Version', meta.version);
    if (meta.origin) addRow('Origin', meta.origin);
    if (meta.originRepo) addRow('Origin Repo', meta.originRepo);
    if (meta.originUrl) addRow('Origin URL', meta.originUrl);
    if (meta.license) addRow('License', meta.license);
    if (meta.compatibility) addRow('Compatibility', meta.compatibility);
    if (meta.allowedTools) addRow('Allowed Tools', meta.allowedTools);

    if (skillState) {
      addRow('Source', skillState.source);
      if (skillState.repo) addRow('Repo', skillState.repo);
      if (skillState.version) addRow('Installed Version', skillState.version);
      if (skillState.installedAt) addRow('Installed', skillState.installedAt.split('T')[0]);
      if (skillState.lastUpdated) addRow('Last Updated', skillState.lastUpdated.split('T')[0]);
      if (skillState.frozen) addRow('Frozen', 'Yes');
    }

    // Update check for GitHub skills
    if (skillState?.source === 'github' && skillState.repo && skillState.version && !skillState.frozen) {
      const updateDiv = this.detailPane.createDiv('skills-manager-view-detail-update');
      updateDiv.setText('Checking for updates...');
      this.checkUpdateAsync(folderName, skillState.repo, skillState.version, updateDiv);
    }

    // File tree
    this.renderFileTree(folderName);

    // SKILL.md body
    this.renderSkillBody(folderName);

    // Security scan
    this.renderSecurityScan(folderName);
  }

  private async checkUpdateAsync(
    folderName: string,
    repo: string,
    version: string,
    container: HTMLElement
  ): Promise<void> {
    const pat = this.plugin.state.settings.githubPat || undefined;
    const result = await checkForUpdate(repo, version, pat);
    container.empty();

    if (result?.hasUpdate) {
      container.addClass('skills-manager-update-available');
      container.createSpan({ text: `Update available: ${result.latestVersion}` });
      const btn = container.createEl('button', {
        text: 'Update',
        cls: 'skills-manager-detail-update-btn',
      });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.setText('Updating...');
        const updateResult = await updateGitHubSkill(
          this.app.vault,
          this.plugin.state,
          this.plugin.state.settings.skillsDir,
          folderName
        );
        if (updateResult.success) {
          new Notice(`Updated ${folderName}`);
          await this.refresh();
          this.selectedSkill = folderName;
          this.renderDetail();
        } else {
          new Notice(`Update failed: ${updateResult.errors.join('; ')}`);
          btn.disabled = false;
          btn.setText('Update');
        }
      });
    } else if (result) {
      container.setText('Up to date');
      container.addClass('skills-manager-view-detail-uptodate');
    } else {
      container.setText('Could not check for updates');
    }
  }

  private async renderFileTree(folderName: string): Promise<void> {
    const skillPath = `${this.plugin.state.settings.skillsDir}/${folderName}`;
    try {
      const listing = await this.app.vault.adapter.list(skillPath);
      if (listing.files.length === 0 && listing.folders.length === 0) return;

      const fileDiv = this.detailPane.createDiv('skills-manager-detail-files');
      fileDiv.createEl('strong', { text: 'Files' });
      const ul = fileDiv.createEl('ul');
      for (const file of listing.files) {
        ul.createEl('li', { text: file.split('/').pop() || file });
      }
      for (const folder of listing.folders) {
        ul.createEl('li', { text: `${folder.split('/').pop()}/` });
      }
    } catch {
      // Skip
    }
  }

  private async renderSkillBody(folderName: string): Promise<void> {
    const skillPath = `${this.plugin.state.settings.skillsDir}/${folderName}`;
    const skillFile = `${skillPath}/SKILL.md`;
    try {
      if (await this.app.vault.adapter.exists(skillFile)) {
        const content = await this.app.vault.adapter.read(skillFile);
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1].trim() : content.trim();
        if (body) {
          const contentDiv = this.detailPane.createDiv('skills-manager-detail-content');
          contentDiv.createEl('strong', { text: 'Instructions' });
          const pre = contentDiv.createEl('pre');
          pre.createEl('code', { text: body });
        }
      }
    } catch {
      // Skip
    }
  }

  private async renderSecurityScan(folderName: string): Promise<void> {
    const skillPath = `${this.plugin.state.settings.skillsDir}/${folderName}`;
    let scanResult = this.threatCache.get(folderName);
    if (!scanResult) {
      scanResult = await scanForThreats(this.app.vault, skillPath);
      this.threatCache.set(folderName, scanResult);
    }

    if (scanResult.threats.length > 0) {
      const threatDiv = this.detailPane.createDiv('skills-manager-detail-threats');
      threatDiv.createEl('strong', { text: `Security (${scanResult.riskLevel})` });
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

  private getFilteredSkills(): [string, SkillMeta][] {
    const result: [string, SkillMeta][] = [];
    for (const [name, meta] of this.allSkills) {
      // Source filter
      if (this.sourceFilter !== 'all') {
        const state = this.plugin.state.getSkillState(name);
        const source = state?.source || 'local';
        if (source !== this.sourceFilter) continue;
      }

      // Search filter
      if (this.searchQuery) {
        const text = `${meta.name} ${meta.description} ${meta.category}`.toLowerCase();
        if (!text.includes(this.searchQuery)) continue;
      }

      result.push([name, meta]);
    }
    return result;
  }
}
