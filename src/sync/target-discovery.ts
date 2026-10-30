import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeName } from '../types';

export interface DiscoveredRuntimeTarget {
	runtime: RuntimeName;
	label: string;
	path: string;
}

interface RuntimeTargetLocation {
	runtime: RuntimeName;
	label: string;
	relativePath: string;
}

/** Standard per-user directories only; shared ~/.agents/skills is intentionally excluded. */
const STANDARD_LOCATIONS: RuntimeTargetLocation[] = [
	{ runtime: 'codex', label: 'Codex', relativePath: '.codex/skills' },
	{ runtime: 'hermes', label: 'Hermes', relativePath: '.hermes/skills' },
	{ runtime: 'workbuddy', label: 'WorkBuddy', relativePath: '.workbuddy/skills' },
	{ runtime: 'opencode', label: 'OpenCode', relativePath: '.config/opencode/skills' },
	{ runtime: 'antigravity', label: 'Antigravity', relativePath: '.gemini/config/skills' },
	{ runtime: 'antigravity', label: 'Antigravity', relativePath: '.gemini/antigravity/skills' },
	{ runtime: 'antigravity', label: 'Antigravity CLI', relativePath: '.gemini/antigravity-cli/skills' },
	{ runtime: 'dsh', label: 'DSH', relativePath: '.dsh/skills' },
];

/** Probe only known directory paths. This never reads skill contents or creates files. */
export async function discoverRuntimeTargets(
	home = os.homedir(),
	isDirectory: (candidate: string) => Promise<boolean> = defaultIsDirectory,
): Promise<DiscoveredRuntimeTarget[]> {
	const candidates = await Promise.all(STANDARD_LOCATIONS.map(async (location) => {
		const candidatePath = path.join(home, location.relativePath);
		return await isDirectory(candidatePath)
			? { runtime: location.runtime, label: location.label, path: `~/${location.relativePath.replaceAll(path.sep, '/')}` }
			: null;
	}));
	return candidates.filter((candidate): candidate is DiscoveredRuntimeTarget => candidate !== null);
}

async function defaultIsDirectory(candidate: string): Promise<boolean> {
	try {
		return (await fs.stat(candidate)).isDirectory();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') return false;
		throw error;
	}
}
