import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { SkillSwitchboardSettings } from '../settings';

const CONNECTION_KEYS = ['roots', 'targets', 'syncRootId', 'syncManifestPath', 'autoDistribute', 'autoDistributeScope'] as const;
const PREFERENCE_KEYS = ['language', 'viewLocation', 'autoScan', 'autoCheck', 'scanDelayMs', 'showDistributionBoard'] as const;
type ConnectionSettings = Pick<SkillSwitchboardSettings, typeof CONNECTION_KEYS[number]>;
type SharedSettings = Pick<SkillSwitchboardSettings, typeof PREFERENCE_KEYS[number]> & { settingsStorageVersion: 2 };

const queueKey = Symbol.for('ouatis.skill-switchboard.machine-settings-writes');
// Filesystem operations share a process-level queue across plugin reloads.
const shared = process as typeof process & { [key: symbol]: unknown };
const writes = (shared[queueKey] as Map<string, Promise<void>> | undefined) ?? new Map<string, Promise<void>>();
shared[queueKey] = writes;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Each local vault checkout owns its wiring; packages remain in the machine-wide registry. */
export function machineSettingsPath(vaultPath: string, home = os.homedir()): string {
	const id = createHash('sha256').update(path.resolve(vaultPath)).digest('hex').slice(0, 24);
	return path.join(home, '.skill-switchboard', 'vaults', id, 'settings.json');
}

export async function readMachineSettings(file: string): Promise<Record<string, unknown> | null> {
	await writes.get(file)?.catch(() => undefined);
	return readStoredConnections(file);
}

async function readStoredConnections(file: string): Promise<Record<string, unknown> | null> {
	try {
		if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Machine settings exceed the size limit.');
		const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
		if (!record(value) || value.schemaVersion !== 1 || !record(value.connections)) throw new Error('Invalid machine settings.');
		return value.connections;
	} catch (error) {
		if (record(error) && error.code === 'ENOENT') return null;
		throw new Error(`Could not load local connection settings at ${file}: ${error instanceof Error ? error.message : String(error)}. The file was left unchanged.`);
	}
}

/** Legacy connections migrate once. New devices never inherit another device's wiring. */
export function restoredSettings(saved: unknown, local: Record<string, unknown> | null): unknown {
	if (!record(saved) && !local) return saved;
	const data = record(saved) ? { ...saved } : {};
	delete data.harnesses;
	// Write consent is never imported from synced plugin data, even in a legacy file.
	delete data.autoDistribute;
	delete data.autoDistributeScope;
	if (local || data.settingsStorageVersion === 2) {
		for (const key of CONNECTION_KEYS) delete data[key];
		if (local) for (const key of CONNECTION_KEYS) if (Object.prototype.hasOwnProperty.call(local, key)) data[key] = local[key];
	}
	return data;
}

export function hasLegacyConnections(saved: unknown): boolean {
	return record(saved) && [...CONNECTION_KEYS, 'harnesses'].some((key) => Object.prototype.hasOwnProperty.call(saved, key));
}

/** Capture before queuing, then save locally before removing legacy values from shared data. */
export function persistSettings(
	settings: SkillSwitchboardSettings,
	file: string,
	saveShared: (data: SharedSettings) => Promise<void>,
	legacy?: unknown,
): Promise<void> {
	const connections = Object.fromEntries(CONNECTION_KEYS.map((key) => [key, settings[key]])) as ConnectionSettings;
	const payload = JSON.stringify({ schemaVersion: 1, connections }, null, 2) + '\n';
	const legacyHarnesses = record(legacy) && Object.prototype.hasOwnProperty.call(legacy, 'harnesses')
		? JSON.stringify(legacy.harnesses) : undefined;
	const preferences = Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, settings[key]])) as SharedSettings;
	preferences.settingsStorageVersion = 2;
	const operation = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
		// Retired command records stay on disk for recovery, outside active settings.
		const stored = await readStoredConnections(file);
		const document = JSON.parse(payload) as { schemaVersion: 1; connections: Record<string, unknown> };
		if (stored && Object.prototype.hasOwnProperty.call(stored, 'harnesses')) document.connections.harnesses = stored.harnesses;
		else if (legacyHarnesses !== undefined) document.connections.harnesses = JSON.parse(legacyHarnesses) as unknown;
		await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			await fs.writeFile(temporary, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
			await fs.rename(temporary, file);
		} finally { await fs.rm(temporary, { force: true }); }
		await saveShared(preferences);
	});
	writes.set(file, operation);
	return operation.finally(() => { if (writes.get(file) === operation) writes.delete(file); });
}
