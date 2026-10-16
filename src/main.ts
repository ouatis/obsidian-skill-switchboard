import { Notice, Plugin } from 'obsidian';
import path from 'node:path';
import {
	DEFAULT_SETTINGS,
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
import { normalizeVaultPath } from './scanner';
import { CheckFreshness } from './sync/freshness';
import { resolveSyncSource, settingsCheckKey } from './sync/source';
import { localPackageRegistryPath, readLocalPackagePaths, resolveLocalPackagePath, saveLocalPackagePath } from './sync/package-paths';
import { isInside } from './sync/manifest';

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
	lastRepairSummary: RepairSummary | null = null;
	private readonly freshness = new CheckFreshness();
	private checkTimer: number | null = null;
	private disposed = false;
	private indexKey = '';
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
		if (this.checkTimer !== null) window.clearTimeout(this.checkTimer);
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
		const normalizedRoots = this.settings.roots
			.filter((root) => root.enabled && root.kind === 'vault' && root.path.trim())
			.map((root) => normalizeVaultPath(root.path));
		const relevant = changedPaths.some((changedPath) =>
			normalizedRoots.some((root) => changedPath === root || changedPath.startsWith(`${root}/`)),
		);
		const basePath = this.getVaultBasePath();
		let affectsChecks = relevant;
		try {
			if (basePath) {
				const source = resolveSyncSource(basePath, this.settings);
				affectsChecks ||= changedPaths.some((changedPath) => path.resolve(basePath, changedPath) === source.manifestPath);
			}
		} catch { /* Invalid source configuration is reported by the next check. */ }
		if (affectsChecks) { this.invalidateChecks(); this.scheduleBackgroundCheck(); }
		if (!relevant || !this.settings.autoScan) return;
		if (this.scanQueued) return;
		this.scanQueued = true;
		// The `number` control keeps this a number, but data saved by an earlier
		// build used a text control, so the value is still coerced on read.
		const stored = Number(this.settings.scanDelayMs);
		const delay = Number.isFinite(stored) && stored >= 0 ? stored : INDEX_DEBOUNCE_MS;
		window.setTimeout(() => {
			this.scanQueued = false;
			if (this.disposed || !this.settings.autoScan) return;
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
			syncRootId: data?.syncRootId ?? (data?.roots ?? DEFAULT_SETTINGS.roots).find((root) => root.enabled && root.path.trim())?.id ?? '',
			syncManifestPath: typeof data?.syncManifestPath === 'string' ? data.syncManifestPath : '',
			autoCheck: typeof data?.autoCheck === 'boolean' ? data.autoCheck : DEFAULT_SETTINGS.autoCheck,
		};
		// scanIntervalMinutes was the old polling interval; the debounce is in
		// milliseconds now, so a legacy value cannot be carried over as-is.
		if (this.settings.scanDelayMs === undefined) {
			this.settings.scanDelayMs = DEFAULT_SETTINGS.scanDelayMs;
		}
		this.configurationKey = settingsCheckKey(this.settings);
	}

	async saveSettings(): Promise<void> {
		const key = settingsCheckKey(this.settings);
		if (key !== this.configurationKey) { this.configurationKey = key; this.invalidateChecks(); }
		await this.saveData(this.settings);
		this.scheduleBackgroundCheck();
	}

	async reloadLocalPackagePaths(): Promise<void> {
		try { this.localPackagePaths = await readLocalPackagePaths(this.packageRegistryPath); this.localPackagePathsError = ''; }
		catch (error) { this.localPackagePaths = {}; this.localPackagePathsError = error instanceof Error ? error.message : String(error); }
	}

	async saveExternalPackagePath(id: string, directory: string): Promise<void> {
		if (!this.index.skills.some((skill) => skill.frontmatter.package_id === id)) throw new Error('Package is not declared by an indexed skill.');
		const vaultPath = this.getVaultBasePath();
		if (directory.trim() && vaultPath && isInside(vaultPath, resolveLocalPackagePath(directory))) throw new Error('External tool packages must be outside the vault.');
		this.localPackagePaths = await saveLocalPackagePath(id, directory, this.packageRegistryPath);
		this.localPackagePathsError = '';
		this.invalidateChecks();
		this.scheduleBackgroundCheck();
	}

	async onExternalSettingsChange(): Promise<void> {
		const previous = this.configurationKey;
		await this.loadSettings();
		if (previous !== this.configurationKey) this.invalidateChecks();
		this.renderViews();
		this.scheduleBackgroundCheck();
	}

	async setDistributionBoardVisible(visible: boolean): Promise<void> {
		this.settings.showDistributionBoard = visible;
		await this.saveSettings();
		this.renderViews();
	}

	async refreshIndex(showNotice: boolean): Promise<void> {
		this.index = await scanConfiguredRoots(this.app, this.settings.roots);
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
		const confirmed = await confirmRepair(this.app, strings, strings.repairConfirmMessage);
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
			this.adapterRepairRunning = false;
			if (this.freshness.accept(revision)) this.adapterRepair = { status: 'failed', exitCode: 1, output: error instanceof Error ? error.message : String(error) };
			this.renderViews();
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
