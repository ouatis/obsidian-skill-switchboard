import type { RuntimeName } from '../types';
import type { AdapterCheckResult } from './result';
import type { SyncManifestSnapshot } from './manifest';
import { prepareRuntime } from './native-check';
import { installPackage, type InstallOptions } from './install-package';

export interface RepairChange { skill: string; path: string; kind: 'package'; action: 'created' | 'updated' }
export interface NativeRepairResult extends AdapterCheckResult {
	writtenFiles: number;
	replacedDirectories: number;
	changedSkills: string[];
	changes: RepairChange[];
	partial?: boolean;
	blockedSkills?: string[];
}
export interface NativeRepairOptions extends InstallOptions { opencodeCommandsDir?: string }

/** One-way distribution. No edited Agent copy is ever promoted to the canonical source. */
export async function repairRuntimeNative(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot: SyncManifestSnapshot, options: NativeRepairOptions = {}): Promise<NativeRepairResult> {
	const changes: RepairChange[] = [];
	const problems: string[] = [];
	const blockedSkills: string[] = [];
	let writtenFiles = 0;
	try {
		for (const plan of await prepareRuntime(vaultPath, runtime, targetPath, snapshot)) {
			if (options.isCurrent?.() === false) { problems.push('Repair was cancelled; remaining packages were not changed.'); break; }
			try {
				if (!plan.bundle) throw new Error(plan.state.detail);
				const result = await installPackage(plan.bundle, snapshot.vaultPath, snapshot.sharedRoot, options);
				if (result.changed) changes.push({ skill: plan.name, path: plan.bundle.directory, kind: 'package', action: plan.state.kind === 'missing' ? 'created' : 'updated' });
				writtenFiles += result.files;
				problems.push(...(result.cleanupWarnings ?? []));
			} catch (error) {
				blockedSkills.push(plan.name);
				problems.push(`${plan.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	} catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
	return {
		status: problems.length ? 'failed' : 'passed', exitCode: problems.length ? 1 : 0,
		output: [`[distribution] ${problems.length ? 'INCOMPLETE' : 'PASS'}`, `Installed ${changes.length} complete skill package(s), ${writtenFiles} file(s).`, ...problems].join('\n'),
		writtenFiles, replacedDirectories: changes.filter((change) => change.action === 'updated').length, changes,
		changedSkills: changes.map((change) => change.skill),
		partial: problems.length > 0 && changes.length > 0, blockedSkills,
	};
}
