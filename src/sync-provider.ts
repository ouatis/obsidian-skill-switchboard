import type { AdapterCheckResult } from './sync/result';
import type { RuntimeName } from './types';
import { inspectManifest, type ManifestCheckResult } from './sync/manifest';
import { checkRuntimeNative, type NativeCheckResult } from './sync/native-check';
import { repairRuntimeNative } from './sync/native-repair';

export { inspectManifest } from './sync/manifest';
export type { ManifestCheckResult, SyncManifestSnapshot } from './sync/manifest';

export interface SyncRuntimeCheckResult extends AdapterCheckResult {
	native?: NativeCheckResult;
}

export interface SyncProvider {
	readonly id: string;
	inspectManifest(vaultPath: string): Promise<ManifestCheckResult>;
	checkRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string): Promise<SyncRuntimeCheckResult>;
	repairRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string): Promise<AdapterCheckResult>;
}

export class JardinNativeSyncProvider implements SyncProvider {
	readonly id = 'jardin-native';

	inspectManifest(vaultPath: string): Promise<ManifestCheckResult> {
		return inspectManifest(vaultPath);
	}

	async checkRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string): Promise<SyncRuntimeCheckResult> {
		const manifest = await inspectManifest(vaultPath);
		if (manifest.status === 'failed' || !manifest.snapshot) return manifest;
		const native = await checkRuntimeNative(vaultPath, runtime, targetPath, manifest.snapshot);
		return {
			...native,
			native,
		};
	}

	async repairRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string): Promise<AdapterCheckResult> {
		const manifest = await inspectManifest(vaultPath);
		if (manifest.status === 'failed' || !manifest.snapshot) return manifest;
		return repairRuntimeNative(vaultPath, runtime, targetPath, manifest.snapshot);
	}
}

export function createSyncProvider(): SyncProvider {
	return new JardinNativeSyncProvider();
}
