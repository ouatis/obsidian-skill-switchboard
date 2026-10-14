import { App } from 'obsidian';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IndexedSkill, SkillRoot } from './types';
import { resolveConfiguredPath } from './utils/paths';
import { scalarFrontmatter } from './utils/frontmatter';

export interface SkillIndex {
	skills: IndexedSkill[];
	errors: string[];
	scannedAt: number;
}

interface SkillDocument {
	name: string;
	description: string;
	frontmatter: Record<string, string>;
}

export async function scanConfiguredRoots(
	app: App,
	roots: SkillRoot[],
): Promise<SkillIndex> {
	const skills: IndexedSkill[] = [];
	const errors: string[] = [];

	for (const root of roots.filter((candidate) => candidate.enabled && candidate.path.trim())) {
		try {
			if (root.kind === 'vault') {
				await scanVaultRoot(app, root, skills);
			} else {
				await scanExternalRoot(root, skills, getVaultBasePath(app));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${root.label || root.path}: ${message}`);
		}
	}

	return { skills, errors, scannedAt: Date.now() };
}

async function scanVaultRoot(
	app: App,
	root: SkillRoot,
	output: IndexedSkill[],
): Promise<void> {
	const rootPath = normalizeVaultPath(root.path);
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => {
			if (!file.path.startsWith(`${rootPath}/`)) return false;
			const relativePath = file.path.slice(rootPath.length + 1);
			return isSkillFileName(file.name) || isDirectMarkdownFile(relativePath);
		});
	const contents = new Map<string, string>();
	for (const file of files.filter((candidate) => isDirectMarkdownFile(candidate.path.slice(rootPath.length + 1)))) {
		contents.set(file.path, await app.vault.read(file));
	}
	const packages = declaredPackagePaths([...contents.entries()]);

	for (const file of files) {
		const relativePath = file.path.slice(rootPath.length + 1);
		if (isPackageResource(relativePath, packages)) continue;
		const content = contents.get(file.path) ?? await app.vault.read(file);
		output.push(
			toIndexedSkill(
				root,
				file.path,
				relativePath,
				content,
			),
		);
	}
}

async function scanExternalRoot(root: SkillRoot, output: IndexedSkill[], basePath: string): Promise<void> {
	const rootPath = resolveConfiguredPath(root.path, basePath);
	const entries = await fs.readdir(rootPath, { withFileTypes: true });
	const contents = new Map<string, string>();
	for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.toLowerCase().endsWith('.md'))) {
		const filePath = path.join(rootPath, entry.name);
		contents.set(filePath, await fs.readFile(filePath, 'utf8'));
	}
	const packages = declaredPackagePaths([...contents.entries()]);
	const skillFiles = await findSkillFiles(rootPath, packages);
	for (const filePath of skillFiles) {
		const content = contents.get(filePath) ?? await fs.readFile(filePath, 'utf8');
		output.push(
			toIndexedSkill(root, filePath, path.relative(rootPath, filePath), content),
		);
	}
}

function getVaultBasePath(app: App): string {
	const adapter = app.vault.adapter as { getBasePath?: () => string };
	return adapter.getBasePath?.() ?? process.cwd();
}

async function findSkillFiles(directory: string, packages: string[], relativeDirectory = ''): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === '.git' || entry.name === 'node_modules') continue;
		const entryPath = path.join(directory, entry.name);
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		if (isPackageResource(relativePath, packages, entry.isDirectory())) continue;
		if (entry.isDirectory()) {
			files.push(...(await findSkillFiles(entryPath, packages, relativePath)));
		} else if (
			entry.isFile() &&
			(isSkillFileName(entry.name) || (!relativeDirectory && entry.name.toLowerCase().endsWith('.md')))
		) {
			files.push(entryPath);
		}
	}
	return files;
}

/** Explicit dependencies are resources, not extra skill installations. */
function declaredPackagePaths(documents: [string, string][]): string[] {
	const packages = new Set<string>();
	for (const [filePath, content] of documents) {
		const value = parseSkillDocument(content, filePath).frontmatter.package_path;
		if (!value) continue;
		const raw = value.trim().replaceAll('\\', '/');
		const relativePath = path.posix.normalize(raw).replace(/\/$/, '');
		if (
			!relativePath || relativePath === '.' || relativePath === '..' ||
			relativePath.startsWith('../') || raw.startsWith('/') || raw.startsWith('~') ||
			/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes('\0')
		) {
			throw new Error(`Invalid package_path in ${path.basename(filePath)}: use a directory relative to the skill root.`);
		}
		packages.add(relativePath);
	}
	return [...packages];
}

function isPackageResource(relativePath: string, packages: string[], isDirectory = false): boolean {
	return packages.some((directory) =>
		(isDirectory && relativePath === directory) || relativePath.startsWith(`${directory}/`),
	);
}

function toIndexedSkill(
	root: SkillRoot,
	filePath: string,
	relativePath: string,
	content: string,
): IndexedSkill {
	const document = parseSkillDocument(content, filePath);
	return {
		id: `${root.id}:${relativePath}`,
		name: document.name,
		description: document.description,
		rootLabel: root.label || root.path,
		rootKind: root.kind,
		path: filePath,
		relativePath,
		sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
		frontmatter: document.frontmatter,
	};
}

function parseSkillDocument(content: string, filePath: string): SkillDocument {
	const frontmatter = scalarFrontmatter(content);
	const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
	const body = match ? content.slice(match[0].length) : content;
	const lines = body.split(/\r?\n/);
	const headingIndex = lines.findIndex((line) => /^#\s+/.test(line));
	const headingLine = headingIndex >= 0 ? lines[headingIndex] : undefined;
	const heading = headingLine ? headingLine.replace(/^#\s+/, '').trim() : '';
	const paragraph = extractFirstParagraph(lines, headingIndex);
	const basename = path.basename(filePath, path.extname(filePath));
	const fallbackName = basename.toLowerCase() === 'skill' ? path.basename(path.dirname(filePath)) : basename;
	return {
		name:
			frontmatter.name ||
			frontmatter.title ||
			heading ||
			fallbackName,
		description: frontmatter.description ?? paragraph,
		frontmatter,
	};
}

function extractFirstParagraph(lines: string[], headingIndex: number): string {
	const start = headingIndex >= 0 ? headingIndex + 1 : 0;
	const paragraphLines: string[] = [];
	for (const line of lines.slice(start)) {
		if (/^#{1,6}\s+/.test(line)) break;
		if (!line.trim()) {
			if (paragraphLines.length > 0) break;
			continue;
		}
		if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) break;
		paragraphLines.push(line.trim());
	}
	return paragraphLines.join(' ');
}

function isSkillFileName(fileName: string): boolean {
	return fileName.toLowerCase() === 'skill.md';
}

function isDirectMarkdownFile(relativePath: string): boolean {
	return !relativePath.includes('/') && relativePath.toLowerCase().endsWith('.md');
}

export function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}
