import path from 'node:path';
import os from 'node:os';
import { adapterFor, isInside, ManifestSkill, SyncManifestSnapshot } from './manifest';
import { RuntimeName } from '../types';

export interface RuntimeSkill {
	name: string;
	sharedFile: string;
	sharedPath: string;
	description: string;
	category: string;
	tags: string[];
	relatedSkills: string[];
	displayName: string;
	shortDescription: string;
	defaultPrompt: string;
}

export function loadRuntimeSkills(snapshot: SyncManifestSnapshot, runtime: RuntimeName): RuntimeSkill[] {
	return snapshot.skills.flatMap((skill) => {
		const config = adapterFor(skill, runtime);
		if (config === null) return [];
		const description = runtime === 'hermes' || runtime === 'opencode'
			? normalizeDescription(stringValue(config.description)) : stringValue(config.description);
		const category = stringValue(config.category) || 'shared';
		if (category.includes('/') || category.includes('\\') || category === '..' || category === '.') {
			throw new Error(`Invalid runtime category: ${category}`);
		}
		const loaded: RuntimeSkill = {
			name: skill.name, sharedFile: skill.sharedFile, sharedPath: skill.sharedPath,
			description: description || sharedDescription(skill, runtime === 'opencode'), category,
			tags: stringArray(config.tags), relatedSkills: stringArray(config.related_skills),
			displayName: stringValue(config.display_name), shortDescription: stringValue(config.short_description),
			defaultPrompt: stringValue(config.default_prompt),
		};
		if (!loaded.description) throw new Error(`Missing ${runtime} description: ${skill.name}`);
		if (runtime === 'codex' && (!loaded.displayName || !loaded.shortDescription || !loaded.defaultPrompt)) {
			throw new Error(`Missing Codex interface metadata: ${skill.name}`);
		}
		return [loaded];
	});
}

function sharedDescription(skill: ManifestSkill, frontmatterOnly: boolean): string {
	let body = skill.sharedText;
	const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (frontmatter) {
		body = frontmatter[2] ?? '';
		const desc = frontmatter[1]?.match(/^description:\s*(.+)$/m)?.[1];
		if (desc) return normalizeDescription(desc.trim().replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, ''));
	}
	if (frontmatterOnly) return '';
	const paragraph: string[] = [];
	for (const line of body.split(/\r?\n/)) {
		const text = line.trim();
		if (!text || text.startsWith('```') || text.startsWith('#')) {
			if (paragraph.length) break;
			continue;
		}
		paragraph.push(text);
	}
	return normalizeDescription(paragraph.join(' '));
}

export function wrapperFor(skill: RuntimeSkill, runtime: RuntimeName, snapshot: SyncManifestSnapshot): string {
	const metadata = runtime === 'hermes'
		? `version: 1.0.0\nplatforms: [linux, macos, windows]\nmetadata:\n  hermes:\n    tags: ${yamlArray(skill.tags)}\n    related_skills: ${yamlArray(skill.relatedSkills)}\n`
		: runtime === 'dsh'
			? `metadata:\n  skill_switchboard:\n    source: shared-canonical\n    canonical: ${canonicalFilePath(snapshot, skill.sharedFile)}\n` : '';
	const liveReferences = runtime === 'workbuddy' || runtime === 'dsh'
		? 'If the shared card references files under `references/`, read those from the same shared skills directory.\n' : '';
	const qualifier = runtime === 'workbuddy' ? 'WorkBuddy ' : runtime === 'dsh' ? 'DSH ' : '';
	const trigger = runtime === 'hermes'
		? `\n## Trigger\n\nUse skill_view(name='${skill.name}') to load the full shared skill when needed.\n`
		: runtime === 'opencode'
			? `\n## Trigger\n\nUse the skill name \`${skill.name}\` in your prompt or reference the shared file path directly.\n` : '';
	return `---\nname: ${skill.name}\ndescription: "${yamlQuoted(skill.description)}"\n${metadata}---\n\n# ${titleFromName(skill.name)}\n\nCanonical shared rules live at:\n${canonicalPathLines(snapshot, skill.sharedFile)}\n\nOpen the first path that exists and follow it as the source of truth.\nPrefer the workspace-relative path when working inside the configured vault.\n${liveReferences}\n## Wrapper Rule\n\n- Keep this installed ${qualifier}skill thin.\n- Do not duplicate or locally rewrite the shared rule card unless the install mechanism itself changes.\n- If this wrapper and the shared rule card ever diverge, the shared rule card wins.\n${trigger}`;
}

export function agentMetadataFor(skill: RuntimeSkill): string {
	return `interface:\n  display_name: "${yamlQuoted(skill.displayName)}"\n  short_description: "${yamlQuoted(skill.shortDescription)}"\n  default_prompt: "${yamlQuoted(skill.defaultPrompt)}"\n`;
}

export function commandFor(skill: RuntimeSkill): string {
	return `---\ndescription: ${skill.description}\n---\n\nLoad the ${skill.name} skill and follow its rules to handle the following. $ARGUMENTS\n`;
}

function canonicalPathLines(snapshot: SyncManifestSnapshot, sharedFile: string): string {
	const local = path.resolve(snapshot.sharedRoot, sharedFile).replace(/\\/g, '/');
	const relative = path.relative(snapshot.vaultPath, path.join(snapshot.sharedRoot, sharedFile)).replace(/\\/g, '/');
	const lines = isInside(snapshot.vaultPath, snapshot.sharedRoot) ? [`- \`${relative}\` in the configured vault`] : [];
	lines.push(`- \`${local}\` on this machine (derived from the configured source)`);
	return lines.join('\n');
}

export function canonicalFilePath(snapshot: SyncManifestSnapshot, sharedFile: string): string {
	return snapshot.sharedPrefix ? snapshot.sharedPrefix + sharedFile : path.join(snapshot.sharedRoot, sharedFile).replaceAll(path.sep, '/');
}

export function expandHome(value: string): string {
	return value === '~' ? os.homedir() : /^~[\\/]/.test(value) ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}

export function yamlQuoted(value: string): string { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function yamlArray(values: string[]): string { return `[${values.map((value) => `"${yamlQuoted(value)}"`).join(', ')}]`; }
function titleFromName(name: string): string { return name.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
function normalizeDescription(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function stringArray(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error('Adapter tags/related_skills must be string arrays.');
	return value;
}
