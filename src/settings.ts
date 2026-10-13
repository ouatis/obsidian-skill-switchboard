import { App, PluginSettingTab, Setting } from 'obsidian';
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
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
						this.display();
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
					this.display();
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
				this.display();
			}),
		);
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
					this.display();
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
				this.display();
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
					this.display();
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
				this.display();
			}),
		);
	}
}
