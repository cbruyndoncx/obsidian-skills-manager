import { App, Modal, Notice, requestUrl } from 'obsidian';
import type SkillsManagerPlugin from '../main';
import { RegistrySkill } from '../types';
import { installFromGitHub } from '../installer';

type Board = 'all-time' | 'trending' | 'hot';

const REGISTRY_API = 'https://skills.sh/api/skills';

export class RegistryModal extends Modal {
  private plugin: SkillsManagerPlugin;
  private onDone: () => void;
  private activeBoard: Board = 'all-time';
  private skills: RegistrySkill[] = [];
  private page = 0;
  private hasMore = false;
  private loading = false;
  private error = '';
  private searchQuery = '';

  constructor(app: App, plugin: SkillsManagerPlugin, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  onOpen(): void {
    this.modalEl.addClass('skills-manager-registry-modal');
    this.titleEl.setText('Browse Skills Registry');
    this.loadSkills(true);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async loadSkills(reset: boolean): Promise<void> {
    if (reset) {
      this.skills = [];
      this.page = 0;
      this.hasMore = false;
    }

    this.loading = true;
    this.error = '';
    this.render();

    try {
      const url = `${REGISTRY_API}/${this.activeBoard}/${this.page}`;
      const response = await requestUrl({ url, throw: false });

      if (response.status !== 200) {
        this.error = `Registry returned status ${response.status}`;
        this.loading = false;
        this.render();
        return;
      }

      const data = response.json as {
        skills: RegistrySkill[];
        hasMore: boolean;
        page: number;
      };

      if (reset) {
        this.skills = data.skills;
      } else {
        this.skills = [...this.skills, ...data.skills];
      }
      this.hasMore = data.hasMore;
      this.page = data.page;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }

    this.loading = false;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Tab bar
    const tabBar = contentEl.createDiv('skills-manager-tab-bar');
    const boards: { id: Board; label: string }[] = [
      { id: 'all-time', label: 'All Time' },
      { id: 'trending', label: 'Trending' },
      { id: 'hot', label: 'Hot' },
    ];

    for (const board of boards) {
      const tab = tabBar.createEl('button', { text: board.label });
      tab.addClass('skills-manager-tab');
      if (this.activeBoard === board.id) tab.addClass('is-active');
      tab.addEventListener('click', () => {
        this.activeBoard = board.id;
        this.searchQuery = '';
        this.loadSkills(true);
      });
    }

    // Search
    const searchContainer = contentEl.createDiv('skills-manager-search');
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Filter results...',
    });
    searchInput.addClass('skills-manager-search-input');
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.filterList(listContainer);
    });

    // Skill list
    const listContainer = contentEl.createDiv('skills-manager-registry-list');

    if (this.error) {
      listContainer.createEl('p', {
        text: this.error,
        cls: 'skills-manager-registry-error',
      });
    }

    for (const skill of this.skills) {
      this.renderSkillItem(listContainer, skill);
    }

    if (this.loading) {
      listContainer.createEl('p', {
        text: 'Loading...',
        cls: 'skills-manager-registry-loading',
      });
    }

    // Skill count
    if (!this.loading && this.skills.length > 0) {
      contentEl.createEl('p', {
        text: `Showing ${this.skills.length} skills`,
        cls: 'skills-manager-registry-count',
      });
    }

    // Load more
    if (this.hasMore && !this.loading) {
      const loadMoreBtn = contentEl.createEl('button', {
        text: 'Load more',
        cls: 'skills-manager-load-more',
      });
      loadMoreBtn.addEventListener('click', () => {
        this.page++;
        this.loadSkills(false);
      });
    }
  }

  private renderSkillItem(container: HTMLElement, skill: RegistrySkill): void {
    const row = container.createDiv('skills-manager-registry-item');
    row.dataset.searchText = `${skill.name} ${skill.source}`.toLowerCase();

    const info = row.createDiv('skills-manager-registry-info');
    info.createEl('span', { text: skill.name, cls: 'skills-manager-registry-name' });
    info.createEl('span', {
      text: skill.source,
      cls: 'skills-manager-registry-source',
    });
    info.createEl('span', {
      text: `${skill.installs} installs`,
      cls: 'skills-manager-registry-installs',
    });

    const installBtn = row.createEl('button', {
      text: 'Install',
      cls: 'skills-manager-registry-install-btn',
    });
    installBtn.addEventListener('click', async () => {
      installBtn.setText('Installing...');
      installBtn.disabled = true;

      const pat = this.plugin.state.settings.githubPat || undefined;
      const result = await installFromGitHub(
        this.app.vault,
        this.plugin.state,
        this.plugin.state.settings.skillsDir,
        skill.source,
        undefined,
        pat
      );

      if (result.success) {
        new Notice(`Installed: ${result.skillName}`);
        installBtn.setText('Installed');
        this.onDone();
      } else {
        new Notice(`Failed: ${result.errors.join('; ')}`);
        installBtn.setText('Install');
        installBtn.disabled = false;
      }
    });
  }

  private filterList(container: HTMLElement): void {
    const items = container.querySelectorAll('.skills-manager-registry-item');
    items.forEach((item) => {
      const el = item as HTMLElement;
      const text = el.dataset.searchText || '';
      el.style.display =
        !this.searchQuery || text.includes(this.searchQuery) ? '' : 'none';
    });
  }
}
