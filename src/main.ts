import { Notice, Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SkillSwitchboardSettings,
	SkillSwitchboardSettingTab,
} from './settings';
import { SkillIndex, scanConfiguredRoots } from './scanner';
import { SkillSwitchboardView, VIEW_TYPE_SKILL_SWITCHBOARD } from './ui/view';
import { notifyWithCopy } from './ui/notice';
import { runRecord, writePluginStatus } from './status';
import { getStrings } from './i18n';
import { registerCommands } from './commands';
import type { AdapterCheckResult } from './sync/result';
import { createSyncProvider, ManifestCheckResult, SyncProvider } from './sync-provider';
import {
	AdapterRunContext,
	RepairTarget,
	checkAllTargets,
	desktopPathFailure,
	getRepairTargets,
	runRepairAll,
} from './sync/adapter-run';

export default class SkillSwitchboardPlugin extends Plugin {
	settings!: SkillSwitchboardSettings;
	index: SkillIndex = { skills: [], errors: [], scannedAt: 0 };
	adapterCheck: AdapterCheckResult | null = null;
	adapterCheckRunning = false;
	adapterRepair: AdapterCheckResult | null = null;
	adapterRepairRunning = false;
	manifestCheck: ManifestCheckResult | null = null;
	syncProvider: SyncProvider = createSyncProvider();

	async onload(): Promise<void> {
		await this.loadSettings();
		const strings = getStrings(this.settings.language);

		this.registerView(
			VIEW_TYPE_SKILL_SWITCHBOARD,
			(leaf) => new SkillSwitchboardView(leaf, this),
		);

		this.addRibbonIcon('waypoints', strings.openSwitchboard, () => {
			void this.activateView();
		});

		registerCommands(this);

		this.addSettingTab(new SkillSwitchboardSettingTab(this.app, this));

		await this.refreshIndex(false);
		void writePluginStatus(this);

		if (this.settings.autoScan && this.settings.scanIntervalMinutes > 0) {
			this.registerInterval(
				window.setInterval(
					() => void this.refreshIndex(false),
					this.settings.scanIntervalMinutes * 60 * 1000,
				),
			);
		}
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<SkillSwitchboardSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...data,
			roots: data?.roots ?? DEFAULT_SETTINGS.roots,
			targets: data?.targets ?? DEFAULT_SETTINGS.targets,
			harnesses: data?.harnesses ?? DEFAULT_SETTINGS.harnesses,
			language: data?.language === 'zh-CN' ? 'zh-CN' : DEFAULT_SETTINGS.language,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async refreshIndex(showNotice: boolean): Promise<void> {
		this.index = await scanConfiguredRoots(this.app, this.settings.roots);
		this.renderViews();
		if (showNotice) {
			new Notice(getStrings(this.settings.language).skillIndexRefreshed(this.index.skills.length));
		}
	}

	private adapterContext(): AdapterRunContext {
		return { provider: this.syncProvider, settings: this.settings };
	}

	async checkAdapters(): Promise<void> {
		if (this.adapterCheckRunning || this.adapterRepairRunning) return;
		this.adapterCheckRunning = true;
		this.adapterCheck = null;
		this.manifestCheck = null;
		this.renderViews();

		const strings = getStrings(this.settings.language);
		const basePath = this.getVaultBasePath();
		const run = basePath
			? await checkAllTargets(this.adapterContext(), basePath, strings.noRepairTargets)
			: null;
		const result = run?.result ?? desktopPathFailure();
		if (run) this.manifestCheck = run.manifest;
		this.adapterCheck = result;
		this.adapterCheckRunning = false;
		this.renderViews();

		notifyWithCopy(
			strings,
			result.status === 'passed'
				? strings.adapterCheckPassed
				: strings.adapterCheckFailed(result.exitCode),
			result.output,
		);
		await writePluginStatus(this, { lastCheck: runRecord(result.status, result.exitCode, result.output) });
	}

	/** Most recent adapter output: repair output wins because it also contains the follow-up checks. */
	latestCheckOutput(): string {
		return (this.adapterRepair?.output ?? this.adapterCheck?.output ?? '').trim();
	}

	getRepairTargets(): RepairTarget[] {
		return getRepairTargets(this.settings.targets);
	}

	async repairAllAdapters(): Promise<void> {
		if (this.adapterCheckRunning || this.adapterRepairRunning) return;
		const strings = getStrings(this.settings.language);
		const vaultPath = this.getVaultBasePath();
		if (!vaultPath) {
			const result = desktopPathFailure();
			this.adapterCheck = result;
			this.adapterRepair = result;
			this.renderViews();
			return;
		}

		this.adapterRepairRunning = true;
		this.adapterRepair = null;
		this.adapterCheck = null;
		this.manifestCheck = null;
		this.renderViews();

		const summary = await runRepairAll(this.adapterContext(), vaultPath, strings);
		this.manifestCheck = summary.manifest;
		this.adapterCheck = summary.checkResult;
		this.adapterRepair = summary.repair;

		// A manifest failure aborts before any repair attempt, so it is reported as-is.
		if (summary.aborted) {
			this.adapterRepairRunning = false;
			this.renderViews();
			notifyWithCopy(strings, strings.adapterCheckFailed(summary.repair.exitCode), summary.repair.output);
			return;
		}

		this.adapterRepairRunning = false;
		this.renderViews();
		notifyWithCopy(
			strings,
			summary.failedCount === 0
				? strings.repairAllPassed(summary.repairedCount)
				: strings.repairAllFailed(summary.failedCount),
			summary.repair.output,
		);
		await writePluginStatus(this, {
			lastRepair: runRecord(this.adapterRepair.status, this.adapterRepair.exitCode, this.adapterRepair.output),
		});
	}

	getVaultBasePath(): string | null {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		return adapter.getBasePath?.() ?? null;
	}

	private renderViews(): void {
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_SKILL_SWITCHBOARD)
			.forEach((leaf) => {
				const view = leaf.view;
				if (view instanceof SkillSwitchboardView) view.renderIndex();
			});
	}

	async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_SKILL_SWITCHBOARD,
		)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_SKILL_SWITCHBOARD, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}