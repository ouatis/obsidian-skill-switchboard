import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdapterCheckResult } from './result';
import type { RuntimeName } from '../types';
import {
	adapterFor,
	isInside,
	pathsOverlap,
	type ManifestSkill,
	type SyncManifestSnapshot,
} from './manifest';

export { inspectManifest } from './manifest';
import {
	agentMetadataFor,
	canonicalFilePath,
	commandFor,
	loadRuntimeSkills,
	wrapperFor,
	yamlQuoted,
} from './templates';
import {
	EXCLUDED_SKILL_DIRS,
	groupedSkillProblems,
	pathExists,
	readBytes,
	readText,
	relativeDisplay,
	staleProblems,
	walkFiles,
	existingRealPath,
} from './filesystem';
import { resolveConfiguredPath } from '../utils/paths';
import { blockedResourceSkills, resourceBlockMessage } from './resources';

export type NativeCheckKind = 'clean' | 'drift' | 'blocked' | 'error';

export interface NativeCheckResult extends AdapterCheckResult {
	kind: NativeCheckKind;
	problems: string[];
	checkedSkillCount: number;
	blockedSkills?: string[];
}

export interface NativeCheckOptions {
	/** Test-only override; production follows OPENCODE_CONFIG like the Python adapter. */
	opencodeCommandsDir?: string;
}

export async function checkRuntimeNative(
	vaultPath: string,
	runtime: RuntimeName,
	targetPath: string,
	snapshot: SyncManifestSnapshot,
	options: NativeCheckOptions = {},
): Promise<NativeCheckResult> {
	try {
		const resolvedVault = path.resolve(snapshot.vaultPath || vaultPath);
		const resolvedTarget = await existingRealPath(resolveConfiguredPath(targetPath, resolvedVault));
		if (isInside(resolvedVault, resolvedTarget)) {
			return errorResult(`Native check refused a target inside the vault: ${resolvedTarget}`);
		}
		if (pathsOverlap(snapshot.sharedRoot, resolvedTarget)) {
			return errorResult(`Native check refused a target that overlaps the canonical skill source: ${resolvedTarget}`);
		}

		const effectiveOptions = runtime === 'opencode'
			? { ...options, opencodeCommandsDir: await existingRealPath(resolveOpenCodeCommandsDir(options)) }
			: options;
		if (runtime === 'opencode' && effectiveOptions.opencodeCommandsDir) {
			if (isInside(resolvedVault, effectiveOptions.opencodeCommandsDir)) {
				return errorResult(`Native check refused an OpenCode command directory inside the vault: ${effectiveOptions.opencodeCommandsDir}`);
			}
			if (pathsOverlap(snapshot.sharedRoot, effectiveOptions.opencodeCommandsDir)) {
				return errorResult(`Native check refused an OpenCode command directory that overlaps the canonical skill source: ${effectiveOptions.opencodeCommandsDir}`);
			}
		}

		const candidates = loadRuntimeSkills(snapshot, runtime);
		if (candidates.length === 0) return errorResult(`No skills enable the ${runtime} adapter in the configured manifest.`);
		const blockedSkills = blockedResourceSkills(snapshot.resources, candidates);
		const blocked = new Set(blockedSkills);
		const skills = candidates.filter((skill) => !blocked.has(skill.name));
		const policy = snapshot.runtimePolicies[runtime];
		const retired = new Set(policy.retiredNames);
		const problems: string[] = [];
		if (['codex', 'workbuddy', 'antigravity', 'dsh'].includes(runtime)) {
			problems.push(...await manifestCoverage(snapshot, runtime));
		}

		for (const skill of skills) {
			problems.push(...await checkSkill(snapshot, runtime, resolvedTarget, skill, effectiveOptions));
		}

		if (runtime === 'hermes') {
			problems.push(...await staleProblems(resolvedTarget, policy.rejectExampleAbsolutePath, EXCLUDED_SKILL_DIRS, policy.forbiddenLiterals));
		} else if (runtime === 'opencode') {
			problems.push(...await groupedSkillProblems(resolvedTarget, retired));
		} else if (runtime === 'dsh') {
			problems.push(...await staleProblems(resolvedTarget, policy.rejectExampleAbsolutePath, EXCLUDED_SKILL_DIRS, policy.forbiddenLiterals));
			problems.push(...await groupedSkillProblems(resolvedTarget, retired));
		} else {
			problems.push(...await staleProblems(resolvedTarget, policy.rejectExampleAbsolutePath, new Set<string>(), policy.forbiddenLiterals));
			problems.push(...await groupedSkillProblems(resolvedTarget, retired));
		}

		const unique = [...new Set(problems)].sort((left, right) => left.localeCompare(right));
		if (unique.length === 0 && blockedSkills.length === 0) {
			return {
				status: 'passed', kind: 'clean', checkedSkillCount: skills.length, problems: [], exitCode: 0,
				output: `[native] PASS\nChecked ${skills.length} skill(s) without writing runtime files.`,
			};
		}
		return {
			status: 'failed', kind: unique.length ? 'drift' : 'blocked', checkedSkillCount: candidates.length, blockedSkills, problems: unique, exitCode: 1,
			output: [unique.length ? `[native] DRIFT\n${unique.join('\n')}` : '', resourceBlockMessage(blockedSkills)].filter(Boolean).join('\n\n'),
		};
	} catch (error) {
		return errorResult(error instanceof Error ? error.message : String(error));
	}
}

