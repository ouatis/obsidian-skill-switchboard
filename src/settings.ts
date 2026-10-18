import { App, PluginSettingTab, Setting, requireApiVersion } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type SkillSwitchboardPlugin from './main';
import { getStrings, Language } from './i18n';
import { RUNTIME_NAMES, RuntimeTarget, SkillRoot } from './types';
import {
	renderExternalPackagesSection,
	renderRootsSection,
	renderSyncSourceSection,
	renderTargetsSection,
} from './settings/sections';

export interface SkillSwitchboardSettings {
	roots: SkillRoot[];
	targets: RuntimeTarget[];
	language: Language;
	autoScan: boolean;
	scanDelayMs: number;
	showDistributionBoard: boolean;
	syncRootId: string;
	syncManifestPath: string;
	autoCheck: boolean;
	/** Machine-local opt-in, bound to a resolved source/destination scope. */
	autoDistribute: boolean;
	autoDistributeScope: string;
}

export const DEFAULT_SETTINGS: SkillSwitchboardSettings = {
	roots: [
		{
			id: 'vault-skills',
			label: 'Vault skills',
			path: 'skills',
			kind: 'vault',
			enabled: true,
		},
	],
	targets: [],
	language: 'en',
	autoScan: false,
	scanDelayMs: 500,
	showDistributionBoard: true,
	syncRootId: 'vault-skills',
	syncManifestPath: '',
	autoCheck: true,
	autoDistribute: false,
	autoDistributeScope: '',
};

const RUNTIME_NAME_SET: ReadonlySet<string> = new Set(RUNTIME_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecords<T extends { id: string }>(records: readonly T[]): T[] {
	return records.map((record) => ({ ...record }));
}

interface NormalizedRecords<T> {
	items: T[];
	recovered: boolean;
}

function normalizeRecords<T extends { id: string }>(
	value: unknown,
	fallback: readonly T[],
	normalize: (candidate: unknown) => T | null,
): NormalizedRecords<T> {
	const source = Array.isArray(value) ? value : fallback;
	const ids = new Set<string>();
	const items: T[] = [];
	let recovered = value !== undefined && !Array.isArray(value);
	for (const candidate of source) {
		const record = normalize(candidate);
		if (!record || ids.has(record.id)) {
			recovered = true;
			continue;
		}
		ids.add(record.id);
		items.push(record);
	}
	// Preserve an intentional empty list, but recover to defaults if every saved
	// entry is malformed so one bad row cannot leave the editor unusable.
	if (Array.isArray(value) && value.length > 0 && items.length === 0) {
		return { items: cloneRecords(fallback), recovered: true };
	}
	return { items, recovered };
}

function normalizeRoot(value: unknown): SkillRoot | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== 'string' || !value.id.trim() || typeof value.label !== 'string' || typeof value.path !== 'string') return null;
	if ((value.kind !== 'vault' && value.kind !== 'external') || typeof value.enabled !== 'boolean') return null;
	return { ...value, id: value.id, label: value.label, path: value.path, kind: value.kind, enabled: value.enabled };
}

function normalizeTarget(value: unknown): RuntimeTarget | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== 'string' || !value.id.trim() || typeof value.label !== 'string' || typeof value.path !== 'string') return null;
	if ((value.mode !== 'copy' && value.mode !== 'symlink' && value.mode !== 'wrapper') || typeof value.enabled !== 'boolean') return null;
	if (value.runtime !== undefined && (typeof value.runtime !== 'string' || !RUNTIME_NAME_SET.has(value.runtime))) return null;
	return {
		...value,
		id: value.id,
		label: value.label,
		path: value.path,
		// Legacy modes migrate as configuration only; no filesystem write or takeover.
		mode: 'copy',
		enabled: value.enabled,
		...(typeof value.runtime === 'string' ? { runtime: value.runtime as RuntimeTarget['runtime'] } : {}),
	};
}

export interface SettingsNormalization {
	settings: SkillSwitchboardSettings;
	recovered: boolean;
}

