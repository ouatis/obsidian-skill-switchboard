import path from 'node:path';
import type { RuntimeName } from '../types';
import type { ManifestSkill, SyncManifestSnapshot } from './manifest';
import { agentMetadataFor, loadRuntimeSkills, yamlQuoted } from './templates';
import { materialize, type PackageFile, type SourceFile } from './package-files';

export interface SkillBundle { name: string; directory: string; files: PackageFile[]; sourceFiles: SourceFile[]; legacyFlat?: string }

/** The destination contains the instructions themselves, never a pointer to the source document. */
export async function skillBundle(snapshot: SyncManifestSnapshot, runtime: RuntimeName, target: string, source: ManifestSkill): Promise<SkillBundle> {
	if (source.packageError) throw new Error(source.packageError);
	if (!source.files?.length) throw new Error(`No complete package snapshot: ${source.name}`);
	const skill = loadRuntimeSkills({ ...snapshot, skills: [source] }, runtime)[0];
	if (!skill) throw new Error(`Skill is not enabled for ${runtime}: ${source.name}`);
	const files = await materialize(source.files);
	const entry = files.find((file) => file.path === 'SKILL.md');
	if (!entry) throw new Error(`Missing SKILL.md: ${source.name}`);
	if (path.basename(source.sharedPath) !== 'SKILL.md') {
		const text = entry.bytes.toString('utf8');
		const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
		const rest = (match?.[1] ?? '').replace(/^(?:name|description):[^\n]*(?:\n[ \t]+[^\n]*)*/gm, '').trim();
		const body = match ? text.slice(match[0].length) : text;
		entry.bytes = Buffer.from(`---\nname: ${skill.name}\ndescription: "${yamlQuoted(skill.description)}"\n${rest ? rest + '\n' : ''}---\n${body}`);
	}
	if (runtime === 'codex' && !files.some((file) => file.path === 'agents/openai.yaml')) {
		files.push({ path: 'agents/openai.yaml', bytes: Buffer.from(agentMetadataFor(skill)), executable: false });
	}
	const seen = new Set<string>();
	for (const file of files) {
		if (file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part) || [...part].some((character) => character.charCodeAt(0) < 32) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Non-portable skill file: ${file.path}`);
		const folded = file.path.toLowerCase();
		if (seen.has(folded)) throw new Error(`Duplicate skill file: ${file.path}`);
		seen.add(folded);
	}
	return {
		name: skill.name,
		directory: path.join(target, ...(runtime === 'hermes' ? [skill.category] : []), skill.name),
		files: files.sort((a, b) => a.path.localeCompare(b.path)),
		sourceFiles: source.files,
		...(runtime === 'dsh' ? { legacyFlat: path.join(target, `${skill.name}.md`) } : {}),
	};
}
