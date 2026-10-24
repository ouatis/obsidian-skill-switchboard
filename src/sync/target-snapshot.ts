import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface TargetSnapshotManifest {
	skill: string;
	target: string;
	fingerprint?: string;
	createdAt: string;
	files: string[];
}

export interface CreateTargetSnapshotOptions {
	skill: string;
	source: string;
	store: string;
	fingerprint?: string;
	keep?: number;
}

export interface StoredTargetSnapshot {
	directory: string;
	manifest: TargetSnapshotManifest;
}

const MANIFEST = 'manifest.json';
const DEFAULT_KEEP = 5;

async function copyTree(from: string, to: string): Promise<string[]> {
	const copied: string[] = [];
	const walk = async (dir: string, rel: string) => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const sourcePath = path.join(dir, entry.name);
			const targetPath = path.join(to, rel, entry.name);
			if (entry.isDirectory()) {
				await fs.mkdir(targetPath, { recursive: true });
				await walk(sourcePath, path.join(rel, entry.name));
			} else {
				await fs.mkdir(path.dirname(targetPath), { recursive: true });
				await fs.copyFile(sourcePath, targetPath);
				copied.push(path.join(rel, entry.name).split(path.sep).join('/'));
			}
		}
	};
	await fs.mkdir(to, { recursive: true });
	await walk(from, '');
	return copied;
}

async function listSnapshotDirectories(skillDirectory: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(skillDirectory, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
	} catch {
		return [];
	}
}

/**
 * Copies the current target tree into the snapshot store and prunes older
 * snapshots. Snapshots live inside the vault, so they ride the existing sync
 * and never touch the Agent-side directory being copied.
 */
export async function createTargetSnapshot(options: CreateTargetSnapshotOptions): Promise<{ directory: string; files: number }> {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const suffix = options.fingerprint ? `-${options.fingerprint.slice(0, 8)}` : '';
	const directory = path.join(options.store, options.skill, `${stamp}${suffix}`);
	const files = await copyTree(options.source, directory);
	const manifest: TargetSnapshotManifest = {
		skill: options.skill,
		target: options.source,
		fingerprint: options.fingerprint,
		createdAt: new Date().toISOString(),
		files,
	};
	await fs.writeFile(path.join(directory, MANIFEST), JSON.stringify(manifest, null, '\t') + '\n');
	await pruneSnapshots(options.store, options.skill, options.keep ?? DEFAULT_KEEP);
	return { directory, files: files.length };
}

/** Keeps the newest `keep` snapshots of one skill; older directories are removed. */
export async function pruneSnapshots(store: string, skill: string, keep = DEFAULT_KEEP): Promise<void> {
	const skillDirectory = path.join(store, skill);
	const names = await listSnapshotDirectories(skillDirectory);
	for (const name of names.slice(0, Math.max(0, names.length - keep))) {
		await fs.rm(path.join(skillDirectory, name), { recursive: true, force: true });
	}
}

/** The newest snapshot of one skill, or of any skill when none is named. */
export async function latestTargetSnapshot(store: string, skill?: string): Promise<StoredTargetSnapshot | null> {
	const skills = skill ? [skill] : (await listSnapshotDirectories(store));
	const candidates: StoredTargetSnapshot[] = [];
	for (const one of skills) {
		const names = [...(await listSnapshotDirectories(path.join(store, one)))].reverse();
		for (const name of names) {
			const directory = path.join(store, one, name);
			try {
				const manifest = JSON.parse(await fs.readFile(path.join(directory, MANIFEST), 'utf8')) as TargetSnapshotManifest;
				candidates.push({ directory, manifest });
				break;
			} catch {
				continue;
			}
		}
	}
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
	return candidates[0] ?? null;
}

/**
 * Replaces the recorded target with the snapshot copy. The snapshot's own
 * manifest is metadata and is not copied back.
 */
export async function restoreTargetSnapshot(snapshotDirectory: string): Promise<{ files: number; target: string }> {
	const manifest = JSON.parse(await fs.readFile(path.join(snapshotDirectory, MANIFEST), 'utf8')) as TargetSnapshotManifest;
	await fs.mkdir(manifest.target, { recursive: true });
	for (const entry of await fs.readdir(manifest.target, { withFileTypes: true })) {
		await fs.rm(path.join(manifest.target, entry.name), { recursive: true, force: true });
	}
	let files = 0;
	for (const entry of await fs.readdir(snapshotDirectory, { withFileTypes: true })) {
		if (entry.name === MANIFEST) continue;
		await fs.cp(path.join(snapshotDirectory, entry.name), path.join(manifest.target, entry.name), { recursive: true });
		files += 1;
	}
	return { files, target: manifest.target };
}
