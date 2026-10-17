import { Notice, Plugin } from 'obsidian';
import {
	normalizeSettings,
	SkillSwitchboardSettings,
	SkillSwitchboardSettingTab,
} from './settings';
import { SkillIndex, scanConfiguredRoots } from './scanner';
import { SkillSwitchboardView, VIEW_TYPE_SKILL_SWITCHBOARD } from './ui/view';
import { notifyWithCopy } from './ui/notice';
import { checkState, runRecord, writePluginStatus } from './status';
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
	type RepairSummary,
} from './sync/adapter-run';
import { CheckFreshness } from './sync/freshness';
import { resolveSyncSource, settingsCheckKey } from './sync/source';
import { getVaultChangeImpact } from './sync/vault-change-impact';
import { localPackageRegistryPath, readLocalPackagePaths, resolveLocalPackagePath, saveLocalPackagePath } from './sync/package-paths';
import { existingRealPath } from './sync/filesystem';
import { isInside } from './sync/manifest';

/** Fallback wait when the setting holds an unusable value. */
const INDEX_DEBOUNCE_MS = 500;

export default class SkillSwitchboardPlugin extends Plugin {
	settings!: SkillSwitchboardSettings;
	index: SkillIndex = { skills: [], errors: [], scannedAt: 0 };
	/** Trailing debounce for vault changes; cleared on refresh and unload. */
	private scanTimer: number | null = null;
	adapterCheck: AdapterCheckResult | null = null;
	adapterCheckRunning = false;
	adapterRepair: AdapterCheckResult | null = null;
	adapterRepairRunning = false;
	manifestCheck: ManifestCheckResult | null = null;
	targetChecks: TargetCheck[] = [];
	targetActivity: TargetActivity | null = null;
	targetCheckedAt = 0;
	syncProvider: SyncProvider = createSyncProvider();
	lastRepairSummary: RepairSummary | null = null;
	private readonly freshness = new CheckFreshness();
	private checkTimer: number | null = null;
	private rootRefreshTimer: number | null = null;
	private rootsRefreshPending = false;
	private disposed = false;
	private indexKey = '';
	private rootsKey = '';
	private indexRevision = 0;
	private configurationKey = '';
	private latestOutput = '';
	localPackagePaths: Record<string, string> = {};
	localPackagePathsError = '';
	get packageRegistryPath(): string { return localPackageRegistryPath(); }
	get checksStale(): boolean { return this.freshness.stale; }

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.reloadLocalPackagePaths();
		this.syncProvider = createSyncProvider((vaultPath) => ({ ...resolveSyncSource(vaultPath, this.settings), packageRegistryPath: this.packageRegistryPath }));
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

