#!/usr/bin/env node
/**
 * Runs every unit test script in scripts/ (test-*.mjs) in deterministic order.
 * Live scripts (test-ui-live, test-package-ui-live) are excluded: they drive a
 * real Obsidian CLI + vault and stay manual steps. Fails fast on the first
 * non-zero exit; the failing script is named in the summary.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SKIP = new Set(['test-ui-live.mjs', 'test-package-ui-live.mjs']);
const directory = path.dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(directory)
	.filter((file) => /^test-.+\.mjs$/.test(file) && !SKIP.has(file))
	.sort();

if (process.argv.includes('--list')) {
	console.log(tests.join('\n'));
	process.exit(0);
}

const failures = [];
for (const file of tests) {
	process.stdout.write(`\n=== ${file} ===\n`);
	const result = spawnSync(process.execPath, [path.join(directory, file)], {
		stdio: 'inherit',
	});
	if (result.status !== 0 || result.error) {
		failures.push(file);
		break;
	}
}

console.log(`\n=== summary: ${tests.length - failures.length}/${tests.length} scripts passed ===`);
if (failures.length > 0) {
	console.error(`FAILED: ${failures.join(', ')}`);
	process.exit(1);
}
