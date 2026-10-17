import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SyncManifestSnapshot } from './manifest';
import { scalarFrontmatter } from '../utils/frontmatter';
import { pathsOverlap } from '../utils/paths';
import { readLocalPackagePaths, validPackageId } from './package-paths';

export type ResourceIssueCode = 'missing' | 'changed' | 'unexpected' | 'invalid' | 'hidden-path' | 'unverified' | 'unconfigured';
export interface ResourceIssue { code: ResourceIssueCode; path: string }
export interface PackageCheck {
	skill: string;
	path: string;
	location: 'source' | 'external';
	status: 'passed' | 'warning' | 'failed';
	files: number;
	verifiedFiles: number;
	issues: ResourceIssue[];
}
export interface ResourceCheck {
	status: 'passed' | 'warning' | 'failed';
	packages: PackageCheck[];
	/** Remote receipt and agent execution are deliberately not inferred from file checks. */
	crossDevice: 'unverified';
}

function inside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
function relativeResource(value: string): string {
	const raw = value.replaceAll('\\', '/').trim();
	const normalized = path.posix.normalize(raw);
	if (!raw || raw.startsWith('/') || raw.startsWith('~') || /^[a-z][a-z0-9+.-]*:/i.test(raw) ||
		normalized === '.' || normalized === '..' || normalized.startsWith('../') || raw.includes('\0')) {
		throw new Error('Invalid relative resource path');
	}
	return normalized.replace(/\/$/, '');
}
async function containedRealPath(root: string, relative: string): Promise<string> {
	const result = await fs.realpath(path.join(root, relativeResource(relative)));
	if (!inside(root, result)) throw new Error('Resource leaves the configured source');
	return result;
}
function hidden(value: string): boolean { return value.replaceAll('\\', '/').split('/').some((part) => part.startsWith('.')); }

async function visibleFiles(root: string, directory = root, output: string[] = []): Promise<string[]> {
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const full = path.join(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error('Symbolic resource entries need an explicit portable inventory');
		if (entry.isDirectory()) await visibleFiles(root, full, output);
		else if (entry.isFile()) output.push(path.relative(root, full).replaceAll(path.sep, '/'));
		if (output.length > 10000) throw new Error('Resource inventory exceeds the check limit');
	}
	return output;
}

export async function checkResources(snapshot: SyncManifestSnapshot, registryPath?: string): Promise<ResourceCheck> {
	const packages: PackageCheck[] = [];
	let localPaths: Record<string, string> | undefined;
	for (const skill of snapshot.skills) {
		const metadata = scalarFrontmatter(skill.sharedText);
		const sourcePath = metadata.package_path ?? '';
		const packageId = metadata.package_id ?? '';
		if (!sourcePath && !packageId) continue;
		const external = Boolean(packageId);
		const declared = packageId || sourcePath;
		const result: PackageCheck = { skill: skill.name, path: declared, location: external ? 'external' : 'source', status: 'passed', files: 0, verifiedFiles: 0, issues: [] };
		packages.push(result);
		try {
			if (sourcePath && packageId) throw new Error('Choose package_path or package_id, not both.');
			let packageRoot: string;
			if (external) {
				if (!validPackageId(packageId)) throw new Error('Invalid external package ID');
				localPaths ??= await readLocalPackagePaths(registryPath);
				if (!localPaths[packageId]) {
					result.issues.push({ code: 'unconfigured', path: packageId });
					result.status = 'failed';
					continue;
				}
				packageRoot = await fs.realpath(localPaths[packageId]);
				if (pathsOverlap(snapshot.vaultPath, packageRoot) || pathsOverlap(snapshot.sharedRoot, packageRoot)) {
					throw new Error('External packages must not overlap the vault or canonical source');
				}
				result.path = packageRoot;
			} else packageRoot = await containedRealPath(snapshot.sharedRoot, sourcePath);
			if (!(await fs.stat(packageRoot)).isDirectory()) throw new Error('Package is not a directory');
			if (!external && hidden(sourcePath)) result.issues.push({ code: 'hidden-path', path: sourcePath });
			const entry = metadata.package_entry || 'SKILL.md';
			const entryPath = await containedRealPath(packageRoot, entry);
			if (!(await fs.stat(entryPath)).isFile()) throw new Error('Package entry is not a file');
			const actual = await visibleFiles(packageRoot);
			result.files = actual.length;
			if (!metadata.package_manifest) {
				result.issues.push({ code: 'unverified', path: declared });
			} else {
				const manifestPath = await containedRealPath(snapshot.sharedRoot, metadata.package_manifest);
				if ((await fs.stat(manifestPath)).size > 5 * 1024 * 1024) throw new Error('Inventory exceeds size limit');
				const value: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
				if (!isRecord(value) || value.schema_version !== 1 || !Array.isArray(value.files) || !value.files.length || value.files.length > 10000) throw new Error('Invalid resource inventory');
				const expected = new Set<string>();
				for (const file of value.files) {
					if (!isRecord(file) || typeof file.path !== 'string' || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(file.sha256)) throw new Error('Invalid inventory entry');
					const relative = relativeResource(file.path);
					if (expected.has(relative)) throw new Error('Duplicate inventory entry');
					expected.add(relative);
					if (!external && hidden(relative)) result.issues.push({ code: 'hidden-path', path: relative });
					try {
						const full = await containedRealPath(packageRoot, relative);
						const hash = createHash('sha256').update(await fs.readFile(full)).digest('hex');
						if (hash !== file.sha256.toLowerCase()) result.issues.push({ code: 'changed', path: relative });
						else result.verifiedFiles++;
					} catch { result.issues.push({ code: 'missing', path: relative }); }
				}
				if (!expected.has(relativeResource(entry))) throw new Error('Inventory must include the package entry');
				for (const file of actual) if (!expected.has(file)) result.issues.push({ code: 'unexpected', path: file });
			}
		} catch (error) {
			const missing = isRecord(error) && error.code === 'ENOENT';
			result.issues.push({ code: missing ? 'missing' : 'invalid', path: result.path });
		}
		result.status = result.issues.some((issue) => !['hidden-path', 'unverified'].includes(issue.code))
			? 'failed' : result.issues.length ? 'warning' : 'passed';
	}
	return {
		status: packages.some((item) => item.status === 'failed') ? 'failed' : packages.some((item) => item.status === 'warning') ? 'warning' : 'passed',
		packages, crossDevice: 'unverified',
	};
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
