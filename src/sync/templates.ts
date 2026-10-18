import { adapterFor, ManifestSkill, SyncManifestSnapshot } from './manifest';
import { RuntimeName } from '../types';
import { scalarFrontmatter } from '../utils/frontmatter';

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
			displayName: stringValue(config.display_name) || skill.name, shortDescription: stringValue(config.short_description) || description || sharedDescription(skill, false),
			defaultPrompt: stringValue(config.default_prompt) || `Use $${skill.name}`,
		};
		if (!loaded.description) throw new Error(`Missing ${runtime} description: ${skill.name}`);
		return [loaded];
	});
}

function sharedDescription(skill: ManifestSkill, frontmatterOnly: boolean): string {
	const declared = scalarFrontmatter(skill.sharedText).description;
	if (declared) return normalizeDescription(declared);
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

export function agentMetadataFor(skill: RuntimeSkill): string {
	return `interface:\n  display_name: "${yamlQuoted(skill.displayName)}"\n  short_description: "${yamlQuoted(skill.shortDescription)}"\n  default_prompt: "${yamlQuoted(skill.defaultPrompt)}"\n`;
}

export function yamlQuoted(value: string): string { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function normalizeDescription(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function stringArray(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error('Adapter tags/related_skills must be string arrays.');
	return value;
}
