import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-machines-'));
try {
	const bundle = path.join(temporary, 'storage.cjs');
	await esbuild.build({ entryPoints: [path.join(repo, 'src/settings/storage.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
	const storage = await import(pathToFileURL(bundle).href);
	const legacy = {
		roots: [{ id: 'source', path: '/device-a/skills', enabled: true, kind: 'external', label: 'Source' }],
		targets: [{ id: 'target', path: '/device-a/agent', enabled: true, mode: 'wrapper', runtime: 'codex', label: 'Agent' }],
		harnesses: [{ id: 'harness', command: '/device-a/run {prompt}', enabled: true, label: 'Harness' }],
		syncRootId: 'source', syncManifestPath: '/device-a/manifest.json',
		language: 'zh-CN', autoScan: false, autoCheck: true, showDistributionBoard: true, scanDelayMs: 500,
	};
	const { harnesses, ...active } = legacy;
	const fileA = storage.machineSettingsPath('/device-a/vault', path.join(temporary, 'home-a'));
	const fileB = storage.machineSettingsPath('/device-b/vault', path.join(temporary, 'home-b'));
	assert.notEqual(fileA, storage.machineSettingsPath('/other/vault', path.join(temporary, 'home-a')));
	assert.equal(await storage.readMachineSettings(fileA), null);
	assert.deepEqual(storage.restoredSettings(legacy, null), active, 'legacy connections migrate without activating retired commands');
	let shared;
	await storage.persistSettings(active, fileA, async data => { shared = data; }, legacy);
	await assert.rejects(fs.access(path.join(path.dirname(fileA), 'legacy-settings.json')), { code: 'ENOENT' }, 'migration does not create history backups');
	assert.equal(shared.settingsStorageVersion, 2);
	assert(!JSON.stringify(shared).includes('/device-a'), 'shared preferences never carry local paths or commands');
	assert.equal(shared.targets, undefined); assert.equal(shared.roots, undefined);
	const localA = await storage.readMachineSettings(fileA);
	assert.deepEqual(localA.harnesses, harnesses, 'legacy commands are retained on disk for recovery');
	assert.equal(storage.restoredSettings(shared, localA).harnesses, undefined, 'retired commands are not loaded into active settings');
	assert.deepEqual(storage.restoredSettings(shared, localA).targets, legacy.targets);
	assert.deepEqual(storage.restoredSettings({ ...legacy, targets: [] }, localA).targets, legacy.targets, 'synced legacy data cannot replace this machine’s existing wiring');
	const deviceB = storage.restoredSettings(shared, await storage.readMachineSettings(fileB));
	assert.equal(deviceB.targets, undefined, 'another device starts without enabled agents or inherited paths');
	const forged = { ...shared, autoDistribute: true, autoDistributeScope: 'a'.repeat(64) };
	assert.equal(storage.restoredSettings(forged, null).autoDistribute, undefined, 'synced write consent cannot activate another machine');
	assert.equal(storage.restoredSettings({ ...legacy, autoDistribute: true, autoDistributeScope: 'a'.repeat(64) }, null).autoDistribute, undefined, 'legacy synced data cannot migrate write consent');
	await storage.persistSettings({ ...active, autoDistribute: true, autoDistributeScope: 'b'.repeat(64) }, fileA, async data => { shared = data; });
	assert.equal(shared.autoDistribute, undefined); assert.equal(shared.autoDistributeScope, undefined);
	assert.equal(storage.restoredSettings(shared, await storage.readMachineSettings(fileA)).autoDistributeScope, 'b'.repeat(64), 'consent restores only from this machine file');
	await Promise.all([
		storage.persistSettings({ ...active, language: 'en', targets: [] }, fileA, async data => { await new Promise(resolve => setTimeout(resolve, 20)); shared = data; }),
		storage.persistSettings({ ...active, language: 'zh-CN' }, fileA, async data => { shared = data; }),
	]);
	assert.equal(shared.language, 'zh-CN'); assert.deepEqual((await storage.readMachineSettings(fileA)).targets, legacy.targets, 'queued local and shared saves finish in the same order');
	assert.deepEqual((await storage.readMachineSettings(fileA)).harnesses, harnesses, 'ordinary saves preserve retired command records');
	const pending = storage.persistSettings({ ...active, targets: [] }, fileA, async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
	assert.deepEqual((await storage.readMachineSettings(fileA)).targets, [], 'reload waits for an outstanding configuration save');
	await pending;
	const obstacle = path.join(temporary, 'not-a-directory'); await fs.writeFile(obstacle, 'preserve');
	let sharedWrites = 0;
	await assert.rejects(storage.persistSettings(legacy, path.join(obstacle, 'settings.json'), async () => { sharedWrites++; }));
	assert.equal(sharedWrites, 0, 'legacy settings are not removed when the local migration fails');
	await fs.writeFile(fileA, '{broken'); await assert.rejects(storage.readMachineSettings(fileA));
	await assert.rejects(storage.persistSettings(active, fileA, async () => { sharedWrites++; }));
	assert.equal(sharedWrites, 0, 'an unreadable local file is not overwritten by a save');
	assert.equal(await fs.readFile(fileA, 'utf8'), '{broken', 'invalid local settings are preserved for recovery');
	console.log('Machine settings checks passed: legacy migration, device/vault isolation, local override, serialized saves, privacy, and failure recovery.');
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
