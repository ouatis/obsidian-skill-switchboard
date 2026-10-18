import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-packages-'));
const vault = path.join(temporary, 'vault');
const source = path.join(vault, 'skills');
const location = { sharedRoot: source, manifestPath: path.join(vault, 'skills-manifest.json'), confineToVault: true };
const options = {};
async function write(file, bytes) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); }
const main = '---\nname: drawing\ndescription: >\n  Draw diagrams with\n  local resources.\nlicense: MIT\n---\n\n# Drawing\n\nREAL INSTRUCTIONS: draw the requested diagram. Read [support](references/support.md). Run scripts/build.mjs.\n';
try {
	const modules = {};
	for (const name of ['manifest', 'native-check', 'native-repair', 'skill-bundle', 'install-package', 'install-state']) {
		const bundle = path.join(temporary, `${name}.cjs`);
		await esbuild.build({ entryPoints: [path.join(repo, 'src/sync', `${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
		modules[name] = await import(pathToFileURL(bundle).href);
	}
	const inspect = () => modules.manifest.inspectManifest(vault, location);
	const check = (runtime, target, snapshot) => modules['native-check'].checkRuntimeNative(vault, runtime, target, snapshot);
	const repair = (runtime, target, snapshot, extra = {}) => modules['native-repair'].repairRuntimeNative(vault, runtime, target, snapshot, { ...options, ...extra });
	await write(path.join(source, 'drawing/SKILL.md'), main);
	await write(path.join(source, 'drawing/references/support.md'), '# Support\nRequired details.\n');
	await write(path.join(source, 'drawing/scripts/build.mjs'), 'export const answer = 42;\n');
	await write(path.join(source, 'drawing/assets/image.bin'), Buffer.from([0, 1, 2, 255]));
	let inspected = await inspect();
	assert.equal(inspected.status, 'passed', inspected.output);
	assert.equal(inspected.snapshot.skillCount, 1, 'standard directories work without a hand-written manifest');
	assert.equal(inspected.snapshot.skills[0].files.length, 4);
	const targets = {};
	for (const runtime of ['codex', 'hermes', 'workbuddy', 'opencode', 'antigravity', 'dsh']) {
		const target = targets[runtime] = path.join(temporary, runtime);
		assert.equal((await check(runtime, target, inspected.snapshot)).installs[0].state, 'missing');
		const result = await repair(runtime, target, inspected.snapshot);
		assert.equal(result.status, 'passed', result.output);
		const directory = path.join(target, ...(runtime === 'hermes' ? ['shared'] : []), 'drawing');
		assert.equal(await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8'), main, 'native document contains full instructions, byte for byte');
		assert.deepEqual(await fs.readFile(path.join(directory, 'assets/image.bin')), Buffer.from([0, 1, 2, 255]));
		assert.equal((await check(runtime, target, inspected.snapshot)).kind, 'clean');
		assert.equal((await repair(runtime, target, inspected.snapshot)).writtenFiles, 0, 'idempotent repair');
	}
	const codex = path.join(targets.codex, 'drawing');
	await assert.rejects(fs.access(path.join(codex, '.skill-switchboard.json')), { code: 'ENOENT' }, 'installs do not write ownership metadata');
	await write(path.join(source, 'drawing/assets/new.bin'), 'new asset');
	await fs.unlink(path.join(source, 'drawing/assets/image.bin'));
	const updated = await inspect();
	assert(!modules.manifest.sameSourceSnapshot(inspected.snapshot, updated.snapshot), 'support-file changes invalidate source snapshots');
	assert.equal((await check('codex', targets.codex, updated.snapshot)).installs[0].state, 'update');
	assert.equal((await repair('codex', targets.codex, inspected.snapshot)).status, 'failed', 'stale source files are refused');
	const changed = await repair('codex', targets.codex, updated.snapshot);
	assert.equal(changed.status, 'passed', changed.output);
	assert(!('backupPath' in changed) && !('backupPaths' in changed), 'successful repairs have no retained backup');
	assert.equal(await fs.access(path.join(codex, 'assets/image.bin')).then(() => true, () => false), false, 'removed source files do not linger in copies');
	await write(path.join(codex, 'references/support.md'), 'LOCAL EDIT');
	let state = await check('codex', targets.codex, updated.snapshot);
	assert.equal(state.installs[0].state, 'update');
	assert.equal((await repair('codex', targets.codex, updated.snapshot)).status, 'passed');
	assert.equal(await fs.readFile(path.join(codex, 'references/support.md'), 'utf8'), '# Support\nRequired details.\n', 'canonical source replaces local edits');
	assert.equal(await fs.readFile(path.join(source, 'drawing/references/support.md'), 'utf8'), '# Support\nRequired details.\n', 'an Agent edit never flows back to the source');
	const foreignTarget = path.join(temporary, 'foreign');
	await write(path.join(foreignTarget, 'drawing/SKILL.md'), 'USER OWNED');
	await write(path.join(foreignTarget, 'other/SKILL.md'), 'ANOTHER SKILL');
	const foreign = await check('codex', foreignTarget, updated.snapshot);
	assert.equal(foreign.installs[0].state, 'update');
	assert.equal(foreign.unmanagedEntries.length, 1, 'unlisted skills remain outside the managed scope');
	const adopted = await repair('codex', foreignTarget, updated.snapshot);
	assert.equal(adopted.status, 'passed', adopted.output);
	assert.equal(await fs.readFile(path.join(foreignTarget, 'drawing/SKILL.md'), 'utf8'), main);
	assert.equal(await fs.readFile(path.join(foreignTarget, 'other/SKILL.md'), 'utf8'), 'ANOTHER SKILL');
	// Both the source and target are revalidated after preparing a new package.
	await write(path.join(source, 'drawing/scripts/build.mjs'), 'export const answer = 43;\n');
	let fresh = await inspect();
	const beforeRollback = await fs.readFile(path.join(codex, 'SKILL.md'));
	const oldScript = await fs.readFile(path.join(codex, 'scripts/build.mjs'));
	const rollback = await repair('codex', targets.codex, fresh.snapshot, { afterDisplace: async () => { throw new Error('simulated swap failure'); } });
	assert.equal(rollback.status, 'failed');
	assert.deepEqual(await fs.readFile(path.join(codex, 'SKILL.md')), beforeRollback);
	assert.deepEqual(await fs.readFile(path.join(codex, 'scripts/build.mjs')), oldScript, 'failed swaps restore the complete old directory');
	const concurrentEdit = await repair('codex', targets.codex, fresh.snapshot, { beforeCommit: async () => write(path.join(codex, 'new.txt'), 'new local edit') });
	assert.equal(concurrentEdit.status, 'failed');
	assert.equal(await fs.readFile(path.join(codex, 'new.txt'), 'utf8'), 'new local edit');
	await fs.unlink(path.join(codex, 'new.txt'));
	const sourceEdit = await repair('codex', targets.codex, fresh.snapshot, { beforeCommit: async () => write(path.join(source, 'drawing/scripts/build.mjs'), 'source changed again') });
	assert.equal(sourceEdit.status, 'failed');
	assert.deepEqual(await fs.readFile(path.join(codex, 'scripts/build.mjs')), oldScript);
	// DSH's old flat entry migrates in the same authoritative repair.
	fresh = await inspect();
	let release, ready;
	const prepared = new Promise((resolve) => { ready = resolve; });
	const held = new Promise((resolve) => { release = resolve; });
	const firstConcurrent = repair('codex', targets.codex, fresh.snapshot, { beforeCommit: async () => { ready(); await held; } });
	await prepared;
	try {
		const secondConcurrent = await repair('codex', targets.codex, fresh.snapshot);
		assert.equal(secondConcurrent.status, 'failed');
		assert.match(secondConcurrent.output, /EEXIST|exist/i, 'a second repair cannot acquire the same installation lock');
	} finally { release(); }
	assert.equal((await firstConcurrent).status, 'passed');
	const legacyTarget = path.join(temporary, 'legacy-dsh');
	await write(path.join(legacyTarget, 'drawing.md'), 'OLD THIN ENTRY');
	const legacy = await check('dsh', legacyTarget, fresh.snapshot);
	assert.equal(legacy.installs[0].state, 'update');
	const migrated = await repair('dsh', legacyTarget, fresh.snapshot);
	assert.equal(migrated.status, 'passed', migrated.output);
	assert(!('backupPath' in migrated));
	assert.equal(await fs.access(path.join(legacyTarget, 'drawing.md')).then(() => true, () => false), false);
	assert.equal((await check('dsh', legacyTarget, fresh.snapshot)).kind, 'clean');
	// Refuse vault/source overlap and symlink escapes.
	for (const target of [vault, source, path.dirname(source)]) assert.equal((await repair('codex', target, fresh.snapshot)).status, 'failed');
	const alias = path.join(temporary, 'alias');
	await fs.symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
	assert.equal((await repair('codex', alias, fresh.snapshot)).status, 'failed');
	const redirected = path.join(temporary, 'redirected-hermes');
	const unrelated = path.join(temporary, 'unrelated');
	await fs.mkdir(redirected); await fs.mkdir(unrelated);
	await fs.symlink(unrelated, path.join(redirected, 'shared'), process.platform === 'win32' ? 'junction' : 'dir');
	const redirectedRepair = await repair('hermes', redirected, fresh.snapshot);
	assert.equal(redirectedRepair.status, 'failed', 'an internal junction cannot silently redirect an installation');
	assert.deepEqual(await fs.readdir(unrelated), []);
	await write(path.join(codex, '.skill-switchboard.json'), '{bad');
	assert.equal((await check('codex', targets.codex, fresh.snapshot)).installs[0].state, 'update');
	assert.equal((await repair('codex', targets.codex, fresh.snapshot)).status, 'passed');
	await assert.rejects(fs.access(path.join(codex, '.skill-switchboard.json')), { code: 'ENOENT' }, 'obsolete root receipts are removed, not parsed');
	for (const target of [...Object.values(targets), foreignTarget, legacyTarget]) {
		assert(!(await fs.readdir(target)).some((name) => name.startsWith('.skill-switchboard-')), 'successful transactions leave no adjacent temporary files');
	}
	await assert.rejects(fs.access(path.join(temporary, 'backups')), { code: 'ENOENT' });
	// Legacy cards remain usable, but install their whole body and reference closure.
	const cards = path.join(vault, 'cards');
	await write(path.join(cards, 'review.md'), '---\nstatus: active\n---\n# Review\n\nREAL REVIEW RULES. Read [support](references/a.md).\n');
	await write(path.join(cards, 'references/a.md'), '# A\nRead [B](b.md).\n');
	await write(path.join(cards, 'references/b.md'), '# B\n');
	const manifest = { schema_version: 1, total_skills: 1, skills: [{ name: 'review', shared_file: 'review.md', adapters: { codex: true, dsh: true, antigravity: false } }] };
	await write(location.manifestPath, JSON.stringify(manifest));
	const cardSnapshot = await modules.manifest.inspectManifest(vault, { ...location, sharedRoot: cards });
	assert.equal(cardSnapshot.status, 'passed', cardSnapshot.output);
	assert.equal(modules.manifest.adapterFor(cardSnapshot.snapshot.skills[0], 'antigravity'), null);
	const cardTarget = path.join(temporary, 'cards-codex');
	assert.equal((await repair('codex', cardTarget, cardSnapshot.snapshot)).status, 'passed');
	const cardText = await fs.readFile(path.join(cardTarget, 'review/SKILL.md'), 'utf8');
	assert(cardText.includes('REAL REVIEW RULES.'));
	assert(!cardText.includes('Canonical shared rules live at:'));
	assert.equal(await fs.readFile(path.join(cardTarget, 'review/references/b.md'), 'utf8'), '# B\n');
	assert.equal((await modules.manifest.inspectManifest(vault, { ...location, manifestPath: path.join(vault, 'missing.json'), manifestRequired: true })).status, 'failed');
	console.log('Complete package distribution passed: 6 runtimes, optional manifest, full text/resources/binaries, one-way copies, source authority, no backups or receipts, update/removals, rollback, races, legacy migration, and path guards.');
} finally {
	// The only recursive cleanup target is the exact directory created by mkdtemp above.
	assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
	await fs.rm(temporary, { recursive: true, force: true });
}
