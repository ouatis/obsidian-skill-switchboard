import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-status-queue-'));
const previousWindow = globalThis.window;
globalThis.window = {};

async function bundleStatus(name, buildId) {
	const outfile = path.join(tempRoot, `${name}.cjs`);
	await esbuild.build({
		entryPoints: [path.join(repo, 'src/status.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile,
		logLevel: 'silent',
		plugins: [{
			name: `build-info-${name}`,
			setup(build) {
				build.onResolve({ filter: /^virtual:skill-switchboard-build-info$/ }, () => ({ path: 'build-info', namespace: name }));
				build.onLoad({ filter: /.*/, namespace: name }, () => ({ contents: `export const BUILD_ID = ${JSON.stringify(buildId)};`, loader: 'js' }));
			},
		}],
	});
	return await import(pathToFileURL(outfile).href);
}

try {
	const oldBundle = await bundleStatus('old', 'old-build');
	const newBundle = await bundleStatus('new', 'new-build');
	const events = [];
	let releaseOldWrite;
	let notifyOldStarted;
	const oldStarted = new Promise((resolve) => { notifyOldStarted = resolve; });
	const oldGate = new Promise((resolve) => { releaseOldWrite = resolve; });

	const oldWrite = oldBundle.serializeStatusWrite('same-vault-status', async () => {
		events.push('old-start');
		notifyOldStarted();
		await oldGate;
		events.push('old-finish');
	});
	await oldStarted;
	const newWrite = newBundle.serializeStatusWrite('same-vault-status', async () => {
		events.push('new-write');
	});
	await Promise.resolve();
	assert.deepEqual(events, ['old-start'], 'a newer bundle waits for an in-flight write from the previous bundle');
	releaseOldWrite();
	await Promise.all([oldWrite, newWrite]);
	assert.deepEqual(events, ['old-start', 'old-finish', 'new-write'], 'the newest status write is last');

	let releaseIndependent;
	let notifyIndependentStarted;
	const independentStarted = new Promise((resolve) => { notifyIndependentStarted = resolve; });
	const independentGate = new Promise((resolve) => { releaseIndependent = resolve; });
	const blocked = oldBundle.serializeStatusWrite('vault-a', async () => {
		notifyIndependentStarted();
		await independentGate;
	});
	await independentStarted;
	let independentCompleted = false;
	await newBundle.serializeStatusWrite('vault-b', async () => { independentCompleted = true; });
	assert.equal(independentCompleted, true, 'different vaults do not block one another');
	releaseIndependent();
	await blocked;

	await assert.rejects(oldBundle.serializeStatusWrite('recoverable-vault', async () => {
		throw new Error('fixture write failure');
	}));
	let recovered = false;
	await newBundle.serializeStatusWrite('recoverable-vault', async () => { recovered = true; });
	assert.equal(recovered, true, 'a failed write does not poison later writes');

	console.log('Status queue checks passed: cross-bundle ordering, per-vault isolation, and recovery after failed writes.');
} finally {
	if (previousWindow === undefined) delete globalThis.window;
	else globalThis.window = previousWindow;
	assert.equal(path.dirname(await fs.realpath(tempRoot)), await fs.realpath(os.tmpdir()));
	assert.ok(path.basename(tempRoot).startsWith('skill-switchboard-status-queue-'));
	await fs.rm(tempRoot, { recursive: true, force: true });
}
