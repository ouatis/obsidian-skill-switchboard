import { promises as fs } from 'node:fs';
import type { RuntimeName } from '../types';
import type { AdapterCheckResult } from './result';
import type { SyncManifestSnapshot } from './manifest';
import { forgetInstall } from './install-ledger';
import { orphanScan, prepareRuntime } from './native-check';
import { installPackage, type InstallOptions } from './install-package';
import { createTargetSnapshot } from './target-snapshot';
import { retryFileOperation } from './file-retry';
import { resolveConfiguredPath } from '../utils/paths';

export interface RepairChange { skill: string; path: string; kind: 'package'; action: 'created' | 'updated' }
export interface NativeRepairResult extends AdapterCheckResult {
	writtenFiles: number;
	replacedDirectories: number;
	changedSkills: string[];
	changes: RepairChange[];
	/** Copies removed because the source skill left the manifest. */
	retiredSkills?: string[];
	/** Orphans reported but kept, with the reason. */
	keptOrphans?: string[];
	partial?: boolean;
	blockedSkills?: string[];
}
export interface NativeRepairOptions extends InstallOptions {
	opencodeCommandsDir?: string;
	/** Remove installed copies whose source skill is no longer in the manifest. */
	sweepOrphans?: boolean;
}

/** One-way distribution. No edited Agent copy is ever promoted to the canonical source. */
export async function repairRuntimeNative(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot: SyncManifestSnapshot, options: NativeRepairOptions = {}): Promise<NativeRepairResult> {
	const changes: RepairChange[] = [];
	const problems: string[] = [];
	const blockedSkills: string[] = [];
	const retiredSkills: string[] = [];
	const keptOrphans: string[] = [];
	let writtenFiles = 0;
	try {
		const plans = await prepareRuntime(vaultPath, runtime, targetPath, snapshot);
		const targetLabel = resolveConfiguredPath(targetPath, vaultPath);
		for (const plan of plans) {
			if (options.isCurrent?.() === false) { problems.push('Repair was cancelled; remaining packages were not changed.'); break; }
			try {
				if (!plan.bundle) throw new Error(plan.state.detail);
				const result = await installPackage(plan.bundle, snapshot.vaultPath, snapshot.sharedRoot, { ...options, targetLabel, runtime });
				if (result.changed) changes.push({ skill: plan.name, path: plan.bundle.directory, kind: 'package', action: plan.state.kind === 'missing' ? 'created' : 'updated' });
				writtenFiles += result.files;
				problems.push(...(result.cleanupWarnings ?? []));
			} catch (error) {
				blockedSkills.push(plan.name);
				problems.push(`${plan.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (options.sweepOrphans) {
			const sweep = await sweepRuntimeOrphans(vaultPath, runtime, targetPath, snapshot, options);
			retiredSkills.push(...sweep.retired);
			keptOrphans.push(...sweep.kept);
			problems.push(...sweep.problems);
		}
	} catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
	return {
		status: problems.length ? 'failed' : 'passed', exitCode: problems.length ? 1 : 0,
		output: [
			`[distribution] ${problems.length ? 'INCOMPLETE' : 'PASS'}`,
			`Installed ${changes.length} complete skill package(s), ${writtenFiles} file(s); retired ${retiredSkills.length} copy/copies whose source is gone.`,
			...problems,
		].join('\n'),
		writtenFiles,
		replacedDirectories: changes.filter((change) => change.action === 'updated').length,
		changes,
		changedSkills: changes.map((change) => change.skill),
		retiredSkills,
		keptOrphans,
		partial: problems.length > 0 && changes.length + retiredSkills.length > 0,
		blockedSkills,
	};
}

/**
 * Removes copies whose source skill is no longer in the manifest.
 *
 * A copy is removed only when the ledger says this plugin installed it and the
 * tree still holds exactly what that install recorded. Both are required: the
 * first says the copy is ours to retire, the second says nothing of the user's
 * own work is inside it. A snapshot is taken first, so the removal can be undone;
 * without one the copy is reported and left alone.
 */
async function sweepRuntimeOrphans(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot: SyncManifestSnapshot, options: NativeRepairOptions): Promise<{ retired: string[]; kept: string[]; problems: string[] }> {
	const retired: string[] = [];
	const kept: string[] = [];
	const problems: string[] = [];
	const store = options.ledgerDirectory;
	if (!store) return { retired, kept, problems };

	const scan = await orphanScan(vaultPath, runtime, targetPath, snapshot, store);
	for (const candidate of [...scan.sweepable, ...scan.kept]) {
		if (candidate.reason !== null) {
			kept.push(`${candidate.path} (${candidate.reason})`);
			continue;
		}
		if (options.isCurrent?.() === false) { problems.push('Sweep was cancelled; the remaining orphan copies were left alone.'); break; }
		try {
			// The copy may be the only place the tree still exists, so a
			// snapshot is what makes the removal reversible. Without one, skip.
			try {
				await createTargetSnapshot({ skill: candidate.skill, source: candidate.path, store, fingerprint: candidate.fingerprint });
			} catch (error) {
				kept.push(`${candidate.path} (no snapshot)`);
				problems.push(`Kept ${candidate.path}: a retirement snapshot could not be created (${error instanceof Error ? error.message : String(error)}).`);
				continue;
			}
			await retryFileOperation(() => fs.rm(candidate.path, { recursive: true, force: true }));
			await forgetInstall(store, runtime, candidate.path);
			retired.push(candidate.path);
		} catch (error) {
			problems.push(`Could not retire ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { retired, kept: [...new Set(kept)], problems };
}
