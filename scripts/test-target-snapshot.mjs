import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-snapshot-')), 'target-snapshot.cjs');
await esbuild.build({ entryPoints: [path.join(repo, 'src/sync/target-snapshot.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, external: ['node:*'], logLevel: 'silent' });
const { createTargetSnapshot, latestTargetSnapshot, pruneSnapshots, restoreTargetSnapshot } = await import(pathToFileURL(bundle).href);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-snapshot-'));
const store = path.join(root, 'snapshots');

async function writeTree(base, files) {
	for (const [name, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(base, name)), { recursive: true });
		await fs.writeFile(path.join(base, name), content);
	}
}

async function readTree(base) {
	const out = {};
	const walk = async (dir, rel) => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const target = path.join(rel, entry.name);
			if (entry.isDirectory()) await walk(path.join(dir, entry.name), target);
			else out[target.split(path.sep).join('/')] = await fs.readFile(path.join(dir, entry.name), 'utf8');
		}
	};
	await walk(base, '');
	return out;
}

test('create copies the tree, writes a manifest and reports the file count', async () => {
	const target = path.join(root, 'targets', 'demo-skill');
	await writeTree(target, { 'SKILL.md': 'source copy', 'scripts/run.sh': 'echo hi' });
	const { directory, files } = await createTargetSnapshot({ skill: 'demo-skill', source: target, store, fingerprint: 'aabbccdd11223344' });
	assert.equal(files, 2);
	const copied = await readTree(directory);
	delete copied['manifest.json'];
	assert.deepEqual(copied, { 'SKILL.md': 'source copy', 'scripts/run.sh': 'echo hi' });
	const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
	assert.equal(manifest.skill, 'demo-skill');
	assert.equal(manifest.target, target);
	assert.ok(manifest.fingerprint.startsWith('aabbccdd'));
	assert.deepEqual([...manifest.files].sort(), ['SKILL.md', 'scripts/run.sh']);
	assert.ok(manifest.createdAt);
});

test('restore replaces the recorded target with the snapshot copy, skipping the manifest', async () => {
	const target = path.join(root, 'targets', 'restore-skill');
	await writeTree(target, { 'SKILL.md': 'before', 'notes.md': 'kept in snapshot only' });
	const { directory } = await createTargetSnapshot({ skill: 'restore-skill', source: target, store });
	await writeTree(target, { 'SKILL.md': 'after', 'extra.md': 'added later' });
	const { files } = await restoreTargetSnapshot(directory);
	assert.equal(files, 2);
	assert.deepEqual(await readTree(target), { 'SKILL.md': 'before', 'notes.md': 'kept in snapshot only' });
});

test('prune keeps only the newest snapshots per skill', async () => {
	const target = path.join(root, 'targets', 'prune-skill');
	await writeTree(target, { 'SKILL.md': 'x' });
	for (let i = 0; i < 7; i += 1) {
		// Distinct names: identical timestamps within the same second would collide.
		await new Promise((resolve) => setTimeout(resolve, 1010));
		await createTargetSnapshot({ skill: 'prune-skill', source: target, store, keep: 3 });
	}
	const skillDirectory = path.join(store, 'prune-skill');
	const remaining = (await fs.readdir(skillDirectory)).sort();
	assert.equal(remaining.length, 3, `expected 3 snapshots, got ${remaining.length}`);
	await pruneSnapshots(store, 'prune-skill', 1);
	assert.equal((await fs.readdir(skillDirectory)).length, 1);
});

test('latestTargetSnapshot prefers the newest snapshot and resolves without a skill name', async () => {
	const oldest = path.join(store, 'latest-a', 'old');
	await fs.mkdir(oldest, { recursive: true });
	await fs.writeFile(path.join(oldest, 'manifest.json'), JSON.stringify({ skill: 'latest-a', target: path.join(root, 'targets', 'a'), createdAt: '2026-01-01T00:00:00.000Z', files: [] }));
	const target = path.join(root, 'targets', 'latest-b');
	await writeTree(target, { 'SKILL.md': 'newest' });
	const { directory } = await createTargetSnapshot({ skill: 'latest-b', source: target, store });
	const anySkill = await latestTargetSnapshot(store);
	assert.equal(anySkill.directory, directory);
	const bySkill = await latestTargetSnapshot(store, 'latest-a');
	assert.equal(bySkill.directory, oldest);
	assert.equal(await latestTargetSnapshot(store, 'missing-skill'), null);
});
