import { Notice, Plugin } from 'obsidian';
import type { WorkspaceItem, WorkspaceLeaf } from 'obsidian';
import path from 'node:path';
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
import { confirmDetectedTargets, confirmRepair } from './ui/confirm-modal';
import { repairPlanDetails } from './ui/repair-plan';
import type { AdapterCheckResult } from './sync/result';
import { createSyncProvider, ManifestCheckResult, SyncProvider, type SyncManifestSnapshot } from './sync-provider';
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
	type AdapterRun,
} from './sync/adapter-run';
import { CheckFreshness } from './sync/freshness';
import { resolveSyncSource, settingsCheckKey } from './sync/source';
import { getVaultChangeImpact } from './sync/vault-change-impact';
import { localPackageRegistryPath, readLocalPackagePaths, resolveLocalPackagePath, saveLocalPackagePath } from './sync/package-paths';
import { existingRealPath } from './sync/filesystem';
import { pathsOverlap, resolveConfiguredPath } from './utils/paths';
import { discoverRuntimeTargets, type DiscoveredRuntimeTarget } from './sync/target-discovery';
import { machineSettingsPath, readMachineSettings, restoredSettings, hasLegacyConnections, persistSettings } from './settings/storage';
import { AutomaticDistribution } from './sync/automatic-distribution';
import { resolveAutomaticScope } from './sync/automatic-scope';

/** Fallback wait when the setting holds an unusable value. */
const INDEX_DEBOUNCE_MS = 500;

export default class SkillSwitchboardPlugin extends Plugin {
	settings!: SkillSwitchboardSettings;
	get machineSettingsPath(): string | null {
		const vaultPath = this.getVaultBasePath();
		return vaultPath ? machineSettingsPath(vaultPath) : null;
	}
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
	private consentRevision = 0;
	private settingsTab?: SkillSwitchboardSettingTab;
	private readonly automatic = new AutomaticDistribution({
		enabled: () => !this.disposed && Boolean(this.settings?.autoDistribute),
		consent: () => this.settings?.autoDistributeScope ?? '',
		busy: () => this.adapterCheckRunning || this.adapterRepairRunning,
		scope: () => resolveAutomaticScope(this.getVaultBasePath() ?? '', this.settings),
		inspect: () => this.syncProvider.inspectManifest(this.getVaultBasePath() ?? ''),
		requestCheck: () => this.scheduleBackgroundCheck(),
		revoke: async () => {
			this.settings.autoDistribute = false; this.settings.autoDistributeScope = '';
			await this.saveSettings();
			this.settingsTab?.refreshAutomaticState();
			new Notice(getStrings(this.settings.language).autoDistributeRevoked);
		},
		repair: (snapshot, current) => this.executeRepair(snapshot, current),
		failure: (output) => notifyWithCopy(getStrings(this.settings.language), getStrings(this.settings.language).autoDistributeFailed, output),
	});
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

