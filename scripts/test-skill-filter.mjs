import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-skill-filter-'));
async function write(file, text) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, text);
}

try {
	const bundle = path.join(temporary, 'bundle.cjs');
	await esbuild.build({
		stdin: {
			contents: `
				export * from './src/sync/skill-filter';
				export { inspectManifest } from './src/sync/manifest';
				export { NativeSyncProvider } from './src/sync-provider';
				export { checkAllTargets, runRepairAll, retireOrphanCopies } from './src/sync/adapter-run';
				export { automaticWiringKey, resolveAutomaticScope } from './src/sync/automatic-scope';
				export { distributionNodes } from './src/ui/distribution-state';
				export { getStrings } from './src/i18n';
			`,
			resolveDir: repo,
		},
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: bundle,
		logLevel: 'silent',
	});
	const m = await import(pathToFileURL(bundle).href);

	// Unit helpers.
	assert.deepEqual(m.parseSkillFilterList(undefined), { valid: true });
	assert.deepEqual(m.parseSkillFilterList([]), { valid: true });
	assert.deepEqual(m.parseSkillFilterList(['  beta ', 'alpha', 'beta', '']), { valid: true, value: ['alpha', 'beta'] });
	assert.deepEqual(m.parseSkillFilterList('alpha'), { valid: false });
	assert.deepEqual(m.parseSkillFilterList(['alpha', 42]), { valid: false });

	assert.equal(m.matchesSkillFilter('alpha', undefined), true);
	assert.equal(m.matchesSkillFilter('alpha', { includeSkills: ['alpha'] }), true);
	assert.equal(m.matchesSkillFilter('beta', { includeSkills: ['alpha'] }), false);
	assert.equal(m.matchesSkillFilter('gamma', { excludeSkills: ['gamma'] }), false);
	assert.equal(m.matchesSkillFilter('alpha', { includeSkills: ['alpha', 'beta'], excludeSkills: ['beta'] }), true);
	assert.equal(m.matchesSkillFilter('beta', { includeSkills: ['alpha', 'beta'], excludeSkills: ['beta'] }), false);

	assert.equal(m.sameSkillFilter({ includeSkills: ['b', 'a', 'a'] }, { includeSkills: ['a', 'b'] }), true);
	assert.equal(m.sameSkillFilter({ includeSkills: ['a'] }, { excludeSkills: ['a'] }), false);
	assert.deepEqual(m.parseSkillNamesInput(' gamma, alpha; beta\nalpha '), ['alpha', 'beta', 'gamma']);
	assert.equal(m.formatSkillNamesInput(['alpha', 'beta']), 'alpha, beta');

	// End-to-end zero-manifest vault.
	const vault = path.join(temporary, 'vault');
	const source = path.join(vault, 'skills');
	const registryPath = path.join(temporary, 'packages.json');
	await write(path.join(source, 'alpha/SKILL.md'), '---\nname: alpha\ndescription: Alpha skill\n---\n# Alpha\n');
	await write(path.join(source, 'beta/SKILL.md'), '---\nname: beta\ndescription: Beta skill\n---\n# Beta\n');
	await write(path.join(source, 'gamma/SKILL.md'), '---\nname: gamma\ndescription: Gamma skill\npackage_id: broken-pkg\n---\n# Gamma\n');

	const location = { sharedRoot: source, manifestPath: path.join(vault, 'skills-manifest.json'), confineToVault: true, packageRegistryPath: registryPath };
	const provider = new m.NativeSyncProvider(() => location);
	const strings = m.getStrings('en');

	// Off-vault project-level directory receiving only 'alpha', plus filtered target excluding 'gamma'.
	const projectClaude = path.join(temporary, 'my-project', '.claude', 'skills');
	const cursorDir = path.join(temporary, 'cursor-skills');
	const storeDir = path.join(temporary, 'snapshots');

	const projectTarget = { id: 'proj', label: 'Project Claude', path: projectClaude, mode: 'copy', enabled: true, runtime: 'claude-code', includeSkills: ['alpha'] };
	const cursorTarget = { id: 'cur', label: 'Cursor', path: cursorDir, mode: 'copy', enabled: true, runtime: 'cursor', excludeSkills: ['gamma'] };

	const initialCheck = await m.checkAllTargets({ provider, settings: { targets: [projectTarget, cursorTarget] } }, vault, 'none');
	assert.equal(initialCheck.result.status, 'failed');

	const repairOutcome = await m.runRepairAll(
		{ provider, settings: { targets: [projectTarget, cursorTarget] }, snapshotDirectory: storeDir, ledgerDirectory: storeDir },
		vault,
		strings,
	);
	assert.equal(repairOutcome.repairedCount, 2);
	assert.equal(repairOutcome.failedCount, 0);
	assert.equal(await fs.access(path.join(projectClaude, 'alpha/SKILL.md')).then(() => true, () => false), true);
	assert.equal(await fs.access(path.join(projectClaude, 'beta')).then(() => true, () => false), false);
	assert.equal(await fs.access(path.join(projectClaude, 'gamma')).then(() => true, () => false), false);
	assert.equal(await fs.access(path.join(cursorDir, 'alpha/SKILL.md')).then(() => true, () => false), true);
	assert.equal(await fs.access(path.join(cursorDir, 'beta/SKILL.md')).then(() => true, () => false), true);
	assert.equal(await fs.access(path.join(cursorDir, 'gamma')).then(() => true, () => false), false);

	// Resources on skills excluded from all active targets do not fail checkAllTargets.
	const afterFilteredCheck = await m.checkAllTargets({ provider, settings: { targets: [projectTarget, cursorTarget] }, ledgerDirectory: storeDir }, vault, 'none');
	assert.equal(afterFilteredCheck.result.status, 'passed', afterFilteredCheck.result.output);

	// Unfiltered target receives all healthy skills and fails when gamma has a broken package.
	const globalDir = path.join(temporary, 'global-codex');
	const globalTarget = { id: 'global', label: 'Codex', path: globalDir, mode: 'copy', enabled: true, runtime: 'codex' };
	const unfilteredCheck = await m.checkAllTargets({ provider, settings: { targets: [globalTarget] } }, vault, 'none');
	assert.equal(unfilteredCheck.result.status, 'failed');
	assert.equal(unfilteredCheck.checks[0].result.native.installs.length, 3);

	// Filter matching zero skills fails clearly.
	const emptyFilterTarget = { id: 'empty', label: 'Empty', path: path.join(temporary, 'empty-dir'), mode: 'copy', enabled: true, runtime: 'custom', includeSkills: ['nonexistent'] };
	const emptyCheck = await m.checkAllTargets({ provider, settings: { targets: [emptyFilterTarget] } }, vault, 'none');
	assert.equal(emptyCheck.result.status, 'failed');
	assert.match(emptyCheck.result.output, /No skills match the configured skill filter/);

	// Narrowing a target filter surfaces previously installed skills as sweepable orphans and retires them cleanly with snapshots.
	const narrowDir = path.join(temporary, 'narrow-claude');
	const broadTarget = { id: 'narrow', label: 'Narrow', path: narrowDir, mode: 'copy', enabled: true, runtime: 'claude-code', includeSkills: ['alpha', 'beta'] };
	await m.runRepairAll({ provider, settings: { targets: [broadTarget] }, snapshotDirectory: storeDir, ledgerDirectory: storeDir }, vault, strings);
	assert.equal(await fs.access(path.join(narrowDir, 'beta/SKILL.md')).then(() => true, () => false), true);

	const narrowedTarget = { ...broadTarget, includeSkills: ['alpha'] };
	const narrowedCheck = await m.checkAllTargets({ provider, settings: { targets: [narrowedTarget] }, ledgerDirectory: storeDir }, vault, 'none');
	assert.equal(narrowedCheck.checks[0].result.native.orphanCandidates.length, 1);
	assert.equal(narrowedCheck.checks[0].result.native.orphanCandidates[0].skill, 'beta');

	const retired = await m.retireOrphanCopies(
		{ provider, settings: { targets: [narrowedTarget] }, snapshotDirectory: storeDir, ledgerDirectory: storeDir },
		vault,
		strings,
	);
	assert.equal(retired.retiredCount, 1);
	assert.equal(await fs.access(path.join(narrowDir, 'beta')).then(() => true, () => false), false);
	assert.equal(await fs.access(path.join(narrowDir, 'alpha/SKILL.md')).then(() => true, () => false), true);

	// Automatic scope & distributionNodes detect filter changes immediately.
	const baseSettings = {
		roots: [{ id: 'src', label: 'Skills', path: 'skills', kind: 'vault', enabled: true }],
		syncRootId: 'src',
		syncManifestPath: '',
		targets: [projectTarget],
	};
	const changedSettings = {
		...baseSettings,
		targets: [{ ...projectTarget, includeSkills: ['alpha', 'beta'] }],
	};
	assert.notEqual(m.automaticWiringKey(baseSettings), m.automaticWiringKey(changedSettings));
	const scopeA = await m.resolveAutomaticScope(vault, baseSettings);
	const scopeB = await m.resolveAutomaticScope(vault, changedSettings);
	assert.notEqual(scopeA.key, scopeB.key);
	assert.match(scopeA.details, /only: alpha/);

	const nodes = m.distributionNodes({
		targets: [{ ...projectTarget, includeSkills: ['alpha', 'beta'] }],
		checks: afterFilteredCheck.checks,
		activity: null,
		blocked: false,
	});
	assert.equal(nodes[0].state, 'unknown', 'distribution node resets to unknown when target filter changes');

	console.log('Skill filter checks passed: normalization, matching, off-vault project subsets, resource scoping, orphan retirement, consent revocation, and board invalidation.');
} finally {
	await fs.rm(temporary, { recursive: true, force: true });
}
