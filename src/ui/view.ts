import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type SkillSwitchboardPlugin from '../main';
import { IndexedSkill, RootKind } from '../types';
import { getStrings, Strings } from '../i18n';
import { copyTextToClipboard } from '../utils/clipboard';
import { renderAdapterStatus } from './adapter-status';
import { DistributionBoard } from './distribution-board';
import { distributionNodes } from './distribution-state';
import { openPluginSettings } from './open-settings';

export const VIEW_TYPE_SKILL_SWITCHBOARD = 'skill-switchboard-view';

export class SkillSwitchboardView extends ItemView {
	plugin: SkillSwitchboardPlugin;
	/** Live filter over the current index; not persisted because it is UI state, not configuration. */
	private query = '';
	private distributionBoard: DistributionBoard | null = null;

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
		this.distributionBoard?.destroy();
		this.distributionBoard = null;
		this.contentEl.empty();
		return Promise.resolve();
	}

	renderIndex(): void {
		const strings = getStrings(this.plugin.settings.language);
		this.contentEl.empty();
		this.contentEl.addClass('skill-switchboard-view');
		const contentEl = this.contentEl.createDiv('skill-switchboard-page');

		this.renderHeader(contentEl, strings);
		if (this.plugin.settings.showDistributionBoard) {
			if (this.distributionBoard) contentEl.appendChild(this.distributionBoard.element);
			else this.distributionBoard = new DistributionBoard(contentEl, this.distributionModel(), () => {
				void this.plugin.setDistributionBoardVisible(false);
			});
			this.updateDistributionBoard();
		} else {
			this.distributionBoard?.destroy();
			this.distributionBoard = null;
		}

		const summary = contentEl.createDiv('skill-switchboard-summary');
		const activeRoots = this.plugin.settings.roots.filter((root) => root.enabled && root.path).length;
		const enabledTargets = this.plugin.settings.targets.filter((target) => target.enabled).length;
		const enabledHarnesses = this.plugin.settings.harnesses.filter((harness) => harness.enabled).length;
		const goToList = () => {
			contentEl.querySelector('.skill-switchboard-search')?.scrollIntoView({
				behavior: contentEl.win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
			});
		};
		addStat(summary, strings, strings.skills, String(this.plugin.index.skills.length), 'list', goToList);
		addStat(summary, strings, strings.roots, String(activeRoots), 'settings', () => this.openSettings());
		addStat(summary, strings, strings.targets, String(enabledTargets), 'settings', () => this.openSettings());
		addStat(summary, strings, strings.harnesses, String(enabledHarnesses), 'settings', () => this.openSettings());

		if (this.plugin.index.errors.length > 0) {
			const errorBox = contentEl.createDiv('skill-switchboard-errors');
			errorBox.createEl('strong', { text: strings.scanWarnings });
			for (const error of this.plugin.index.errors) errorBox.createDiv({ text: error });
		}

		renderAdapterStatus(contentEl, this.plugin, strings, (output) => this.copyOutput(output));

		if (this.plugin.index.skills.length === 0) {
			const empty = contentEl.createDiv('skill-switchboard-empty');
			empty.createEl('h3', { text: strings.noSkillsTitle });
			empty.createEl('p', { text: strings.noSkillsDescription });
			return;
		}

		const library = contentEl.createDiv('skill-switchboard-library-header');
		library.createEl('h2', { text: strings.skillLibrary });
		library.createSpan({ text: strings.readOnlyScan, cls: 'skill-switchboard-library-note' });
		this.renderSearchBox(contentEl, strings);
		this.renderSkillGroups(contentEl, strings);

		const footer = contentEl.createDiv('skill-switchboard-footer');
		footer.setText(`${strings.readOnlyScan} · ${new Date(this.plugin.index.scannedAt).toLocaleString()}`);
	}

	updateDistributionBoard(): void {
		this.distributionBoard?.update(this.distributionModel());
	}

	private distributionModel() {
		const plugin = this.plugin;
		const blocked = plugin.manifestCheck?.status === 'failed'
			|| (plugin.adapterCheck?.status === 'failed' && plugin.targetChecks.length === 0);
		return {
			nodes: distributionNodes({ targets: plugin.settings.targets, checks: plugin.targetChecks, activity: plugin.targetActivity, blocked }),
			// Use the active sync provider's canonical path, not an unrelated indexing root.
			sourcePath: plugin.settings.roots.find((root) => root.id === plugin.settings.syncRootId)?.path ?? '',
			sourceUnavailable: blocked || plugin.manifestCheck?.resources?.status === 'failed',
			checkedAt: plugin.targetCheckedAt,
			strings: getStrings(plugin.settings.language),
		};
	}

	/** Filtering runs against the existing index, so typing never hits the disk. */
	private renderSearchBox(contentEl: HTMLElement, strings: Strings): void {
		const row = contentEl.createDiv('skill-switchboard-search');
		const icon = row.createSpan('skill-switchboard-search-icon');
		setIcon(icon, 'search');
		const input = row.createEl('input', {
			type: 'search',
			cls: 'skill-switchboard-search-input',
		});
		input.value = this.query;
		input.setAttribute('placeholder', strings.searchSkills);
		input.setAttribute('aria-label', strings.searchSkills);

		const count = row.createSpan('skill-switchboard-search-count');
		const clear = row.createEl('button', {
			text: strings.clearSearch,
			cls: 'skill-switchboard-search-clear',
		});
		clear.setAttribute('aria-label', strings.clearSearch);
		clear.addEventListener('click', () => {
			this.query = '';
			input.value = '';
			input.focus();
			refresh();
			this.renderListOnly(strings);
		});

		const refresh = () => {
			const matched = this.filteredSkills().length;
			const filtering = this.query.trim().length > 0;
			count.setText(filtering ? strings.matchCount(matched) : '');
			row.toggleClass('is-filtering', filtering);
		};
		input.addEventListener('input', () => {
			this.query = input.value;
			refresh();
			this.renderListOnly(strings);
		});
		refresh();
	}

	/** Re-renders only the list so the search box keeps focus and caret position. */
	private renderListOnly(strings: Strings): void {
		const contentEl = this.contentEl;
		contentEl.findAll('.skill-switchboard-list, .skill-switchboard-no-results').forEach((el) => el.remove());
		const anchor = contentEl.querySelector('.skill-switchboard-search');
		if (!anchor) {
			this.renderIndex();
			return;
		}
		this.renderFilteredList(contentEl, strings, anchor);
	}

	private renderFilteredList(contentEl: HTMLElement, strings: Strings, anchor: Element): void {
		const matched = this.filteredSkills();
		if (matched.length === 0) {
			const empty = contentEl.createDiv('skill-switchboard-no-results');
			anchor.insertAdjacentElement('afterend', empty);
			empty.createDiv({ text: strings.noSearchResults });
			empty.createDiv({
				text: `“${this.query.trim()}”`,
				cls: 'skill-switchboard-no-results-query',
			});
			const reset = empty.createEl('button', { text: strings.clearSearch });
			reset.addEventListener('click', () => {
				this.query = '';
				this.renderIndex();
			});
			return;
		}
		this.renderSkillGroups(contentEl, strings, matched, anchor);
	}

	private filteredSkills(): IndexedSkill[] {
		const query = this.query.trim().toLowerCase();
		if (!query) return this.plugin.index.skills;
		return this.plugin.index.skills.filter((skill) =>
			[skill.name, skill.description, skill.relativePath, skill.rootLabel]
				.join('\n')
				.toLowerCase()
				.includes(query),
		);
	}

	private openSettings(): void {
		if (!openPluginSettings(this.app, this.plugin.manifest.id)) {
			new Notice(getStrings(this.plugin.settings.language).settingsNotice);
		}
	}

	/** One primary action, restrained utility controls; repair still requires confirmation. */
	private renderHeader(contentEl: HTMLElement, strings: Strings): void {
		const header = contentEl.createDiv('skill-switchboard-header');
		const heading = header.createDiv('skill-switchboard-heading');
		heading.createEl('h1', { cls: 'skill-switchboard-title', text: strings.viewTitle });
		heading.createDiv({ cls: 'skill-switchboard-subtitle', text: strings.viewDescription });

		const actions = header.createDiv('skill-switchboard-actions');
		const primary = actions.createDiv('skill-switchboard-main-actions');
		const check = actionButton(primary, strings.checkAdapters, 'scan-line', 'mod-cta');
		const busy = this.plugin.adapterCheckRunning || this.plugin.adapterRepairRunning;
		check.disabled = busy;
		check.addEventListener('click', () => void this.plugin.checkAdapters());

		const repair = actionButton(primary, strings.repairAllAdapters, 'wrench');
		repair.setAttribute('title', strings.repairAllDescription);
		repair.disabled = busy;
		repair.addEventListener('click', () => void this.plugin.repairAllAdapters());

		const utilities = actions.createDiv('skill-switchboard-utility-actions');
		const refresh = utilities.createEl('button', {
			cls: 'skill-switchboard-icon-button',
		});
		refresh.setAttribute('aria-label', strings.refresh);
		refresh.setAttribute('title', strings.refresh);
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => void this.plugin.refreshIndex(true));

		if (!this.plugin.settings.showDistributionBoard) {
			const showBoard = utilities.createEl('button', { cls: 'skill-switchboard-icon-button' });
			showBoard.setAttribute('aria-label', strings.distributionShow);
			showBoard.setAttribute('title', strings.distributionShow);
			setIcon(showBoard, 'waypoints');
			showBoard.addEventListener('click', () => void this.plugin.setDistributionBoardVisible(true));
		}

		const settings = actionButton(utilities, strings.settings, 'settings');
		settings.addEventListener('click', () => this.openSettings());
	}

	private renderSkillGroups(
		contentEl: HTMLElement,
		strings: Strings,
		skills: IndexedSkill[] = this.filteredSkills(),
		anchor?: Element,
	): void {
		const groups = new Map<string, IndexedSkill[]>();
		for (const skill of skills) {
			const bucket = groups.get(skill.rootLabel);
			if (bucket) bucket.push(skill);
			else groups.set(skill.rootLabel, [skill]);
		}

		// Without an anchor the list goes to the end of the view; with one it is
		// placed directly after the search box so the filter UI never moves.
		const container = contentEl.createDiv('skill-switchboard-list');
		if (anchor) anchor.insertAdjacentElement('afterend', container);

		for (const [rootLabel, items] of groups) {
			if (groups.size > 1) {
				const heading = container.createDiv('skill-switchboard-group-heading');
				heading.createEl('strong', { text: rootLabel });
				heading.createSpan({ text: String(items.length), cls: 'skill-switchboard-badge' });
			}
			for (const skill of items) this.renderSkill(container, skill, strings);
		}
	}

	private async copyOutput(output: string): Promise<void> {
		const strings = getStrings(this.plugin.settings.language);
		if (!output.trim()) {
			new Notice(strings.noOutputToCopy);
			return;
		}
		const copied = await copyTextToClipboard(output);
		new Notice(copied ? strings.outputCopied : strings.copyFailed);
	}

	/** Name and description carry the meaning; path and hash are diagnostics. */
	private renderSkill(container: HTMLElement, skill: IndexedSkill, strings: Strings): void {
		const card = container.createDiv('skill-switchboard-card');
		const opensInObsidian = skill.rootKind === 'vault';
		card.addClass('is-actionable');
		const action = card.createEl('button', { cls: 'skill-switchboard-card-action' });
		action.setAttribute('type', 'button');
		const actionLabel = opensInObsidian ? strings.openSource : strings.copySourcePath;
		action.setAttribute('aria-label', `${actionLabel}: ${skill.name}`);
		action.setAttribute('title', actionLabel);
		action.addEventListener('click', () => void this.openSkill(skill));

		const heading = action.createSpan('skill-switchboard-card-heading');
		heading.createEl('strong', { text: skill.name });
		if (skill.rootKind !== 'vault') {
			heading.createSpan({ text: rootKindLabel(skill.rootKind, strings), cls: 'skill-switchboard-badge' });
		}

		action.createSpan({
			text: skill.description || strings.noDescription,
			cls: 'skill-switchboard-description',
		});

		const details = card.createEl('details', { cls: 'skill-switchboard-details' });
		details.createEl('summary', { text: strings.technicalDetails, cls: 'skill-switchboard-check-label' });
		const body = details.createDiv('skill-switchboard-card-meta');
		body.createDiv({ text: `${strings.sourcePath} ${skill.path}`, cls: 'skill-switchboard-path' });
		body.createDiv({ text: `${strings.sha256} ${skill.sha256.slice(0, 12)}…`, cls: 'skill-switchboard-hash' });
	}

	/**
	 * Vault skills resolve to a vault path and open in place. External roots live
	 * outside the vault, so Obsidian cannot open them and the path is copied instead.
	 */
	private async openSkill(skill: IndexedSkill): Promise<void> {
		const strings = getStrings(this.plugin.settings.language);
		if (skill.rootKind !== 'vault') {
			const copied = await copyTextToClipboard(skill.path);
			new Notice(copied ? strings.pathCopied : strings.pathCopyFailed);
			return;
		}
		// The scanner only indexes markdown files, so narrow the lookup result before
		// handing it to the workspace.
		const file = this.app.vault.getAbstractFileByPath(skill.path);
		if (!(file instanceof TFile)) {
			new Notice(strings.sourceMissing);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}

function rootKindLabel(kind: RootKind, strings: Strings): string {
	return kind === 'external' ? strings.externalRoot : strings.vaultRelative;
}

function actionButton(parent: HTMLElement, label: string, icon: string, extraClass = ''): HTMLButtonElement {
	const button = parent.createEl('button', { cls: `skill-switchboard-button ${extraClass}`.trim() });
	button.setAttribute('aria-label', label);
	setIcon(button.createSpan('skill-switchboard-button-icon'), icon);
	button.createSpan({ text: label });
	return button;
}

/**
 * The counts double as navigation: the skill count points at the list, while
 * roots, targets and harnesses live in settings and say so.
 */
function addStat(
	container: HTMLElement,
	strings: Strings,
	label: string,
	value: string,
	target: 'list' | 'settings',
	onClick: () => void,
): void {
	const stat = container.createEl('button', { cls: 'skill-switchboard-stat is-clickable' });
	stat.setAttribute('aria-label', `${label}: ${value} · ${target === 'list' ? strings.jumpToList : strings.manageInSettings}`);
	stat.createSpan({ text: value, cls: 'skill-switchboard-stat-value' });
	stat.createSpan({ text: label, cls: 'skill-switchboard-stat-label' });
	const hint = stat.createSpan({
		text: target === 'list' ? strings.jumpToList : strings.manageInSettings,
		cls: 'skill-switchboard-stat-hint',
	});

	stat.addEventListener('click', onClick);
	hint.setAttribute('aria-hidden', 'true');
}
