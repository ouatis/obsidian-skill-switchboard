import path from 'node:path';
import type { Strings } from '../i18n';
import type { RuntimeName, RuntimeTarget } from '../types';
import type { AdapterCheckResult } from './result';
import type { ManifestCheckResult, SyncProvider, SyncRuntimeCheckResult, SyncManifestSnapshot, SyncRepairResult } from '../sync-provider';
import type { ResourceCheck, PackageCheck } from './resources';
import { adapterFor, isInside, pathsOverlap, sameSourceSnapshot } from './manifest';
import { existingRealPath } from './filesystem';
import { resolveConfiguredPath } from '../utils/paths';
import { planInstalls } from './install-plan';

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
	/** When set, each displaced target tree is snapshotted here before repair writes. */
	snapshotDirectory?: string;
	/** Where install evidence is kept. Without it no orphan can be identified or retired. */
	ledgerDirectory?: string;
	/**
	 * Let a repair retire installed copies whose source skill left the manifest.
	 *
	 * Off by default: deleting a directory is a different class of action from
	 * overwriting one, so only a caller that asked for retirement gets it. Manual
	 * repair turns it on because the confirmation named the copies; automatic
	 * distribution leaves it off because nobody confirmed anything.
	 */
	sweepOrphans?: boolean;
	/**
	 * Retire orphans without installing anything.
	 *
	 * The dedicated retirement command is the only caller that sets this: a user
	 * who removed a skill from the source should not have to re-write every other
	 * copy to get one stale copy removed, and a report full of installs would stop
	 * answering the question that was asked.
	 */
	retireOnly?: boolean;
}

export interface AdapterRun {
	result: AdapterCheckResult;
	manifest: ManifestCheckResult;
	checks: TargetCheck[];
}

