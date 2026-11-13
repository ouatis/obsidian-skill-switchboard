import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-target-discovery-'));
try {
	const bundle = path.join(temporary, 'target-discovery.cjs');
	await esbuild.build({
		entryPoints: [path.join(repo, 'src/sync/target-discovery.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: bundle,
		logLevel: 'silent',
	});
	const { discoverRuntimeTargets } = await import(pathToFileURL(bundle).href);
	const home = path.join(temporary, 'home');
	await Promise.all([
		fs.mkdir(path.join(home, '.codex', 'skills'), { recursive: true }),
		fs.mkdir(path.join(home, '.config', 'opencode', 'skills'), { recursive: true }),
		fs.mkdir(path.join(home, '.gemini', 'antigravity', 'skills'), { recursive: true }),
		fs.mkdir(path.join(home, '.hermes', 'skills'), { recursive: true }),
	]);
	await fs.mkdir(path.join(home, '.workbuddy'), { recursive: true });
	await fs.writeFile(path.join(home, '.workbuddy', 'skills'), 'not a directory');

	const detected = await discoverRuntimeTargets(home);
	assert.deepEqual(detected, [
		{ runtime: 'codex', label: 'Codex', path: '~/.codex/skills' },
		{ runtime: 'hermes', label: 'Hermes', path: '~/.hermes/skills' },
		{ runtime: 'opencode', label: 'OpenCode', path: '~/.config/opencode/skills' },
		{ runtime: 'antigravity', label: 'Antigravity', path: '~/.gemini/antigravity/skills' },
	], 'only existing standard directories are returned, in stable order, using portable home-relative paths');

	const probed = [];
	const injected = await discoverRuntimeTargets(home, async (candidate) => {
		probed.push(candidate);
		return candidate.endsWith(path.join('.dsh', 'skills'));
	});
	assert.deepEqual(injected, [{ runtime: 'dsh', label: 'DSH', path: '~/.dsh/skills' }]);
	assert.equal(probed.length, 8, 'only the finite standard path list is probed; no recursive home scan occurs');
	assert.deepEqual(await discoverRuntimeTargets(home, async () => false), [], 'no match yields an empty list');
	await assert.rejects(() => discoverRuntimeTargets(home, async () => { throw new Error('probe failure'); }), /probe failure/);

	console.log('Runtime target discovery checks passed: finite read-only probes, directory filtering, portable paths, stable order, and error propagation.');
} finally {
	await fs.rm(temporary, { recursive: true, force: true });
}
