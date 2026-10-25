import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { buildIdentityPlugin } from './build-id-plugin.mjs';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-build-id-'));
const entry = path.join(tempRoot, 'entry.mjs');
const bundlePath = path.join(tempRoot, 'bundle.mjs');
const buildResults = [];
let resolveNextBuild;
const waitForBuild = () => new Promise((resolve) => {
	if (buildResults.length > 0) {
		resolve(buildResults.shift());
		return;
	}
	resolveNextBuild = resolve;
});
const buildObserver = {
	name: 'test-build-observer',
	setup(build) {
		build.onEnd((result) => {
			if (resolveNextBuild) {
				const resolve = resolveNextBuild;
				resolveNextBuild = undefined;
				resolve(result);
			} else {
				buildResults.push(result);
			}
		});
	},
};
await fs.writeFile(entry, "import { BUILD_ID } from 'virtual:skill-switchboard-build-info';\nconsole.log(BUILD_ID);\n", 'utf8');
const context = await esbuild.context({
	entryPoints: [entry],
	bundle: true,
	format: 'esm',
	outfile: bundlePath,
	plugins: [buildIdentityPlugin('fixture'), buildObserver],
	logLevel: 'silent',
});

try {
	const firstBuild = waitForBuild();
	await context.watch();
	assert.equal((await firstBuild).errors.length, 0);
	const firstBundle = await fs.readFile(bundlePath, 'utf8');
	const firstBuildId = firstBundle.match(/fixture-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)?.[0];
	assert.ok(firstBuildId, 'first bundle embeds a revision and UTC build time');
	const secondBuild = waitForBuild();
	await fs.writeFile(entry, "import { BUILD_ID } from 'virtual:skill-switchboard-build-info';\nconsole.log(BUILD_ID, 'rebuilt');\n", 'utf8');
	assert.equal((await secondBuild).errors.length, 0);
	const secondBundle = await fs.readFile(bundlePath, 'utf8');
	const secondBuildId = secondBundle.match(/fixture-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)?.[0];
	assert.ok(secondBuildId, 'rebuilt bundle embeds a revision and UTC build time');
	assert.notEqual(secondBuildId, firstBuildId, 'each development watch rebuild receives a new build ID');
	console.log('Build identity checks passed: development watch rebuilds embed distinct revision/time IDs.');
} finally {
	await context.dispose();
	await fs.rm(tempRoot, { recursive: true, force: true });
}

// Deterministic production identity: same revision → byte-identical bundles.
const detRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-build-id-det-'));
const detEntry = path.join(detRoot, 'entry.mjs');
await fs.writeFile(
	detEntry,
	"import { BUILD_ID } from 'virtual:skill-switchboard-build-info';\nconsole.log(BUILD_ID);\n",
	'utf8',
);
const detBuild = () => esbuild.build({
	entryPoints: [detEntry],
	bundle: true,
	format: 'esm',
	outfile: path.join(detRoot, 'bundle.mjs'),
	plugins: [buildIdentityPlugin('fixture', { deterministic: true })],
	logLevel: 'silent',
});
await detBuild();
const detFirst = await fs.readFile(path.join(detRoot, 'bundle.mjs'), 'utf8');
await detBuild();
const detSecond = await fs.readFile(path.join(detRoot, 'bundle.mjs'), 'utf8');
assert.equal(detSecond, detFirst, 'deterministic builds with the same revision are byte-identical');
assert.ok(detFirst.includes('"fixture"'), 'deterministic BUILD_ID is the revision alone, with no timestamp');
assert.doesNotMatch(detFirst, /\d{4}-\d{2}-\d{2}T/, 'deterministic BUILD_ID embeds no build time');
await fs.rm(detRoot, { recursive: true, force: true });
console.log('Deterministic build identity checks passed: production builds are reproducible.');

