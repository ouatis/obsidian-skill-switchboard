import { fileHashes, type PackageFile } from './package-files';

export type DiffLineKind = 'context' | 'add' | 'remove';

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
}

export interface SkillTextDiff {
	lines: DiffLine[];
	truncated: boolean;
	omittedReason?: 'too-large' | 'binary';
}

export interface SkillDriftDiff {
	added: string[];
	removed: string[];
	modified: string[];
	skillMdDiff?: SkillTextDiff;
}

export const MAX_DIFF_BYTES = 128 * 1024;
export const MAX_DIFF_LINES = 600;
export const MAX_PREVIEW_LINES = 80;
export const CONTEXT_LINES = 2;

function splitLines(text: string): string[] {
	const normalized = text.replaceAll('\r\n', '\n');
	const stripped = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
	return stripped === '' ? [] : stripped.split('\n');
}

export function computeLineDiff(beforeText: string, afterText: string): SkillTextDiff {
	const beforeLines = splitLines(beforeText);
	const afterLines = splitLines(afterText);
	if (beforeLines.length > MAX_DIFF_LINES || afterLines.length > MAX_DIFF_LINES) {
		return { lines: [], truncated: true, omittedReason: 'too-large' };
	}

	const m = beforeLines.length;
	const n = afterLines.length;
	const cols = n + 1;
	const table = new Uint32Array((m + 1) * cols);
	const at = (row: number, col: number): number => table[row * cols + col] ?? 0;

	for (let i = m - 1; i >= 0; i--) {
		const before = beforeLines[i] ?? '';
		for (let j = n - 1; j >= 0; j--) {
			table[i * cols + j] = before === (afterLines[j] ?? '')
				? 1 + at(i + 1, j + 1)
				: Math.max(at(i + 1, j), at(i, j + 1));
		}
	}

	const raw: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < m || j < n) {
		if (i < m && j < n && beforeLines[i] === afterLines[j]) {
			raw.push({ kind: 'context', text: beforeLines[i] ?? '' });
			i++;
			j++;
		} else if (i < m && (j === n || at(i + 1, j) >= at(i, j + 1))) {
			raw.push({ kind: 'remove', text: beforeLines[i] ?? '' });
			i++;
		} else if (j < n) {
			raw.push({ kind: 'add', text: afterLines[j] ?? '' });
			j++;
		}
	}

	const keep = new Array<boolean>(raw.length).fill(false);
	for (let index = 0; index < raw.length; index++) {
		if (raw[index]?.kind === 'context') continue;
		const start = Math.max(0, index - CONTEXT_LINES);
		const end = Math.min(raw.length - 1, index + CONTEXT_LINES);
		for (let k = start; k <= end; k++) keep[k] = true;
	}

	const collapsed: DiffLine[] = [];
	let skipped = false;
	for (let index = 0; index < raw.length; index++) {
		const entry = raw[index];
		if (!entry) continue;
		if (!keep[index]) {
			skipped = true;
			continue;
		}
		if (skipped && collapsed.length > 0) {
			collapsed.push({ kind: 'context', text: '…' });
		}
		skipped = false;
		collapsed.push(entry);
	}

	if (collapsed.length > MAX_PREVIEW_LINES) {
		return { lines: collapsed.slice(0, MAX_PREVIEW_LINES), truncated: true };
	}
	return { lines: collapsed, truncated: false };
}

export function computeDriftDiff(
	sourceFiles: readonly PackageFile[],
	installedFiles: readonly PackageFile[],
): SkillDriftDiff {
	const sourceHashes = fileHashes([...sourceFiles]);
	const installedHashes = fileHashes([...installedFiles]);
	const allPaths = [...new Set([...Object.keys(sourceHashes), ...Object.keys(installedHashes)])].sort((a, b) => a.localeCompare(b));

	const added: string[] = [];
	const removed: string[] = [];
	const modified: string[] = [];

	for (const filePath of allPaths) {
		const sourceHash = sourceHashes[filePath];
		const installedHash = installedHashes[filePath];
		if (sourceHash === undefined) {
			removed.push(filePath);
		} else if (installedHash === undefined) {
			added.push(filePath);
		} else if (sourceHash !== installedHash) {
			modified.push(filePath);
		}
	}

	let skillMdDiff: SkillTextDiff | undefined;
	if (modified.includes('SKILL.md')) {
		const sourceEntry = sourceFiles.find((file) => file.path === 'SKILL.md');
		const installedEntry = installedFiles.find((file) => file.path === 'SKILL.md');
		if (sourceEntry && installedEntry) {
			if (sourceEntry.bytes.length > MAX_DIFF_BYTES || installedEntry.bytes.length > MAX_DIFF_BYTES) {
				skillMdDiff = { lines: [], truncated: true, omittedReason: 'too-large' };
			} else if (sourceEntry.bytes.includes(0) || installedEntry.bytes.includes(0)) {
				skillMdDiff = { lines: [], truncated: true, omittedReason: 'binary' };
			} else {
				skillMdDiff = computeLineDiff(
					installedEntry.bytes.toString('utf8'),
					sourceEntry.bytes.toString('utf8'),
				);
			}
		}
	}

	return {
		added,
		removed,
		modified,
		...(skillMdDiff ? { skillMdDiff } : {}),
	};
}
