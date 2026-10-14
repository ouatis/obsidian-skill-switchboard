import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isAbsolutePath } from '../utils/paths';

export const EXCLUDED_SKILL_DIRS = new Set([
	'.git',
	'.github',
	'.hub',
	'.archive',
	'.curator_backups',
	'.locks',
	'.venv',
	'venv',
	'node_modules',
	'site-packages',
	'__pycache__',
]);

export const CODEX_STALE_PATTERN = '\\[file\\]\\(</abs/path/file\\.md:42>\\)';

export interface InstalledSkillEntry {
	name: string;
	path: string;
}

export async function readText(filePath: string): Promise<string> {
	return (await fs.readFile(filePath)).toString('utf8').replace(/\r\n?/g, '\n');
}

export async function readBytes(filePath: string): Promise<Buffer> {
	return fs.readFile(filePath);
}

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function existingRealPath(filePath: string): Promise<string> {
	const candidate = isAbsolutePath(filePath) ? filePath : path.resolve(filePath);
	let current = candidate;
	const suffix: string[] = [];
	while (true) {
		try {
			const real = await fs.realpath(current);
			return suffix.length === 0 ? real : path.resolve(real, ...suffix.reverse());
		} catch {
			const parent = path.dirname(current);
			if (parent === current) return candidate;
			suffix.push(path.basename(current));
			current = parent;
		}
	}
}

export async function walkFiles(root: string, options: {
	excludeDirectories?: Set<string>;
	include?: (filePath: string) => boolean;
} = {}): Promise<string[]> {
	if (!(await pathExists(root))) return [];
	const files: string[] = [];
	const pending = [isAbsolutePath(root) ? root : path.resolve(root)];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) continue;
		const entries = await fs.readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!(options.excludeDirectories ?? EXCLUDED_SKILL_DIRS).has(entry.name)) {
					pending.push(path.join(current, entry.name));
				}
				continue;
			}
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			const filePath = path.join(current, entry.name);
			if (!options.include || options.include(filePath)) files.push(filePath);
		}
	}
	return files.sort((left, right) => left.localeCompare(right));
}

export async function installedSkillEntries(root: string): Promise<InstalledSkillEntry[]> {
	const files = await walkFiles(root);
	const entries: InstalledSkillEntry[] = [];
	for (const filePath of files) {
		if (path.basename(filePath) !== 'SKILL.md') continue;
		const text = await readText(filePath);
		const match = text.match(/^name:\s*(.+?)\s*$/m);
		if (!match?.[1]) continue;
		const name = match[1].trim().replace(/^"|"$/g, '');
		entries.push({ name, path: filePath });
	}
	return entries;
}

export async function staleProblems(
	root: string,
	includeAbsolutePathPattern: boolean,
	excludeDirectories?: Set<string>,
	forbiddenLiterals: string[] = [],
): Promise<string[]> {
	if (!includeAbsolutePathPattern && forbiddenLiterals.length === 0) return [];
	const files = await walkFiles(root, {
		// Codex/WorkBuddy/Antigravity intentionally scan every file; Hermes/DSH
		// pass the shared exclusion set used by the Python core scanner.
		excludeDirectories,
		include: (filePath) => ['.md', '.yaml'].includes(path.extname(filePath).toLowerCase()),
	});
	const problems: string[] = [];
	for (const filePath of files) {
		const text = await readText(filePath);
		for (const literal of forbiddenLiterals) {
			if (text.includes(literal)) problems.push(`Stale term '${literal}' in ${filePath}`);
		}
		if (includeAbsolutePathPattern && new RegExp(CODEX_STALE_PATTERN).test(text)) problems.push(`Example absolute path in ${filePath}`);
	}
	return problems;
}

export async function groupedSkillProblems(
	root: string,
	retiredNames: Set<string>,
	useExclusions = true,
): Promise<string[]> {
	const entries = useExclusions
		? await installedSkillEntries(root)
		: await installedSkillEntriesUnfiltered(root);
	const grouped = new Map<string, string[]>();
	for (const entry of entries) {
		const paths = grouped.get(entry.name) ?? [];
		paths.push(entry.path);
		grouped.set(entry.name, paths);
	}
	const problems: string[] = [];
	for (const [name, paths] of grouped) {
		const sorted = [...paths].sort((left, right) => left.localeCompare(right));
		if (sorted.length > 1) {
			problems.push(`Duplicate installed skill name '${name}': ${sorted.join('; ')}`);
		}
		if (retiredNames.has(name)) problems.push(`Retired installed skill alias '${name}': ${sorted[0]}`);
	}
	return problems;
}

async function installedSkillEntriesUnfiltered(root: string): Promise<InstalledSkillEntry[]> {
	const files = await walkFiles(root, { excludeDirectories: new Set<string>() });
	const entries: InstalledSkillEntry[] = [];
	for (const filePath of files) {
		if (path.basename(filePath) !== 'SKILL.md') continue;
		const match = (await readText(filePath)).match(/^name:\s*(.+?)\s*$/m);
		if (match?.[1]) entries.push({ name: match[1].trim().replace(/^"|"$/g, ''), path: filePath });
	}
	return entries;
}

export function relativeDisplay(root: string, filePath: string): string {
	return path.relative(root, filePath).split(path.sep).join('/');
}