export function getRepairTargets(targets: RuntimeTarget[]): RepairTarget[] {
	return targets.filter(
		(target): target is RepairTarget =>
			target.enabled && (target.mode === 'copy' || target.mode === 'wrapper') && Boolean(target.runtime && target.path.trim()),
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
	const resources = resourcesForTargets(manifest, context.settings.targets);
	const resourceReport = resources && resources.status !== 'passed' ? formatResourceCheck(resources) : null;
	return {
		result: combineResults(manifest, aggregateTargetChecks(checks, emptyMessage), ...(resourceReport ? [resourceReport] : [])),
		manifest,
		checks,
	};
}

function resourcesForTargets(manifest: ManifestCheckResult, targets: RuntimeTarget[]): ResourceCheck | undefined {
	if (!manifest.resources || !manifest.snapshot?.skills) return manifest.resources;
	const runtimes = getRepairTargets(targets).map((target) => target.runtime);
	const names = new Set(manifest.snapshot.skills.filter((skill) => runtimes.some((runtime) => adapterFor(skill, runtime) !== null)).map((skill) => skill.name));
	const packages = manifest.resources.packages.filter((item) => names.has(item.skill));
	return { ...manifest.resources, packages, status: packages.some((item) => item.status === 'failed') ? 'failed' : packages.some((item) => item.status === 'warning') ? 'warning' : 'passed' };
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
		const result = await context.provider.checkRuntime(vaultPath, target.runtime, target.path, snapshot, { ledgerDirectory: context.ledgerDirectory });
		const plan = result.native?.installs ? planInstalls(result.native.installs) : null;
		record({
			target,
			targetPath: resolvedTarget,
			repairable: result.native?.kind !== 'error' && (plan ? result.status === 'passed' || plan.writes > 0 || ((result.native?.orphanCandidates?.length ?? 0) > 0) : result.native?.kind !== 'blocked'),
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

/** What one retirement pass did, across every target. */
export interface RetirementOutcome {
	/** The sweep result per target, or a skip line when there was nothing to do. */
	report: AdapterCheckResult;
	/** Copies actually removed. */
	retiredCount: number;
	/** Copies kept back, with the reason in parentheses. */
	kept: string[];
	/** Targets whose sweep failed, so the caller can report them. */
	failedCount: number;
}

/**
 * Retires orphaned copies and writes nothing else.
 *
 * A user who removed a skill from the source should not have to re-write every
 * healthy copy to get the stale one removed: that would make a deletion request
 * produce a report full of installs, and the counts would stop answering the
 * question that was asked. So this runs the sweep alone, through a repair that
 * is told to write nothing.
 *
 * What may go is decided by the same rule as everywhere else: the ledger names
 * the copy and its tree still matches what the install recorded. Everything
 * else is reported and kept.
 */
export async function retireOrphanCopies(
	context: AdapterRunContext,
	vaultPath: string,
	strings: Strings,
	snapshot?: SyncManifestSnapshot,
): Promise<RetirementOutcome> {
	const lines: string[] = [];
	const kept: string[] = [];
	let retiredCount = 0;
	let failedCount = 0;
	let firstFailureCode: number | undefined;

	for (const check of await collectTargetChecks(context, vaultPath, snapshot)) {
		if (context.isCurrent?.() === false) {
			failedCount += 1;
			firstFailureCode ??= 1;
			lines.push(strings.checksStale);
			break;
		}
		const label = displayTargetName(check.target);
		if (!check.targetPath) {
			failedCount += 1;
			firstFailureCode ??= 1;
			lines.push(`[${label}] RETIRE FAILED\n${check.result.output}`);
			continue;
		}
		// No ledger, no evidence: a copy the plugin cannot name is not its to remove.
		if (!context.ledgerDirectory) {
			lines.push(`[${label}] RETIRE SKIPPED\n${strings.orphanLedgerUnavailable}`);
			continue;
		}
		const repair = await context.provider.repairRuntime(vaultPath, check.target.runtime, check.target.path, snapshot, {
			isCurrent: context.isCurrent,
			snapshotDirectory: context.snapshotDirectory,
			ledgerDirectory: context.ledgerDirectory,
			retireOnly: true,
		});
		const retired = (repair.native?.retiredSkills ?? []).length;
		retiredCount += retired;
		kept.push(...(repair.native?.keptOrphans ?? []));
		if (repair.status === 'failed') {
			failedCount += 1;
			firstFailureCode ??= repair.exitCode;
			lines.push(`[${label}] RETIRE FAILED\n${repair.output}`);
			continue;
		}
		lines.push(`[${label}] RETIRED ${retired}\n${repair.output}`);
	}

	return {
		report: {
			status: failedCount === 0 ? 'passed' : 'failed',
			output: lines.filter(Boolean).join('\n\n'),
			exitCode: firstFailureCode ?? 0,
		},
		retiredCount,
		kept,
		failedCount,
	};
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
	approvedSnapshot?: SyncManifestSnapshot,
): Promise<RepairSummary> {
	const manifest = await context.provider.inspectManifest(vaultPath);
	const failure = manifest.status === 'failed' ? manifest
		: approvedSnapshot && (!manifest.snapshot || !sameSourceSnapshot(approvedSnapshot, manifest.snapshot))
			? { status: 'failed' as const, output: strings.checksStale, exitCode: 1 } : null;
	if (failure) {
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
		return detail ? { ...check, result: detail.followUp ?? checkResultFromRepair(detail.repair), repairFailed: detail.repair.status === 'failed' && !detail.repair.native?.partial } : check;
	});
	return { manifest, checkResult: combineResults(manifest, aggregateTargetChecks(finalChecks, strings.noRepairTargets)), repair, repairedCount, failedCount, details, aborted: false };
}

/**
 * Repairs each eligible package target and re-checks it afterwards. `blockedCount`
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
	// A sweep needs the install evidence, so it is only possible when the caller
	// supplied a ledger directory; on top of that the caller must opt in.
	const sweepOrphans = context.sweepOrphans === true && context.ledgerDirectory !== undefined;
	const retireOnly = context.retireOnly === true && sweepOrphans;

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
		const repair = await context.provider.repairRuntime(vaultPath, runtime, check.target.path, snapshot, {
			isCurrent: context.isCurrent,
			snapshotDirectory: context.snapshotDirectory,
			ledgerDirectory: context.ledgerDirectory,
			retireOnly,
			// A sweep removes directories, so it needs both the install evidence and
			// an explicit opt-in from the caller.
			sweepOrphans,
		});
		const detail: TargetRepairDetail = { targetId: check.target.id, label, runtime, repair };
		details.push(detail);
		if (repair.status === 'failed' && !repair.native?.partial) {
			context.onTargetCheck?.({ ...check, result: checkResultFromRepair(repair), repairFailed: true });
			failedCount += 1;
			firstFailureCode ??= repair.exitCode;
			repairOutputs.push(`[${label}] REPAIR FAILED\n${repair.output}`);
			continue;
		}

		context.onTargetActivity?.({ targetId: check.target.id, phase: 'checking' });
		const followUp = await context.provider.checkRuntime(vaultPath, runtime, check.target.path, undefined, { ledgerDirectory: context.ledgerDirectory });
		detail.followUp = followUp;
		context.onTargetCheck?.({ ...check, result: followUp, repairFailed: false });
		if (followUp.status === 'passed' && repair.status === 'passed') {
			repairedCount += 1;
			repairOutputs.push(
				`[${label}] REPAIRED\n${repair.output}\n--- follow-up check ---\n${followUp.output}`,
			);
		} else {
			failedCount += 1;
			firstFailureCode ??= repair.status === 'failed' ? repair.exitCode : followUp.exitCode;
			repairOutputs.push(
				`[${label}] ${repair.native?.partial ? 'PARTIAL (some operations incomplete)' : 'REPAIR FAILED (follow-up)'}\n${repair.output}\n--- follow-up check ---\n${followUp.output}`,
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
