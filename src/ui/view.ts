import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type SkillSwitchboardPlugin from '../main';
import { IndexedSkill } from '../types';
import { getStrings } from '../i18n';

export const VIEW_TYPE_SKILL_SWITCHBOARD = 'skill-switchboard-view';

export class SkillSwitchboardView extends ItemView {
	plugin: SkillSwitchboardPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: SkillSwitchboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SKILL_SWITCHBOARD;
	}

	getDisplayText(): string {
		return getStrings(this.plugin.settings.language).viewTitle;
	}

	getIcon(): string {
		return 'waypoints';
	}

	onOpen(): Promise<void> {
		this.renderIndex();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	renderIndex(): void {
		const { contentEl } = this;
		const strings = getStrings(this.plugin.settings.language);
		contentEl.empty();
		contentEl.addClass('skill-switchboard-view');

		const header = contentEl.createDiv('skill-switchboard-header');
		header.createDiv({
			cls: 'skill-switchboard-title',
			text: strings.viewTitle,
		});
		const actions = header.createDiv('skill-switchboard-actions');
		const refresh = actions.createEl('button', { text: strings.refresh });
		refresh.addEventListener('click', () => void this.plugin.refreshIndex(true));
		const checkAdapters = actions.createEl('button', { text: strings.checkAdapters });
		checkAdapters.disabled = this.plugin.adapterCheckRunning || this.plugin.adapterRepairRunning;
		checkAdapters.addEventListener('click', () => void this.plugin.checkAdapters());
		const repairAll = actions.createEl('button', { text: strings.repairAllAdapters });
		repairAll.disabled = this.plugin.adapterCheckRunning || this.plugin.adapterRepairRunning;
		repairAll.addEventListener('click', () => void this.plugin.repairAllAdapters());
		const settings = actions.createEl('button', { text: strings.settings });
		settings.addEventListener('click', () => {
			new Notice(strings.settingsNotice);
		});

		const summary = contentEl.createDiv('skill-switchboard-summary');
		const activeRoots = this.plugin.settings.roots.filter((root) => root.enabled && root.path).length;
		const enabledTargets = this.plugin.settings.targets.filter((target) => target.enabled).length;
		const enabledHarnesses = this.plugin.settings.harnesses.filter((harness) => harness.enabled).length;
		addStat(summary, strings.skills, String(this.plugin.index.skills.length));
		addStat(summary, strings.roots, String(activeRoots));
		addStat(summary, strings.targets, String(enabledTargets));
		addStat(summary, strings.harnesses, String(enabledHarnesses));

		if (this.plugin.index.errors.length > 0) {
			const errorBox = contentEl.createDiv('skill-switchboard-errors');
			errorBox.createEl('strong', { text: strings.scanWarnings });
			for (const error of this.plugin.index.errors) errorBox.createDiv({ text: error });
		}

		if (this.plugin.adapterCheckRunning || this.plugin.adapterCheck) {
			const checkBox = contentEl.createDiv('skill-switchboard-check');
			checkBox.createEl('strong', {
				text: this.plugin.adapterCheckRunning
					? strings.adapterCheckRunning
					: this.plugin.adapterCheck?.status === 'passed'
						? strings.adapterCheckPassed
						: strings.adapterCheckFailed(this.plugin.adapterCheck?.exitCode ?? 1),
			});
			if (this.plugin.adapterCheck?.output) {
				checkBox.createDiv({
					text: strings.adapterCheckOutput,
					cls: 'skill-switchboard-check-label',
				});
				checkBox.createEl('pre', {
					text: this.plugin.adapterCheck.output,
					cls: 'skill-switchboard-check-output',
				});
			}
		}

		const repairBox = contentEl.createDiv('skill-switchboard-repair');
		repairBox.createEl('strong', { text: strings.repairAllAdapters });
		repairBox.createDiv({ text: strings.repairAllDescription, cls: 'skill-switchboard-check-label' });

		if (this.plugin.adapterRepairRunning || this.plugin.adapterRepair) {
			const repairResult = contentEl.createDiv('skill-switchboard-check');
			repairResult.createEl('strong', {
				text: this.plugin.adapterRepairRunning
					? strings.repairAllRunning
					: this.plugin.adapterRepair?.status === 'passed'
						? strings.repairAllOutput
						: strings.adapterCheckFailed(this.plugin.adapterRepair?.exitCode ?? 1),
			});
			if (this.plugin.adapterRepair?.output) {
				repairResult.createDiv({
					text: strings.repairAllOutput,
					cls: 'skill-switchboard-check-label',
				});
				repairResult.createEl('pre', {
					text: this.plugin.adapterRepair.output,
					cls: 'skill-switchboard-check-output',
				});
			}
		}

		if (this.plugin.index.skills.length === 0) {
			const empty = contentEl.createDiv('skill-switchboard-empty');
			empty.createEl('h3', { text: strings.noSkillsTitle });
			empty.createEl('p', {
				text: strings.noSkillsDescription,
			});
			return;
		}

		const list = contentEl.createDiv('skill-switchboard-list');
		for (const skill of this.plugin.index.skills) this.renderSkill(list, skill);

		const footer = contentEl.createDiv('skill-switchboard-footer');
		footer.setText(`${strings.readOnlyScan} · ${new Date(this.plugin.index.scannedAt).toLocaleString()}`);
	}

	private renderSkill(container: HTMLElement, skill: IndexedSkill): void {
		const strings = getStrings(this.plugin.settings.language);
		const card = container.createDiv('skill-switchboard-card');
		const heading = card.createDiv('skill-switchboard-card-heading');
		heading.createEl('strong', { text: skill.name });
		heading.createSpan({ text: skill.rootLabel, cls: 'skill-switchboard-badge' });

		card.createDiv({
			text: skill.description || strings.noDescription,
			cls: 'skill-switchboard-description',
		});
		card.createDiv({ text: skill.path, cls: 'skill-switchboard-path' });
		card.createDiv({
			text: `${strings.sha256} ${skill.sha256.slice(0, 12)}…`,
			cls: 'skill-switchboard-hash',
		});
	}
}

function addStat(container: HTMLElement, label: string, value: string): void {
	const stat = container.createDiv('skill-switchboard-stat');
	stat.createDiv({ text: value, cls: 'skill-switchboard-stat-value' });
	stat.createDiv({ text: label, cls: 'skill-switchboard-stat-label' });
}
