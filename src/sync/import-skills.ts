import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RuntimeName } from '../types';
import { isInside, pathsOverlap } from '../utils/paths';
import { existingRealPath } from './filesystem';
import { exists } from './install-state';
import { readPackageTree, type PackageFile } from './package-files';

export interface ImportSourceFolder {
	label: string;
	path: string;
	runtime?: RuntimeName;
}

export type ImportCandidateStatus = 'ready' | 'conflict' | 'duplicate' | 'invalid';

export interface ImportCandidate {
	name: string;
	sourceLabel: string;
	sourceFolder: string;
	sourceDir: string;
	fileCount: number;
	status: ImportCandidateStatus;
	reason?: string;
}

export interface ImportScanResult {
	destinationRoot: string;
	hasManifest: boolean;
	candidates: ImportCandidate[];
}

export interface ImportExecutionResult {
	destinationRoot: string;
	imported: string[];
	skipped: { name: string; reason: string }[];
	failed: { name: string; error: string }[];
}

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*]/;

function invalidSegmentReason(segment: string): string | null {
	if (!segment || segment === '.' || segment === '..') return 'Invalid path segment.';
	if (WINDOWS_INVALID_CHARS.test(segment) || [...segment].some((character) => character.charCodeAt(0) < 32)) {
		return 'Contains unsupported filename characters.';
	}
	if (/[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment)) {
		return 'Uses a non-portable filename.';
	}
	return null;
}

function validateSkillName(name: string): string | null {
	if (!name || name.length > 128 || name.startsWith('.')) return 'Invalid skill directory name.';
	return invalidSegmentReason(name);
}

function validateRelativePaths(files: readonly PackageFile[]): string | null {
	if (!files.some((file) => file.path === 'SKILL.md')) return 'Missing SKILL.md entry file.';
	const seen = new Set<string>();
	for (const file of files) {
		if (file.path.startsWith('/') || file.path.includes('\\')) return `Non-portable skill file: ${file.path}`;
		for (const part of file.path.split('/')) {
			if (invalidSegmentReason(part)) return `Non-portable skill file: ${file.path}`;
		}
		const folded = file.path.toLowerCase();
		if (seen.has(folded)) return `Duplicate skill file: ${file.path}`;
		seen.add(folded);
	}
	return null;
}

async function readExistingEntryNames(directory: string): Promise<Set<string>> {
	const existing = new Set<string>();
	let entries;
	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') return existing;
		throw error;
	}
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue;
		if (entry.isDirectory() || entry.isSymbolicLink()) {
			existing.add(entry.name.toLowerCase());
		} else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
			existing.add(entry.name.slice(0, -3).toLowerCase());
		}
	}
	return existing;
}

async function discoverSkillDirectories(folderDir: string, runtime?: RuntimeName): Promise<{ name: string; dir: string }[]> {
	const entries = await fs.readdir(folderDir, { withFileTypes: true });
	const found: { name: string; dir: string }[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith('.') || entry.isSymbolicLink() || !entry.isDirectory()) continue;
		const sub = path.join(folderDir, entry.name);
		if (await exists(path.join(sub, 'SKILL.md'))) {
			found.push({ name: entry.name, dir: sub });
			continue;
		}
		if (runtime === 'hermes') {
			const nestedEntries = await fs.readdir(sub, { withFileTypes: true });
			for (const nested of nestedEntries) {
				if (nested.name.startsWith('.') || nested.isSymbolicLink() || !nested.isDirectory()) continue;
				const nestedDir = path.join(sub, nested.name);
				if (await exists(path.join(nestedDir, 'SKILL.md'))) {
					found.push({ name: nested.name, dir: nestedDir });
				}
			}
		}
	}
	return found.sort((left, right) => left.name.localeCompare(right.name) || left.dir.localeCompare(right.dir));
}

