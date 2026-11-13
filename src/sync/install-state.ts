import { promises as fs } from 'node:fs';
import type { SkillBundle } from './skill-bundle';
import { digest, fileHashes, readPackageTree } from './package-files';

export type InstallKind = 'missing' | 'current' | 'update' | 'blocked';
export interface InstallState { kind: InstallKind; detail: string; fingerprint: string; files?: Record<string, string> }
const absent = (error: unknown): boolean => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
const stable = (value: Record<string, string>): string => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

export async function exists(file: string): Promise<boolean> {
	try { await fs.lstat(file); return true; } catch (error) { if (absent(error)) return false; throw error; }
}

/** The canonical package is the only baseline. No ownership database or merge state. */
export async function inspectInstall(bundle: SkillBundle): Promise<InstallState> {
	try {
		if (bundle.legacyFlat && await exists(bundle.legacyFlat)) {
			const stat = await fs.lstat(bundle.legacyFlat);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Legacy flat entry cannot be safely read.');
			const folder = await inspectInstall({ ...bundle, legacyFlat: undefined });
			if (folder.kind === 'blocked') return folder;
			return { kind: 'update', detail: 'Replace the legacy flat entry with the canonical directory package.', files: folder.files, fingerprint: `legacy:${digest(await fs.readFile(bundle.legacyFlat))}:${folder.fingerprint}` };
		}
		if (!await exists(bundle.directory)) return { kind: 'missing', detail: 'Not installed', fingerprint: 'missing' };
		const stat = await fs.lstat(bundle.directory);
		if (!stat.isDirectory() || stat.isSymbolicLink()) return { kind: 'blocked', detail: 'Target is a link or not a directory; left unchanged.', fingerprint: 'non-directory' };
		// Old installation receipts are ordinary obsolete output and disappear on replacement.
		const files = fileHashes(await readPackageTree(bundle.directory, false, true));
		const content = stable(files);
		const current = stable(fileHashes(bundle.files)) === content;
		return { kind: current ? 'current' : 'update', detail: current ? 'Matches the canonical source.' : 'Different from the canonical source; repair replaces this copy without a history backup.', files, fingerprint: digest(content) };
	} catch (error) {
		return { kind: 'blocked', detail: error instanceof Error ? error.message : String(error), fingerprint: 'unreadable' };
	}
}
