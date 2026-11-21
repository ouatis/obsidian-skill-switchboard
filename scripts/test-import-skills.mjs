import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-import-'));
async function write(file, content, mode) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, content);
	if (mode !== undefined) await fs.chmod(file, mode);
}

try {
	const bundle = path.join(temporary, 'import-skills.cjs');
	await esbuild.build({
		entryPoints: [path.join(repo, 'src/sync/import-skills.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: bundle,
		logLevel: 'silent',
	});
	const { scanImportableSkills, importSkillPackages } = await import(pathToFileURL(bundle).href);

	const vault = path.join(temporary, 'vault');
	const destination = path.join(vault, 'skills');
	const claude = path.join(temporary, 'claude-skills');
	const codex = path.join(temporary, 'codex-skills');
	const hermes = path.join(temporary, 'hermes-skills');
	const manifestPath = path.join(vault, 'skills-manifest.json');

	// Existing source entries: both a directory ('existing') and a legacy card ('legacy-card.md').
	await write(path.join(destination, 'existing', 'SKILL.md'), '---\nname: existing\n---\nCANONICAL\n');
	await write(path.join(destination, 'legacy-card.md'), '---\nname: legacy-card\n---\nLEGACY\n');
	await write(manifestPath, '{"schema_version":1,"total_skills":0,"skills":[]}');

	// Local Agent candidates across multiple folders.
	await write(path.join(claude, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Alpha skill\n---\n# Alpha\n');
	await write(path.join(claude, 'alpha', 'scripts', 'run.sh'), '#!/bin/sh\necho ok\n', 0o755);
	await write(path.join(claude, 'alpha', 'assets', 'icon.bin'), Buffer.from([1, 2, 3, 250]));
	await write(path.join(claude, 'Existing', 'SKILL.md'), 'AGENT EXISTING\n');
	await write(path.join(claude, 'legacy-card', 'SKILL.md'), 'AGENT LEGACY\n');
	await write(path.join(claude, 'con', 'SKILL.md'), 'RESERVED NAME\n');
	await write(path.join(claude, 'sym-skill', 'SKILL.md'), 'MAIN\n');
	const secretTarget = path.join(temporary, 'secret.txt');
	await write(secretTarget, 'secret\n');
	if (process.platform !== 'win32') {
		await fs.symlink(secretTarget, path.join(claude, 'sym-skill', 'leak.txt'));
	}

	await write(path.join(codex, 'alpha', 'SKILL.md'), 'DUPLICATE ALPHA\n');
	await write(path.join(codex, 'beta', 'SKILL.md'), '---\nname: beta\n---\n# Beta\n');
	await write(path.join(hermes, 'jardin-shared', 'gamma', 'SKILL.md'), '---\nname: gamma\n---\n# Gamma\n');

	const folders = [
		{ label: 'Claude Code', path: claude, runtime: 'claude-code' },
		{ label: 'Claude Code Dup', path: claude, runtime: 'claude-code' },
		{ label: 'Inside Vault', path: path.join(vault, 'other'), runtime: 'custom' },
		{ label: 'Destination Self', path: destination, runtime: 'custom' },
		{ label: 'Codex', path: codex, runtime: 'codex' },
		{ label: 'Hermes', path: hermes, runtime: 'hermes' },
		{ label: 'Missing', path: path.join(temporary, 'missing') },
	];
	await write(path.join(vault, 'other', 'hidden-inside', 'SKILL.md'), 'INSIDE\n');

	const scan = await scanImportableSkills(vault, destination, folders, { manifestPath });
	assert.equal(scan.hasManifest, true);
	const byKey = new Map(scan.candidates.map((item) => [`${item.sourceLabel}:${item.name}`, item]));
	assert.equal(byKey.get('Claude Code:alpha')?.status, 'ready');
	assert.equal(byKey.get('Claude Code:alpha')?.fileCount, 3);
	assert.equal(byKey.get('Claude Code:Existing')?.status, 'conflict');
	assert.equal(byKey.get('Claude Code:legacy-card')?.status, 'conflict');
	assert.equal(byKey.get('Claude Code:con')?.status, 'invalid');
	if (process.platform !== 'win32') {
		assert.equal(byKey.get('Claude Code:sym-skill')?.status, 'invalid');
	}
	assert.equal(byKey.get('Codex:alpha')?.status, 'duplicate');
	assert.equal(byKey.get('Codex:beta')?.status, 'ready');
	assert.equal(byKey.get('Hermes:gamma')?.status, 'ready');
	assert.equal(scan.candidates.some((item) => item.sourceLabel === 'Claude Code Dup'), false, 'duplicate folder paths are scanned once');
	assert.equal(scan.candidates.some((item) => item.sourceLabel === 'Inside Vault'), false, 'vault folders are excluded');

	// Import selected skills into a fresh destination inside another isolated vault.
	const freshVault = path.join(temporary, 'fresh-vault');
	await fs.mkdir(freshVault, { recursive: true });
	const freshDest = path.join(freshVault, 'skills');
	const ready = scan.candidates.filter((item) => item.status === 'ready');
	const result = await importSkillPackages(freshVault, freshDest, ready, { confineToVault: true });
	assert.deepEqual(result.imported, ['alpha', 'beta', 'gamma']);
	assert.deepEqual(result.skipped, []);
	assert.deepEqual(result.failed, []);
	assert.equal(await fs.readFile(path.join(freshDest, 'alpha', 'SKILL.md'), 'utf8'), '---\nname: alpha\ndescription: Alpha skill\n---\n# Alpha\n');
	assert.deepEqual(await fs.readFile(path.join(freshDest, 'alpha', 'assets', 'icon.bin')), Buffer.from([1, 2, 3, 250]));
	if (process.platform !== 'win32') {
		const mode = (await fs.stat(path.join(freshDest, 'alpha', 'scripts', 'run.sh'))).mode & 0o111;
		assert.notEqual(mode, 0, 'executable script mode is preserved');
	}
	// Agent folders remain untouched.
	assert.equal(await fs.readFile(path.join(claude, 'alpha', 'SKILL.md'), 'utf8'), '---\nname: alpha\ndescription: Alpha skill\n---\n# Alpha\n');

	// Re-importing or importing conflicts never overwrites canonical files.
	await write(path.join(freshDest, 'alpha', 'SKILL.md'), 'MODIFIED IN VAULT\n');
	const repeat = await importSkillPackages(freshVault, freshDest, ready, { confineToVault: true });
	assert.deepEqual(repeat.imported, []);
	assert.equal(repeat.skipped.length, 3);
	assert.equal(await fs.readFile(path.join(freshDest, 'alpha', 'SKILL.md'), 'utf8'), 'MODIFIED IN VAULT\n');

	// Vault confinement blocks destinations escaping the vault.
	await assert.rejects(
		importSkillPackages(freshVault, path.join(temporary, 'outside'), ready, { confineToVault: true }),
		/outside the vault/,
	);

	// Failure mid-package cleans up partial output without blocking healthy packages.
	const missingSourceCandidate = { ...ready[0], name: 'broken-new', sourceDir: path.join(temporary, 'missing-dir') };
	const okNew = { ...ready[1], name: 'beta-copy' };
	const partial = await importSkillPackages(freshVault, freshDest, [missingSourceCandidate, okNew], { confineToVault: true });
	assert.deepEqual(partial.imported, ['beta-copy']);
	assert.equal(partial.failed.length, 1);
	assert.equal(partial.failed[0]?.name, 'broken-new');
	assert.equal(await fs.access(path.join(freshDest, 'broken-new')).then(() => true, () => false), false);

	console.log('Import skills checks passed: discovery, Hermes category depth, conflict/duplicate/symlink/name guards, non-overwriting copy, vault confinement, and partial failure isolation.');
} finally {
	await fs.rm(temporary, { recursive: true, force: true });
}
