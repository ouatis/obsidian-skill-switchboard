import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-boundaries-'));
async function write(file, content) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
try {
	const output = path.join(temporary, 'engine.cjs');
	await esbuild.build({ stdin: { contents: `export {inspectManifest} from './src/sync/manifest';export {checkRuntimeNative} from './src/sync/native-check';export {repairRuntimeNative} from './src/sync/native-repair';export {materialize} from './src/sync/package-files';export {skillBundle} from './src/sync/skill-bundle';`, resolveDir: repo }, outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
	const engine = await import(pathToFileURL(output).href);
	async function fixture() {
		const root = await fs.mkdtemp(path.join(temporary, 'case-'));
		const vault = path.join(root, 'vault'), source = path.join(vault, 'skills'), target = path.join(root, 'agent');
		await write(path.join(source, 'drawing/SKILL.md'), '---\nname: drawing\ndescription: Draw diagrams.\n---\n# Drawing\nFull instructions.\n');
		const location = { sharedRoot: source, manifestPath: path.join(vault, 'skills-manifest.json'), confineToVault: true };
		const inspect = () => engine.inspectManifest(vault, location);
		const check = async () => engine.checkRuntimeNative(vault, 'codex', target, (await inspect()).snapshot);
		const repair = async (extra = {}) => engine.repairRuntimeNative(vault, 'codex', target, (await inspect()).snapshot, extra);
		return { root, vault, source, target, location, inspect, check, repair, directory: path.join(target, 'drawing') };
	}
	await test('nested receipt-named resources are copied and local changes are detected', async () => {
		const f = await fixture();
		await write(path.join(f.source, 'drawing/assets/.skill-switchboard.json'), 'SOURCE RESOURCE');
		const snapshot = await f.inspect();
		assert(snapshot.snapshot.skills[0].files.some((file) => file.path === 'assets/.skill-switchboard.json'), 'old root metadata is excluded only from the source package');
		assert.equal((await f.repair()).status, 'passed');
		assert.equal(await fs.readFile(path.join(f.directory, 'assets/.skill-switchboard.json'), 'utf8'), 'SOURCE RESOURCE');
		await write(path.join(f.directory, 'assets/.skill-switchboard.json'), 'USER LOCAL EDIT');
		assert.equal((await f.check()).installs[0].state, 'update');
		assert.equal((await f.repair()).status, 'passed');
		assert.equal(await fs.readFile(path.join(f.directory, 'assets/.skill-switchboard.json'), 'utf8'), 'SOURCE RESOURCE');
	});
	await test('adding obsolete metadata during preparation invalidates the target snapshot', async () => {
		const f = await fixture();
		await write(path.join(f.directory, 'SKILL.md'), 'USER OWNED SKILL');
		const marker = JSON.stringify({ schema: 1, sourceId: 'another-source' });
		const result = await f.repair({ beforeCommit: async () => write(path.join(f.directory, '.skill-switchboard.json'), marker) });
		assert.equal(result.status, 'failed');
		assert.equal(await fs.readFile(path.join(f.directory, '.skill-switchboard.json'), 'utf8'), marker);
		assert.equal(await fs.readFile(path.join(f.directory, 'SKILL.md'), 'utf8'), 'USER OWNED SKILL');
	});
	await test('an unexpected staging file cannot be committed', async () => {
		const f = await fixture();
		const result = await f.repair({ beforeCommit: async () => {
			const staging = (await fs.readdir(f.target)).find((name) => name.startsWith('.skill-switchboard-drawing-next-'));
			assert(staging);
			await write(path.join(f.target, staging, '.skill-switchboard.json'), JSON.stringify({ schema: 1, sourceId: 'another-source' }));
		} });
		assert.equal(result.status, 'failed');
		await assert.rejects(fs.access(f.directory), { code: 'ENOENT' });
		assert.equal((await fs.readdir(f.target)).length, 0, 'temporary preparation and lock are cleaned up');
	});
	await test('new source resources added during preparation invalidate the package snapshot', async () => {
		const f = await fixture();
		const result = await f.repair({ beforeCommit: async () => {
			await write(path.join(f.source, 'drawing/references/new.md'), '# Added after preview\n');
		} });
		assert.equal(result.status, 'failed');
		assert.match(result.output, /Source changed/);
		await assert.rejects(fs.access(f.directory), { code: 'ENOENT' });
	});
	await test('redirecting a source package during preparation is refused', async () => {
		const f = await fixture();
		const directory = path.join(f.source, 'drawing');
		const result = await f.repair({ beforeCommit: async () => {
			await fs.rename(directory, path.join(f.source, 'original'));
			await fs.symlink(path.join(f.source, 'original'), directory, process.platform === 'win32' ? 'junction' : 'dir');
		} });
		assert.equal(result.status, 'failed');
		assert.match(result.output, /Source changed/);
		await assert.rejects(fs.access(f.directory), { code: 'ENOENT' });
	});
	await test('a broken legacy sibling does not block a healthy package', async () => {
		const f = await fixture();
		await write(path.join(f.source, 'good.md'), '# Good\n\nUseful instructions.\n');
		await write(path.join(f.source, 'empty.md'), '# Empty\n');
		await write(f.location.manifestPath, JSON.stringify({ schema_version: 1, total_skills: 2, skills: ['good', 'empty'].map((name) => ({ name, shared_file: `${name}.md`, adapters: { codex: true } })) }));
		const result = await f.repair();
		assert.equal(result.status, 'failed');
		assert.equal(result.partial, true, 'healthy and blocked results stay independent');
		assert.deepEqual(result.changedSkills, ['good']);
		assert.deepEqual(result.blockedSkills, ['empty']);
		assert.match(await fs.readFile(path.join(f.target, 'good/SKILL.md'), 'utf8'), /Useful instructions/);
	});
	await test('legacy references ignore code-shaped links and partial external paths', async () => {
		const f = await fixture();
		await write(path.join(f.source, 'legacy.md'), '# Legacy\n\nUseful instructions. Read [guide](references/guide.md). Run `scripts/run.mjs`.\n');
		await write(path.join(f.source, 'scripts/run.mjs'), 'console.log(42);\n');
		await write(path.join(f.source, 'references/guide.md'), '# Guide\n\nRead [details](details.md).\n\n```python\nregex = "([^\\\"]+)[\\\"]"\nexample = "[not a resource](missing.md)"\n```\n~~~text\n[another example](another-missing.md)\n~~~\n`[inline example](inline-missing.md)`\nUse `toolkit/scripts/local.py` and `~/tools/scripts/other.py` in the configured workspace.\n');
		await write(path.join(f.source, 'references/details.md'), '# Details\n');
		await write(f.location.manifestPath, JSON.stringify({ schema_version: 1, total_skills: 1, skills: [{ name: 'legacy', shared_file: 'legacy.md', adapters: { codex: true } }] }));
		const snapshot = (await f.inspect()).snapshot;
		assert.equal(snapshot.skills[0].packageError, undefined);
		assert.deepEqual(snapshot.skills[0].files.map((file) => file.path), ['references/details.md', 'references/guide.md', 'scripts/run.mjs', 'SKILL.md']);
		assert.equal((await f.repair()).status, 'passed');
		await write(path.join(f.source, 'references/details.md'), '# Details\nRead [missing](missing.md).\n');
		assert.match((await f.inspect()).snapshot.skills[0].packageError, /missing.md/, 'actual missing relative links still block copying');
	});
	await test('vault knowledge wikilinks stay contextual while required file links remain confined', async () => {
		const f = await fixture();
		await write(path.join(f.vault, 'notes/concept.md'), '# Knowledge\nDo not copy into an Agent package.\n');
		await write(path.join(f.source, 'legacy.md'), '# Legacy\n\nFull instructions. Read [guide](references/guide.md).\n');
		await write(path.join(f.source, 'references/guide.md'), '# Guide\nOptional vault context: [[concept|Knowledge]] and [[not-loaded#Heading]].\n');
		await write(f.location.manifestPath, JSON.stringify({ schema_version: 1, total_skills: 1, skills: [{ name: 'legacy', shared_file: 'legacy.md', adapters: { codex: true } }] }));
		const snapshot = (await f.inspect()).snapshot;
		assert.equal(snapshot.skills[0].packageError, undefined);
		assert.deepEqual(snapshot.skills[0].files.map((file) => file.path), ['references/guide.md', 'SKILL.md']);
		assert.equal((await f.repair()).status, 'passed');
		assert.match(await fs.readFile(path.join(f.target, 'legacy/references/guide.md'), 'utf8'), /\[\[concept\|Knowledge\]\]/);
		await fs.appendFile(path.join(f.source, 'references/guide.md'), 'Required [file](../../notes/concept.md).\n');
		assert.match((await f.inspect()).snapshot.skills[0].packageError, /escapes its source/);
		await fs.writeFile(path.join(f.source, 'references/guide.md'), '# Guide\nRequired [file](missing.md).\n');
		assert.match((await f.inspect()).snapshot.skills[0].packageError, /missing.md/);
	});
	await test('vault confinement is checked before parsing an outside manifest or source', async () => {
		const f = await fixture();
		const outside = path.join(f.root, 'outside'), badManifest = path.join(f.vault, 'invalid.json');
		await write(path.join(outside, 'SKILL.md'), 'This is not a skill.');
		await write(badManifest, '{invalid');
		const sourceResult = await engine.inspectManifest(f.vault, { ...f.location, sharedRoot: outside, manifestPath: badManifest });
		assert.match(sourceResult.output, /root resolves outside the vault/, 'confinement has priority over reading unrelated content');
		const outsideManifest = path.join(outside, 'manifest.json'); await write(outsideManifest, '{invalid');
		const manifestResult = await engine.inspectManifest(f.vault, { ...f.location, manifestPath: outsideManifest });
		assert.match(manifestResult.output, /manifest resolves outside the vault/);
	});
	await test('cleanup failure reports partial failure with the exact temporary original path', async () => {
		const f = await fixture();
		assert.equal((await f.repair()).status, 'passed');
		await write(path.join(f.source, 'drawing/assets/new.txt'), 'AUTHORITATIVE');
		const result = await f.repair({ beforeCleanup: async () => { throw new Error('simulated cleanup failure'); } });
		assert.equal(result.status, 'failed');
		assert.equal(result.partial, true);
		assert.deepEqual(result.changedSkills, ['drawing']);
		assert.equal((await f.check()).kind, 'clean', 'file equality must not conceal cleanup failure');
		const residue = (await fs.readdir(f.target)).filter((name) => name.startsWith('.skill-switchboard-drawing-old-'));
		assert.equal(residue.length, 1);
		assert(result.output.includes(path.join(f.target, residue[0])));
		assert.match(result.output, /cleanup/i);
	});
	await test('a reported leftover keeps the target spelling the user configured', async () => {
		// The install path is resolved — Windows short names and macOS
		// symlinked roots both expand — but a path handed back to the user
		// has to be the one they can open. A target reached through a symlink
		// is the same place spelled two ways, which is where the two drift
		// apart.
		if (process.platform === 'win32') return; // symlink creation needs elevation
		const f = await fixture();
		// The symlink must point at a directory that exists: a dangling link
		// cannot be resolved, and the install would then fail before it
		// ever got to the point of reporting a leftover.
		const real = path.join(f.root, 'real-agent');
		await fs.mkdir(real, { recursive: true });
		const linked = path.join(f.root, 'agent-link');
		await fs.symlink(real, linked, 'dir');
		const target = path.join(linked, 'agent');
		// The snapshot is taken fresh each time: the source changes below, and
		// a cached snapshot would make the second repair a no-op.
		const repairThrough = async (extra = {}) => engine.repairRuntimeNative(f.vault, 'codex', target, (await f.inspect()).snapshot, extra);
		assert.equal((await repairThrough()).status, 'passed');
		await write(path.join(f.source, 'drawing/assets/new.txt'), 'AUTHORITATIVE');
		const result = await repairThrough({ beforeCleanup: async () => { throw new Error('simulated cleanup failure'); } });
		assert.equal(result.status, 'failed');
		const residue = (await fs.readdir(target)).filter((name) => name.startsWith('.skill-switchboard-drawing-old-'));
		assert.equal(residue.length, 1);
		assert(result.output.includes(path.join(target, residue[0])), 'the reported path is the configured one, not the resolved one');
	});
	await test('revoking an in-flight repair prevents replacement and restores a displaced original', async () => {
		const f = await fixture(); await write(path.join(f.directory, 'SKILL.md'), 'ORIGINAL');
		for (const seam of ['beforeCommit', 'afterDisplace']) {
			let current = true;
			const result = await f.repair({ isCurrent: () => current, [seam]: async () => { current = false; } });
			assert.equal(result.status, 'failed'); assert.match(result.output, /cancelled/);
			assert.equal(await fs.readFile(path.join(f.directory, 'SKILL.md'), 'utf8'), 'ORIGINAL');
			assert(!(await fs.readdir(f.target)).some(name => name.startsWith('.skill-switchboard-')));
		}
	});
	await test('a captured executable permission change invalidates materialization', { skip: process.platform === 'win32' && 'Windows does not expose executable mode changes' }, async () => {
		const f = await fixture();
		const script = path.join(f.source, 'drawing/scripts/run.sh');
		await write(script, '#!/bin/sh\necho hello\n'); await fs.chmod(script, 0o755);
		const snapshot = (await f.inspect()).snapshot;
		await fs.chmod(script, 0o644);
		await assert.rejects(engine.materialize(snapshot.skills[0].files), /Source changed/);
	});
} finally {
	assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
	await fs.rm(temporary, { recursive: true, force: true });
}
