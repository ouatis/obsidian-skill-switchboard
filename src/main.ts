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
import { RuntimeName, RuntimeTarget } from './types';
import { createSyncProvider, ManifestCheckResult, SyncProvider } from './sync-provider';
import path from 'node:path';
import { resolveConfiguredPath } from './utils/paths';

interface TargetCheck {
	target: RuntimeTarget & { runtime: RuntimeName };
	targetPath: string | null;
	result: AdapterCheckResult;
	repairable: boolean;
}

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

	async checkAdapters(): Promise<void> {
		if (this.adapterCheckRunning || this.adapterRepairRunning) return;
		this.adapterCheckRunning = true;
		this.adapterCheck = null;
		this.manifestCheck = null;
		this.renderViews();

		const strings = getStrings(this.settings.language);
		const basePath = this.getVaultBasePath();
		const result = basePath ? await this.checkAllTargets(basePath, strings.noRepairTargets) : desktopPathFailure();
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

	getRepairTargets(): Array<RuntimeTarget & { runtime: RuntimeName }> {
		return this.settings.targets.filter(
			(target): target is RuntimeTarget & { runtime: RuntimeName } =>
				target.enabled && target.mode === 'wrapper' && Boolean(target.runtime && target.path.trim()),
		);
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

		const manifest = await this.syncProvider.inspectManifest(vaultPath);
		this.manifestCheck = manifest;
		if (manifest.status === 'failed') {
			this.adapterCheck = manifest;
			this.adapterRepair = manifest;
			this.adapterRepairRunning = false;
			this.renderViews();
			notifyWithCopy(strings, strings.adapterCheckFailed(manifest.exitCode), manifest.output);
			return;
		}

		const checks = await this.collectTargetChecks(vaultPath);
		const checkResult = combineResults(manifest, aggregateTargetChecks(checks, strings.noRepairTargets));
		this.adapterCheck = checkResult;
		this.renderViews();

		const drifted = checks.filter((check) => check.result.status === 'failed' && check.repairable);
		const blocked = checks.filter((check) => check.result.status === 'failed' && !check.repairable);
		if (drifted.length === 0) {
			this.adapterRepair = {
				status: blocked.length === 0 ? 'passed' : 'failed',
				output: [
					blocked.length === 0 ? strings.repairAllNoDrift : strings.repairAllFailed(blocked.length),
					checkResult.output,
				].filter(Boolean).join('\n\n'),
				exitCode: checkResult.exitCode,
			};
			this.adapterRepairRunning = false;
			this.renderViews();
			notifyWithCopy(
				strings,
				blocked.length === 0 ? strings.repairAllNoDrift : strings.repairAllFailed(blocked.length),
				this.adapterRepair.output,
			);
			return;
		}

		const repairOutputs: string[] = [];
		let repairedCount = 0;
		let failedCount = blocked.length;
		let firstFailureCode = blocked[0]?.result.exitCode;

		for (const check of drifted) {
			const runtime = check.target.runtime;
			const targetPath = check.targetPath;
			if (!targetPath) {
				failedCount += 1;
				firstFailureCode ??= 1;
				repairOutputs.push(`[${displayTargetName(check.target)}] REPAIR FAILED\n${check.result.output}`);
				continue;
			}
			const label = displayTargetName(check.target);
			const repair = await this.syncProvider.repairRuntime(vaultPath, runtime, check.target.path);
			if (repair.status === 'failed') {
				failedCount += 1;
				firstFailureCode ??= repair.exitCode;
				repairOutputs.push(`[${label}] REPAIR FAILED\n${repair.output}`);
				continue;
			}

			const followUp = await this.syncProvider.checkRuntime(vaultPath, runtime, check.target.path);
			if (followUp.status === 'passed') {
				repairedCount += 1;
				repairOutputs.push(
					`[${label}] REPAIRED\n${repair.output}\n--- follow-up check ---\n${followUp.output}`,
				);
			} else {
				failedCount += 1;
				firstFailureCode ??= followUp.exitCode;
				repairOutputs.push(
					`[${label}] REPAIR FAILED (follow-up)\n${repair.output}\n--- follow-up check ---\n${followUp.output}`,
				);
			}
		}

		this.adapterRepair = {
			status: failedCount === 0 ? 'passed' : 'failed',
			output: [
				failedCount === 0
					? strings.repairAllPassed(repairedCount)
					: strings.repairAllFailed(failedCount),
				...repairOutputs,
			].join('\n\n'),
			exitCode: firstFailureCode ?? 0,
		};
		this.adapterRepairRunning = false;
		this.renderViews();
		notifyWithCopy(
			strings,
			failedCount === 0
				? strings.repairAllPassed(repairedCount)
				: strings.repairAllFailed(failedCount),
			this.adapterRepair.output,
		);
		await writePluginStatus(this, {
			lastRepair: runRecord(this.adapterRepair.status, this.adapterRepair.exitCode, this.adapterRepair.output),
		});
	}

	getVaultBasePath(): string | null {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		return adapter.getBasePath?.() ?? null;
	}

	private async checkAllTargets(vaultPath: string, emptyMessage: string): Promise<AdapterCheckResult> {
		const manifest = await this.syncProvider.inspectManifest(vaultPath);
		this.manifestCheck = manifest;
		if (manifest.status === 'failed') return manifest;
		return combineResults(manifest, aggregateTargetChecks(await this.collectTargetChecks(vaultPath), emptyMessage));
	}

	private async collectTargetChecks(vaultPath: string): Promise<TargetCheck[]> {
		const checks: TargetCheck[] = [];
		for (const target of this.getRepairTargets()) {
			let resolvedTarget: string;
			try {
				resolvedTarget = resolveConfiguredPath(target.path, vaultPath);
			} catch (error) {
				checks.push({
					target,
					targetPath: null,
					repairable: false,
					result: {
						status: 'failed',
						output: error instanceof Error ? error.message : String(error),
						exitCode: 1,
					},
				});
				continue;
			}
			if (isTargetInsideVault(vaultPath, resolvedTarget)) {
				checks.push({
					target,
					targetPath: resolvedTarget,
					repairable: false,
					result: {
						status: 'failed',
						output: `Repair target must be outside the vault: ${resolvedTarget}`,
						exitCode: 1,
					},
				});
				continue;
			}
			checks.push({
				target,
				targetPath: resolvedTarget,
				repairable: true,
				result: await this.syncProvider.checkRuntime(vaultPath, target.runtime, target.path),
			});
		}
		return checks;
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

function combineResults(...results: AdapterCheckResult[]): AdapterCheckResult {
	const failed = results.find((result) => result.status === 'failed');
	return {
		status: failed ? 'failed' : 'passed',
		output: results.map((result) => result.output).filter(Boolean).join('\n\n'),
		exitCode: failed?.exitCode ?? 0,
	};
}

function aggregateTargetChecks(checks: TargetCheck[], emptyMessage: string): AdapterCheckResult {
	if (checks.length === 0) {
		return { status: 'passed', output: emptyMessage, exitCode: 0 };
	}

	const failed = checks.find((check) => check.result.status === 'failed');
	return {
		status: failed ? 'failed' : 'passed',
		output: checks
			.map((check) => {
				const state =
					check.result.status === 'passed'
						? 'PASS'
						: check.repairable
							? 'DRIFT'
							: 'FAIL';
				return `[${displayTargetName(check.target)}] ${state}\n${check.result.output}`;
			})
			.join('\n\n'),
		exitCode: failed?.result.exitCode ?? 0,
	};
}

function displayTargetName(target: RuntimeTarget & { runtime: RuntimeName }): string {
	return target.label.trim() || target.runtime;
}

function isTargetInsideVault(vaultPath: string, targetPath: string): boolean {
	const relativeTarget = path.relative(path.resolve(vaultPath), targetPath);
	return (
		relativeTarget === '' ||
		(!relativeTarget.startsWith(`..${path.sep}`) && relativeTarget !== '..' && !path.isAbsolute(relativeTarget))
	);
}

function desktopPathFailure(): AdapterCheckResult {
	return {
		status: 'failed',
		output: 'The active vault adapter does not expose a desktop base path.',
		exitCode: 1,
	};
}
