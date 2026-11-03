import path from 'node:path';
import { normalizeVaultPath } from '../utils/vault-paths';
import { resolveSyncSource, type SyncSourceSettings } from './source';

export interface VaultChangeImpact {
	/** A file changed inside an enabled vault-based skill root. */
	affectsIndex: boolean;
	/** The index or selected manifest changed, so adapter results are stale. */
	affectsChecks: boolean;
}

export interface ResolvedVaultSource { sharedRoot: string; manifestPath: string }

/**
 * Decide which cached plugin state a set of vault-relative file changes affects.
 * Invalid source settings leave manifest matching unavailable; the next check
 * reports that configuration error, while configured skill-root changes still
 * invalidate existing results.
 */
export function getVaultChangeImpact(
	changedPaths: string[],
	settings: SyncSourceSettings,
	vaultPath: string | null,
	resolvedSource?: ResolvedVaultSource | null,
): VaultChangeImpact {
	const normalizedRoots = settings.roots
		.filter((root) => root.enabled && root.kind === 'vault' && root.path.trim())
		.map((root) => normalizeVaultPath(root.path));
	let affectsIndex = changedPaths.some((changedPath) =>
		normalizedRoots.some((root) => changedPath === root || changedPath.startsWith(`${root}/`)),
	);
	let affectsChecks = affectsIndex;
	try {
		if (vaultPath) {
			const source = resolveSyncSource(vaultPath, settings);
			affectsChecks ||= changedPaths.some((changedPath) => path.resolve(vaultPath, changedPath) === source.manifestPath);
			if (resolvedSource) {
				affectsChecks ||= changedPaths.some((changedPath) => path.resolve(vaultPath, changedPath) === path.resolve(resolvedSource.manifestPath));
			}
		}
	} catch {
		// Invalid source configuration is reported by the next check.
	}
	if (vaultPath && resolvedSource) {
		const affectsResolvedSource = changedPaths.some((changedPath) => {
			const changed = path.resolve(vaultPath, changedPath);
			return changed === resolvedSource.sharedRoot || changed.startsWith(`${resolvedSource.sharedRoot}${path.sep}`);
		});
		affectsIndex ||= affectsResolvedSource;
		affectsChecks ||= affectsResolvedSource;
	}
	return { affectsIndex, affectsChecks };
}
