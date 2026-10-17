import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Covers the check/repair orchestration in src/sync/adapter-run.ts with a fake
// provider, so these cases run without a real vault and can go to CI.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-adapter-'));

const strings = {
	noRepairTargets: 'no repair targets',
	repairAllPassed: (count) => `repaired ${count}`,
	repairAllFailed: (count) => `failed ${count}`,
	repairAllNoDrift: 'no drift',
};

try {
	const bundle = path.join(tempRoot, 'adapter-run.cjs');
	await esbuild.build({
		entryPoints: [path.join(repo, 'src', 'sync', 'adapter-run.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: bundle,
		external: ['node:*'],
		logLevel: 'silent',
	});
	const run = await import(pathToFileURL(bundle).href);

	const target = (over = {}) => ({
		id: 't1',
		label: 'Codex',
		path: '~/.codex/skills',
		mode: 'wrapper',
		enabled: true,
		runtime: 'codex',
		...over,
	});
	const passed = (output = 'ok') => ({ status: 'passed', output, exitCode: 0 });
	const failed = (output = 'bad', exitCode = 3) => ({ status: 'failed', output, exitCode });

	// getRepairTargets keeps only enabled wrapper targets with a runtime and a path.
	{
		const targets = [
			target(),
			target({ id: 'off', enabled: false }),
			target({ id: 'copy', mode: 'copy' }),
			target({ id: 'noruntime', runtime: undefined }),
			target({ id: 'nopath', path: '   ' }),
		];
		const kept = run.getRepairTargets(targets);
		assert.deepEqual(kept.map((item) => item.id), ['t1']);
	}

	// Read-only resource failures name the affected skill and issue without leaking a machine-local path.
	{
		const localPath = '/Users/example/private-toolkit';
		const provider = {
			inspectManifest: async () => ({
				status: 'passed', output: '[manifest] PASS', exitCode: 0, snapshot: {},
				resources: { status: 'failed', crossDevice: 'unverified', packages: [{
					skill: 'anatomy', location: 'external', path: localPath, status: 'failed', files: 0, verifiedFiles: 0,
					issues: [{ code: 'unconfigured', path: 'drawing-kit' }, { code: 'invalid', path: localPath }],
				}] },
			}),
			checkRuntime: async () => passed(),
			repairRuntime: async () => passed(),
		};
		const outcome = await run.checkAllTargets({ provider, settings: { targets: [target()] } }, '/vault', 'no targets');
		assert.equal(outcome.result.status, 'failed');
		assert.match(outcome.result.output, /anatomy — external package/);
		assert.match(outcome.result.output, /unconfigured: drawing-kit/);
		assert.match(outcome.result.output, /machine-local path omitted/);
		assert.ok(!outcome.result.output.includes(localPath), 'external absolute paths stay out of the vault diagnostic');
	}

	// A passing manifest short-circuits: no target is checked.
	{
		let checked = 0;
		const provider = {
			inspectManifest: async () => failed('manifest broken', 9),
			checkRuntime: async () => {
				checked += 1;
				return passed();
			},
			repairRuntime: async () => passed(),
		};
		const outcome = await run.runRepairAll({ provider, settings: { targets: [target()] } }, '/vault', strings);
		assert.equal(checked, 0, 'a failed manifest must abort before any target check');
		assert.equal(outcome.aborted, true);
		assert.equal(outcome.repair.status, 'failed');
		assert.equal(outcome.repair.exitCode, 9, 'the manifest exit code carries through');
	}

	// Blocked (non-repairable) failures count in the summary even with no drift.
	{
		// A target inside the vault is rejected before the provider is ever called.
		const provider = {
			inspectManifest: async () => ({ status: 'passed', output: '', exitCode: 0, snapshot: {} }),
			checkRuntime: async () => passed(),
			repairRuntime: async () => passed(),
		};
		const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-vault-'));
		const outcome = await run.runRepairAll(
			{ provider, settings: { targets: [target({ path: vault })] } },
			vault,
			strings,
		);
		assert.equal(outcome.aborted, false);
		assert.equal(outcome.failedCount, 1, 'a blocked target still counts as a failure');
		assert.equal(outcome.repairedCount, 0);
		assert.ok(outcome.repair.output.includes('must be outside the vault'));
	}

	// External targets may not equal, contain, or sit inside the canonical source.
	{
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-source-overlap-'));
		const vault = path.join(root, 'vault');
		const source = path.join(root, 'canonical-skills');
		await fs.mkdir(vault, { recursive: true });
		await fs.mkdir(source, { recursive: true });
		let checked = 0;
		const provider = {
			inspectManifest: async () => ({
				status: 'passed', output: '', exitCode: 0,
				snapshot: { vaultPath: vault, sharedRoot: source },
			}),
			checkRuntime: async () => {
				checked += 1;
				return passed();
			},
			repairRuntime: async () => passed(),
		};
		const overlappingPaths = [source, path.join(source, 'nested'), root];
		const checks = await run.collectTargetChecks({
			provider,
			settings: { targets: overlappingPaths.map((targetPath, index) => target({ id: `overlap-${index}`, path: targetPath })) },
		}, vault, { vaultPath: vault, sharedRoot: source });
		assert.equal(checked, 0, 'overlapping targets are rejected before invoking the provider');
		assert.equal(checks.length, overlappingPaths.length);
		for (const check of checks) {
			assert.equal(check.repairable, false);
			assert.match(check.result.output, /must not overlap the canonical skill source/);
		}
		if (process.platform !== 'win32') {
			const alias = path.join(root, 'source-alias');
			await fs.symlink(source, alias);
			const aliasChecks = await run.collectTargetChecks({
				provider,
				settings: { targets: [target({ path: alias })] },
			}, vault, { vaultPath: vault, sharedRoot: source });
			assert.equal(aliasChecks[0].repairable, false);
			assert.match(aliasChecks[0].result.output, /must not overlap the canonical skill source/);
			assert.equal(checked, 0, 'symlink aliases are rejected before invoking the provider');
		}
	}

	// Drifted targets are repaired and re-checked; blocked ones add to failedCount.
	{
		const calls = [];
		const provider = {
			inspectManifest: async () => ({ status: 'passed', output: '', exitCode: 0, snapshot: {} }),
			checkRuntime: async (vaultPath, runtime) => {
				calls.push(`check:${runtime}`);
				return failed('drift', 4);
			},
			repairRuntime: async (vaultPath, runtime) => {
				calls.push(`repair:${runtime}`);
				return passed('rewrote');
			},
		};
		const outcome = await run.runRepairAll(
			{ provider, settings: { targets: [target()] } },
			'/vault',
			strings,
		);
		assert.equal(outcome.aborted, false);
		assert.deepEqual(calls, ['check:codex', 'repair:codex', 'check:codex'], 'repair is followed by a recheck');
		// The recheck kept failing, so the target counts as failed.
		assert.equal(outcome.failedCount, 1);
		assert.equal(outcome.repairedCount, 0);
		assert.ok(outcome.repair.output.includes('follow-up'));
	}

	// A successful repair reports the repaired count, not zero.
	{
		let checks = 0;
		const provider = {
			inspectManifest: async () => ({ status: 'passed', output: '', exitCode: 0, snapshot: {} }),
			checkRuntime: async () => {
				checks += 1;
				return checks === 1 ? failed('drift', 2) : passed('clean');
			},
			repairRuntime: async () => passed('rewrote'),
		};
		const outcome = await run.runRepairAll(
			{ provider, settings: { targets: [target()] } },
			'/vault',
			strings,
		);
		assert.equal(outcome.repairedCount, 1);
		assert.equal(outcome.failedCount, 0);
		assert.equal(outcome.repair.status, 'passed');
		assert.ok(outcome.repair.output.includes('repaired 1'), 'the summary reports what was repaired');
	}

	// No drift and nothing blocked means an up-to-date run.
	{
		const provider = {
			inspectManifest: async () => ({ status: 'passed', output: '', exitCode: 0, snapshot: {} }),
			checkRuntime: async () => passed('clean'),
			repairRuntime: async () => passed(),
		};
		const outcome = await run.runRepairAll(
			{ provider, settings: { targets: [target()] } },
			'/vault',
			strings,
		);
		assert.equal(outcome.failedCount, 0);
		assert.equal(outcome.repairedCount, 0);
		assert.ok(outcome.repair.output.includes('no drift'), 'a clean run says it is up to date');
	}

	// Empty target lists pass with the configured message and check nothing.
	{
		const provider = {
			inspectManifest: async () => ({ status: 'passed', output: '', exitCode: 0, snapshot: {} }),
			checkRuntime: async () => passed(),
			repairRuntime: async () => passed(),
		};
		const outcome = await run.runRepairAll({ provider, settings: { targets: [] } }, '/vault', strings);
		assert.equal(outcome.failedCount, 0);
		assert.ok(outcome.checkResult.output.includes('no repair targets'));
	}

	// The deck observes real results, including the follow-up, without changing decisions.
	{
		let checks = 0;
		const activities = [];
		const observed = [];
		const provider = {
			inspectManifest: async () => ({ status: 'passed', output: '', exitCode: 0, snapshot: {} }),
			checkRuntime: async () => ++checks === 1 ? failed('drift', 1) : passed('verified'),
			repairRuntime: async () => passed('written'),
		};
		const outcome = await run.runRepairAll({
			provider,
			settings: { targets: [target()] },
			onTargetActivity: (activity) => activities.push(activity.phase),
			onTargetCheck: (check) => observed.push(check.result.output),
		}, '/vault', strings);
		assert.deepEqual(activities, ['checking', 'repairing', 'checking']);
		assert.deepEqual(observed, ['drift', 'verified'], 'write success alone must not mark a target clean');
		assert.equal(outcome.repairedCount, 1);
	}
	{
		const observed = [];
		const provider = {
			inspectManifest: async () => ({ status: 'passed', output: '', exitCode: 0, snapshot: {} }),
			checkRuntime: async () => failed('drift', 1),
			repairRuntime: async () => failed('write refused', 1),
		};
		await run.runRepairAll({
			provider,
			settings: { targets: [target()] },
			onTargetCheck: (check) => observed.push(check),
		}, '/vault', strings);
		assert.equal(observed.at(-1).repairFailed, true);
		assert.equal(observed.at(-1).result.status, 'failed');
	}
	console.log('Adapter run checks passed: target filtering, manifest abort, blocked counting, repair, follow-up, and truthful UI events.');
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}
