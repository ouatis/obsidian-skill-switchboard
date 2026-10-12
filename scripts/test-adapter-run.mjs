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

	console.log('Adapter run checks passed: target filtering, manifest abort, blocked counting, repair and follow-up.');
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}