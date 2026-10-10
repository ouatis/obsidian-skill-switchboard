import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RuntimeName } from '../types';
import type { AdapterCheckResult } from './result';

export const RUNTIMES: RuntimeName[] = ['codex', 'hermes', 'workbuddy', 'opencode', 'antigravity', 'dsh'];
export const SHARED_PREFIX = '00-MEMORTE/shared/skills/';
export type AdapterMetadata = Record<string, unknown>;

export interface ManifestSkill {
	name: string;
	sharedFile: string;
	sharedPath: string;
	sharedText: string;
	adapters: Partial<Record<RuntimeName, AdapterMetadata | boolean | null>>;
}

export interface SyncManifestSnapshot {
	path: string;
	vaultPath: string;
	sharedRoot: string;
	skillCount: number;
	runtimes: RuntimeName[];
	skills: ManifestSkill[];
}

export interface ManifestCheckResult extends AdapterCheckResult {
	snapshot: SyncManifestSnapshot | null;
}

export async function inspectManifest(vaultPath: string): Promise<ManifestCheckResult> {
	try {
		const resolvedVault = await fs.realpath(vaultPath);
		const manifestPath = path.join(resolvedVault, '00-MEMORTE', 'shared', 'skills-manifest.json');
		const sharedRoot = await fs.realpath(path.join(resolvedVault, '00-MEMORTE', 'shared', 'skills'));
		const value: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
		if (!isRecord(value) || !Array.isArray(value.skills)) throw new Error('Manifest must contain a skills array.');
		if (value.schema_version !== 1) throw new Error('Unsupported manifest schema_version; expected 1.');
		if (value.skills.length === 0) throw new Error('Manifest contains no skills; a zero-skill check is not success.');
		if (value.total_skills !== value.skills.length) throw new Error('Manifest total_skills does not match its skills array.');

		const skills: ManifestSkill[] = [];
		const names = new Set<string>();
		for (const [index, skill] of value.skills.entries()) {
			if (!isRecord(skill) || typeof skill.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill.name)) {
				throw new Error(`Manifest skill #${index + 1} has an invalid name.`);
			}
			if (names.has(skill.name)) throw new Error(`Duplicate skill name: ${skill.name}`);
			names.add(skill.name);
			if (typeof skill.shared_file !== 'string') throw new Error(`Missing shared_file: ${skill.name}`);
			const sharedFile = skill.shared_file.startsWith(SHARED_PREFIX)
				? skill.shared_file.slice(SHARED_PREFIX.length) : skill.shared_file;
			if (!sharedFile.endsWith('.md') || sharedFile.includes('\\') || sharedFile.includes('/') || sharedFile === '..') {
				throw new Error(`shared_file must name a top-level canonical Markdown card: ${skill.shared_file}`);
			}
			const sharedPath = await fs.realpath(path.join(sharedRoot, sharedFile));
			if (!isInside(sharedRoot, sharedPath)) throw new Error(`Canonical skill escapes shared root: ${sharedFile}`);
			const adapters: ManifestSkill['adapters'] = {};
			if (skill.adapters !== undefined && !isRecord(skill.adapters)) throw new Error(`Invalid adapters: ${skill.name}`);
			for (const [runtime, config] of Object.entries(skill.adapters ?? {})) {
				if (!RUNTIMES.includes(runtime as RuntimeName)) throw new Error(`Unknown runtime: ${runtime}`);
				if (config !== null && typeof config !== 'boolean' && !isRecord(config)) {
					throw new Error(`Invalid adapters.${runtime}: ${skill.name}`);
				}
			adapters[runtime as RuntimeName] = config;
			}
			skills.push({ name: skill.name, sharedFile, sharedPath, sharedText: await fs.readFile(sharedPath, 'utf8'), adapters });
		}
		const snapshot: SyncManifestSnapshot = {
			path: manifestPath, vaultPath: resolvedVault, sharedRoot, skillCount: skills.length, skills,
			runtimes: RUNTIMES.filter((runtime) => skills.some((skill) => adapterFor(skill, runtime) !== null)),
		};
		return { status: 'passed', output: `[manifest] PASS\nLoaded ${skills.length} skill(s) from ${manifestPath}.`, exitCode: 0, snapshot };
	} catch (error) {
		return { status: 'failed', output: `[manifest] FAIL\n${formatError(error)}`, exitCode: 1, snapshot: null };
	}
}

export function adapterFor(skill: ManifestSkill, runtime: RuntimeName): AdapterMetadata | null {
	if (runtime === 'antigravity') {
		// Python uses truthiness here: an empty object falls through to the next adapter.
		for (const key of ['antigravity', 'opencode', 'codex'] as const) {
			const value = skill.adapters[key];
			if (value === true) return {};
			if (isRecord(value) && Object.keys(value).length > 0) return value;
		}
		return {};
	}
	const value = skill.adapters[runtime];
	return value === true ? {} : isRecord(value) ? value : null;
}

export function isInside(root: string, target: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
