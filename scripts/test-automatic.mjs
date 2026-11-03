import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-automatic-'));
const previousWindow = globalThis.window, timers = new Map(); let timerId = 0;
globalThis.window = { setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) { for (let i = 0; i < 300 && !predicate(); i++) await pause(); assert(predicate(), 'asynchronous operation did not settle'); }
async function write(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
try {
	const output = path.join(temporary, 'engine.cjs');
	await esbuild.build({ stdin: { contents: `export * from './src/sync/automatic-distribution';export * from './src/sync/automatic-scope';export * from './src/sync/file-retry';export {createSyncProvider} from './src/sync-provider';export {checkAllTargets,runRepairAll} from './src/sync/adapter-run';export {getStrings} from './src/i18n';`, resolveDir: repo }, outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
	const e = await import(pathToFileURL(output).href);
	async function fixture() {
		const root = await fs.mkdtemp(path.join(temporary, 'case-')), vault = path.join(root, 'vault'), source = path.join(vault, 'skills'), target = path.join(root, 'agent');
		const original = '---\nname: drawing\ndescription: Draw a diagram.\n---\n# Drawing\nFull instructions.\n';
		await write(path.join(source, 'drawing/SKILL.md'), original);
		await write(path.join(target, 'other/SKILL.md'), 'DO NOT CHANGE');
		const settings = { roots: [{ id: 'source', label: 'Source', path: 'skills', kind: 'vault', enabled: true }], syncRootId: 'source', syncManifestPath: '',
			targets: [{ id: 'codex', runtime: 'codex', label: 'Codex', path: target, mode: 'copy', enabled: true }], autoDistribute: false, autoDistributeScope: '' };
		const provider = e.createSyncProvider(() => ({ sharedRoot: source, manifestPath: path.join(vault, 'skills-manifest.json'), confineToVault: true, packageRegistryPath: path.join(root, 'packages.json') }));
		const context = { provider, settings }, f = { root, vault, source, target, settings, original, notifications: [], repairs: 0, requests: 0, revokes: 0, busy: false, last: null };
		f.scope = () => e.resolveAutomaticScope(vault, settings);
		f.run = () => e.checkAllTargets(context, vault, 'No targets');
		f.controller = new e.AutomaticDistribution({ enabled: () => settings.autoDistribute, consent: () => settings.autoDistributeScope,
			busy: () => f.busy, scope: f.scope, inspect: () => provider.inspectManifest(vault), requestCheck: () => f.requests++,
			revoke: async () => { f.revokes++; settings.autoDistribute = false; settings.autoDistributeScope = ''; },
			repair: async (snapshot, current) => { f.repairs++; f.last = await e.runRepairAll({ ...context, isCurrent: current }, vault, e.getStrings('en'), snapshot); return f.last; },
			failure: output => f.notifications.push(output) });
		f.authorize = async () => { settings.autoDistributeScope = (await f.scope()).key; settings.autoDistribute = true; };
		f.fire = () => { const [id, item] = [...timers].at(-1) ?? []; assert(item); assert.equal(item.ms, 2000); timers.delete(id); item.fn(); };
		return f;
	}
	await test('disabled by default; changed source needs a second stable snapshot before writes', async () => {
		const f = await fixture();
		f.controller.consider(await f.run()); assert.equal(timers.size, 0);
		await f.authorize(); f.controller.consider(await f.run());
		await fs.appendFile(path.join(f.source, 'drawing/SKILL.md'), 'New source rule.\n');
		f.fire(); await until(() => f.requests === 1);
		assert.equal(f.repairs, 0); await assert.rejects(fs.access(path.join(f.target, 'drawing')), { code: 'ENOENT' });
		f.controller.consider(await f.run()); f.fire(); await until(() => f.last !== null);
		assert.equal(f.last.repair.status, 'passed'); assert.equal(f.repairs, 1); assert.equal(f.notifications.length, 0);
		assert.match(await fs.readFile(path.join(f.target, 'drawing/SKILL.md'), 'utf8'), /New source rule/);
		assert.equal(await fs.readFile(path.join(f.target, 'other/SKILL.md'), 'utf8'), 'DO NOT CHANGE');
		assert(!(await fs.readdir(f.target)).some(name => name.startsWith('.skill-switchboard-')));
		f.controller.cancel();
	});
	await test('cancellation and a busy foreground operation cannot leave an automatic write queued', async () => {
		const f = await fixture(); await f.authorize();
		f.controller.consider(await f.run()); f.controller.cancel(); assert.equal(timers.size, 0);
		f.controller.consider(await f.run()); f.busy = true; f.fire(); await pause(); assert.equal(f.repairs, 0);
		f.busy = false; f.settings.autoDistribute = false; f.controller.consider(await f.run()); assert.equal(timers.size, 0);
	});
	await test('partial packages stay blocked, healthy copies update, and the same failure alerts once', async () => {
		const f = await fixture();
		await write(path.join(f.source, 'broken.md'), '# Broken\n\nRequired [resource](references/missing.md).\n');
		await write(path.join(f.vault, 'skills-manifest.json'), JSON.stringify({ schema_version: 1, total_skills: 2, skills: [
			{ name: 'drawing', shared_file: 'drawing/SKILL.md', adapters: { codex: true } }, { name: 'broken', shared_file: 'broken.md', adapters: { codex: true } } ] }));
		await f.authorize(); f.controller.consider(await f.run()); f.fire(); await until(() => f.notifications.length === 1);
		assert.equal(f.last.repair.status, 'failed'); assert.deepEqual(f.last.details[0].repair.native.changedSkills, ['drawing']);
		await assert.rejects(fs.access(path.join(f.target, 'broken')), { code: 'ENOENT' });
		f.last = null; f.controller.consider(await f.run()); f.fire(); await until(() => f.last !== null); await pause();
		assert.equal(f.notifications.length, 1, 'healthy-copy counts must not generate a second warning');
		const attempts = f.repairs; f.controller.consider(await f.run()); f.fire(); await pause(); await pause(); assert.equal(f.repairs, attempts, 'unchanged failure does not retry every timer tick');
		await fs.appendFile(path.join(f.source, 'drawing/SKILL.md'), 'Another healthy source update.\n');
		f.last = null; f.controller.consider(await f.run()); f.fire(); await until(() => f.last !== null); await pause();
		assert.match(await fs.readFile(path.join(f.target, 'drawing/SKILL.md'), 'utf8'), /Another healthy source update/);
		assert.equal(f.notifications.length, 1, 'an unrelated healthy update must not repeat the same blocked-skill warning');
		await write(path.join(f.source, 'references/missing.md'), '# Restored resource\n');
		f.last = null; f.controller.consider(await f.run()); f.fire(); await until(() => f.last?.repair.status === 'passed');
		assert.equal((await f.run()).result.status, 'passed'); assert.equal(f.notifications.length, 1); f.controller.cancel();
	});
	await test('destination changes revoke consent, labels do not, and overlapping roots are refused', async () => {
		const f = await fixture(); await f.authorize(); const scope = f.settings.autoDistributeScope;
		f.settings.targets[0].label = 'Renamed display label'; assert.equal((await f.scope()).key, scope);
		f.settings.targets[0].path = path.join(f.root, 'new-agent'); assert.equal(await f.controller.validate(), false);
		assert.equal(f.revokes, 1); assert.equal(f.settings.autoDistribute, false);
		f.settings.targets.push({ ...f.settings.targets[0], id: 'nested', path: path.join(f.root, 'new-agent/nested') });
		await assert.rejects(f.scope(), /overlap each other/);
		f.settings.targets = [f.settings.targets[0]]; f.settings.targets[0].path = f.source; await assert.rejects(f.scope(), /outside the vault and source/);
	});
	await test('physical path redirects revoke consent even if the configured text is unchanged', async () => {
		const f = await fixture(), alias = path.join(f.root, 'agent-alias'), other = path.join(f.root, 'other-agent');
		await fs.mkdir(other); await fs.symlink(f.target, alias, process.platform === 'win32' ? 'junction' : 'dir');
		f.settings.targets[0].path = alias; await f.authorize();
		await fs.unlink(alias); await fs.symlink(other, alias, process.platform === 'win32' ? 'junction' : 'dir');
		assert.equal(await f.controller.validate(), false); assert.equal(f.revokes, 1);
	});
	await test('filesystem retries are bounded, selective, and cancellation-aware', async () => {
		let attempts = 0; const waits = [];
		assert.equal(await e.retryFileOperation(async () => { if (++attempts < 3) throw Object.assign(new Error('Busy'), { code: 'EPERM' }); return 42; }, () => true, async ms => waits.push(ms)), 42);
		assert.equal(attempts, 3); assert.deepEqual(waits, [150, 450]);
		for (const code of ['EINVAL', 'ENOENT', 'EEXIST']) {
			attempts = 0; await assert.rejects(e.retryFileOperation(async () => { attempts++; throw Object.assign(new Error(code), { code }); })); assert.equal(attempts, 1);
		}
		attempts = 0; await assert.rejects(e.retryFileOperation(async () => { attempts++; throw Object.assign(new Error('Busy'), { code: 'EBUSY' }); }, () => true, async () => {})); assert.equal(attempts, 3);
		let current = true; attempts = 0;
		await assert.rejects(e.retryFileOperation(async () => { attempts++; throw Object.assign(new Error('Busy'), { code: 'EPERM' }); }, () => current, async () => { current = false; }), /cancelled/); assert.equal(attempts, 1);
	});
} finally {
	timers.clear(); globalThis.window = previousWindow;
	assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
	await fs.rm(temporary, { recursive: true, force: true });
}
