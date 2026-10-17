import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-deck-'));

try {
	const bundle = path.join(tempRoot, 'distribution.cjs');
	await esbuild.build({
		entryPoints: [path.join(repo, 'src/ui/distribution-state.ts')],
		bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
	});
	const { distributionNodes, deckPositions } = await import(pathToFileURL(bundle).href);
	const target = { id: 'codex', label: 'Codex', path: '~/.codex/skills', runtime: 'codex', mode: 'wrapper', enabled: true };
	const check = { target, targetPath: '/outside/skills', repairable: true, result: { status: 'passed', output: 'ok', exitCode: 0 } };
	const nodes = (over = {}) => distributionNodes({ targets: [target], checks: [], activity: null, blocked: false, ...over });
	assert.equal(nodes()[0].state, 'unknown', 'configuration is not proof of success');
	assert.equal(nodes({ checks: [check] })[0].state, 'clean');
	assert.equal(nodes({ checks: [{ ...check, result: { status: 'failed', output: 'drift', exitCode: 1 } }] })[0].state, 'drift');
	assert.equal(nodes({ checks: [{ ...check, repairable: false }] })[0].state, 'unavailable');
	assert.equal(nodes({ checks: [{ ...check, repairable: false, result: { status: 'failed', exitCode: 1, native: { kind: 'blocked', blockedSkills: ['drawing'] } } }] })[0].state, 'blocked');
	assert.equal(nodes({ checks: [{ ...check, result: { status: 'failed', output: 'error', exitCode: 2 } }] })[0].state, 'unavailable');
	assert.equal(nodes({ checks: [{ ...check, result: { status: 'failed', output: 'error', exitCode: 1, native: { kind: 'error' } } }] })[0].state, 'unavailable');
	assert.equal(nodes({ checks: [{ ...check, repairFailed: true }] })[0].state, 'repair-failed');
	assert.equal(nodes({ blocked: true })[0].state, 'unavailable');
	assert.equal(nodes({ checks: [check], activity: { targetId: 'codex', phase: 'repairing' } })[0].state, 'repairing');
	assert.equal(nodes({ activity: { targetId: 'codex', phase: 'checking' } })[0].state, 'checking');
	assert.equal(nodes({ checks: [check], targets: [{ ...target, path: '/different' }] })[0].state, 'unknown');
	assert.equal(nodes({ checks: [check], targets: [{ ...target, runtime: 'hermes' }] })[0].state, 'unknown');
	assert.equal(nodes({ targets: [{ ...target, enabled: false }, { ...target, id: 'copy', mode: 'copy' }] }).length, 0);
	assert.equal(nodes({ targets: [{ ...target, label: '  ' }] })[0].label, 'codex');
	for (const count of [0, 1, 2, 5, 6, 7, 12]) {
		const points = deckPositions(count);
		assert.equal(points.length, count);
		assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && x > 0 && x < 420 && y > 0 && y < 235));
		assert.equal(new Set(points.map(({ x, y }) => `${x},${y}`)).size, count);
	}
	console.log('Distribution checks passed: unknown/clean/drift/error/repair states, changed targets, filtering, and dynamic layout.');
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}
