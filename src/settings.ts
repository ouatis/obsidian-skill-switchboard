import { App, Notice, PluginSettingTab, Setting, requireApiVersion } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type SkillSwitchboardPlugin from './main';
import { getStrings, Language } from './i18n';
import { HarnessDefinition, RuntimeTarget, SkillRoot, SyncMode } from './types';

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

function newId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}`;
}

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
		new Setting(containerEl).setName(strings.skillRoots).setHeading();
		containerEl.createEl('p', {
			text: strings.skillRootsDescription,
			cls: 'skill-switchboard-muted',
		});

		this.plugin.settings.roots.forEach((root) => {
			const setting = new Setting(containerEl).setName(root.label || strings.unnamedRoot);
			setting.addText((text) =>
				text.setValue(root.label).setPlaceholder(strings.label).onChange(async (value) => {
					root.label = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addDropdown((dropdown) =>
				dropdown
					.addOption('vault', strings.vaultRelative)
					.addOption('external', strings.externalDesktopFolder)
					.setValue(root.kind)
					.onChange(async (value) => {
						root.kind = value as SkillRoot['kind'];
						await this.plugin.saveSettings();
					}),
			);
			setting.addText((text) =>
				text.setValue(root.path).setPlaceholder(strings.path).onChange(async (value) => {
					root.path = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addToggle((toggle) =>
				toggle.setValue(root.enabled).setTooltip(strings.enabled).onChange(async (value) => {
					root.enabled = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addButton((button) =>
				button.setButtonText(strings.remove).onClick(async () => {
					this.plugin.settings.roots = this.plugin.settings.roots.filter(
						(candidate) => candidate.id !== root.id,
					);
					await this.plugin.saveSettings();
				this.refreshTab();
				}),
			);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText(strings.addSkillRoot).setCta().onClick(async () => {
				this.plugin.settings.roots.push({
					id: newId('root'),
					label: strings.newRoot,
					path: '',
					kind: 'external',
					enabled: true,
				});
				await this.plugin.saveSettings();
				this.refreshTab();
			}),
		);
	}

	private renderSyncSource(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		new Setting(containerEl).setName(strings.syncSource).setHeading();
		new Setting(containerEl).setName(strings.canonicalRoot).setDesc(strings.canonicalRootDescription)
			.addDropdown((dropdown) => {
				dropdown.addOption('', strings.chooseSource);
				for (const root of this.plugin.settings.roots.filter((item) => item.enabled)) dropdown.addOption(root.id, root.label || root.path);
				dropdown.setValue(this.plugin.settings.syncRootId).onChange(async (value) => {
					this.plugin.settings.syncRootId = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl).setName(strings.syncManifest).setDesc(strings.syncManifestDescription)
			.addText((text) => text.setValue(this.plugin.settings.syncManifestPath).setPlaceholder(strings.syncManifestAuto)
				.onChange(async (value) => { this.plugin.settings.syncManifestPath = value; await this.plugin.saveSettings(); }));
	}

	private renderExternalPackages(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		new Setting(containerEl).setName(strings.externalPackages).setHeading();
		containerEl.createEl('p', { text: strings.externalPackagesDescription, cls: 'skill-switchboard-muted' });
		containerEl.createDiv({ text: this.plugin.packageRegistryPath, cls: 'skill-switchboard-path' });
		const panel = containerEl.createDiv();
		void this.plugin.reloadLocalPackagePaths().then(() => {
			if (!panel.isConnected) return;
			if (this.plugin.localPackagePathsError) panel.createDiv({ text: this.plugin.localPackagePathsError, cls: 'skill-switchboard-muted' });
			const ids = [...new Set(this.plugin.index.skills.map((skill) => skill.frontmatter.package_id).filter((id): id is string => Boolean(id)))];
			if (!ids.length) panel.createDiv({ text: strings.externalPackagesEmpty, cls: 'skill-switchboard-muted' });
			for (const id of ids) {
				let directory = this.plugin.localPackagePaths[id] ?? '';
				new Setting(panel).setName(id).setDesc(strings.externalPackagePath)
					.addText((text) => text.setValue(directory).setPlaceholder('~/tools/toolkit').onChange((value) => { directory = value; }))
					.addButton((button) => button.setButtonText(strings.saveLocalPath).onClick(async () => {
						button.setDisabled(true);
						try { await this.plugin.saveExternalPackagePath(id, directory); new Notice(strings.localPathSaved); }
						catch (error) { new Notice(`${strings.localPathSaveFailed}: ${error instanceof Error ? error.message : String(error)}`); }
						finally { button.setDisabled(false); }
					}));
			}
		});
	}

	private renderTargets(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		new Setting(containerEl).setName(strings.runtimeTargets).setHeading();
		containerEl.createEl('p', {
			text: strings.runtimeTargetsDescription,
			cls: 'skill-switchboard-muted',
		});

		this.plugin.settings.targets.forEach((target) => {
			const setting = new Setting(containerEl).setName(target.label || strings.unnamedTarget);
			setting.addText((text) =>
				text.setValue(target.label).setPlaceholder(strings.label).onChange(async (value) => {
					target.label = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addText((text) =>
				text.setValue(target.path).setPlaceholder(strings.targetPath).onChange(async (value) => {
					target.path = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addDropdown((dropdown) =>
				dropdown
					.addOption('copy', strings.copy)
					.addOption('symlink', strings.symlink)
					.addOption('wrapper', strings.wrapper)
					.setValue(target.mode)
					.onChange(async (value) => {
						target.mode = value as SyncMode;
						await this.plugin.saveSettings();
					}),
			);
			setting.addDropdown((dropdown) => {
				dropdown.addOption('', strings.chooseAgent);
				for (const runtime of ['codex', 'hermes', 'workbuddy', 'opencode', 'antigravity', 'dsh'] as const) dropdown.addOption(runtime, runtime);
				dropdown.setValue(target.runtime ?? '').onChange(async (value) => {
					target.runtime = value ? value as RuntimeTarget['runtime'] : undefined;
					await this.plugin.saveSettings();
				});
			});
			setting.addToggle((toggle) =>
				toggle.setValue(target.enabled).setTooltip(strings.enabled).onChange(async (value) => {
					target.enabled = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addButton((button) =>
				button.setButtonText(strings.remove).onClick(async () => {
					this.plugin.settings.targets = this.plugin.settings.targets.filter(
						(candidate) => candidate.id !== target.id,
					);
					await this.plugin.saveSettings();
				this.refreshTab();
				}),
			);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText(strings.addRuntimeTarget).onClick(async () => {
				this.plugin.settings.targets.push({
					id: newId('target'),
					label: strings.newTarget,
					path: '',
					mode: 'wrapper',
					enabled: true,
				});
				await this.plugin.saveSettings();
				this.refreshTab();
			}),
		);
	}

	private renderHarnesses(containerEl: HTMLElement, strings: ReturnType<typeof getStrings>): void {
		new Setting(containerEl).setName(strings.harnesses).setHeading();
		containerEl.createEl('p', {
			text: strings.harnessesDescription,
			cls: 'skill-switchboard-muted',
		});

		this.plugin.settings.harnesses.forEach((harness) => {
			const setting = new Setting(containerEl).setName(harness.label || strings.unnamedHarness);
			setting.addText((text) =>
				text.setValue(harness.label).setPlaceholder(strings.label).onChange(async (value) => {
					harness.label = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addText((text) =>
				text.setValue(harness.command).setPlaceholder(strings.commandTemplate).onChange(async (value) => {
					harness.command = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addToggle((toggle) =>
				toggle.setValue(harness.enabled).setTooltip(strings.enabled).onChange(async (value) => {
					harness.enabled = value;
					await this.plugin.saveSettings();
				}),
			);
			setting.addButton((button) =>
				button.setButtonText(strings.remove).onClick(async () => {
					this.plugin.settings.harnesses = this.plugin.settings.harnesses.filter(
						(candidate) => candidate.id !== harness.id,
					);
					await this.plugin.saveSettings();
				this.refreshTab();
				}),
			);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText(strings.addHarness).onClick(async () => {
				this.plugin.settings.harnesses.push({
					id: newId('harness'),
					label: strings.newHarness,
					command: '',
					enabled: true,
				});
				await this.plugin.saveSettings();
				this.refreshTab();
			}),
		);
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
