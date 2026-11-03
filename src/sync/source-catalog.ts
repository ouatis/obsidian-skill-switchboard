import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scalarFrontmatter } from '../utils/frontmatter';
import { RUNTIME_NAMES } from '../types';
import { cardFiles, sourceTree } from './package-files';
import type { ManifestSkill } from './manifest';
import type { SourceFile } from './package-files';

export async function discoverSkills(root: string): Promise<unknown[]> {
	const skills: unknown[] = [];
	async function visit(directory: string): Promise<void> {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
			const file = path.join(directory, 'SKILL.md');
			const metadata = scalarFrontmatter(await fs.readFile(file, 'utf8'));
			skills.push({ name: metadata.name || path.basename(directory), shared_file: path.relative(root, file).replaceAll(path.sep, '/'), adapters: Object.fromEntries(RUNTIME_NAMES.map((runtime) => [runtime, true])) });
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') await visit(path.join(directory, entry.name));
		}
	}
	await visit(root);
	return skills;
}

export async function snapshotSkillFiles(entry: string, root: string): Promise<SourceFile[]> {
	return path.basename(entry) === 'SKILL.md' ? sourceTree(path.dirname(entry)) : cardFiles(entry, root);
}

export async function captureSkillFiles(skill: ManifestSkill, root: string): Promise<void> {
	try {
		skill.files = await snapshotSkillFiles(skill.sharedPath, root);
	} catch (error) {
		skill.packageError = error instanceof Error ? error.message : String(error);
	}
}
