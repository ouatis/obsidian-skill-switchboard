import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type SkillSwitchboardPlugin from '../main';
import { IndexedSkill, RootKind } from '../types';
import { getStrings, Strings } from '../i18n';
import { copyTextToClipboard } from '../utils/clipboard';

export const VIEW_TYPE_SKILL_SWITCHBOARD = 'skill-switchboard-view';

export class SkillSwitchboardView extends ItemView {
	plugin: SkillSwitchboardPlugin;
	/** Live filter over the current index; not persisted because it is UI state, not configuration. */
	private query = '';

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

		this.renderHeader(contentEl, strings);

		const summary = contentEl.createDiv('skill-switchboard-summary');
		const activeRoots = this.plugin.settings.roots.filter((root) => root.enabled && root.path).length;
		const enabledTargets = this.plugin.settings.targets.filter((target) => target.enabled).length;
		const enabledHarnesses = this.plugin.settings.harnesses.filter((harness) => harness.enabled).length;
		addStat(summary, strings, strings.skills, String(this.plugin.index.skills.length), 'list');
		addStat(summary, strings, strings.roots, String(activeRoots), 'settings');
		addStat(summary, strings, strings.targets, String(enabledTargets), 'settings');
		addStat(summary, strings, strings.harnesses, String(enabledHarnesses), 'settings');

		if (this.plugin.index.errors.length > 0) {
			const errorBox = contentEl.createDiv('skill-switchboard-errors');
			errorBox.createEl('strong', { text: strings.scanWarnings });
			for (const error of this.plugin.index.errors) errorBox.createDiv({ text: error });
		}

		this.renderAdapterSection(contentEl, strings);

		if (this.plugin.index.skills.length === 0) {
			const empty = contentEl.createDiv('skill-switchboard-empty');
			empty.createEl('h3', { text: strings.noSkillsTitle });
			empty.createEl('p', { text: strings.noSkillsDescription });
			return;
		}

		this.renderSearchBox(contentEl, strings);
		this.renderSkillGroups(contentEl, strings);

		const footer = contentEl.createDiv('skill-switchboard-footer');
		footer.setText(`${strings.readOnlyScan} · ${new Date(this.plugin.index.scannedAt).toLocaleString()}`);
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
			const empty = anchor.createDiv('skill-switchboard-no-results');
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

	/** Primary action first, diagnostics folded away, destructive styling kept for repair. */
	private renderHeader(contentEl: HTMLElement, strings: Strings): void {
		const header = contentEl.createDiv('skill-switchboard-header');
		header.createDiv({ cls: 'skill-switchboard-title', text: strings.viewTitle });

		const actions = header.createDiv('skill-switchboard-actions');
		const check = actions.createEl('button', { text: strings.checkAdapters });
		check.addClass('mod-cta');
		const busy = this.plugin.adapterCheckRunning || this.plugin.adapterRepairRunning;
		check.disabled = busy;
		check.addEventListener('click', () => void this.plugin.checkAdapters());

		const repair = actions.createEl('button', {
			text: strings.repairAllAdapters,
			cls: 'mod-warning',
		});
		repair.disabled = busy;
		repair.addEventListener('click', () => void this.plugin.repairAllAdapters());

		const refresh = actions.createEl('button', {
			text: strings.refresh,
			cls: 'skill-switchboard-icon-button',
		});
		refresh.setAttribute('aria-label', strings.refresh);
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => void this.plugin.refreshIndex(true));

