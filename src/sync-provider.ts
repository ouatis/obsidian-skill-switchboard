import type { AdapterCheckResult } from './sync/result';
import type { RuntimeName } from './types';
import { inspectManifest, sameSourceSnapshot, type ManifestCheckResult, type SyncManifestSnapshot } from './sync/manifest';
import type { ManifestLocation } from './sync/source';
import { checkRuntimeNative, type NativeCheckResult } from './sync/native-check';
import { repairRuntimeNative, type NativeRepairResult } from './sync/native-repair';

export { inspectManifest } from './sync/manifest';
export type { ManifestCheckResult, SyncManifestSnapshot } from './sync/manifest';

export interface SyncRuntimeCheckResult extends AdapterCheckResult {
	native?: NativeCheckResult;
}

export interface SyncRepairResult extends AdapterCheckResult { native?: NativeRepairResult }
export interface RepairControl {
	isCurrent?: () => boolean;
	snapshotDirectory?: string;
	/** Where install evidence is kept, so a sweep can tell a managed copy from a foreign one. */
	ledgerDirectory?: string;
	/** Remove copies whose source skill left the manifest. */
	sweepOrphans?: boolean;
	/**
	 * Retire orphans without writing anything else.
	 *
	 * This is the dedicated retirement command's whole point: a user who removed a
	 * skill from the source should not have to re-install every other copy to get
	 * the stale one removed. When set, a provider only sweeps.
	 */
	retireOnly?: boolean;
}

export interface SyncProvider {
	readonly id: string;
	inspectManifest(vaultPath: string): Promise<ManifestCheckResult>;
	checkRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot?: SyncManifestSnapshot, control?: RepairControl): Promise<SyncRuntimeCheckResult>;
	repairRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot?: SyncManifestSnapshot, control?: RepairControl): Promise<SyncRepairResult>;
}

type SyncSourceResolver = (vaultPath: string) => ManifestLocation | Promise<ManifestLocation>;

export class NativeSyncProvider implements SyncProvider {
	readonly id = 'native';
	constructor(private readonly source?: SyncSourceResolver) {}

	async inspectManifest(vaultPath: string): Promise<ManifestCheckResult> {
		try { return await inspectManifest(vaultPath, await this.source?.(vaultPath)); }
		catch (error) { return { status: 'failed', output: error instanceof Error ? error.message : String(error), exitCode: 1, snapshot: null }; }
	}

	async checkRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot?: SyncManifestSnapshot, control?: RepairControl): Promise<SyncRuntimeCheckResult> {
		const manifest = snapshot ? null : await this.inspectManifest(vaultPath);
		const selected = snapshot ?? manifest?.snapshot;
		if (!selected) return manifest as ManifestCheckResult;
		const native = await checkRuntimeNative(vaultPath, runtime, targetPath, selected, { ledgerDirectory: control?.ledgerDirectory });
		return {
			...native,
			native,
		};
	}

	async repairRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot?: SyncManifestSnapshot, control?: RepairControl): Promise<SyncRepairResult> {
		const manifest = await this.inspectManifest(vaultPath);
		if (manifest.status === 'failed' || !manifest.snapshot) return manifest;
		// Re-read the source before writing; never apply a snapshot whose rules changed.
		if (snapshot && !sameSourceSnapshot(snapshot, manifest.snapshot)) {
			return { status: 'failed', exitCode: 1, output: 'Source changed during repair. Check again before writing.' };
		}
		const native = await repairRuntimeNative(vaultPath, runtime, targetPath, manifest.snapshot, {
			...control,
			ledgerDirectory: control?.ledgerDirectory ?? control?.snapshotDirectory,
			// Retiring is a kind of sweep, so it implies one.
			sweepOrphans: control?.sweepOrphans || control?.retireOnly,
		});
		return { ...native, native };
	}
}

export function createSyncProvider(source?: SyncSourceResolver): SyncProvider {
	return new NativeSyncProvider(source);
}
