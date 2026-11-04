#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// Read-only drift check for an installed vault, using the same modules the
// plugin's adapter check uses. Nothing here writes: no repair, no status file,
// no snapshot directory. Rewriting belongs to the panel, where the user sees
// the plan and confirms it.
//
//   npm run check:runtime -- --vault "C:/path/to/vault" [--json]
//
// The vault's wiring lives outside the vault (see src/settings/storage.ts), so
// the script derives that file from the vault path and reads the configured
// source and runtime targets out of it.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
};

const vaultArg = arg('--vault') ?? process.env.SKILL_SWITCHBOARD_VAULT;
const wantsJson = argv.includes('--json');

if (!vaultArg) {
	console.error('check:runtime needs a vault: pass --vault <path> or set SKILL_SWITCHBOARD_VAULT.');
	process.exit(2);
}

const vaultPath = path.resolve(vaultArg);
const vaultId = createHash('sha256').update(vaultPath).digest('hex').slice(0, 24);
const settingsFile = path.join(os.homedir(), '.skill-switchboard', 'vaults', vaultId, 'settings.json');

async function readConnections() {
	let raw;
	try {
		raw = await fs.readFile(settingsFile, 'utf8');
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			console.error(`check:runtime found no wiring for ${vaultPath}.`);
			console.error(`Expected ${settingsFile}. Open the switchboard in Obsidian once so the plugin writes it.`);
			process.exit(2);
		}
		throw error;
	}
	const stored = JSON.parse(raw);
	const connections = stored?.connections;
	if (!connections || !Array.isArray(connections.targets) || !Array.isArray(connections.roots)) {
		console.error(`check:runtime could not read connections from ${settingsFile}.`);
		process.exit(2);
	}
	return connections;
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ssb-check-runtime-'));
try {
	for (const [name, entry] of [
		['adapter-run.cjs', 'src/sync/adapter-run.ts'],
		['sync-provider.cjs', 'src/sync-provider.ts'],
		['source.cjs', 'src/sync/source.ts'],
		['package-paths.cjs', 'src/sync/package-paths.ts'],
	]) {
		await esbuild.build({
			entryPoints: [path.join(repo, entry)],
			bundle: true,
			platform: 'node',
			format: 'cjs',
			outfile: path.join(tempRoot, name),
			external: ['node:*'],
			logLevel: 'silent',
		});
	}

	const load = (name) => import(pathToFileURL(path.join(tempRoot, name)).href);
	const adapterRun = await load('adapter-run.cjs');
	const { createSyncProvider } = await load('sync-provider.cjs');
	const source = await load('source.cjs');
	const { localPackageRegistryPath } = await load('package-paths.cjs');

	const connections = await readConnections();
	// Mirror main.ts: the provider resolves the canonical source per vault, so a
	// stale default path is recovered the same way the panel recovers it.
	const provider = createSyncProvider(async (currentVault) => ({
		...(await source.resolveSyncSourceForVault(currentVault, connections)),
		packageRegistryPath: localPackageRegistryPath(),
	}));

	const manifest = await provider.inspectManifest(vaultPath);
	if (manifest.status === 'failed' || !manifest.snapshot) {
		console.error(`check:runtime could not read the shared manifest for ${vaultPath}.`);
		if (manifest.output) console.error(manifest.output);
		process.exit(1);
	}

	const checks = await adapterRun.collectTargetChecks({ provider, settings: { targets: connections.targets } }, vaultPath, manifest.snapshot);
	// The native result carries one entry per skill, so the output can name what
	// drifted instead of repeating the first line of a multi-line summary.
	const rows = checks.map((check) => {
		const installs = check.result.native?.installs ?? [];
		const stale = installs.filter((item) => item.state !== 'current').map((item) => `${item.state}: ${item.name}`);
		return {
			target: check.target.label || check.target.id,
			runtime: check.target.runtime,
			path: check.targetPath ?? check.target.path,
			status: check.result.status,
			repairable: check.repairable,
			skills: installs.length,
			stale,
		};
	});

	if (wantsJson) {
		console.log(JSON.stringify({ vault: vaultPath, targets: rows.length, checks: rows }, null, 2));
	} else {
		console.log(`check:runtime — ${vaultPath}`);
		console.log(`  ${rows.length} configured target(s)`);
		for (const row of rows) {
			const mark = row.status === 'passed' ? 'ok  ' : 'DRIFT';
			const count = row.skills > 0 ? ` ${row.skills} skill(s)` : '';
			console.log(`  ${mark} ${row.target} (${row.runtime})${count} ${row.path}`);
			for (const line of row.stale) console.log(`        ${line}`);
		}
	}

	const drifted = rows.filter((row) => row.status !== 'passed');
	if (drifted.length > 0) {
		const names = [...new Set(rows.flatMap((row) => row.stale.map((line) => line.replace(/^[a-z]+: /, ''))))];
		if (names.length > 0) console.log(`check:runtime — skills out of date: ${names.join(', ')}`);
		console.log(`check:runtime — ${drifted.length} of ${rows.length} target(s) need a repair; open the switchboard panel to rewrite them.`);
		process.exit(1);
	}
	console.log(`check:runtime — all ${rows.length} target(s) match the shared skills.`);
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}