		const settings = actions.createEl('button', {
			text: strings.settings,
			cls: 'skill-switchboard-icon-button',
		});
		settings.setAttribute('aria-label', strings.settings);
		setIcon(settings, 'settings');
		settings.addEventListener('click', () => {
			new Notice(strings.settingsNotice);
		});
	}

	/**
	 * Adapter diagnostics stay collapsed by default: a clean run is a single line,
	 * and the raw multi-target output is only worth reading when something failed.
	 */
	private renderAdapterSection(contentEl: HTMLElement, strings: Strings): void {
		const check = this.plugin.adapterCheck;
		const checkRunning = this.plugin.adapterCheckRunning;
		const repair = this.plugin.adapterRepair;
		const repairRunning = this.plugin.adapterRepairRunning;
		if (!checkRunning && !repairRunning && !check && !repair) return;

		const section = contentEl.createDiv('skill-switchboard-check');
		if (checkRunning || check) {
			const passed = check?.status === 'passed';
			const text = checkRunning
				? strings.adapterCheckRunning
				: passed
					? strings.adapterCheckPassed
					: strings.adapterCheckFailed(check?.exitCode ?? 1);
			this.renderStatusRow(section, text, passed, passed ? 'check-circle' : 'alert-triangle');
			if (check?.output && !passed) {
				this.renderOutputBlock(section, strings, strings.adapterCheckOutput, check.output);
			}
		}

		if (repairRunning || repair) {
			const passed = repair?.status === 'passed';
			const text = repairRunning
				? strings.repairAllRunning
				: passed
					? strings.repairAllNoDrift
					: strings.adapterCheckFailed(repair?.exitCode ?? 1);
			this.renderStatusRow(section, text, passed, passed ? 'wrench' : 'alert-triangle');
			if (repair?.output && !passed) {
				this.renderOutputBlock(section, strings, strings.repairAllOutput, repair.output);
			}
		}
	}

	private renderStatusRow(container: HTMLElement, text: string, passed: boolean, icon: string): void {
		const row = container.createDiv('skill-switchboard-status');
		row.toggleClass('is-passed', passed);
		const marker = row.createSpan('skill-switchboard-status-icon');
		setIcon(marker, icon);
		row.createSpan({ text });
	}

	private renderOutputBlock(container: HTMLElement, strings: Strings, label: string, output: string): void {
		const details = container.createEl('details', { cls: 'skill-switchboard-details' });
		details.createEl('summary', { text: label, cls: 'skill-switchboard-check-label' });
		const body = details.createDiv('skill-switchboard-output-body');
		const copyButton = body.createEl('button', {
			text: strings.copyOutput,
			cls: 'skill-switchboard-copy-button',
		});
		copyButton.setAttribute('aria-label', strings.copyOutput);
		copyButton.addEventListener('click', () => void this.copyOutput(output));
		body.createEl('pre', { text: output, cls: 'skill-switchboard-check-output' });
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
		const container = anchor
			? anchor.createDiv('skill-switchboard-list')
			: contentEl.createDiv('skill-switchboard-list');

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
		const openable = skill.rootKind === 'vault';
		if (openable) {
			card.addClass('is-openable');
			card.setAttribute('role', 'link');
			card.setAttribute('tabindex', '0');
			card.setAttribute('aria-label', `${strings.openSource}: ${skill.name}`);
			card.addEventListener('click', (event) => {
				if ((event.target as HTMLElement).closest('details, button')) return;
				void this.openSkill(skill);
			});
			card.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				if ((event.target as HTMLElement).closest('details, button')) return;
				event.preventDefault();
				void this.openSkill(skill);
			});
		}

		const heading = card.createDiv('skill-switchboard-card-heading');
		heading.createEl('strong', { text: skill.name });
		if (skill.rootKind !== 'vault') {
			heading.createSpan({ text: rootKindLabel(skill.rootKind), cls: 'skill-switchboard-badge' });
		}

		card.createDiv({
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
			await copyTextToClipboard(skill.path);
			new Notice(strings.pathCopied);
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

function rootKindLabel(kind: RootKind): string {
	return kind === 'external' ? 'external' : 'vault';
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
): void {
	const stat = container.createDiv('skill-switchboard-stat');
	stat.createDiv({ text: value, cls: 'skill-switchboard-stat-value' });
	stat.createDiv({ text: label, cls: 'skill-switchboard-stat-label' });
	const hint = stat.createDiv({
		text: target === 'list' ? strings.jumpToList : strings.manageInSettings,
		cls: 'skill-switchboard-stat-hint',
	});

	if (target === 'list') {
		stat.addClass('is-clickable');
		stat.setAttribute('role', 'button');
		stat.setAttribute('tabindex', '0');
		const goToList = () => {
			const list = container.parentElement?.querySelector('.skill-switchboard-list');
			list?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		};
		stat.addEventListener('click', goToList);
		stat.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				goToList();
			}
		});
	} else {
		stat.addClass('is-hint');
	}
	hint.setAttribute('aria-hidden', 'true');
}