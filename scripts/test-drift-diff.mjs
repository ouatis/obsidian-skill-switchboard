import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-drift-diff-'));
const file = (relativePath, content, executable = false) => ({
	path: relativePath,
	bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
	executable,
});

try {
	const bundle = path.join(temporary, 'drift-diff.cjs');
	await esbuild.build({
		entryPoints: [path.join(repo, 'src/sync/drift-diff.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: bundle,
		logLevel: 'silent',
	});
	const { computeDriftDiff, computeLineDiff } = await import(pathToFileURL(bundle).href);

	// Identical packages yield empty change sets and omit skillMdDiff.
	const base = [file('SKILL.md', '# Skill\nLine 1\n'), file('scripts/run.sh', 'echo hi\n', true)];
	const clean = computeDriftDiff(base, [file('SKILL.md', '# Skill\nLine 1\n'), file('scripts/run.sh', 'echo hi\n', true)]);
	assert.deepEqual(clean, { added: [], removed: [], modified: [] });

	// Added, removed, modified, and executable-bit-only changes classify cleanly.
	const sourceSet = [
		file('SKILL.md', '# Skill\nLine 1\nLine 2\n'),
		file('references/extra.md', 'Extra\n'),
		file('scripts/run.sh', 'echo hi\n', true),
	];
	const installedSet = [
		file('SKILL.md', '# Skill\nLine 1\nOld line\n'),
		file('assets/stale.txt', 'Stale\n'),
		file('scripts/run.sh', 'echo hi\n', false),
	];
	const mixed = computeDriftDiff(sourceSet, installedSet);
	assert.deepEqual(mixed.added, ['references/extra.md']);
	assert.deepEqual(mixed.removed, ['assets/stale.txt']);
	assert.deepEqual(mixed.modified, ['scripts/run.sh', 'SKILL.md']);
	assert.deepEqual(mixed.skillMdDiff, {
		truncated: false,
		lines: [
			{ kind: 'context', text: '# Skill' },
			{ kind: 'context', text: 'Line 1' },
			{ kind: 'remove', text: 'Old line' },
			{ kind: 'add', text: 'Line 2' },
		],
	});

	// Separated change hunks collapse intervening unchanged runs with ellipsis.
	const beforeLines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
	const afterLines = [...beforeLines];
	afterLines[2] = 'Updated 3';
	afterLines[17] = 'Updated 18';
	const collapsed = computeLineDiff(beforeLines.join('\n'), afterLines.join('\n'));
	assert.equal(collapsed.truncated, false);
	assert.ok(collapsed.lines.some((entry) => entry.kind === 'context' && entry.text === '…'), 'unchanged gap between hunks collapses with ellipsis');
	assert.ok(!collapsed.lines.some((entry) => entry.text === 'Line 10'), 'far unchanged lines are omitted');
	assert.ok(collapsed.lines.some((entry) => entry.kind === 'remove' && entry.text === 'Line 3'));
	assert.ok(collapsed.lines.some((entry) => entry.kind === 'add' && entry.text === 'Updated 3'));

	// Binary SKILL.md omits line preview safely.
	const binary = computeDriftDiff(
		[file('SKILL.md', Buffer.from([0x23, 0x00, 0xff]))],
		[file('SKILL.md', 'text\n')],
	);
	assert.deepEqual(binary.skillMdDiff, { lines: [], truncated: true, omittedReason: 'binary' });

	// Oversized SKILL.md (>128 KiB or >600 lines) returns too-large omission.
	const overBytes = computeDriftDiff(
		[file('SKILL.md', 'x'.repeat(128 * 1024 + 10))],
		[file('SKILL.md', 'small\n')],
	);
	assert.deepEqual(overBytes.skillMdDiff, { lines: [], truncated: true, omittedReason: 'too-large' });
	const overLines = computeLineDiff(
		Array.from({ length: 601 }, (_, i) => `row ${i}`).join('\n'),
		'small\n',
	);
	assert.deepEqual(overLines, { lines: [], truncated: true, omittedReason: 'too-large' });

	// Previews longer than 80 diff lines truncate cleanly at 80 lines.
	const bigChangesA = Array.from({ length: 120 }, (_, i) => `old ${i}`).join('\n');
	const bigChangesB = Array.from({ length: 120 }, (_, i) => `new ${i}`).join('\n');
	const truncatedDiff = computeLineDiff(bigChangesA, bigChangesB);
	assert.equal(truncatedDiff.truncated, true);
	assert.equal(truncatedDiff.omittedReason, undefined);
	assert.equal(truncatedDiff.lines.length, 80);

	console.log('Drift diff checks passed: file add/remove/modify/exec classification, LCS line diff, hunk collapsing, binary/oversized guards, and 80-line truncation.');
} finally {
	await fs.rm(temporary, { recursive: true, force: true });
}
