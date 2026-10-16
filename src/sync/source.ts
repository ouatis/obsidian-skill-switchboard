import path from 'node:path';
import type { SkillRoot } from '../types';
import { resolveConfiguredPath } from '../utils/paths';

export interface SyncSourceSettings {
	roots: SkillRoot[];
	syncRootId?: string;
	syncManifestPath?: string;
}

export interface ManifestLocation {
	sharedRoot: string;
	manifestPath: string;
	/** Reject symlink escapes when the configured source is inside the vault. */
	confineToVault?: boolean;
	/** Optional injection for isolated tests; production uses the home-directory registry. */
	packageRegistryPath?: string;
}

/** The selected source drives both indexing and distribution; no vault layout is special. */
export function resolveSyncSource(vaultPath: string, settings: SyncSourceSettings): ManifestLocation {
	const root = settings.syncRootId
		? settings.roots.find((item) => item.id === settings.syncRootId)
		: settings.roots.find((item) => item.enabled && item.path.trim());
	if (!root?.enabled || !root.path.trim()) throw new Error('Choose an enabled canonical source in settings.');
	const sharedRoot = resolveConfiguredPath(root.path, vaultPath);
	const relative = path.relative(path.resolve(vaultPath), sharedRoot);
	if (root.kind === 'vault' && (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`))) {
		throw new Error('A vault source must stay inside the vault; choose an external root for desktop folders.');
	}
	return {
		sharedRoot,
		manifestPath: settings.syncManifestPath?.trim()
			? resolveConfiguredPath(settings.syncManifestPath, vaultPath)
			: path.join(path.dirname(sharedRoot), 'skills-manifest.json'),
		confineToVault: root.kind === 'vault',
	};
}

export function settingsCheckKey(settings: SyncSourceSettings & { targets: unknown[] }): string {
	return JSON.stringify({ roots: settings.roots, root: settings.syncRootId, manifest: settings.syncManifestPath, targets: settings.targets });
}