		this.settingsTab = new SkillSwitchboardSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

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
		this.consentRevision++;
		this.automatic.cancel();
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
		this.automatic.cancel();
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
		if (!this.app.workspace.layoutReady || this.disposed || !(this.settings.autoCheck || this.settings.autoDistribute) || this.adapterCheckRunning || this.adapterRepairRunning) return;
		if (this.checkTimer !== null) window.clearTimeout(this.checkTimer);
		const delay = Number.isFinite(this.settings.scanDelayMs) ? Math.max(0, this.settings.scanDelayMs) : INDEX_DEBOUNCE_MS;
		this.checkTimer = window.setTimeout(() => {
			this.checkTimer = null;
			if (!this.disposed && (this.settings.autoCheck || this.settings.autoDistribute)) void this.checkAdapters(false, true);
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
		if ((this.settings.autoCheck || this.settings.autoDistribute) && !this.adapterCheckRunning && !this.adapterRepairRunning) {
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
		const file = this.machineSettingsPath;
		const local = file ? await readMachineSettings(file) : null;
		const saved: unknown = await this.loadData();
		const normalized = normalizeSettings(restoredSettings(saved, local));
		this.settings = normalized.settings;
		if (normalized.recovered) new Notice(getStrings(this.settings.language).settingsRecovered);
		if (file && hasLegacyConnections(saved)) await persistSettings(this.settings, file, (data) => this.saveData(data), saved);
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
		if (this.settings.autoDistribute) await this.automatic.validate();
		if (!this.machineSettingsPath) throw new Error('Machine settings require a local desktop vault.');
		await persistSettings(this.settings, this.machineSettingsPath, (data) => this.saveData(data));
		this.scheduleRootRefresh();
		this.scheduleBackgroundCheck();
	}

	/** One explicit grant on this machine; synced preferences can never enable it. */
	async setAutoDistributionEnabled(enabled: boolean): Promise<boolean> {
		const request = ++this.consentRevision;
		this.automatic.reset();
		this.settings.autoDistribute = false;
		this.settings.autoDistributeScope = '';
		const strings = getStrings(this.settings.language);
		try {
			await this.saveSettings();
			if (!enabled) return false;
			const vault = this.getVaultBasePath();
			if (!vault) throw new Error('Automatic distribution requires a local desktop vault.');
			const scope = await resolveAutomaticScope(vault, this.settings);
			const manifest = await this.syncProvider.inspectManifest(vault);
			if (!manifest.snapshot) throw new Error(manifest.output);
			const confirmed = await confirmRepair(this.app, strings, strings.autoDistributeConfirm, scope.details,
				{ title: strings.autoDistribute, confirm: strings.autoDistributeAllow });
			if (!confirmed || request !== this.consentRevision || this.disposed) return false;
			if (this.adapterRepairRunning || (await resolveAutomaticScope(vault, this.settings)).key !== scope.key) throw new Error(strings.autoDistributeRevoked);
			this.settings.autoDistribute = true;
			this.settings.autoDistributeScope = scope.key;
			try { await this.saveSettings(); }
			catch (error) { this.settings.autoDistribute = false; this.settings.autoDistributeScope = ''; throw error; }
			return this.settings.autoDistribute;
		} catch (error) {
			if (!this.disposed) notifyWithCopy(strings, strings.autoDistributeFailed, error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	async reloadLocalPackagePaths(): Promise<void> {
		try { this.localPackagePaths = await readLocalPackagePaths(this.packageRegistryPath); this.localPackagePathsError = ''; }
		catch (error) { this.localPackagePaths = {}; this.localPackagePathsError = error instanceof Error ? error.message : String(error); }
	}

	/** Detect and register standard runtime folders only after an explicit confirmation. */
	async detectRuntimeTargets(): Promise<void> {
		const strings = getStrings(this.settings.language);
		let discovered: DiscoveredRuntimeTarget[];
		try {
			discovered = await discoverRuntimeTargets();
		} catch (error) {
			new Notice(`${strings.detectRuntimeTargetsFailed}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (discovered.length === 0) {
			new Notice(strings.detectRuntimeTargetsEmpty);
			return;
		}

		const vaultPath = this.getVaultBasePath() ?? process.cwd();
		const normalizedPath = (value: string): string => {
			const resolved = path.resolve(resolveConfiguredPath(value, vaultPath));
			return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
		};
		const registeredPaths = new Set(this.settings.targets.flatMap((target) => {
			if (!target.path.trim()) return [];
			try { return [normalizedPath(target.path)]; } catch { return []; }
		}));
		const additions = discovered.filter((target) => !registeredPaths.has(normalizedPath(target.path)));
		if (additions.length === 0) {
			new Notice(strings.detectRuntimeTargetsAlreadyConfigured);
			return;
		}

		const details = additions.map((target) => `${target.label} · ${target.path}`).join('\n');
		if (!await confirmDetectedTargets(this.app, strings, details)) return;

		const currentPaths = new Set(this.settings.targets.flatMap((target) => {
			if (!target.path.trim()) return [];
			try { return [normalizedPath(target.path)]; } catch { return []; }
		}));
		const confirmedAdditions = additions.filter((target) => !currentPaths.has(normalizedPath(target.path)));
		if (confirmedAdditions.length === 0) {
			new Notice(strings.detectRuntimeTargetsAlreadyConfigured);
			return;
		}

		const idPrefix = Date.now().toString(36);
		this.settings.targets.push(...confirmedAdditions.map((target, index) => ({
			id: `detected-${idPrefix}-${index.toString(36)}`,
			label: target.label,
			path: target.path,
			runtime: target.runtime,
			mode: 'copy' as const,
			enabled: true,
		})));
		try {
			await this.saveSettings();
			this.settingsTab?.refreshAutomaticState();
			new Notice(strings.detectedTargetsAdded(confirmedAdditions.length));
		} catch (error) {
			this.settings.targets = this.settings.targets.filter((target) => !target.id.startsWith(`detected-${idPrefix}-`));
			new Notice(`${strings.detectRuntimeTargetsFailed}: ${error instanceof Error ? error.message : String(error)}`);
		}
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
			if (pathsOverlap(realVault, realDirectory) || pathsOverlap(realSource, realDirectory)) {
				throw new Error('External tool packages must not overlap the vault or canonical source.');
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

	private adapterContext(revision: number, current?: () => boolean): AdapterRunContext {
		return {
			provider: this.syncProvider,
			settings: { targets: this.settings.targets.map((target) => ({ ...target })) },
			isCurrent: () => !this.disposed && this.freshness.isCurrent(revision) && current?.() !== false,
			snapshotDirectory: this.snapshotStore(),
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

	/** Before/after copies of displaced target trees live inside the plugin directory. */
	snapshotStore(): string {
		// manifest is always set in Obsidian; the fallback keeps fixture plugins usable.
		return path.join(this.getVaultBasePath() ?? '', this.manifest?.dir ?? '', 'snapshots');
	}

	async checkAdapters(showNotice = true, allowAutomatic = false): Promise<void> {
		if (this.adapterCheckRunning || this.adapterRepairRunning) return;
		if (this.checkTimer !== null) { window.clearTimeout(this.checkTimer); this.checkTimer = null; }
		this.adapterCheckRunning = true;
		this.invalidateChecks('A new read-only check was requested; the previous result is no longer current.');
		this.renderViews();

		const strings = getStrings(this.settings.language);
		const basePath = this.getVaultBasePath();
		let revision = this.freshness.capture();
		let automaticRun: AdapterRun | undefined;
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
				if (run && allowAutomatic) automaticRun = run;
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
			if (automaticRun && !this.disposed && !this.checksStale) this.automatic.consider(automaticRun);
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
		this.automatic.cancel();
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
		let approvedSnapshot: SyncManifestSnapshot | undefined;
		let previewComplete = false;
		const previewRevision = this.freshness.capture();
		try {
			const preview = await checkAllTargets(this.adapterContext(previewRevision), vaultPath, strings.noRepairTargets);
			if (this.disposed || !this.freshness.isCurrent(previewRevision)) throw new Error(strings.checksStale);
			if (preview.manifest.status === 'failed') throw new Error(preview.result.output);
			approvedSnapshot = preview.manifest.snapshot ?? undefined;
			this.manifestCheck = preview.manifest;
			this.adapterCheck = preview.result;
			this.latestOutput = preview.result.output;
			this.targetChecks = preview.checks;
			this.targetCheckedAt = Date.now();
			this.freshness.accept(previewRevision);
			previewComplete = true;
			await writePluginStatus(this, { lastCheck: runRecord(preview.result.status, preview.result.exitCode, preview.result.output), currentCheck: checkState(preview.result.status) });
			confirmed = await confirmRepair(this.app, strings, strings.repairConfirmMessage, repairPlanDetails(preview.checks, strings));
			if (confirmed && !this.freshness.isCurrent(previewRevision)) throw new Error(strings.checksStale);
		} catch (error) {
			if (!previewComplete) this.invalidateChecks('Repair stopped unexpectedly; run a fresh read-only check.');
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
		await this.executeRepair(approvedSnapshot);
	}

	private async executeRepair(approvedSnapshot?: SyncManifestSnapshot, automaticCurrent?: () => boolean): Promise<RepairSummary | null> {
		if (automaticCurrent && (this.adapterCheckRunning || this.adapterRepairRunning || !automaticCurrent())) return null;
		const strings = getStrings(this.settings.language);
		const vaultPath = this.getVaultBasePath();
		if (!vaultPath || this.disposed) return null;
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
		try { summary = await runRepairAll(this.adapterContext(revision, automaticCurrent), vaultPath, strings, approvedSnapshot); }
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
				if (!automaticCurrent) notifyWithCopy(strings, strings.repairAllFailed(1), output);
			}
			if (!this.disposed) {
				this.renderViews();
				if (this.checksStale) this.scheduleBackgroundCheck();
			}
			if (automaticCurrent) throw error;
			return null;
		}
		this.lastRepairSummary = summary;
		if (this.disposed || !this.freshness.accept(revision)) {
			this.adapterRepairRunning = false;
			if (!this.disposed) { this.renderViews(); this.scheduleBackgroundCheck(); }
			return summary;
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
			if (!automaticCurrent) notifyWithCopy(strings, strings.adapterCheckFailed(summary.repair.exitCode), summary.repair.output);
			return summary;
		}

		this.adapterRepairRunning = false;
		this.renderViews();
		if (!automaticCurrent) notifyWithCopy(
			strings,
			summary.failedCount === 0
				? strings.repairAllPassed(summary.repairedCount)
				: strings.repairAllFailed(summary.failedCount),
			summary.repair.output,
		);
		await writePluginStatus(this, {
			lastRepair: runRecord(this.adapterRepair.status, this.adapterRepair.exitCode, this.adapterRepair.output),
		});
		return summary;
	}

	getVaultBasePath(): string | null {
		const adapter = this.app.vault?.adapter as { getBasePath?: () => string } | undefined;
		return adapter?.getBasePath?.() ?? null;
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
		const wantsSidebar = this.settings.viewLocation === 'sidebar';
		if (existing && this.isLeafInSidebar(existing) === wantsSidebar) {
			await this.app.workspace.revealLeaf(existing);
			this.scheduleBackgroundCheck();
			return;
		}

		const leaf = wantsSidebar
			? this.app.workspace.getRightLeaf(false)
			: this.app.workspace.getLeaf('tab');
		if (!leaf) return;
		const currentState = existing?.getViewState();
		await leaf.setViewState(currentState
			? { ...currentState, type: VIEW_TYPE_SKILL_SWITCHBOARD, active: true }
			: { type: VIEW_TYPE_SKILL_SWITCHBOARD, active: true });
		if (existing && existing !== leaf) existing.detach();
		await this.app.workspace.revealLeaf(leaf);
		this.scheduleBackgroundCheck();
	}

	private isLeafInSidebar(leaf: WorkspaceLeaf): boolean {
		let parent: WorkspaceItem | null = leaf.parent;
		while (parent) {
			if (parent === this.app.workspace.leftSplit || parent === this.app.workspace.rightSplit) return true;
			if (parent === this.app.workspace.rootSplit) return false;
			parent = parent.parent;
		}
		return false;
	}
}