		this.app.workspace.onLayoutReady(() => {
			if (this.disposed) return;
			void writePluginStatus(this, {
				currentCheck: checkState('stale', 'Plugin loaded; waiting for a fresh read-only check.'),
			});
			// Obsidian emits create events while loading the vault. Subscribe only
			// after that pass, then scan the complete file list once.
			this.registerVaultChangeEvents();
			void this.refreshIndex(false).then(() => {
				if (this.disposed) return;
				void writePluginStatus(this);
				this.scheduleBackgroundCheck();
			});
		});
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf?.view.getViewType() === VIEW_TYPE_SKILL_SWITCHBOARD) this.scheduleBackgroundCheck();
		}));
		this.registerInterval(window.setInterval(() => this.scheduleBackgroundCheck(), 5 * 60 * 1000));
	}

	onunload(): void {
		this.disposed = true;
		this.freshness.invalidate();
		this.indexRevision++;
		if (this.checkTimer !== null) window.clearTimeout(this.checkTimer);
		this.clearQueuedScan();
		this.clearRootRefresh();
		if (this.adapterCheckRunning) {
			void writePluginStatus(this, {
				currentCheck: checkState('stale', 'Plugin unloaded before the read-only check finished.'),
			});
		}
	}

	private invalidateChecks(reason = 'Source, settings, or indexed skills changed; run a fresh read-only check.'): void {
		this.freshness.invalidate();
		this.latestOutput = '';
		this.adapterCheck = null;
		this.manifestCheck = null;
		this.targetChecks = [];
		this.targetActivity = null;
		void writePluginStatus(this, { currentCheck: checkState('stale', reason) });
		this.renderViews();
	}

	private scheduleBackgroundCheck(): void {
		if (!this.app.workspace.layoutReady || this.disposed || !this.settings.autoCheck || this.adapterCheckRunning || this.adapterRepairRunning) return;
		if (this.checkTimer !== null) window.clearTimeout(this.checkTimer);
		const delay = Number.isFinite(this.settings.scanDelayMs) ? Math.max(0, this.settings.scanDelayMs) : INDEX_DEBOUNCE_MS;
		this.checkTimer = window.setTimeout(() => {
			this.checkTimer = null;
			if (!this.disposed && this.settings.autoCheck) void this.checkAdapters(false);
		}, delay);
	}

	private registerVaultChangeEvents(): void {
		// A vault event beats a fixed interval: the index only needs rebuilding
		// when a file inside a configured root actually changed.
		this.registerEvent(this.app.vault.on('create', (file) => this.onVaultChanged(file.path)));
		this.registerEvent(this.app.vault.on('modify', (file) => this.onVaultChanged(file.path)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.onVaultChanged(file.path)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onVaultChanged(file.path, oldPath)));
	}

	/**
	 * Re-scans when a changed file falls inside a configured vault root. The index
	 * is small, so the whole scan is repeated rather than patched in place.
	 */
	private onVaultChanged(...changedPaths: string[]): void {
		const impact = getVaultChangeImpact(changedPaths, this.settings, this.getVaultBasePath());
		if (impact.affectsChecks) { this.invalidateChecks(); this.scheduleBackgroundCheck(); }
		if (!impact.affectsIndex) return;
		if (!this.settings.autoScan) { this.clearQueuedScan(); return; }
		this.clearQueuedScan();
		// The `number` control keeps this a number, but data saved by an earlier
		// build used a text control, so the value is still coerced on read.
		const stored = Number(this.settings.scanDelayMs);
		const delay = Number.isFinite(stored) && stored >= 0 ? stored : INDEX_DEBOUNCE_MS;
		this.scanTimer = window.setTimeout(() => {
			this.scanTimer = null;
			if (this.disposed || !this.settings.autoScan) return;
			void this.refreshIndex(false);
		}, delay);
	}

	private clearQueuedScan(): void {
		if (this.scanTimer !== null) window.clearTimeout(this.scanTimer);
		this.scanTimer = null;
	}

	private clearRootRefresh(): void {
		if (this.rootRefreshTimer !== null) window.clearTimeout(this.rootRefreshTimer);
		this.rootRefreshTimer = null;
	}

	private scheduleRootRefresh(): void {
		if (!this.rootsRefreshPending) return;
		if (this.settings.autoCheck && !this.adapterCheckRunning && !this.adapterRepairRunning) {
			this.clearRootRefresh();
			return;
		}
		this.clearRootRefresh();
		const stored = Number(this.settings.scanDelayMs);
		const delay = Number.isFinite(stored) && stored >= 0 ? stored : INDEX_DEBOUNCE_MS;
		this.rootRefreshTimer = window.setTimeout(() => {
			this.rootRefreshTimer = null;
			if (this.disposed) return;
			if (this.adapterRepairRunning) { this.scheduleRootRefresh(); return; }
			void this.refreshIndex(false);
		}, delay);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.configurationKey = settingsCheckKey(this.settings);
		this.rootsKey = JSON.stringify(this.settings.roots);
	}

	async saveSettings(): Promise<void> {
		if (!this.settings.autoScan) this.clearQueuedScan();
		const rootsKey = JSON.stringify(this.settings.roots);
		if (rootsKey !== this.rootsKey) {
			this.rootsKey = rootsKey;
			this.rootsRefreshPending = true;
			this.indexRevision++;
		}
		const key = settingsCheckKey(this.settings);
		if (key !== this.configurationKey) { this.configurationKey = key; this.invalidateChecks(); }
		await this.saveData(this.settings);
		this.scheduleRootRefresh();
		this.scheduleBackgroundCheck();
	}

	async reloadLocalPackagePaths(): Promise<void> {
		try { this.localPackagePaths = await readLocalPackagePaths(this.packageRegistryPath); this.localPackagePathsError = ''; }
		catch (error) { this.localPackagePaths = {}; this.localPackagePathsError = error instanceof Error ? error.message : String(error); }
	}

	async saveExternalPackagePath(id: string, directory: string): Promise<void> {
		if (!this.index.skills.some((skill) => skill.frontmatter.package_id === id)) throw new Error('Package is not declared by an indexed skill.');
		const vaultPath = this.getVaultBasePath();
		if (directory.trim() && vaultPath) {
			const source = resolveSyncSource(vaultPath, this.settings).sharedRoot;
			const [realVault, realSource, realDirectory] = await Promise.all([
				existingRealPath(vaultPath),
				existingRealPath(source),
				existingRealPath(resolveLocalPackagePath(directory)),
			]);
			if (isInside(realVault, realDirectory) || isInside(realSource, realDirectory)) {
				throw new Error('External tool packages must stay outside the vault and canonical source.');
			}
		}
		this.localPackagePaths = await saveLocalPackagePath(id, directory, this.packageRegistryPath);
		this.localPackagePathsError = '';
		this.invalidateChecks();
		this.scheduleBackgroundCheck();
	}

	async onExternalSettingsChange(): Promise<void> {
		const previous = this.configurationKey;
		const previousRoots = this.rootsKey;
		await this.loadSettings();
		if (previousRoots !== this.rootsKey) {
			this.rootsRefreshPending = true;
			this.indexRevision++;
		}
		if (!this.settings.autoScan) this.clearQueuedScan();
		if (previous !== this.configurationKey) this.invalidateChecks();
		this.scheduleRootRefresh();
		this.renderViews();
		this.scheduleBackgroundCheck();
	}

	async setDistributionBoardVisible(visible: boolean): Promise<void> {
		this.settings.showDistributionBoard = visible;
		await this.saveSettings();
		this.renderViews();
	}

	async refreshIndex(showNotice: boolean): Promise<void> {
		// A foreground or check-triggered refresh satisfies any queued scan.
		this.clearQueuedScan();
		this.clearRootRefresh();
		this.rootsRefreshPending = false;
		const revision = ++this.indexRevision;
		const roots = this.settings.roots.map((root) => ({ ...root }));
		const index = await scanConfiguredRoots(this.app, roots);
		if (this.disposed || revision !== this.indexRevision) return;
		this.index = index;
		const key = JSON.stringify(this.index.skills.map((skill) => [skill.id, skill.sha256]));
		if (this.indexKey && this.indexKey !== key) { this.invalidateChecks(); this.scheduleBackgroundCheck(); }
		this.indexKey = key;
		this.renderViews();
		if (showNotice) {
			new Notice(getStrings(this.settings.language).skillIndexRefreshed(this.index.skills.length));
		}
	}

	private adapterContext(revision: number): AdapterRunContext {
		return {
			provider: this.syncProvider,
			settings: { targets: this.settings.targets.map((target) => ({ ...target })) },
			isCurrent: () => !this.disposed && this.freshness.isCurrent(revision),
			onTargetActivity: (activity) => {
				if (this.disposed || !this.freshness.isCurrent(revision)) return;
				this.targetActivity = activity;
				this.updateDistributionViews();
			},
			onTargetCheck: (check) => {
				if (this.disposed || !this.freshness.isCurrent(revision)) return;
				this.targetChecks = [...this.targetChecks.filter((item) => item.target.id !== check.target.id), check];
				this.targetActivity = null;
				this.updateDistributionViews();
			},
		};
	}

	async checkAdapters(showNotice = true): Promise<void> {
		if (this.adapterCheckRunning || this.adapterRepairRunning) return;
		if (this.checkTimer !== null) { window.clearTimeout(this.checkTimer); this.checkTimer = null; }
		this.adapterCheckRunning = true;
		this.invalidateChecks('A new read-only check was requested; the previous result is no longer current.');
		this.renderViews();

		const strings = getStrings(this.settings.language);
		const basePath = this.getVaultBasePath();
		let revision = this.freshness.capture();
		try {
			await this.refreshIndex(false);
			revision = this.freshness.capture();
			if (!this.disposed && this.freshness.isCurrent(revision)) {
				await writePluginStatus(this, { currentCheck: checkState('running') });
			}
			const run = basePath ? await checkAllTargets(this.adapterContext(revision), basePath, strings.noRepairTargets) : null;
			const result = run?.result ?? desktopPathFailure();
			if (!this.disposed && this.freshness.accept(revision)) {
				if (run) { this.manifestCheck = run.manifest; this.targetChecks = run.checks; }
				this.adapterCheck = result;
				this.latestOutput = result.output;
				this.targetCheckedAt = Date.now();
				if (showNotice) notifyWithCopy(strings, result.status === 'passed' ? strings.adapterCheckPassed : strings.adapterCheckFailed(result.exitCode), result.output);
				await writePluginStatus(this, {
					lastCheck: runRecord(result.status, result.exitCode, result.output),
					currentCheck: checkState(result.status),
				});
			}
		} catch (error) {
			if (!this.disposed && this.freshness.accept(revision)) {
				const output = error instanceof Error ? error.message : String(error);
				this.adapterCheck = { status: 'failed', exitCode: 1, output };
				this.latestOutput = output;
				this.targetCheckedAt = Date.now();
				await writePluginStatus(this, {
					lastCheck: runRecord('failed', 1, output),
					currentCheck: checkState('failed'),
				});
			}
		} finally {
			this.adapterCheckRunning = false;
			this.targetActivity = null;
			if (!this.disposed) { this.renderViews(); if (this.checksStale) this.scheduleBackgroundCheck(); }
		}
	}

	/** Do not copy a historical success as the current diagnosis. */
	latestCheckOutput(): string {
		if (this.checksStale) return getStrings(this.settings.language).checksStale;
		return (this.latestOutput || this.adapterCheck?.output || this.adapterRepair?.output || '').trim();
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

		// Pause automatic checks while confirmation is open; never overlap a read run and repair.
		this.adapterRepairRunning = true;
		this.renderViews();
		let confirmed: boolean;
		try {
			confirmed = await confirmRepair(this.app, strings, strings.repairConfirmMessage);
		} catch (error) {
			const output = error instanceof Error ? error.message : String(error);
			this.adapterRepair = { status: 'failed', exitCode: 1, output };
			this.latestOutput = output;
			this.adapterRepairRunning = false;
			await writePluginStatus(this, { lastRepair: runRecord('failed', 1, output) });
			this.renderViews();
			notifyWithCopy(strings, strings.repairAllFailed(1), output);
			if (this.checksStale) this.scheduleBackgroundCheck();
			return;
		}
		if (!confirmed) { this.adapterRepairRunning = false; this.renderViews(); if (this.checksStale) this.scheduleBackgroundCheck(); return; }
		if (this.checkTimer !== null) { window.clearTimeout(this.checkTimer); this.checkTimer = null; }

		this.adapterRepairRunning = true;
		this.adapterRepair = null;
		this.adapterCheck = null;
		this.manifestCheck = null;
		this.targetChecks = [];
		this.targetActivity = null;
		this.targetCheckedAt = 0;
		this.freshness.invalidate();
		const revision = this.freshness.capture();
		void writePluginStatus(this, {
			currentCheck: checkState('stale', 'Repair may change runtime files; run a separate read-only check afterward.'),
		});
		this.renderViews();

		let summary: RepairSummary;
		try { summary = await runRepairAll(this.adapterContext(revision), vaultPath, strings); }
		catch (error) {
			const output = error instanceof Error ? error.message : String(error);
			this.targetActivity = null;
			this.adapterRepairRunning = false;
			if (!this.disposed && this.freshness.isCurrent(revision)) {
				this.adapterRepair = { status: 'failed', exitCode: 1, output };
				this.latestOutput = output;
				await writePluginStatus(this, {
					lastRepair: runRecord('failed', 1, output),
					currentCheck: checkState('stale', 'Repair stopped unexpectedly; run a fresh read-only check.'),
				});
				notifyWithCopy(strings, strings.repairAllFailed(1), output);
			}
			if (!this.disposed) {
				this.renderViews();
				if (this.checksStale) this.scheduleBackgroundCheck();
			}
			return;
		}
		this.lastRepairSummary = summary;
		if (this.disposed || !this.freshness.accept(revision)) {
			this.adapterRepairRunning = false;
			if (!this.disposed) { this.renderViews(); this.scheduleBackgroundCheck(); }
			return;
		}
		this.manifestCheck = summary.manifest;
		this.adapterCheck = summary.checkResult;
		this.adapterRepair = summary.repair;
		this.latestOutput = summary.repair.output;
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
			this.scheduleBackgroundCheck();
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_SKILL_SWITCHBOARD, active: true });
		await this.app.workspace.revealLeaf(leaf);
		this.scheduleBackgroundCheck();
	}
}
