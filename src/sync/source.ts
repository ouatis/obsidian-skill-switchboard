import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillRoot } from '../types';
import { isInside, resolveConfiguredPath } from '../utils/paths';

export interface SyncSourceSettings {
	roots: SkillRoot[];
	syncRootId?: string;
	syncManifestPath?: string;
}

export interface ManifestLocation {
	sharedRoot: string;
	manifestPath: string;
	/** True when a missing vault root was safely located by scanning the vault. */
	autoDiscovered?: boolean;
	/** Reject symlink escapes when the configured source is inside the vault. */
	confineToVault?: boolean;
	/** Optional injection for isolated tests; production uses the home-directory registry. */
	packageRegistryPath?: string;
	manifestRequired?: boolean;
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
		...(settings.syncManifestPath?.trim() ? { manifestRequired: true } : {}),
	};
}

const discoveredRoots = new Map<string, string>();

/**
 * Resolve the selected source, recovering from a stale/missing vault-relative
 * default without changing the user's saved settings. Explicit manifest paths
 * and external roots remain strict overrides.
 */
export async function resolveSyncSourceForVault(vaultPath: string, settings: SyncSourceSettings): Promise<ManifestLocation> {
	const location = resolveSyncSource(vaultPath, settings);
	if (!location.confineToVault || settings.syncManifestPath?.trim()) return location;
	try {
		await fs.realpath(location.sharedRoot);
		return location;
	} catch (error) {
		if (!isNodeError(error, 'ENOENT')) throw error;
	}

	const discoveredRoot = await discoverVaultSkillsRoot(vaultPath);
	if (!discoveredRoot) throw new Error(`Configured skills folder was not found: ${location.sharedRoot}. No unambiguous skills folder was found in this vault.`);
	return {
		...location,
		sharedRoot: discoveredRoot,
		manifestPath: path.join(path.dirname(discoveredRoot), 'skills-manifest.json'),
		autoDiscovered: true,
	};
}

const MAX_DISCOVERY_DIRECTORIES = 20_000;
const MAX_DISCOVERY_DEPTH = 12;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.trash']);
const SEARCHABLE_HIDDEN_DIRECTORIES = new Set(['.agents', '.claude', '.codex']);

/** Locate a unique skills/ folder with either SKILL.md entries or a sibling manifest. */
export async function discoverVaultSkillsRoot(vaultPath: string): Promise<string | null> {
	const resolvedVault = await fs.realpath(vaultPath);
	const cacheKey = resolvedVault;
	const cachedRoot = discoveredRoots.get(cacheKey);
	if (cachedRoot) {
		try {
			const realRoot = await fs.realpath(cachedRoot);
			if (isInside(resolvedVault, realRoot)) return realRoot;
			discoveredRoots.delete(cacheKey);
		} catch (error) {
			if (!isNodeError(error, 'ENOENT')) throw error;
			discoveredRoots.delete(cacheKey);
		}
	}
	const candidates: string[] = [];
	const skillFiles: string[] = [];
	let visited = 0;

	async function visit(directory: string, depth: number): Promise<void> {
		if (depth > MAX_DISCOVERY_DEPTH) return;
		if (++visited > MAX_DISCOVERY_DIRECTORIES) throw new Error('Skills auto-discovery reached its safety limit. Set the source folder manually.');
		const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
			if (isNodeError(error, 'ENOENT') || isNodeError(error, 'EACCES')) return null;
			throw error;
		});
		if (!entries) return;
		const subdirectories: string[] = [];
		for (const entry of entries) {
			if (entry.isFile() && entry.name === 'SKILL.md') skillFiles.push(path.join(directory, entry.name));
			if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) continue;
			const child = path.join(directory, entry.name);
			if (/^skills?$/i.test(entry.name)) candidates.push(child);
			if (entry.name.startsWith('.') && !SEARCHABLE_HIDDEN_DIRECTORIES.has(entry.name)) continue;
			subdirectories.push(child);
		}
		for (const child of subdirectories) await visit(child, depth + 1);
	}

	await visit(resolvedVault, 0);
	const withManifest: string[] = [];
	const withSkillFiles: string[] = [];
	for (const candidate of candidates) {
		const siblingManifest = path.join(path.dirname(candidate), 'skills-manifest.json');
		if (await manifestHasSkills(siblingManifest, resolvedVault)) withManifest.push(candidate);
		if (skillFiles.some((file) => isInside(candidate, file))) withSkillFiles.push(candidate);
	}
	const preferred = withManifest.length ? withManifest : withSkillFiles;
	const unique = [...new Set(preferred)].sort((left, right) => left.localeCompare(right));
	if (unique.length > 1) {
		const choices = unique.map((candidate) => path.relative(resolvedVault, candidate).replaceAll(path.sep, '/')).join(', ');
		throw new Error(`More than one skills folder was found (${choices}). Choose the canonical source in settings.`);
	}
	const selected = unique[0];
	if (!selected) return null;
	const realRoot = await fs.realpath(selected);
	if (!isInside(resolvedVault, realRoot)) throw new Error('Auto-discovered skills folder resolves outside the vault.');
	discoveredRoots.set(cacheKey, realRoot);
	return realRoot;
}

async function manifestHasSkills(file: string, vaultRoot: string): Promise<boolean> {
	try {
		const realFile = await fs.realpath(file);
		if (!isInside(vaultRoot, realFile)) return false;
		const value: unknown = JSON.parse(await fs.readFile(realFile, 'utf8'));
		return typeof value === 'object' && value !== null && Array.isArray((value as { skills?: unknown }).skills)
			&& (value as { skills: unknown[] }).skills.length > 0;
	} catch {
		return false;
	}
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

export function settingsCheckKey(settings: SyncSourceSettings & { targets: unknown[] }): string {
	return JSON.stringify({ roots: settings.roots, root: settings.syncRootId, manifest: settings.syncManifestPath, targets: settings.targets });
}
