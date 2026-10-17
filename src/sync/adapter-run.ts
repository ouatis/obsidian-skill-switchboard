import path from 'node:path';
import type { Strings } from '../i18n';
import type { RuntimeName, RuntimeTarget } from '../types';
import type { AdapterCheckResult } from './result';
import type { ManifestCheckResult, SyncProvider, SyncRuntimeCheckResult, SyncManifestSnapshot, SyncRepairResult } from '../sync-provider';
import type { ResourceCheck, PackageCheck } from './resources';
import { isInside, pathsOverlap } from './manifest';
import { existingRealPath } from './filesystem';
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
	isCurrent?: () => boolean;
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
	const checks = await collectTargetChecks(context, vaultPath, manifest.snapshot ?? undefined);
	const resourceReport = manifest.resources && manifest.resources.status !== 'passed'
		? formatResourceCheck(manifest.resources) : null;
	return {
		result: combineResults(manifest, aggregateTargetChecks(checks, emptyMessage), ...(resourceReport ? [resourceReport] : [])),
		manifest,
		checks,
	};
}

function formatResourceCheck(resources: ResourceCheck): AdapterCheckResult {
	const failed = resources.status === 'failed';
	const affected = resources.packages.filter((item) => item.status !== 'passed');
	const details = affected.map((item) => {
		const location = item.location === 'external' ? 'external package (machine-local mapping)' : 'source package';
		const issues = item.issues.map((issue) => {
			const issuePath = issue.path ? `: ${displayResourcePath(item, issue.path)}` : '';
			return `  - ${issue.code}${issuePath}`;
		});
		return [`${item.skill} — ${location}`, ...issues].join('\n');
	});
	return {
		status: failed ? 'failed' : 'passed',
		exitCode: failed ? 1 : 0,
		output: [`[resources] ${failed ? 'FAIL' : 'WARNING'}`, ...details].join('\n'),
	};
}

function displayResourcePath(item: PackageCheck, value: string): string {
	if (item.location === 'external' && (path.isAbsolute(value) || /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\'))) {
		return '(machine-local path omitted)';
	}
	return value;
}

export async function collectTargetChecks(
	context: AdapterRunContext,
	vaultPath: string,
	snapshot?: SyncManifestSnapshot,
): Promise<TargetCheck[]> {
	const checks: TargetCheck[] = [];
	const record = (check: TargetCheck) => {
		checks.push(check);
		context.onTargetCheck?.(check);
	};
	for (const target of getRepairTargets(context.settings.targets)) {
		if (context.isCurrent?.() === false) break;
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
		const pathFailure = await targetPathFailure(vaultPath, resolvedTarget, snapshot);
		if (pathFailure) {
			record({
				target,
				targetPath: resolvedTarget,
				repairable: false,
				result: {
					status: 'failed',
					output: pathFailure,
					exitCode: 1,
				},
			});
			continue;
		}
		const result = await context.provider.checkRuntime(vaultPath, target.runtime, target.path, snapshot);
		record({
			target,
			targetPath: resolvedTarget,
			repairable: result.native?.kind !== 'error',
			result,
		});
	}
	return checks;
}

export interface RepairOutcome {
	repair: AdapterCheckResult;
	repairedCount: number;
	failedCount: number;
	details: TargetRepairDetail[];
}

export interface TargetRepairDetail {
	targetId: string;
	label: string;
	runtime: RuntimeName;
	repair: SyncRepairResult;
	followUp?: SyncRuntimeCheckResult;
}

export interface RepairSummary {
	manifest: ManifestCheckResult;
	checkResult: AdapterCheckResult;
	repair: AdapterCheckResult;
	repairedCount: number;
	failedCount: number;
	/** True when the manifest check failed and no repair was attempted. */
	aborted: boolean;
	details: TargetRepairDetail[];
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
	if (manifest.status === 'failed' || manifest.resources?.status === 'failed') {
		const failure = manifest.status === 'failed' ? manifest : { status: 'failed' as const, output: strings.sourceResourcesBlocked, exitCode: 1 };
		return {
			manifest,
			checkResult: failure,
			repair: failure,
			repairedCount: 0,
			failedCount: 1,
			aborted: true,
			details: [],
		};
	}

	const checks = await collectTargetChecks(context, vaultPath, manifest.snapshot ?? undefined);
	const checkResult = combineResults(manifest, aggregateTargetChecks(checks, strings.noRepairTargets));
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
			details: [],
		};
	}

	const { repair, repairedCount, failedCount, details } = await repairDriftedTargets(
		context,
		vaultPath,
		drifted,
		blocked.length,
		strings,
		manifest.snapshot ?? undefined,
	);
	const finalChecks = checks.map((check) => {
		const detail = details.find((item) => item.targetId === check.target.id);
		return detail ? { ...check, result: detail.followUp ?? checkResultFromRepair(detail.repair), repairFailed: detail.repair.status === 'failed' } : check;
	});
	return { manifest, checkResult: combineResults(manifest, aggregateTargetChecks(finalChecks, strings.noRepairTargets)), repair, repairedCount, failedCount, details, aborted: false };
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
	snapshot?: SyncManifestSnapshot,
): Promise<RepairOutcome> {
	const repairOutputs: string[] = [];
	let repairedCount = 0;
	let failedCount = blockedCount;
	let firstFailureCode: number | undefined;
	const details: TargetRepairDetail[] = [];

	for (const check of drifted) {
		if (context.isCurrent?.() === false) {
			failedCount += drifted.length - details.length;
			firstFailureCode ??= 1;
			repairOutputs.push(strings.checksStale);
			break;
		}
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
		const repair = await context.provider.repairRuntime(vaultPath, runtime, check.target.path, snapshot);
		const detail: TargetRepairDetail = { targetId: check.target.id, label, runtime, repair };
		details.push(detail);
		if (repair.status === 'failed') {
			context.onTargetCheck?.({ ...check, result: checkResultFromRepair(repair), repairFailed: true });
			failedCount += 1;
			firstFailureCode ??= repair.exitCode;
			repairOutputs.push(`[${label}] REPAIR FAILED\n${repair.output}`);
			continue;
		}

		context.onTargetActivity?.({ targetId: check.target.id, phase: 'checking' });
		const followUp = await context.provider.checkRuntime(vaultPath, runtime, check.target.path, snapshot);
		detail.followUp = followUp;
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
		details,
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

function checkResultFromRepair(result: SyncRepairResult): SyncRuntimeCheckResult {
	return { status: result.status, output: result.output, exitCode: result.exitCode };
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
	return isInside(vaultPath, targetPath);
}

async function targetPathFailure(
	vaultPath: string,
	targetPath: string,
	snapshot?: SyncManifestSnapshot,
): Promise<string | null> {
	const [vault, target, source] = await Promise.all([
		existingRealPath(snapshot?.vaultPath ?? vaultPath),
		existingRealPath(targetPath),
		snapshot?.sharedRoot ? existingRealPath(snapshot.sharedRoot) : Promise.resolve(undefined),
	]);
	if (isInside(vault, target)) return `Repair target must be outside the vault: ${target}`;
	if (source && pathsOverlap(source, target)) {
		return `Repair target must not overlap the canonical skill source: ${target}`;
	}
	return null;
}

export function desktopPathFailure(): AdapterCheckResult {
	return {
		status: 'failed',
		output: 'The active vault adapter does not expose a desktop base path.',
		exitCode: 1,
	};
}
