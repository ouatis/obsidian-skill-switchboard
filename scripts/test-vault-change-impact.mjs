import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-vault-changes-'));

try {
	const bundle = path.join(tempRoot, 'vault-change-impact.cjs');
	await esbuild.build({
		entryPoints: [path.join(repo, 'src/sync/vault-change-impact.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: bundle,
		logLevel: 'silent',
	});
	const { getVaultChangeImpact } = await import(pathToFileURL(bundle).href);
	const vaultPath = path.join(tempRoot, 'vault');
	const settings = {
		roots: [
			{ id: 'team', kind: 'vault', label: 'Team', path: '.\\team\\skills\\', enabled: true },
			{ id: 'external', kind: 'external', label: 'External', path: 'outside', enabled: true },
			{ id: 'disabled', kind: 'vault', label: 'Disabled', path: 'archive', enabled: false },
		],
		targets: [],
		syncRootId: 'team',
		syncManifestPath: 'configuration/new.json',
	};

	assert.deepEqual(getVaultChangeImpact(['team/skills/SKILL.md'], settings, vaultPath), {
		affectsIndex: true,
		affectsChecks: true,
	}, 'nested changes in a configured vault root invalidate both index and checks');
	assert.deepEqual(getVaultChangeImpact(['team/skills-old/note.md'], settings, vaultPath), {
		affectsIndex: false,
		affectsChecks: false,
	}, 'a path sharing only the root prefix must not match');
	assert.deepEqual(getVaultChangeImpact(['configuration/new.json'], settings, vaultPath), {
		affectsIndex: false,
		affectsChecks: true,
	}, 'the selected manifest invalidates checks without forcing an index scan');
	const detectedRoot = path.join(vaultPath, '00-MEMORTE', 'shared', 'skills');
	const detectedSource = { sharedRoot: detectedRoot, manifestPath: path.join(path.dirname(detectedRoot), 'skills-manifest.json') };
	assert.deepEqual(getVaultChangeImpact(['00-MEMORTE/shared/skills/drawing/SKILL.md'], settings, vaultPath, detectedSource), {
		affectsIndex: true,
		affectsChecks: true,
	}, 'changes under an auto-detected source invalidate its index and checks');
	assert.deepEqual(getVaultChangeImpact(['00-MEMORTE/shared/skills-manifest.json'], settings, vaultPath, detectedSource), {
		affectsIndex: false,
		affectsChecks: true,
	}, 'the auto-detected sibling manifest invalidates checks without rescanning skills');
	assert.deepEqual(getVaultChangeImpact(['outside/note.md', 'archive/note.md', 'other/note.md'], settings, vaultPath), {
		affectsIndex: false,
		affectsChecks: false,
	}, 'external, disabled, and unrelated roots stay out of vault event matching');
	assert.deepEqual(getVaultChangeImpact(['configuration/new.json'], settings, null), {
		affectsIndex: false,
		affectsChecks: false,
	}, 'manifest matching is skipped when the adapter has no base path');

	console.log('Vault change checks passed: root boundaries, selected manifest, disabled/external roots, and missing base path.');
} finally {
	assert.equal(path.dirname(await fs.realpath(tempRoot)), await fs.realpath(os.tmpdir()));
	assert.ok(path.basename(tempRoot).startsWith('skill-switchboard-vault-changes-'));
	await fs.rm(tempRoot, { recursive: true, force: true });
}
