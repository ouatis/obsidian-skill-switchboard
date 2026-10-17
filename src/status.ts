import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BUILD_ID } from 'virtual:skill-switchboard-build-info';
import type SkillSwitchboardPlugin from './main';

/**
 * Diagnostic trace written next to the vault (dot-prefixed so Obsidian never indexes it).
 * Keep machine-specific vault, source, and target paths out of its metadata so synced copies
 * do not carry a redundant snapshot of local configuration. Run outputs remain verbatim for
 * diagnosis and can include paths. Delete the file whenever the diagnosis is done.
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
	currentCheck?: StatusCheck;
}

export interface StatusCheck {
	state: 'stale' | 'running' | 'passed' | 'failed';
	updatedAt: string;
	reason?: string;
}

const statusWriteQueuesKey = Symbol.for('ouatis.skill-switchboard.status-write-queues');
const sharedWindow = window as typeof window & { [key: symbol]: unknown };
const statusWrites = (sharedWindow[statusWriteQueuesKey] as Map<string, Promise<void>> | undefined) ?? new Map<string, Promise<void>>();
sharedWindow[statusWriteQueuesKey] = statusWrites;

/** Serialize status updates across bundles too, since Obsidian can reload a plugin in-place. */
export function serializeStatusWrite(statusPath: string, operation: () => Promise<void>): Promise<void> {
	const previousWrite = statusWrites.get(statusPath) ?? Promise.resolve();
	const write = previousWrite.catch(() => undefined).then(operation);
	statusWrites.set(statusPath, write);
	return write.finally(() => {
		if (statusWrites.get(statusPath) === write) statusWrites.delete(statusPath);
	});
}

export async function writePluginStatus(plugin: SkillSwitchboardPlugin, extra: StatusExtra = {}): Promise<void> {
	const basePath = plugin.getVaultBasePath();
	if (!basePath) return;
	const statusPath = path.join(basePath, STATUS_FILE);
	try {
		await serializeStatusWrite(statusPath, async () => {
			let previous: StatusExtra = {};
			try {
				const existing = JSON.parse(await fs.readFile(statusPath, 'utf8')) as Record<string, unknown>;
				previous = {
					lastCheck: isStatusRun(existing.lastCheck) ? existing.lastCheck : undefined,
					lastRepair: isStatusRun(existing.lastRepair) ? existing.lastRepair : undefined,
					currentCheck: isStatusCheck(existing.currentCheck) ? existing.currentCheck : undefined,
				};
			} catch {
				// A missing or malformed diagnostic file must not prevent a fresh status write.
			}
			const payload = {
				schemaVersion: 2,
				writtenAt: new Date().toISOString(),
				pluginVersion: plugin.manifest.version,
				buildId: BUILD_ID,
				skillCount: plugin.index.skills.length,
				lastCheck: extra.lastCheck ?? previous.lastCheck,
				lastRepair: extra.lastRepair ?? previous.lastRepair,
				currentCheck: extra.currentCheck ?? previous.currentCheck,
			};
			const temporaryPath = `${statusPath}.${randomUUID()}.tmp`;
			try {
				await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
				await fs.rename(temporaryPath, statusPath);
			} catch (error) {
				await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
				throw error;
			}
		});
	} catch (error) {
		// Diagnostics must never break the plugin itself, but the reason should be visible in the Obsidian console.
		console.warn(`[Skill Switchboard] Could not write diagnostic status at ${statusPath}:`, error);
	}
}

export function runRecord(status: string, exitCode: number, output: string): StatusRun {
	return { status, exitCode, at: new Date().toISOString(), output };
}

export function checkState(state: StatusCheck['state'], reason?: string): StatusCheck {
	return { state, updatedAt: new Date().toISOString(), ...(reason ? { reason } : {}) };
}

function isStatusRun(value: unknown): value is StatusRun {
	if (typeof value !== 'object' || value === null) return false;
	const run = value as Partial<StatusRun>;
	return typeof run.status === 'string' && typeof run.exitCode === 'number' &&
		typeof run.at === 'string' && typeof run.output === 'string';
}

function isStatusCheck(value: unknown): value is StatusCheck {
	if (typeof value !== 'object' || value === null) return false;
	const check = value as Partial<StatusCheck>;
	return ['stale', 'running', 'passed', 'failed'].includes(check.state ?? '') &&
		typeof check.updatedAt === 'string' && (check.reason === undefined || typeof check.reason === 'string');
}