/** Validate persisted Obsidian data before settings are consumed by the UI or scan loop. */
export function normalizeSettings(value: unknown): SettingsNormalization {
	const data = isRecord(value) ? value : {};
	const roots = normalizeRecords(data.roots, DEFAULT_SETTINGS.roots, normalizeRoot);
	const targets = normalizeRecords(data.targets, DEFAULT_SETTINGS.targets, normalizeTarget);
	const firstEnabledRoot = roots.items.find((root) => root.enabled && root.path.trim())?.id ?? '';
	const hasInvalidValue = (key: keyof SkillSwitchboardSettings, valid: (candidate: unknown) => boolean): boolean =>
		Object.prototype.hasOwnProperty.call(data, key) && !valid(data[key]);
	const recovered = (value !== null && value !== undefined && !isRecord(value)) ||
		roots.recovered || targets.recovered ||
		hasInvalidValue('language', (candidate) => candidate === 'en' || candidate === 'zh-CN') ||
		hasInvalidValue('autoScan', (candidate) => typeof candidate === 'boolean') ||
		hasInvalidValue('scanDelayMs', (candidate) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) ||
		hasInvalidValue('showDistributionBoard', (candidate) => typeof candidate === 'boolean') ||
		hasInvalidValue('syncRootId', (candidate) => typeof candidate === 'string') ||
		hasInvalidValue('syncManifestPath', (candidate) => typeof candidate === 'string') ||
		hasInvalidValue('autoCheck', (candidate) => typeof candidate === 'boolean');
	const settings: SkillSwitchboardSettings = {
		roots: roots.items,
		targets: targets.items,
		language: data.language === 'zh-CN' ? 'zh-CN' : DEFAULT_SETTINGS.language,
		autoScan: typeof data.autoScan === 'boolean' ? data.autoScan : DEFAULT_SETTINGS.autoScan,
		scanDelayMs: typeof data.scanDelayMs === 'number' && Number.isFinite(data.scanDelayMs) && data.scanDelayMs >= 0
			? data.scanDelayMs
			: DEFAULT_SETTINGS.scanDelayMs,
		showDistributionBoard: typeof data.showDistributionBoard === 'boolean' ? data.showDistributionBoard : DEFAULT_SETTINGS.showDistributionBoard,
		syncRootId: typeof data.syncRootId === 'string' ? data.syncRootId : firstEnabledRoot,
		syncManifestPath: typeof data.syncManifestPath === 'string' ? data.syncManifestPath : DEFAULT_SETTINGS.syncManifestPath,
		autoCheck: typeof data.autoCheck === 'boolean' ? data.autoCheck : DEFAULT_SETTINGS.autoCheck,
		autoDistribute: data.autoDistribute === true && typeof data.autoDistributeScope === 'string' && /^[0-9a-f]{64}$/.test(data.autoDistributeScope),
		autoDistributeScope: typeof data.autoDistributeScope === 'string' && /^[0-9a-f]{64}$/.test(data.autoDistributeScope) ? data.autoDistributeScope : '',
	};
	return { settings, recovered };
}

export class SkillSwitchboardSettingTab extends PluginSettingTab {
	plugin: SkillSwitchboardPlugin;

