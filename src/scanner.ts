import { App } from 'obsidian';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IndexedSkill, SkillRoot } from './types';

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
				await scanExternalRoot(root, skills);
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

	for (const file of files) {
		const content = await app.vault.read(file);
		output.push(
			toIndexedSkill(
				root,
				file.path,
				file.path.slice(rootPath.length + 1),
				content,
			),
		);
	}
}

async function scanExternalRoot(root: SkillRoot, output: IndexedSkill[]): Promise<void> {
	const rootPath = path.resolve(root.path);
	const skillFiles = await findSkillFiles(rootPath);
	for (const filePath of skillFiles) {
		const content = await fs.readFile(filePath, 'utf8');
		output.push(
			toIndexedSkill(root, filePath, path.relative(rootPath, filePath), content),
		);
	}
}

async function findSkillFiles(directory: string, depth = 0): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === '.git' || entry.name === 'node_modules') continue;
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await findSkillFiles(entryPath, depth + 1)));
		} else if (
			entry.isFile() &&
			(isSkillFileName(entry.name) || (depth === 0 && entry.name.toLowerCase().endsWith('.md')))
		) {
			files.push(entryPath);
		}
	}
	return files;
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
	const frontmatter: Record<string, string> = {};
	const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
	if (match?.[1]) {
		for (const line of match[1].split(/\r?\n/)) {
			const separator = line.indexOf(':');
			if (separator <= 0) continue;
			const key = line.slice(0, separator).trim();
			const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
			frontmatter[key] = value;
		}
	}
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

function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}