async function checkSkill(
	snapshot: SyncManifestSnapshot,
	runtime: RuntimeName,
	targetRoot: string,
	skill: ReturnType<typeof loadRuntimeSkills>[number],
	options: NativeCheckOptions,
): Promise<string[]> {
	const result: string[] = [];
	const adapter = adapterFor(snapshot.skills.find((item) => item.name === skill.name) as ManifestSkill, runtime);
	if (adapter === null) return result;
	const categoryRoot = runtime === 'hermes' ? path.join(targetRoot, skill.category) : targetRoot;
	const skillDir = await resolveSkillDir(path.join(categoryRoot, skill.name));
	const wrapperPath = runtime === 'dsh' ? path.join(targetRoot, `${skill.name}.md`) : path.join(skillDir, 'SKILL.md');

	if (runtime === 'hermes') {
		const references = await referencedSharedFiles(skill.sharedPath, snapshot.sharedRoot);
		if (!(await pathExists(wrapperPath))) {
			result.push(`Missing wrapper: ${wrapperPath}`);
			return result;
		}
		if (await readText(wrapperPath) !== wrapperFor(skill, runtime, snapshot)) {
			result.push(`Wrapper content drift: ${skill.name}`);
		}
		const expected = new Set<string>();
		for (const reference of references) {
			const targetReference = path.join(skillDir, path.relative(snapshot.sharedRoot, reference));
			expected.add(path.resolve(targetReference));
			if (!(await pathExists(targetReference))) {
				result.push(`Missing Hermes reference for ${skill.name}: ${targetReference}`);
			} else if (!(await readBytes(targetReference)).equals(await readBytes(reference))) {
				result.push(`Hermes reference drift for ${skill.name}: ${targetReference}`);
			}
		}
		const referencesDir = path.join(skillDir, 'references');
		for (const installed of await walkFiles(referencesDir, { include: (file) => path.extname(file).toLowerCase() === '.md' })) {
			if (!expected.has(path.resolve(installed))) result.push(`Stale Hermes reference for ${skill.name}: ${installed}`);
		}
		return result;
	}

	if (runtime === 'opencode') {
		if (!(await pathExists(wrapperPath))) result.push(`Missing wrapper: ${wrapperPath}`);
		else if (await readText(wrapperPath) !== wrapperFor(skill, runtime, snapshot)) result.push(`Skill wrapper content drift: ${skill.name}`);
		const commandRoot = options.opencodeCommandsDir ?? resolveOpenCodeCommandsDir(options);
		const commandPath = path.join(commandRoot, `${skill.name}.md`);
		if (!(await pathExists(commandPath))) result.push(`Missing command: ${commandPath}`);
		else if (await readText(commandPath) !== commandFor(skill)) result.push(`Command content drift: ${skill.name}`);
		return result;
	}

	if (!(await pathExists(wrapperPath))) {
		result.push(`Missing wrapper: ${wrapperPath}`);
		return result;
	}
	const current = await readText(wrapperPath);

	const expectedDescription = `description: "${yamlQuoted(skill.description)}"`;
	if (!current.includes(expectedDescription)) result.push(`Description drift: ${skill.name}`);
	if (!current.includes(canonicalFilePath(snapshot, skill.sharedFile))) result.push(`Shared path missing: ${skill.name}`);
	if (runtime === 'codex') {
		const agentPath = path.join(skillDir, 'agents', 'openai.yaml');
		if (await pathExists(agentPath) && await readText(agentPath) !== agentMetadataFor(skill)) {
			result.push(`Agent metadata drift: ${skill.name}`);
		}
	}
	return result;
}

