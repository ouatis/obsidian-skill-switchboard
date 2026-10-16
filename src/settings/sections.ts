import { Notice, Setting } from 'obsidian';
import type SkillSwitchboardPlugin from '../main';
import type { Strings } from '../i18n';
import type { RuntimeTarget, SkillRoot, SyncMode } from '../types';

function newId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}`;
}

export function renderRootsSection(
	plugin: SkillSwitchboardPlugin,
	containerEl: HTMLElement,
	strings: Strings,
	refreshTab: () => void,
): void {
	new Setting(containerEl).setName(strings.skillRoots).setHeading();
	containerEl.createEl('p', {
		text: strings.skillRootsDescription,
		cls: 'skill-switchboard-muted',
	});

	plugin.settings.roots.forEach((root) => {
		const setting = new Setting(containerEl).setName(root.label || strings.unnamedRoot);
		setting.addText((text) =>
			text.setValue(root.label).setPlaceholder(strings.label).onChange(async (value) => {
				root.label = value;
				await plugin.saveSettings();
			}),
		);
		setting.addDropdown((dropdown) =>
			dropdown
				.addOption('vault', strings.vaultRelative)
				.addOption('external', strings.externalDesktopFolder)
				.setValue(root.kind)
				.onChange(async (value) => {
					root.kind = value as SkillRoot['kind'];
					await plugin.saveSettings();
				}),
		);
		setting.addText((text) =>
			text.setValue(root.path).setPlaceholder(strings.path).onChange(async (value) => {
				root.path = value;
				await plugin.saveSettings();
			}),
		);
		setting.addToggle((toggle) =>
			toggle.setValue(root.enabled).setTooltip(strings.enabled).onChange(async (value) => {
				root.enabled = value;
				await plugin.saveSettings();
			}),
		);
		setting.addButton((button) =>
			button.setButtonText(strings.remove).onClick(async () => {
				plugin.settings.roots = plugin.settings.roots.filter((candidate) => candidate.id !== root.id);
				await plugin.saveSettings();
				refreshTab();
			}),
		);
	});

	new Setting(containerEl).addButton((button) =>
		button.setButtonText(strings.addSkillRoot).setCta().onClick(async () => {
			plugin.settings.roots.push({
				id: newId('root'),
				label: strings.newRoot,
				path: '',
				kind: 'external',
				enabled: true,
			});
			await plugin.saveSettings();
			refreshTab();
		}),
	);
}

export function renderSyncSourceSection(plugin: SkillSwitchboardPlugin, containerEl: HTMLElement, strings: Strings): void {
	new Setting(containerEl).setName(strings.syncSource).setHeading();
	new Setting(containerEl).setName(strings.canonicalRoot).setDesc(strings.canonicalRootDescription)
		.addDropdown((dropdown) => {
			dropdown.addOption('', strings.chooseSource);
			for (const root of plugin.settings.roots.filter((item) => item.enabled)) dropdown.addOption(root.id, root.label || root.path);
			dropdown.setValue(plugin.settings.syncRootId).onChange(async (value) => {
				plugin.settings.syncRootId = value;
				await plugin.saveSettings();
			});
		});
	new Setting(containerEl).setName(strings.syncManifest).setDesc(strings.syncManifestDescription)
		.addText((text) => text.setValue(plugin.settings.syncManifestPath).setPlaceholder(strings.syncManifestAuto)
			.onChange(async (value) => { plugin.settings.syncManifestPath = value; await plugin.saveSettings(); }));
}

export function renderExternalPackagesSection(plugin: SkillSwitchboardPlugin, containerEl: HTMLElement, strings: Strings): void {
	new Setting(containerEl).setName(strings.externalPackages).setHeading();
	containerEl.createEl('p', { text: strings.externalPackagesDescription, cls: 'skill-switchboard-muted' });
	containerEl.createDiv({ text: plugin.packageRegistryPath, cls: 'skill-switchboard-path' });
	const panel = containerEl.createDiv();
	void plugin.reloadLocalPackagePaths().then(() => {
		if (!panel.isConnected) return;
		if (plugin.localPackagePathsError) panel.createDiv({ text: plugin.localPackagePathsError, cls: 'skill-switchboard-muted' });
		const ids = [...new Set(plugin.index.skills.map((skill) => skill.frontmatter.package_id).filter((id): id is string => Boolean(id)))];
		if (!ids.length) panel.createDiv({ text: strings.externalPackagesEmpty, cls: 'skill-switchboard-muted' });
		for (const id of ids) {
			let directory = plugin.localPackagePaths[id] ?? '';
			new Setting(panel).setName(id).setDesc(strings.externalPackagePath)
				.addText((text) => text.setValue(directory).setPlaceholder('~/tools/toolkit').onChange((value) => { directory = value; }))
				.addButton((button) => button.setButtonText(strings.saveLocalPath).onClick(async () => {
					button.setDisabled(true);
					try { await plugin.saveExternalPackagePath(id, directory); new Notice(strings.localPathSaved); }
					catch (error) { new Notice(`${strings.localPathSaveFailed}: ${error instanceof Error ? error.message : String(error)}`); }
					finally { button.setDisabled(false); }
				}));
		}
	});
}

export function renderTargetsSection(
	plugin: SkillSwitchboardPlugin,
	containerEl: HTMLElement,
	strings: Strings,
	refreshTab: () => void,
): void {
	new Setting(containerEl).setName(strings.runtimeTargets).setHeading();
	containerEl.createEl('p', {
		text: strings.runtimeTargetsDescription,
		cls: 'skill-switchboard-muted',
	});

	plugin.settings.targets.forEach((target) => {
		const setting = new Setting(containerEl).setName(target.label || strings.unnamedTarget);
		setting.addText((text) =>
			text.setValue(target.label).setPlaceholder(strings.label).onChange(async (value) => {
				target.label = value;
				await plugin.saveSettings();
			}),
		);
		setting.addText((text) =>
			text.setValue(target.path).setPlaceholder(strings.targetPath).onChange(async (value) => {
				target.path = value;
				await plugin.saveSettings();
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
					await plugin.saveSettings();
				}),
		);
		setting.addDropdown((dropdown) => {
			dropdown.addOption('', strings.chooseAgent);
			for (const runtime of ['codex', 'hermes', 'workbuddy', 'opencode', 'antigravity', 'dsh'] as const) dropdown.addOption(runtime, runtime);
			dropdown.setValue(target.runtime ?? '').onChange(async (value) => {
				target.runtime = value ? value as RuntimeTarget['runtime'] : undefined;
				await plugin.saveSettings();
			});
		});
		setting.addToggle((toggle) =>
			toggle.setValue(target.enabled).setTooltip(strings.enabled).onChange(async (value) => {
				target.enabled = value;
				await plugin.saveSettings();
			}),
		);
		setting.addButton((button) =>
			button.setButtonText(strings.remove).onClick(async () => {
				plugin.settings.targets = plugin.settings.targets.filter((candidate) => candidate.id !== target.id);
				await plugin.saveSettings();
				refreshTab();
			}),
		);
	});

	new Setting(containerEl).addButton((button) =>
		button.setButtonText(strings.addRuntimeTarget).onClick(async () => {
			plugin.settings.targets.push({
				id: newId('target'),
				label: strings.newTarget,
				path: '',
				mode: 'wrapper',
				enabled: true,
			});
			await plugin.saveSettings();
			refreshTab();
		}),
	);
}

export function renderHarnessesSection(
	plugin: SkillSwitchboardPlugin,
	containerEl: HTMLElement,
	strings: Strings,
	refreshTab: () => void,
): void {
	new Setting(containerEl).setName(strings.harnesses).setHeading();
	containerEl.createEl('p', {
		text: strings.harnessesDescription,
		cls: 'skill-switchboard-muted',
	});

	plugin.settings.harnesses.forEach((harness) => {
		const setting = new Setting(containerEl).setName(harness.label || strings.unnamedHarness);
		setting.addText((text) =>
			text.setValue(harness.label).setPlaceholder(strings.label).onChange(async (value) => {
				harness.label = value;
				await plugin.saveSettings();
			}),
		);
		setting.addText((text) =>
			text.setValue(harness.command).setPlaceholder(strings.commandTemplate).onChange(async (value) => {
				harness.command = value;
				await plugin.saveSettings();
			}),
		);
		setting.addToggle((toggle) =>
			toggle.setValue(harness.enabled).setTooltip(strings.enabled).onChange(async (value) => {
				harness.enabled = value;
				await plugin.saveSettings();
			}),
		);
		setting.addButton((button) =>
			button.setButtonText(strings.remove).onClick(async () => {
				plugin.settings.harnesses = plugin.settings.harnesses.filter((candidate) => candidate.id !== harness.id);
				await plugin.saveSettings();
				refreshTab();
			}),
		);
	});

	new Setting(containerEl).addButton((button) =>
		button.setButtonText(strings.addHarness).onClick(async () => {
			plugin.settings.harnesses.push({
				id: newId('harness'),
				label: strings.newHarness,
				command: '',
				enabled: true,
			});
			await plugin.saveSettings();
			refreshTab();
		}),
	);
}
