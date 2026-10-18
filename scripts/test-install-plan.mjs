import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-plan-'));
async function write(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
const element = (tag) => {
	const node = { tag, children: [], attributes: new Map(), open: false, text: '', setAttribute(name, value) { this.attributes.set(name, value); } };
	const append = (tag, options = {}) => {
		const child = element(tag); child.text = options.text ?? ''; child.className = typeof options === 'string' ? options : options.cls ?? ''; node.children.push(child); return child;
	};
	node.createDiv = (options) => append('div', options);
	node.createEl = append;
	return node;
};
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
try {
	const output = path.join(temporary, 'engine.cjs');
	await esbuild.build({ stdin: { contents: `export {inspectManifest} from './src/sync/manifest';export {checkRuntimeNative} from './src/sync/native-check';export {repairRuntimeNative} from './src/sync/native-repair';export {runRepairAll,collectTargetChecks} from './src/sync/adapter-run';export {planInstalls} from './src/sync/install-plan';export {sourceTree} from './src/sync/package-files';export {repairPlanDetails} from './src/ui/repair-plan';export {renderInstallPlans} from './src/ui/install-plan';export {getStrings} from './src/i18n';`, resolveDir: repo }, outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
	const e = await import(pathToFileURL(output).href);
	const names = ['missing-copy', 'update-copy', 'local-edit', 'foreign-copy', 'broken', 'keep-current'];
	const vault = path.join(temporary, 'vault'), source = path.join(vault, 'skills'), target = path.join(temporary, 'agent');
	const location = { sharedRoot: source, manifestPath: path.join(vault, 'skills-manifest.json'), confineToVault: true, manifestRequired: true };
	for (const name of names) await write(path.join(source, `${name}.md`), `---\nname: ${name}\ndescription: Do ${name}.\n---\n# ${name}\n\nFull instructions.\n`);
	await write(location.manifestPath, JSON.stringify({ schema_version: 1, total_skills: names.length, skills: names.map((name) => ({ name, shared_file: `${name}.md`, adapters: { codex: true } })) }));
	const inspect = () => e.inspectManifest(vault, location);
	const snapshot = (await inspect()).snapshot;
	assert(snapshot);
	const options = {};
	assert.equal((await e.repairRuntimeNative(vault, 'codex', target, snapshot, options)).status, 'passed');
	await fs.rename(path.join(target, 'missing-copy'), path.join(temporary, 'removed-copy'));
	await fs.appendFile(path.join(source, 'update-copy.md'), 'New canonical rule.\n');
	await fs.appendFile(path.join(target, 'local-edit/SKILL.md'), 'LOCAL USER EDIT\n');
	await write(path.join(target, 'foreign-copy/SKILL.md'), 'OLD SAME-NAME SKILL');
	await write(path.join(target, 'other/SKILL.md'), 'UNRELATED SKILL');
	await fs.appendFile(path.join(source, 'broken.md'), 'Read [required](references/missing.md).\n');
	const targetConfig = { id: 'test', label: 'Codex', runtime: 'codex', mode: 'copy', enabled: true, path: target };
	const provider = {
		inspectManifest: inspect,
		checkRuntime: async (_vault, runtime, targetPath, selected) => {
			const native = await e.checkRuntimeNative(vault, runtime, targetPath, selected ?? (await inspect()).snapshot); return { ...native, native };
		},
		repairRuntime: async (_vault, runtime, targetPath, selected) => {
			const native = await e.repairRuntimeNative(vault, runtime, targetPath, selected ?? (await inspect()).snapshot, options); return { ...native, native };
		},
	};
	const context = { provider, settings: { targets: [targetConfig] } };
	const checks = await e.collectTargetChecks(context, vault, (await inspect()).snapshot);
	await test('plan counts source differences without a second ownership workflow', () => {
		const plan = e.planInstalls(checks[0].result.native.installs);
		assert.deepEqual(plan.counts, { install: 1, update: 3, blocked: 1, current: 1 });
		assert.equal(plan.writes, 4);
		assert.equal(checks[0].repairable, true);
	});
	await test('bilingual confirmation describes all overwrites and the no-backup policy', () => {
		for (const locale of ['en', 'zh-CN']) {
			const strings = e.getStrings(locale), details = e.repairPlanDetails(checks, strings);
			assert(details.includes(strings.installPlanCounts({ install: 1, update: 3, blocked: 1, current: 1 })));
			for (const [action, name] of [['install', 'missing-copy'], ['update', 'update-copy'], ['update', 'local-edit'], ['update', 'foreign-copy'], ['blocked', 'broken']]) assert(details.includes(`${strings.installAction(action)} · ${name}`));
			assert(details.includes('references'));
			assert(strings.repairConfirmMessage.includes(locale === 'en' ? 'without a history backup' : '不保留历史备份'));
		}
	});
	await test('problem groups open first while healthy groups remain collapsed', () => {
		for (const locale of ['en', 'zh-CN']) {
			const host = element('div'), strings = e.getStrings(locale);
			e.renderInstallPlans(host, checks, strings);
			const all = descendants(host), groups = all.filter((node) => node.attributes.has('data-install-group'));
			assert.deepEqual(groups.map((node) => node.attributes.get('data-install-group')), ['blocked', 'install', 'update', 'current']);
			assert.deepEqual(groups.map((node) => node.open), [true, false, false, false]);
			assert(all.some((node) => node.text.includes('missing.md')), 'blocker details are visible without raw logs');
			assert(all.some((node) => node.text === strings.installPlanDescription));
		}
	});
	await test('one repair replaces all differing copies and leaves blocked or unrelated skills alone', async () => {
		const sourceBefore = await e.sourceTree(source);
		const original = new Map(await Promise.all(['broken', 'keep-current', 'other'].map(async (name) => [name, await fs.readFile(path.join(target, name, 'SKILL.md'), 'utf8')])));
		const result = await e.runRepairAll(context, vault, e.getStrings('en'));
		assert.equal(result.repair.status, 'failed', 'remaining blocked packages are not hidden behind success');
		assert.equal(result.failedCount, 1);
		assert.deepEqual(result.details[0].repair.native.changedSkills, ['missing-copy', 'update-copy', 'local-edit', 'foreign-copy']);
		assert.equal(result.details[0].repair.native.partial, true);
		assert.match(result.repair.output, /PARTIAL \(some operations incomplete\)/);
		assert(!('backupPaths' in result.details[0].repair.native));
		assert(!(await fs.readdir(target)).some((name) => name.startsWith('.skill-switchboard-')));
		for (const name of ['missing-copy', 'update-copy', 'local-edit', 'foreign-copy']) {
			const expected = (await fs.readFile(path.join(source, `${name}.md`), 'utf8')).replace(`description: Do ${name}.`, `description: "Do ${name}."`);
			assert.equal(await fs.readFile(path.join(target, name, 'SKILL.md'), 'utf8'), expected);
			await assert.rejects(fs.access(path.join(target, name, '.skill-switchboard.json')), { code: 'ENOENT' });
		}
		for (const [name, text] of original) assert.equal(await fs.readFile(path.join(target, name, 'SKILL.md'), 'utf8'), text);
		assert.deepEqual(await e.sourceTree(source), sourceBefore, 'distribution never rewrites canonical files');
		const repeat = await e.runRepairAll(context, vault, e.getStrings('en'));
		assert.equal(repeat.details.length, 0, 'repeated repair does not rewrite already-current copies');
		const noWrites = e.repairPlanDetails(await e.collectTargetChecks(context, vault, (await inspect()).snapshot), e.getStrings('en'));
		assert(noWrites.includes(e.getStrings('en').installPlanNoWrites));
	});

} finally {
	assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
	await fs.rm(temporary, { recursive: true, force: true });
}
