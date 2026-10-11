import { promises as fs } from 'node:fs';
import path from 'node:path';
import type SkillSwitchboardPlugin from './main';

/**
 * Diagnostic trace written next to the vault (dot-prefixed so Obsidian never indexes it).
 * Without this file there is no way to tell whether the running plugin is the freshly built
 * bundle or an older one still held in memory. Delete it whenever the diagnosis is done.
 */
export const STATUS_FILE = '.skill-switchboard-status.json';

export interface StatusRun {
	status: string;
	exitCode: number;
	at: string;
	output: string;
}

export interface StatusExtra {
	lastCheck?: StatusRun;
	lastRepair?: StatusRun;
}

export async function writePluginStatus(plugin: SkillSwitchboardPlugin, extra: StatusExtra = {}): Promise<void> {
	const basePath = plugin.getVaultBasePath();
	if (!basePath) return;
	const payload = {
		writtenAt: new Date().toISOString(),
		pluginVersion: plugin.manifest.version,
		vaultPath: basePath,
		roots: plugin.settings.roots.map((root) => ({ label: root.label, path: root.path, enabled: root.enabled })),
		targets: plugin.settings.targets.map((target) => ({
			label: target.label,
			runtime: target.runtime,
			mode: target.mode,
			enabled: target.enabled,
			path: target.path,
		})),
		skillCount: plugin.index.skills.length,
		...extra,
	};
	try {
		await fs.writeFile(path.join(basePath, STATUS_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
	} catch (error) {
		// Diagnostics must never break the plugin itself.
		void error;
	}
}

export function runRecord(status: string, exitCode: number, output: string): StatusRun {
	return { status, exitCode, at: new Date().toISOString(), output };
}
