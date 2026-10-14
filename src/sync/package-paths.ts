import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isAbsolutePath, resolveConfiguredPath } from '../utils/paths';

/** Machine-local and inspectable by agents; never stored in synced plugin settings. */
export function localPackageRegistryPath(): string {
	return path.join(os.homedir(), '.skill-switchboard', 'packages.json');
}

export function validPackageId(value: string): boolean { return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value); }

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveLocalPackagePath(value: string): string {
	const raw = value.trim();
	if (!raw || raw.includes('\0') || (!isAbsolutePath(raw) && !/^~[/\\]/.test(raw))) {
		throw new Error('Use an absolute desktop directory or a ~/ path.');
	}
	return resolveConfiguredPath(raw);
}

export async function readLocalPackagePaths(registryPath = localPackageRegistryPath()): Promise<Record<string, string>> {
	try {
		if ((await fs.stat(registryPath)).size > 65536) throw new Error('Local package registry exceeds its size limit.');
		const value: unknown = JSON.parse(await fs.readFile(registryPath, 'utf8'));
		if (!record(value) || value.schema_version !== 1 || !record(value.packages) || Object.keys(value.packages).length > 128) {
			throw new Error('Invalid local package registry.');
		}
		const packages: Record<string, string> = {};
		for (const [id, directory] of Object.entries(value.packages)) {
			if (!validPackageId(id) || typeof directory !== 'string') throw new Error('Invalid local package entry.');
			packages[id] = resolveLocalPackagePath(directory);
		}
		return packages;
	} catch (error) {
		if (record(error) && error.code === 'ENOENT') return {};
		throw error;
	}
}

/** Only an explicit settings action calls this; checks never create the registry. */
export async function saveLocalPackagePath(id: string, directory: string, registryPath = localPackageRegistryPath()): Promise<Record<string, string>> {
	if (!validPackageId(id)) throw new Error('Invalid package ID.');
	const packages = await readLocalPackagePaths(registryPath);
	if (directory.trim()) packages[id] = resolveLocalPackagePath(directory).replaceAll(path.sep, '/');
	else delete packages[id];
	const parent = path.dirname(registryPath);
	await fs.mkdir(parent, { recursive: true });
	const temporary = path.join(parent, `packages-${randomUUID()}.tmp`);
	try {
		await fs.writeFile(temporary, `${JSON.stringify({ schema_version: 1, packages }, null, 2)}\n`, { flag: 'wx' });
		await fs.rename(temporary, registryPath);
	} finally { await fs.unlink(temporary).catch(() => undefined); }
	return packages;
}
