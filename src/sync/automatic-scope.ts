import { createHash } from 'node:crypto';
import type { SkillSwitchboardSettings } from '../settings';
import { existingRealPath } from './filesystem';
import { resolveSyncSource } from './source';
import { getRepairTargets } from './adapter-run';
import { isInside, pathsOverlap, resolveConfiguredPath } from '../utils/paths';

export interface AutomaticScope { key: string; details: string }

/** Content may change under a grant; source selection and write destinations may not. */
export function automaticWiringKey(settings: SkillSwitchboardSettings): string {
	const root = settings.roots.find((item) => item.id === settings.syncRootId)
		?? (!settings.syncRootId ? settings.roots.find((item) => item.enabled && item.path.trim()) : undefined);
	return JSON.stringify({ root: root && { id: root.id, path: root.path, kind: root.kind, enabled: root.enabled },
		manifest: settings.syncManifestPath, targets: getRepairTargets(settings.targets)
			.map(({ id, runtime, path }) => ({ id, runtime, path })).sort((a, b) => a.id.localeCompare(b.id)) });
}

export async function resolveAutomaticScope(vaultPath: string, settings: SkillSwitchboardSettings): Promise<AutomaticScope> {
	const wiring = automaticWiringKey(settings);
	const location = resolveSyncSource(vaultPath, settings);
	const configured = getRepairTargets(settings.targets).map((target) => ({ ...target })).sort((a, b) => a.id.localeCompare(b.id));
	if (!configured.length) throw new Error('Configure at least one Agent target before authorizing automatic distribution.');
	const [vault, source, manifest] = await Promise.all([existingRealPath(vaultPath), existingRealPath(location.sharedRoot), existingRealPath(location.manifestPath)]);
	if (location.confineToVault && (!isInside(vault, source) || !isInside(vault, manifest))) throw new Error('Vault source or manifest resolves outside the vault.');
	const targets = await Promise.all(configured.map(async (target) => ({ id: target.id, runtime: target.runtime,
		path: await existingRealPath(resolveConfiguredPath(target.path, vaultPath)) })));
	for (const [index, target] of targets.entries()) {
		if (isInside(vault, target.path) || pathsOverlap(source, target.path)) throw new Error('Automatic targets must stay outside the vault and source.');
		if (targets.slice(0, index).some((other) => pathsOverlap(other.path, target.path))) throw new Error('Automatic Agent targets must not overlap each other.');
	}
	if (automaticWiringKey(settings) !== wiring) throw new Error('Connection settings changed while checking authorization.');
	return { key: createHash('sha256').update(JSON.stringify({ wiring, vault, source, manifest, targets })).digest('hex'),
		details: [`Source: ${source}`, `Manifest: ${manifest}`, ...targets.map((target) => `${target.runtime}: ${target.path}`)].join('\n') };
}
