import path from 'node:path';
import type { Strings } from '../i18n';
import type { RuntimeName, RuntimeTarget } from '../types';
import type { AdapterCheckResult } from './result';
import type { ManifestCheckResult, SyncProvider, SyncRuntimeCheckResult } from '../sync-provider';
import { resolveConfiguredPath } from '../utils/paths';

/** A runtime target that is eligible for drift repair. */
export type RepairTarget = RuntimeTarget & { runtime: RuntimeName };

export interface TargetCheck {
	target: RepairTarget;
	targetPath: string | null;
	result: SyncRuntimeCheckResult;
	repairable: boolean;
	repairFailed?: boolean;
}

export interface TargetActivity {
	targetId: string;
	phase: 'checking' | 'repairing';
}

/** Everything the check/repair orchestration needs, without importing the plugin class. */
export interface AdapterRunContext {
	provider: SyncProvider;
	settings: { targets: RuntimeTarget[] };
	/** Observers only: they do not select targets or change the repair policy. */
	onTargetActivity?: (activity: TargetActivity) => void;
	onTargetCheck?: (check: TargetCheck) => void;
}

export interface AdapterRun {
	result: AdapterCheckResult;
	manifest: ManifestCheckResult;
	checks: TargetCheck[];
}

export function getRepairTargets(targets: RuntimeTarget[]): RepairTarget[] {
	return targets.filter(
		(target): target is RepairTarget =>
			target.enabled && target.mode === 'wrapper' && Boolean(target.runtime && target.path.trim()),
	);
}

/** Validates the shared manifest, then checks every configured runtime target. */
export async function checkAllTargets(
	context: AdapterRunContext,
	vaultPath: string,
	emptyMessage: string,
): Promise<AdapterRun> {
	const manifest = await context.provider.inspectManifest(vaultPath);
	if (manifest.status === 'failed') return { result: manifest, manifest, checks: [] };
	const checks = await collectTargetChecks(context, vaultPath);
	return {
		result: combineResults(manifest, aggregateTargetChecks(checks, emptyMessage)),
		manifest,
		checks,
	};
}

export async function collectTargetChecks(
	context: AdapterRunContext,
	vaultPath: string,
): Promise<TargetCheck[]> {
	const checks: TargetCheck[] = [];
	const record = (check: TargetCheck) => {
		checks.push(check);
		context.onTargetCheck?.(check);
	};
	for (const target of getRepairTargets(context.settings.targets)) {
		context.onTargetActivity?.({ targetId: target.id, phase: 'checking' });
		let resolvedTarget: string;
		try {
			resolvedTarget = resolveConfiguredPath(target.path, vaultPath);
		} catch (error) {
			record({
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
			record({
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
		record({
			target,
			targetPath: resolvedTarget,
			repairable: true,
			result: await context.provider.checkRuntime(vaultPath, target.runtime, target.path),
		});
	}
	return checks;
}

export interface RepairOutcome {
	repair: AdapterCheckResult;
	repairedCount: number;
	failedCount: number;
}

export interface RepairSummary {
	manifest: ManifestCheckResult;
	checkResult: AdapterCheckResult;
	repair: AdapterCheckResult;
	repairedCount: number;
	failedCount: number;
	/** True when the manifest check failed and no repair was attempted. */
	aborted: boolean;
}

/**
 * Full "repair all" run: validate the manifest, check every target, then repair
 * whatever drifted. The manifest is inspected once up front so a broken manifest
 * aborts before any target is touched.
 */
export async function runRepairAll(
	context: AdapterRunContext,
	vaultPath: string,
	strings: Strings,
): Promise<RepairSummary> {
	const manifest = await context.provider.inspectManifest(vaultPath);
	if (manifest.status === 'failed') {
		return {
			manifest,
			checkResult: manifest,
			repair: manifest,
			repairedCount: 0,
			failedCount: 1,
			aborted: true,
		};
	}

	const { result: checkResult, checks } = await checkAllTargets(context, vaultPath, strings.noRepairTargets);
	const drifted = checks.filter((check) => check.result.status === 'failed' && check.repairable);
	const blocked = checks.filter((check) => check.result.status === 'failed' && !check.repairable);

	if (drifted.length === 0) {
		const passed = blocked.length === 0;
		return {
			manifest,
			checkResult,
			repair: {
				status: passed ? 'passed' : 'failed',
				output: [
					passed ? strings.repairAllNoDrift : strings.repairAllFailed(blocked.length),
					checkResult.output,
				].filter(Boolean).join('\n\n'),
				exitCode: checkResult.exitCode,
			},
			repairedCount: 0,
			failedCount: blocked.length,
			aborted: false,
		};
	}

	const { repair, repairedCount, failedCount } = await repairDriftedTargets(
		context,
		vaultPath,
		drifted,
		blocked.length,
		strings,
	);
	return { manifest, checkResult, repair, repairedCount, failedCount, aborted: false };
}

/**
 * Repairs each drifted wrapper target and re-checks it afterwards. `blockedCount`
 * covers failures that were never repairable, so the reported total matches what
 * the user sees in the check result.
 */
export async function repairDriftedTargets(
	context: AdapterRunContext,
	vaultPath: string,
	drifted: TargetCheck[],
	blockedCount: number,
	strings: Strings,
): Promise<RepairOutcome> {
	const repairOutputs: string[] = [];
	let repairedCount = 0;
	let failedCount = blockedCount;
	let firstFailureCode: number | undefined;

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
		context.onTargetActivity?.({ targetId: check.target.id, phase: 'repairing' });
		const repair = await context.provider.repairRuntime(vaultPath, runtime, check.target.path);
		if (repair.status === 'failed') {
			context.onTargetCheck?.({ ...check, result: repair, repairFailed: true });
			failedCount += 1;
			firstFailureCode ??= repair.exitCode;
			repairOutputs.push(`[${label}] REPAIR FAILED\n${repair.output}`);
			continue;
		}

		context.onTargetActivity?.({ targetId: check.target.id, phase: 'checking' });
		const followUp = await context.provider.checkRuntime(vaultPath, runtime, check.target.path);
		context.onTargetCheck?.({ ...check, result: followUp, repairFailed: false });
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

	const passed = failedCount === 0;
	return {
		repair: {
			status: passed ? 'passed' : 'failed',
			output: [
				passed
					? strings.repairAllPassed(repairedCount)
					: strings.repairAllFailed(failedCount),
				...repairOutputs,
			].join('\n\n'),
			exitCode: firstFailureCode ?? 0,
		},
		repairedCount,
		failedCount,
	};
}

export function combineResults(...results: AdapterCheckResult[]): AdapterCheckResult {
	const failed = results.find((result) => result.status === 'failed');
	return {
		status: failed ? 'failed' : 'passed',
		output: results.map((result) => result.output).filter(Boolean).join('\n\n'),
		exitCode: failed?.exitCode ?? 0,
	};
}

export function aggregateTargetChecks(checks: TargetCheck[], emptyMessage: string): AdapterCheckResult {
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

export function displayTargetName(target: RepairTarget): string {
	return target.label.trim() || target.runtime;
}

export function isTargetInsideVault(vaultPath: string, targetPath: string): boolean {
	const relativeTarget = path.relative(path.resolve(vaultPath), targetPath);
	return (
		relativeTarget === '' ||
		(!relativeTarget.startsWith(`..${path.sep}`) && relativeTarget !== '..' && !path.isAbsolute(relativeTarget))
	);
}

export function desktopPathFailure(): AdapterCheckResult {
	return {
		status: 'failed',
		output: 'The active vault adapter does not expose a desktop base path.',
		exitCode: 1,
	};
}
