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
import { confirmRepair } from './ui/confirm-modal';
import type { AdapterCheckResult } from './sync/result';
import { createSyncProvider, ManifestCheckResult, SyncProvider } from './sync-provider';
import {
	AdapterRunContext,
	RepairTarget,
	TargetActivity,
	TargetCheck,
	checkAllTargets,
	desktopPathFailure,
	getRepairTargets,
	runRepairAll,
} from './sync/adapter-run';
import { normalizeVaultPath } from './scanner';

/** Fallback wait when the setting holds an unusable value. */
const INDEX_DEBOUNCE_MS = 500;

export default class SkillSwitchboardPlugin extends Plugin {
	settings!: SkillSwitchboardSettings;
	index: SkillIndex = { skills: [], errors: [], scannedAt: 0 };
	/** True while a debounced rescan is pending, so a burst of events stays one scan. */
	private scanQueued = false;
	adapterCheck: AdapterCheckResult | null = null;
	adapterCheckRunning = false;
	adapterRepair: AdapterCheckResult | null = null;
	adapterRepairRunning = false;
	manifestCheck: ManifestCheckResult | null = null;
	targetChecks: TargetCheck[] = [];
	targetActivity: TargetActivity | null = null;
	targetCheckedAt = 0;
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

		if (this.settings.autoScan) {
			// A vault event beats a fixed interval: the index only needs rebuilding
			// when a file inside a configured root actually changed, and polling
			// would re-scan the vault every interval for nothing.
			this.registerEvent(
				this.app.vault.on('create', (file) => this.onVaultChanged(file.path)),
			);
			this.registerEvent(
				this.app.vault.on('modify', (file) => this.onVaultChanged(file.path)),
			);
			this.registerEvent(
				this.app.vault.on('delete', (file) => this.onVaultChanged(file.path)),
			);
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => this.onVaultChanged(file.path, oldPath)),
			);
		}
	}

	/**
	 * Re-scans when a changed file falls inside a configured vault root. The index
	 * is small, so the whole scan is repeated rather than patched in place.
	 */
	private onVaultChanged(...changedPaths: string[]): void {
		const normalizedRoots = this.settings.roots
			.filter((root) => root.enabled && root.kind === 'vault' && root.path.trim())
			.map((root) => normalizeVaultPath(root.path));
		if (normalizedRoots.length === 0) return;
		const relevant = changedPaths.some((path) =>
			normalizedRoots.some((root) => path === root || path.startsWith(`${root}/`)),
		);
		if (!relevant) return;
		if (this.scanQueued) return;
		this.scanQueued = true;
		// The `number` control keeps this a number, but data saved by an earlier
		// build used a text control, so the value is still coerced on read.
		const stored = Number(this.settings.scanDelayMs);
		const delay = Number.isFinite(stored) && stored >= 0 ? stored : INDEX_DEBOUNCE_MS;
		window.setTimeout(() => {
			this.scanQueued = false;
			if (!this.settings.autoScan) return;
			void this.refreshIndex(false);
		}, delay);
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
		// scanIntervalMinutes was the old polling interval; the debounce is in
		// milliseconds now, so a legacy value cannot be carried over as-is.
		if (this.settings.scanDelayMs === undefined) {
			this.settings.scanDelayMs = DEFAULT_SETTINGS.scanDelayMs;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async setDistributionBoardVisible(visible: boolean): Promise<void> {
		this.settings.showDistributionBoard = visible;
		await this.saveSettings();
		this.renderViews();
	}

	async refreshIndex(showNotice: boolean): Promise<void> {
		this.index = await scanConfiguredRoots(this.app, this.settings.roots);
		this.renderViews();
		if (showNotice) {
			new Notice(getStrings(this.settings.language).skillIndexRefreshed(this.index.skills.length));
		}
	}

	private adapterContext(): AdapterRunContext {
		return {
			provider: this.syncProvider,
			settings: this.settings,
			onTargetActivity: (activity) => {
				this.targetActivity = activity;
				this.updateDistributionViews();
			},
			onTargetCheck: (check) => {
				this.targetChecks = [...this.targetChecks.filter((item) => item.target.id !== check.target.id), check];
				this.targetActivity = null;
				this.updateDistributionViews();
			},
		};
	}

	async checkAdapters(): Promise<void> {
		if (this.adapterCheckRunning || this.adapterRepairRunning) return;
		this.adapterCheckRunning = true;
		this.adapterCheck = null;
		this.manifestCheck = null;
		this.targetChecks = [];
		this.targetActivity = null;
		this.targetCheckedAt = 0;
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
		this.targetActivity = null;
		this.targetCheckedAt = Date.now();
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

		// Repair writes outside the vault, so it is gated behind an explicit confirm.
		const confirmed = await confirmRepair(this.app, strings, strings.repairConfirmMessage);
		if (!confirmed) return;

		this.adapterRepairRunning = true;
		this.adapterRepair = null;
		this.adapterCheck = null;
		this.manifestCheck = null;
		this.targetChecks = [];
		this.targetActivity = null;
		this.targetCheckedAt = 0;
		this.renderViews();

		const summary = await runRepairAll(this.adapterContext(), vaultPath, strings);
		this.manifestCheck = summary.manifest;
		this.adapterCheck = summary.checkResult;
		this.adapterRepair = summary.repair;
		this.targetActivity = null;
		this.targetCheckedAt = Date.now();

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

	private updateDistributionViews(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_SKILL_SWITCHBOARD).forEach((leaf) => {
			if (leaf.view instanceof SkillSwitchboardView) leaf.view.updateDistributionBoard();
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