export async function scanImportableSkills(
	vaultPath: string,
	destinationRoot: string,
	folders: readonly ImportSourceFolder[],
	options?: { manifestPath?: string },
): Promise<ImportScanResult> {
	const [realVault, realDest] = await Promise.all([
		existingRealPath(vaultPath),
		existingRealPath(destinationRoot),
	]);
	const hasManifest = Boolean(options?.manifestPath && await exists(options.manifestPath));
	const existingFolded = await readExistingEntryNames(realDest);
	const seenFolders = new Set<string>();
	const seenReadyFolded = new Set<string>();
	const candidates: ImportCandidate[] = [];

	for (const folder of folders) {
		if (!folder.path.trim()) continue;
		let realFolder: string;
		try {
			const stat = await fs.stat(folder.path);
			if (!stat.isDirectory()) continue;
			realFolder = await fs.realpath(folder.path);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') continue;
			throw error;
		}
		if (isInside(realVault, realFolder) || pathsOverlap(realDest, realFolder)) continue;
		if (seenFolders.has(realFolder)) continue;
		seenFolders.add(realFolder);

		const discovered = await discoverSkillDirectories(realFolder, folder.runtime);
		for (const item of discovered) {
			const nameError = validateSkillName(item.name);
			if (nameError) {
				candidates.push({
					name: item.name,
					sourceLabel: folder.label,
					sourceFolder: folder.path,
					sourceDir: item.dir,
					fileCount: 0,
					status: 'invalid',
					reason: nameError,
				});
				continue;
			}
			let files: PackageFile[];
			try {
				files = await readPackageTree(item.dir, true);
				const pathError = validateRelativePaths(files);
				if (pathError) throw new Error(pathError);
			} catch (error) {
				candidates.push({
					name: item.name,
					sourceLabel: folder.label,
					sourceFolder: folder.path,
					sourceDir: item.dir,
					fileCount: 0,
					status: 'invalid',
					reason: error instanceof Error ? error.message : String(error),
				});
				continue;
			}
			const folded = item.name.toLowerCase();
			if (existingFolded.has(folded)) {
				candidates.push({
					name: item.name,
					sourceLabel: folder.label,
					sourceFolder: folder.path,
					sourceDir: item.dir,
					fileCount: files.length,
					status: 'conflict',
					reason: 'already-in-source',
				});
			} else if (seenReadyFolded.has(folded)) {
				candidates.push({
					name: item.name,
					sourceLabel: folder.label,
					sourceFolder: folder.path,
					sourceDir: item.dir,
					fileCount: files.length,
					status: 'duplicate',
					reason: 'duplicate-candidate',
				});
			} else {
				seenReadyFolded.add(folded);
				candidates.push({
					name: item.name,
					sourceLabel: folder.label,
					sourceFolder: folder.path,
					sourceDir: item.dir,
					fileCount: files.length,
					status: 'ready',
				});
			}
		}
	}

	return { destinationRoot, hasManifest, candidates };
}

export async function importSkillPackages(
	vaultPath: string,
	destinationRoot: string,
	candidates: readonly ImportCandidate[],
	options?: { confineToVault?: boolean },
): Promise<ImportExecutionResult> {
	const [realVault, resolvedDest] = await Promise.all([
		existingRealPath(vaultPath),
		existingRealPath(destinationRoot),
	]);
	if (options?.confineToVault && !isInside(realVault, resolvedDest)) {
		throw new Error('Import destination resolves outside the vault.');
	}
	await fs.mkdir(resolvedDest, { recursive: true });
	const realDest = await fs.realpath(resolvedDest);
	if (options?.confineToVault && !isInside(realVault, realDest)) {
		throw new Error('Import destination resolves outside the vault.');
	}

	const existingFolded = await readExistingEntryNames(realDest);
	const imported: string[] = [];
	const skipped: { name: string; reason: string }[] = [];
	const failed: { name: string; error: string }[] = [];

	for (const candidate of candidates) {
		if (candidate.status !== 'ready') {
			skipped.push({ name: candidate.name, reason: candidate.reason ?? candidate.status });
			continue;
		}
		const nameError = validateSkillName(candidate.name);
		if (nameError) {
			failed.push({ name: candidate.name, error: nameError });
			continue;
		}
		const folded = candidate.name.toLowerCase();
		if (existingFolded.has(folded)) {
			skipped.push({ name: candidate.name, reason: 'already-in-source' });
			continue;
		}

		const destDir = path.join(realDest, candidate.name);
		let createdDir = false;
		try {
			const files = await readPackageTree(candidate.sourceDir, true);
			const pathError = validateRelativePaths(files);
			if (pathError) throw new Error(pathError);

			await fs.mkdir(destDir);
			createdDir = true;
			const realCreated = await fs.realpath(destDir);
			if (!isInside(realDest, realCreated)) {
				throw new Error('Import destination escapes the canonical source.');
			}

			for (const file of files) {
				const targetFile = path.join(realCreated, file.path);
				await fs.mkdir(path.dirname(targetFile), { recursive: true });
				const resolvedTarget = await existingRealPath(targetFile);
				if (!isInside(realCreated, resolvedTarget)) {
					throw new Error(`Import file escapes the skill directory: ${file.path}`);
				}
				await fs.writeFile(resolvedTarget, file.bytes, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 });
			}
			existingFolded.add(folded);
			imported.push(candidate.name);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (!createdDir && code === 'EEXIST') {
				existingFolded.add(folded);
				skipped.push({ name: candidate.name, reason: 'already-in-source' });
				continue;
			}
			if (createdDir) {
				await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
			}
			failed.push({
				name: candidate.name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { destinationRoot: realDest, imported, skipped, failed };
}
