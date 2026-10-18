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
export interface RepairControl { isCurrent?: () => boolean }

export interface SyncProvider {
	readonly id: string;
	inspectManifest(vaultPath: string): Promise<ManifestCheckResult>;
	checkRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot?: SyncManifestSnapshot): Promise<SyncRuntimeCheckResult>;
	repairRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot?: SyncManifestSnapshot, control?: RepairControl): Promise<SyncRepairResult>;
}

export class NativeSyncProvider implements SyncProvider {
	readonly id = 'native';
	constructor(private readonly source?: (vaultPath: string) => ManifestLocation) {}

	async inspectManifest(vaultPath: string): Promise<ManifestCheckResult> {
		try { return await inspectManifest(vaultPath, this.source?.(vaultPath)); }
		catch (error) { return { status: 'failed', output: error instanceof Error ? error.message : String(error), exitCode: 1, snapshot: null }; }
	}

	async checkRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot?: SyncManifestSnapshot): Promise<SyncRuntimeCheckResult> {
		const manifest = snapshot ? null : await this.inspectManifest(vaultPath);
		const selected = snapshot ?? manifest?.snapshot;
		if (!selected) return manifest as ManifestCheckResult;
		const native = await checkRuntimeNative(vaultPath, runtime, targetPath, selected);
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
		const native = await repairRuntimeNative(vaultPath, runtime, targetPath, manifest.snapshot, control);
		return { ...native, native };
	}
}

export function createSyncProvider(source?: (vaultPath: string) => ManifestLocation): SyncProvider {
	return new NativeSyncProvider(source);
}
