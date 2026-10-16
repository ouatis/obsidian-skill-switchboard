import { App, PluginSettingTab, Setting, requireApiVersion } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type SkillSwitchboardPlugin from './main';
import { getStrings, Language } from './i18n';
import { HarnessDefinition, RuntimeTarget, SkillRoot } from './types';
import {
	renderExternalPackagesSection,
	renderHarnessesSection,
	renderRootsSection,
	renderSyncSourceSection,
	renderTargetsSection,
} from './settings/sections';

export interface SkillSwitchboardSettings {
	roots: SkillRoot[];
	targets: RuntimeTarget[];
	harnesses: HarnessDefinition[];
	language: Language;
	autoScan: boolean;
	scanDelayMs: number;
	showDistributionBoard: boolean;
	syncRootId: string;
	syncManifestPath: string;
	autoCheck: boolean;
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
	harnesses: [],
	language: 'en',
	autoScan: false,
	scanDelayMs: 500,
	showDistributionBoard: true,
	syncRootId: 'vault-skills',
	syncManifestPath: '',
	autoCheck: true,
};

export class SkillSwitchboardSettingTab extends PluginSettingTab {
	plugin: SkillSwitchboardPlugin;

	constructor(app: App, plugin: SkillSwitchboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Re-renders the tab after a root, target or harness entry is added or removed.
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
			{ name: strings.harnesses, render: (setting) => this.renderSection(setting, (el) => this.renderHarnesses(el, strings)) },
		];
	}

	/** Native controls must use the same persistence/invalidation path as old controls. */
	async setControlValue(key: string, value: unknown): Promise<void> {
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
	 * and the home of the root, target and harness list editors.
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
		this.renderHarnesses(containerEl, strings);
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

	private renderHarnesses(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		renderHarnessesSection(this.plugin, containerEl, strings, () => this.refreshTab());
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
