import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-native-'));
const vault = path.join(tempRoot, 'fixture-vault');
const sharedRoot = path.join(vault, 'methods', 'skills');
const location = { sharedRoot, manifestPath: path.join(vault, 'configuration', 'adapters.json'), confineToVault: true };

try {
	await fs.mkdir(path.join(sharedRoot, 'references'), { recursive: true });
	await fs.mkdir(path.dirname(location.manifestPath), { recursive: true });
	const skills = ['drafting', 'review'].map((name) => ({ name, shared_file: `methods/skills/${name}.md`, adapters: {
		codex: { display_name: name, short_description: 'Fixture skill', default_prompt: `Use $${name}` },
		hermes: {}, workbuddy: true, opencode: {}, antigravity: true, dsh: {},
	} }));
	for (const skill of skills) await fs.writeFile(path.join(sharedRoot, `${skill.name}.md`), `---\nname: ${skill.name}\ndescription: Fixture skill.\n---\n\n# ${skill.name}\n\nFixture skill. Read [support](references/support.md).\n`);
	await fs.writeFile(path.join(sharedRoot, 'references', 'support.md'), '# Support\n\nFixture reference.\n');
	await fs.writeFile(location.manifestPath, JSON.stringify({ schema_version: 1, total_skills: 2, adapter_defaults: { hermes: { category: 'team' } }, skills }));
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

	const manifest = await native.inspectManifest(vault, location);
	assert.equal(manifest.status, 'passed', manifest.output);
	assert.ok(manifest.snapshot, 'native manifest snapshot should exist');
	const overlapSource = path.join(tempRoot, 'external-canonical-skills');
	await fs.mkdir(path.join(overlapSource, 'references'), { recursive: true });
	const overlapSkills = ['drafting', 'review'].map((name) => ({ name, shared_file: `${name}.md`, adapters: {
		codex: { display_name: name, short_description: 'Fixture skill', default_prompt: `Use $${name}` },
		hermes: {}, workbuddy: true, opencode: {}, antigravity: true, dsh: {},
	} }));
	for (const skill of overlapSkills) await fs.writeFile(path.join(overlapSource, `${skill.name}.md`), `---\nname: ${skill.name}\ndescription: Fixture skill.\n---\n\n# ${skill.name}\n\nFixture skill. Read [support](references/support.md).\n`);
	await fs.writeFile(path.join(overlapSource, 'references', 'support.md'), '# Support\n\nFixture reference.\n');
	const overlapManifestPath = path.join(tempRoot, 'external-manifest.json');
	await fs.writeFile(overlapManifestPath, JSON.stringify({ schema_version: 1, total_skills: overlapSkills.length, skills: overlapSkills }));
	const overlapManifest = await native.inspectManifest(vault, {
		sharedRoot: overlapSource,
		manifestPath: overlapManifestPath,
	});
	assert.equal(overlapManifest.status, 'passed', overlapManifest.output);
	assert.ok(overlapManifest.snapshot, 'external canonical source snapshot should exist');
	const overlapSourceHash = await hashTree(overlapSource);
	for (const overlappingTarget of [overlapSource, path.join(overlapSource, 'nested'), path.dirname(overlapSource)]) {
		const check = await native.checkRuntimeNative(vault, 'codex', overlappingTarget, overlapManifest.snapshot);
		assert.equal(check.kind, 'error', `overlapping target check: ${overlappingTarget}`);
		assert.match(check.output, /overlaps the canonical skill source/);
		const repairResult = await repair.repairRuntimeNative(vault, 'codex', overlappingTarget, overlapManifest.snapshot);
		assert.equal(repairResult.status, 'failed', `overlapping target repair: ${overlappingTarget}`);
		assert.match(repairResult.output, /overlaps the canonical skill source/);
		assert.equal(await hashTree(overlapSource), overlapSourceHash, 'source remains unchanged when a target overlaps it');
	}
	if (process.platform !== 'win32') {
		const overlapAlias = path.join(tempRoot, 'external-skills-alias');
		await fs.symlink(overlapSource, overlapAlias);
		const aliasCheck = await native.checkRuntimeNative(vault, 'codex', overlapAlias, overlapManifest.snapshot);
		assert.equal(aliasCheck.kind, 'error');
		assert.match(aliasCheck.output, /overlaps the canonical skill source/);
		const aliasRepair = await repair.repairRuntimeNative(vault, 'codex', overlapAlias, overlapManifest.snapshot);
		assert.equal(aliasRepair.status, 'failed');
		assert.equal(await hashTree(overlapSource), overlapSourceHash, 'symlink aliases cannot redirect repair into the source');
	}
	const commandCheck = await native.checkRuntimeNative(vault, 'opencode', targets.opencode, overlapManifest.snapshot, {
		opencodeCommandsDir: overlapSource,
	});
	assert.equal(commandCheck.kind, 'error');
	assert.match(commandCheck.output, /command directory that overlaps the canonical skill source/);
	const commandRepair = await repair.repairRuntimeNative(vault, 'opencode', targets.opencode, overlapManifest.snapshot, {
		opencodeCommandsDir: overlapSource,
	});
	assert.equal(commandRepair.status, 'failed');
	assert.match(commandRepair.output, /overlaps the canonical skill source/);
	const backupTarget = path.join(tempRoot, 'backup-overlap-target');
	const backupWrapper = path.join(backupTarget, 'drafting', 'SKILL.md');
	await fs.mkdir(path.dirname(backupWrapper), { recursive: true });
	await fs.writeFile(backupWrapper, 'drifted wrapper');
	const backupRepair = await repair.repairRuntimeNative(vault, 'codex', backupTarget, overlapManifest.snapshot, {
		backupRoot: overlapSource,
	});
	assert.equal(backupRepair.status, 'failed');
	assert.match(backupRepair.output, /overlaps the canonical skill source/);
	assert.equal(await fs.readFile(backupWrapper, 'utf8'), 'drifted wrapper', 'refusing an overlapping backup path preserves the target');
	assert.equal(await hashTree(overlapSource), overlapSourceHash, 'backup redirection cannot write into the source');
	const outsideRoot = path.join(tempRoot, 'outside-skills');
	await fs.mkdir(outsideRoot, { recursive: true });
	const escapedRoot = await native.inspectManifest(vault, {
		...location,
		sharedRoot: outsideRoot,
	});
	assert.equal(escapedRoot.status, 'failed');
	assert.match(escapedRoot.output, /resolves outside the vault/);
	if (process.platform !== 'win32') {
		const escapedRootLink = path.join(vault, 'escaped-skills');
		await fs.symlink(outsideRoot, escapedRootLink);
		const escapedRootSymlink = await native.inspectManifest(vault, { ...location, sharedRoot: escapedRootLink });
		assert.equal(escapedRootSymlink.status, 'failed');
		assert.match(escapedRootSymlink.output, /resolves outside the vault/);
		const outsideManifest = path.join(tempRoot, 'outside-manifest.json');
		await fs.writeFile(outsideManifest, '{}', 'utf8');
		const escapedManifestLink = path.join(vault, 'escaped-manifest.json');
		await fs.symlink(outsideManifest, escapedManifestLink);
		const escapedManifestSymlink = await native.inspectManifest(vault, {
			...location,
			manifestPath: escapedManifestLink,
		});
		assert.equal(escapedManifestSymlink.status, 'failed');
		assert.match(escapedManifestSymlink.output, /manifest resolves outside the vault/);
	}
	// Derived from the canonical root so adding a skill doesn't fail the suite.
	const canonicalSkillCount = (
		await fs.readdir(sharedRoot, { withFileTypes: true })
	).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
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
		assert.equal(
			result.checkedSkillCount,
			canonicalSkillCount,
			`${runtime} skill count`,
		);
		assert.equal(await hashTree(targets[runtime]), before, `${runtime} native check wrote files`);
	}

	const codexWrapper = path.join(targets.codex, 'drafting', 'SKILL.md');
	const codexText = await fs.readFile(codexWrapper, 'utf8');
	await fs.writeFile(codexWrapper, codexText.replace('description: "', 'description: "DRIFT '), 'utf8');
	const codexDrift = await native.checkRuntimeNative(vault, 'codex', targets.codex, manifest.snapshot);
	assert.equal(codexDrift.kind, 'drift');
	assert.ok(codexDrift.problems.includes('Description drift: drafting'));
	const backupHome = path.join(tempRoot, 'backup-home');
	if (process.platform !== 'win32') {
		const redirectedHome = path.join(tempRoot, 'redirected-home');
		const vaultBackupAlias = path.join(vault, 'backup-alias');
		await fs.mkdir(redirectedHome, { recursive: true });
		await fs.mkdir(vaultBackupAlias, { recursive: true });
		await fs.symlink(vaultBackupAlias, path.join(redirectedHome, '.skill-switchboard'));
		const refusedRepair = await repair.repairRuntimeNative(
			vault,
			'codex',
			targets.codex,
			manifest.snapshot,
			{ backupHomeDir: redirectedHome },
		);
		assert.equal(refusedRepair.status, 'failed');
		assert.match(refusedRepair.output, /refused a target inside the vault/);
		assert.equal((await native.checkRuntimeNative(vault, 'codex', targets.codex, manifest.snapshot)).kind, 'drift');
	}
	const codexRepair = await repair.repairRuntimeNative(
		vault,
		'codex',
		targets.codex,
		manifest.snapshot,
		{ backupHomeDir: backupHome },
	);
	assert.equal(codexRepair.status, 'passed', codexRepair.output);
	assert.ok(codexRepair.writtenFiles > 0);
	assert.ok(codexRepair.backupPath && await fileExists(codexRepair.backupPath));
	const canonicalBackupHome = await fs.realpath(backupHome);
	const canonicalVault = await fs.realpath(vault);
	assert.ok(
		codexRepair.backupPath.startsWith(path.join(canonicalBackupHome, '.skill-switchboard', 'repair-backups')),
		`default backup root: ${codexRepair.backupPath}`,
	);
	assert.equal(path.relative(canonicalVault, codexRepair.backupPath).startsWith('..'), true);
	const backupIndex = JSON.parse(await fs.readFile(path.join(codexRepair.backupPath, 'backup-index.json'), 'utf8'));
	assert.ok(backupIndex.entries.length > 0);
	assert.equal(await fileExists(backupIndex.entries[0].backup), true);
	assert.equal((await native.checkRuntimeNative(vault, 'codex', targets.codex, manifest.snapshot)).kind, 'clean');

	const hermesReference = path.join(targets.hermes, 'team', 'drafting', 'references', 'support.md');
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

	const commandPath = path.join(commands, 'drafting.md');
	await fs.unlink(commandPath);
	const opencodeDrift = await native.checkRuntimeNative(vault, 'opencode', targets.opencode, manifest.snapshot, { opencodeCommandsDir: commands });
	assert.equal(opencodeDrift.kind, 'drift');
	assert.ok(opencodeDrift.problems.some((problem) => problem.startsWith('Missing command:')));
	const opencodeRepair = await repair.repairRuntimeNative(vault, 'opencode', targets.opencode, manifest.snapshot, { opencodeCommandsDir: commands, backupRoot: path.join(tempRoot, 'backups', 'opencode') });
	assert.equal(opencodeRepair.status, 'passed', opencodeRepair.output);
	assert.equal((await native.checkRuntimeNative(vault, 'opencode', targets.opencode, manifest.snapshot, { opencodeCommandsDir: commands })).kind, 'clean');

	console.log(
		`Native checks passed: ${Object.keys(targets).length} runtimes, ${canonicalSkillCount} skills, native-only fixture creation, read-only checks, and repair cases.`,
	);
	if (process.argv.includes('--live')) await checkLive(native);
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}

async function checkLive(native) {
	const position = process.argv.indexOf('--live');
	const liveVault = process.argv[position + 1];
	if (!liveVault) throw new Error('Supply the intended vault after --live.');
	const dataPath = path.join(liveVault, '.obsidian', 'plugins', 'skill-switchboard', 'data.json');
	const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
	const sourceBundle = path.join(tempRoot, 'source.cjs');
	await esbuild.build({ entryPoints: [path.join(repo, 'src/sync/source.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: sourceBundle, logLevel: 'silent' });
	const { resolveSyncSource } = await import(pathToFileURL(sourceBundle).href);
	const manifest = await native.inspectManifest(liveVault, resolveSyncSource(liveVault, data));
	assert.equal(manifest.status, 'passed', manifest.output);
	for (const target of data.targets.filter((item) => item.enabled && item.mode === 'wrapper' && item.runtime && item.path)) {
		const result = await native.checkRuntimeNative(liveVault, target.runtime, target.path, manifest.snapshot);
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
