import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vault = path.resolve(repo, '..', 'JARDIN');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-native-'));

try {
	const bundle = path.join(tempRoot, 'native-check.cjs');
	const repairBundle = path.join(tempRoot, 'native-repair.cjs');
	const pathsBundle = path.join(tempRoot, 'paths.cjs');
	await esbuild.build({
		entryPoints: [path.join(repo, 'src', 'sync', 'native-check.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: bundle,
		external: ['node:*'],
		logLevel: 'silent',
	});
	await esbuild.build({
		entryPoints: [path.join(repo, 'src', 'sync', 'native-repair.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: repairBundle,
		external: ['node:*'],
		logLevel: 'silent',
	});
	await esbuild.build({
		entryPoints: [path.join(repo, 'src', 'utils', 'paths.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: pathsBundle,
		external: ['node:*'],
		logLevel: 'silent',
	});
	const native = await import(pathToFileURL(bundle).href);
	const repair = await import(pathToFileURL(repairBundle).href);
	const paths = await import(pathToFileURL(pathsBundle).href);
	assert.equal(paths.resolveConfiguredPath('~'), os.homedir());
	assert.equal(paths.resolveConfiguredPath('~/.codex/skills'), path.join(os.homedir(), '.codex', 'skills'));
	assert.equal(
		paths.resolveConfiguredPath(path.join(os.homedir(), '.codex', 'skills'), vault),
		path.join(os.homedir(), '.codex', 'skills'),
	);
	assert.equal(paths.resolveConfiguredPath('/~/.codex/skills'), path.join(os.homedir(), '.codex', 'skills'));
	assert.equal(paths.resolveConfiguredPath('${HOME}/.codex/skills'), path.join(os.homedir(), '.codex', 'skills'));
	assert.equal(paths.resolveConfiguredPath('%USERPROFILE%\\.codex\\skills'), path.join(os.homedir(), '.codex', 'skills'));
	assert.equal(paths.resolveConfiguredPath('runtime/skills', vault), path.join(vault, 'runtime', 'skills'));
	if (path.sep === '/') {
		assert.throws(() => paths.resolveConfiguredPath('C:\\Users\\louxi\\.codex\\skills'), /Use a portable path/);
		assert.throws(() => paths.resolveConfiguredPath('/C:\\Users\\louxi\\.codex\\skills'), /Use a portable path/);
	}
	const targets = Object.fromEntries([
		'codex', 'hermes', 'workbuddy', 'opencode', 'antigravity', 'dsh',
	].map((runtime) => [runtime, path.join(tempRoot, runtime)]));
	const commands = path.join(tempRoot, 'opencode-commands');

	const manifest = await native.inspectManifest(vault);
	assert.equal(manifest.status, 'passed', manifest.output);
	assert.ok(manifest.snapshot, 'native manifest snapshot should exist');
	for (const runtime of Object.keys(targets)) {
		const initialRepair = await repair.repairRuntimeNative(vault, runtime, targets[runtime], manifest.snapshot, {
			...(runtime === 'opencode' ? { opencodeCommandsDir: commands } : {}),
			backupRoot: path.join(tempRoot, 'backups', 'initial', runtime),
		});
		assert.equal(initialRepair.status, 'passed', `${runtime} initial native repair: ${initialRepair.output}`);
		const before = await hashTree(targets[runtime]);
		const result = await native.checkRuntimeNative(
			vault,
			runtime,
			targets[runtime],
			manifest.snapshot,
			{ opencodeCommandsDir: commands },
		);
		assert.equal(result.kind, 'clean', `${runtime}: ${result.output}`);
		assert.equal(result.checkedSkillCount, 21, `${runtime} skill count`);
		assert.equal(await hashTree(targets[runtime]), before, `${runtime} native check wrote files`);
	}

	const codexWrapper = path.join(targets.codex, 'chengfa', 'SKILL.md');
	const codexText = await fs.readFile(codexWrapper, 'utf8');
	await fs.writeFile(codexWrapper, codexText.replace('description: "', 'description: "DRIFT '), 'utf8');
	const codexDrift = await native.checkRuntimeNative(vault, 'codex', targets.codex, manifest.snapshot);
	assert.equal(codexDrift.kind, 'drift');
	assert.ok(codexDrift.problems.includes('Description drift: chengfa'));
	const codexRepair = await repair.repairRuntimeNative(vault, 'codex', targets.codex, manifest.snapshot, { backupRoot: path.join(tempRoot, 'backups', 'codex') });
	assert.equal(codexRepair.status, 'passed', codexRepair.output);
	assert.ok(codexRepair.writtenFiles > 0);
	assert.ok(codexRepair.backupPath && await fileExists(codexRepair.backupPath));
	assert.equal((await native.checkRuntimeNative(vault, 'codex', targets.codex, manifest.snapshot)).kind, 'clean');

	const hermesReference = path.join(targets.hermes, 'jardin-shared', 'chengfa', 'references', 'jardin-skill-sync-audit-and-repair.md');
	if (await fileExists(hermesReference)) {
		const referenceText = await fs.readFile(hermesReference, 'utf8');
		await fs.writeFile(hermesReference, `${referenceText}\nDRIFT`, 'utf8');
		const hermesDrift = await native.checkRuntimeNative(vault, 'hermes', targets.hermes, manifest.snapshot);
		assert.equal(hermesDrift.kind, 'drift');
		assert.ok(hermesDrift.problems.some((problem) => problem.startsWith('Hermes reference drift for')));
		const hermesRepair = await repair.repairRuntimeNative(vault, 'hermes', targets.hermes, manifest.snapshot, { backupRoot: path.join(tempRoot, 'backups', 'hermes') });
		assert.equal(hermesRepair.status, 'passed', hermesRepair.output);
		assert.equal((await native.checkRuntimeNative(vault, 'hermes', targets.hermes, manifest.snapshot)).kind, 'clean');
	}

	const commandPath = path.join(commands, 'chengfa.md');
	await fs.unlink(commandPath);
	const opencodeDrift = await native.checkRuntimeNative(vault, 'opencode', targets.opencode, manifest.snapshot, { opencodeCommandsDir: commands });
	assert.equal(opencodeDrift.kind, 'drift');
	assert.ok(opencodeDrift.problems.some((problem) => problem.startsWith('Missing command:')));
	const opencodeRepair = await repair.repairRuntimeNative(vault, 'opencode', targets.opencode, manifest.snapshot, { opencodeCommandsDir: commands, backupRoot: path.join(tempRoot, 'backups', 'opencode') });
	assert.equal(opencodeRepair.status, 'passed', opencodeRepair.output);
	assert.equal((await native.checkRuntimeNative(vault, 'opencode', targets.opencode, manifest.snapshot, { opencodeCommandsDir: commands })).kind, 'clean');

	console.log('Native checks passed: 6 runtimes, 21 skills, native-only fixture creation, read-only checks, and repair cases.');
	if (process.argv.includes('--live')) await checkLive(native);
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}

async function checkLive(native) {
	const dataPath = path.join(vault, '.obsidian', 'plugins', 'skill-switchboard', 'data.json');
	const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
	const manifest = await native.inspectManifest(vault);
	assert.equal(manifest.status, 'passed', manifest.output);
	for (const target of data.targets.filter((item) => item.enabled && item.mode === 'wrapper' && item.runtime && item.path)) {
		const result = await native.checkRuntimeNative(vault, target.runtime, target.path, manifest.snapshot);
		assert.equal(result.kind, 'clean', `${target.runtime} live: ${result.output}`);
	}
	console.log('Live native-only read-only checks passed for the six configured wrapper targets.');
}

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function hashTree(root) {
	const hash = createHash('sha256');
	const files = [];
	await collect(root, files);
	for (const filePath of files.sort()) {
		hash.update(path.relative(root, filePath).replaceAll(path.sep, '/'));
		hash.update(await fs.readFile(filePath));
	}
	return hash.digest('hex');
}

async function collect(current, files) {
	if (!(await fileExists(current))) return;
	for (const entry of await fs.readdir(current, { withFileTypes: true })) {
		const filePath = path.join(current, entry.name);
		if (entry.isDirectory()) await collect(filePath, files);
		else if (entry.isFile()) files.push(filePath);
	}
}
