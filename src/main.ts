import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { StateManager } from './state';
import { SkillsManagerSettingTab } from './settings';
import { AddSkillModal } from './ui/add-modal';
import { RegistryModal } from './ui/registry-modal';
import { checkForUpdate } from './github';
import { installFromGitHub, updateGitHubSkill } from './installer';
import { exportSkills } from './exporter';
import { parseRepo } from './github';
import { SkillsView, VIEW_TYPE_SKILLS } from './ui/skills-view';

export default class SkillsManagerPlugin extends Plugin {
  state!: StateManager;
  private settingsTab!: SkillsManagerSettingTab;

  async onload(): Promise<void> {
    this.state = new StateManager(this);
    await this.state.load();

    this.settingsTab = new SkillsManagerSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Register skills view
    this.registerView(VIEW_TYPE_SKILLS, (leaf) => new SkillsView(leaf, this));

    // Ribbon icon to open skills view
    this.addRibbonIcon('wand-2', 'Open skills manager', () => {
      this.activateView();
    });

    // Protocol handler: obsidian://skills-manager?action=install&repo=owner/repo
    this.registerObsidianProtocolHandler('skills-manager', async (params) => {
      if (params.action === 'install' && params.repo) {
        const repo = parseRepo(params.repo);
        if (!repo) {
          new Notice(`Invalid repository format: ${params.repo}`);
          return;
        }
        new Notice(`Installing skill from ${repo}...`);
        const pat = this.state.settings.githubPat || undefined;
        const result = await installFromGitHub(
          this.app.vault,
          this.state,
          this.state.settings.skillsDir,
          repo,
          undefined,
          pat
        );
        if (result.success) {
          new Notice(`Installed: ${result.skillName}`);
          this.settingsTab.display();
        } else {
          new Notice(`Install failed: ${result.errors.join('; ')}`);
        }
      }
    });

    this.addCommand({
      id: 'skills-manager-list',
      name: 'List skills',
      callback: () => {
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

    this.addCommand({
      id: 'skills-manager-add',
      name: 'Add skill',
      callback: () => {
        new AddSkillModal(this.app, this, () => this.settingsTab.display()).open();
      },
    });

    this.addCommand({
      id: 'skills-manager-check-updates',
      name: 'Check for updates',
      callback: () => this.checkAllUpdates(true),
    });

    this.addCommand({
      id: 'skills-manager-update-all',
      name: 'Update all skills',
      callback: () => this.updateAllSkills(),
    });

    this.addCommand({
      id: 'skills-manager-browse',
      name: 'Browse registry',
      callback: () => {
        new RegistryModal(this.app, this, () => this.settingsTab.display()).open();
      },
    });

    this.addCommand({
      id: 'skills-manager-open-view',
      name: 'Open skills view',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'skills-manager-export',
      name: 'Export to tools',
      callback: async () => {
        if (!this.state.settings.crossToolExportEnabled) {
          new Notice('Cross-tool export is disabled. Enable it in Skills Manager settings.');
          return;
        }
        const targets = this.state.settings.crossToolExport || [];
        if (targets.length === 0) {
          new Notice('No export targets configured. Set them in Skills Manager settings.');
          return;
        }
        const result = await exportSkills(
          this.app.vault,
          this.state.settings.skillsDir,
          targets
        );
        if (result.exported.length > 0) {
          new Notice(`Exported to: ${result.exported.join(', ')}`);
        }
        if (result.errors.length > 0) {
          new Notice(`Errors: ${result.errors.join('; ')}`);
        }
      },
    });

    // Startup update check (60s delay)
    if (this.state.settings.autoUpdate) {
      this.registerInterval(
        window.setTimeout(() => this.checkAllUpdates(false), 60000) as unknown as number
      );
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SKILLS);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SKILLS);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_SKILLS, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async checkAllUpdates(verbose: boolean): Promise<void> {
    const updatable = this.state.getUpdatableGitHubSkills();
    if (updatable.length === 0) {
      if (verbose) new Notice('No GitHub skills to check');
      return;
    }

    const pat = this.state.settings.githubPat || undefined;
    let updatesFound = 0;

    for (const [name, skillState] of updatable) {
      if (!skillState.repo || !skillState.version) continue;
      try {
        const result = await checkForUpdate(skillState.repo, skillState.version, pat);
        if (result?.hasUpdate) {
          updatesFound++;
          new Notice(`Update available for ${name}: ${result.latestVersion}`);
        }
      } catch {
        // Skip failed checks silently
      }
    }

    if (verbose && updatesFound === 0) {
      new Notice('All skills are up to date');
    }
  }

  private async updateAllSkills(): Promise<void> {
    const updatable = this.state.getUpdatableGitHubSkills();
    if (updatable.length === 0) {
      new Notice('No updatable GitHub skills');
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const [name] of updatable) {
      const result = await updateGitHubSkill(
        this.app.vault,
        this.state,
        this.state.settings.skillsDir,
        name
      );
      if (result.success) {
        updated++;
      } else {
        failed++;
      }
    }

    new Notice(`Updated ${updated} skill(s)${failed > 0 ? `, ${failed} failed` : ''}`);
    this.settingsTab.display();
  }
}