async function manifestCoverage(snapshot: SyncManifestSnapshot, runtime: RuntimeName): Promise<string[]> {
	const entries = await fs.readdir(snapshot.sharedRoot, { withFileTypes: true });
	const topLevel = new Set(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name));
	const problems: string[] = [];
	for (const skill of snapshot.skills.filter((item) => adapterFor(item, runtime) !== null)) {
		if (!skill.sharedFile.includes('/') && !topLevel.has(skill.sharedFile)) {
			problems.push(`Top-level shared skill missing from manifest: ${skill.sharedFile}`);
		}
		if (!(await pathExists(skill.sharedPath))) problems.push(`Manifest shared file does not exist: ${skill.sharedFile}`);
	}
	return problems;
}

export async function referencedSharedFiles(sharedPath: string, sharedRoot: string): Promise<string[]> {
	const referencesRoot = path.resolve(sharedRoot, 'references');
	const pending = [path.resolve(sharedPath)];
	const found = new Set<string>();
	while (pending.length > 0) {
		const source = pending.pop();
		if (!source) continue;
		const text = await readText(source);
		const candidates = [
			...text.matchAll(/references\/[A-Za-z0-9._/-]+\.md/g),
			...text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g),
		].map((match) => match[1] ?? match[0]);
		for (const candidate of candidates) {
			if (/^[A-Za-z]:[\\/]/.test(candidate) || /^[a-z]+:\/\//i.test(candidate)) continue;
			const filePath = candidate.startsWith('references/')
				? path.resolve(sharedRoot, candidate)
				: path.resolve(path.dirname(source), candidate);
			if (!isInside(referencesRoot, filePath)) continue;
			if (!(await pathExists(filePath))) throw new Error(`Missing shared reference from ${source}: ${filePath}`);
			if (found.has(filePath)) continue;
			found.add(filePath);
			pending.push(filePath);
		}
	}
	return [...found].sort((left, right) => relativeDisplay(sharedRoot, left).localeCompare(relativeDisplay(sharedRoot, right)));
}

async function resolveSkillDir(candidate: string): Promise<string> {
	try {
		const stats = await fs.lstat(candidate);
		return stats.isSymbolicLink() ? fs.realpath(candidate) : candidate;
	} catch {
		return candidate;
	}
}

function resolveOpenCodeCommandsDir(options: NativeCheckOptions): string {
	return options.opencodeCommandsDir
		? resolveConfiguredPath(options.opencodeCommandsDir)
		: path.join(
			process.env.OPENCODE_CONFIG
				? resolveConfiguredPath(process.env.OPENCODE_CONFIG)
				: path.join(os.homedir(), '.config', 'opencode'),
			'commands',
		);
}


function errorResult(message: string): NativeCheckResult {
	return {
		status: 'failed', kind: 'error', checkedSkillCount: 0, problems: [message], exitCode: 2,
		output: `[native] UNAVAILABLE\n${message}`,
	};
}