	constructor(app: App, plugin: SkillSwitchboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Re-renders the tab after a root or target entry is added or removed.
	 * Obsidian 1.13.0+ rebuilds from getSettingDefinitions() through update(),
	 * while older versions still go through the imperative display().
	 */
	private refreshTab(): void {
		if (requireApiVersion('1.13.0')) {
			this.update();
			return;
		}
		renderImperatively(this);
	}

	refreshAutomaticState(): void {
		if (this.containerEl?.isConnected) this.refreshTab();
	}

	/**
	 * Obsidian 1.13.0+ does not call display() when definitions are present.
	 * Register the dynamic editors as custom render rows as well as the simple
	 * controls, so neither the source nor the local path settings disappear.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const strings = getStrings(this.plugin.settings.language);
		return [
			{ name: strings.overview, desc: strings.overviewDescription },
			{
				name: strings.autoDistribute,
				desc: strings.autoDistributeDescription,
				control: { type: 'toggle', key: 'autoDistribute', defaultValue: false },
			},
			{
				name: strings.language,
				desc: strings.languageDescription,
				control: {
					type: 'dropdown',
					key: 'language',
					options: { en: strings.english, 'zh-CN': strings.chinese },
					defaultValue: DEFAULT_SETTINGS.language,
				},
			},
			{
				name: strings.autoCheck,
				desc: strings.autoCheckDescription,
				control: { type: 'toggle', key: 'autoCheck', defaultValue: DEFAULT_SETTINGS.autoCheck },
			},
			{
				name: strings.distributionBoard,
				desc: strings.distributionBoardDescription,
				control: { type: 'toggle', key: 'showDistributionBoard', defaultValue: DEFAULT_SETTINGS.showDistributionBoard },
			},
			{
				name: strings.scanAutomatically,
				desc: strings.scanAutomaticallyDescription,
				control: { type: 'toggle', key: 'autoScan', defaultValue: DEFAULT_SETTINGS.autoScan },
			},
			{
				name: strings.scanDelay,
				desc: strings.scanDelayDescription,
				// `number` persists a number and falls back to defaultValue when the
				// input cannot be parsed, so the stored value stays usable by setTimeout.
				// A typo falls back to 500 rather than 0, which keeps the debounce
				// meaningful instead of rescanning on every keystroke of a burst.
				control: {
					type: 'number',
					key: 'scanDelayMs',
					defaultValue: DEFAULT_SETTINGS.scanDelayMs,
					min: 0,
				},
			},
			{ name: strings.skillRoots, render: (setting) => this.renderSection(setting, (el) => this.renderRoots(el, strings)) },
			{ name: strings.syncSource, render: (setting) => this.renderSection(setting, (el) => this.renderSyncSource(el, strings)) },
			{ name: strings.externalPackages, render: (setting) => this.renderSection(setting, (el) => this.renderExternalPackages(el, strings)) },
			{ name: strings.runtimeTargets, render: (setting) => this.renderSection(setting, (el) => this.renderTargets(el, strings)) },
		];
	}

	/** Native controls must use the same persistence/invalidation path as old controls. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'autoDistribute') {
			await this.plugin.setAutoDistributionEnabled(value === true);
			this.refreshTab();
			return;
		}
		if (key === 'language') this.plugin.settings.language = value === 'zh-CN' ? 'zh-CN' : 'en';
		else if (key === 'autoCheck' || key === 'autoScan' || key === 'showDistributionBoard') {
			if (typeof value !== 'boolean') throw new Error('Expected a toggle value.');
			if (key === 'showDistributionBoard') { await this.plugin.setDistributionBoardVisible(value); return; }
			this.plugin.settings[key] = value;
		} else if (key === 'scanDelayMs') {
			this.plugin.settings.scanDelayMs = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_SETTINGS.scanDelayMs;
		} else throw new Error('Unsupported setting key.');
		await this.plugin.saveSettings();
		if (key === 'language') { this.refreshTab(); await this.plugin.refreshIndex(false); }
	}

	private renderSection(setting: Setting, render: (container: HTMLElement) => void): void {
		setting.settingEl.empty();
		setting.settingEl.removeClass('setting-item');
		setting.settingEl.addClass('skill-switchboard-settings-section');
		render(setting.settingEl);
	}

	/**
	 * Imperative fallback, still the only renderer on Obsidian older than 1.13.0
	 * and the home of the root and target list editors.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('skill-switchboard-settings');
		const strings = getStrings(this.plugin.settings.language);

		new Setting(containerEl).setName(strings.overview).setHeading();
		containerEl.createEl('p', {
			text: strings.overviewDescription,
			cls: 'skill-switchboard-muted',
		});
		new Setting(containerEl)
			.setName(strings.autoDistribute)
			.setDesc(strings.autoDistributeDescription)
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.autoDistribute).onChange(async (value) => {
				toggle.setValue(await this.plugin.setAutoDistributionEnabled(value));
			}));

		new Setting(containerEl)
			.setName(strings.language)
			.setDesc(strings.languageDescription)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('en', strings.english)
					.addOption('zh-CN', strings.chinese)
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value as Language;
						await this.plugin.saveSettings();
						this.refreshTab();
						await this.plugin.refreshIndex(false);
					}),
			);

		new Setting(containerEl)
			.setName(strings.distributionBoard)
			.setDesc(strings.distributionBoardDescription)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showDistributionBoard).onChange(async (value) => {
					await this.plugin.setDistributionBoardVisible(value);
				}),
			);

		new Setting(containerEl)
			.setName(strings.autoCheck)
			.setDesc(strings.autoCheckDescription)
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.autoCheck).onChange(async (value) => {
				this.plugin.settings.autoCheck = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName(strings.scanAutomatically)
			.setDesc(strings.scanAutomaticallyDescription)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoScan).onChange(async (value) => {
					this.plugin.settings.autoScan = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(strings.scanDelay)
			.setDesc(strings.scanDelayDescription)
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.scanDelayMs))
					.setPlaceholder('500')
					.onChange(async (value) => {
						const ms = Number.parseInt(value, 10);
						if (Number.isFinite(ms) && ms >= 0) {
							this.plugin.settings.scanDelayMs = ms;
							await this.plugin.saveSettings();
						}
					}),
			);

		this.renderRoots(containerEl, strings);
		this.renderSyncSource(containerEl, strings);
		this.renderExternalPackages(containerEl, strings);
		this.renderTargets(containerEl, strings);
	}

	private renderRoots(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		renderRootsSection(this.plugin, containerEl, strings, () => this.refreshTab());
	}

	private renderSyncSource(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		renderSyncSourceSection(this.plugin, containerEl, strings);
	}

	private renderExternalPackages(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		renderExternalPackagesSection(this.plugin, containerEl, strings);
	}

	private renderTargets(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		renderTargetsSection(this.plugin, containerEl, strings, () => this.refreshTab());
	}
}

/**
 * Calls display() on an Obsidian version that predates the declarative settings
 * API. The method is deprecated from 1.13.0 on, but it is the only renderer below
 * that version, so reaching it through a local type keeps this deliberate
 * fallback from reading as accidental use of a deprecated member.
 */
function renderImperatively(tab: PluginSettingTab): void {
	(tab as { display(): void }).display();
}
