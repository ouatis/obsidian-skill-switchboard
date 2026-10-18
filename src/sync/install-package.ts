import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SkillBundle } from './skill-bundle';
import { materialize } from './package-files';
import { exists, inspectInstall } from './install-state';
import { existingRealPath } from './filesystem';
import { isInside, pathsOverlap } from '../utils/paths';
import { snapshotSkillFiles } from './source-catalog';
import { retryFileOperation } from './file-retry';

export interface InstallOptions {
	isCurrent?: () => boolean;
	/** Test seam: inject a failure after preparation without changing the real filesystem API. */
	beforeCommit?: () => Promise<void>;
	afterDisplace?: () => Promise<void>;
	beforeCleanup?: () => Promise<void>;
}

export async function safeInstallPath(candidate: string, vault: string, source: string): Promise<string> {
	const [real, realVault, realSource] = await Promise.all([existingRealPath(candidate), existingRealPath(vault), existingRealPath(source)]);
	if (isInside(realVault, real) || pathsOverlap(realSource, real)) throw new Error(`Distribution target overlaps the vault or canonical skill source: ${candidate}`);
	return real;
}

async function verifyPrepared(bundle: SkillBundle, directory: string): Promise<void> {
	const state = await inspectInstall({ ...bundle, directory, legacyFlat: undefined });
	if (state.kind !== 'current') {
		throw new Error('Prepared package changed; original left unchanged.');
	}
}

/** Source wins. Old trees exist only during the swap for rollback, never as history. */
export async function installPackage(bundle: SkillBundle, vault: string, source: string, options: InstallOptions): Promise<{ changed: boolean; files: number; cleanupWarnings?: string[] }> {
	if (options.isCurrent?.() === false) throw new Error('Repair was cancelled before package preparation.');
	if (await safeInstallPath(bundle.directory, vault, source) !== path.resolve(bundle.directory)) throw new Error('Installation path was redirected by a link; left unchanged.');
	const initial = await inspectInstall(bundle);
	if (initial.kind === 'current') return { changed: false, files: 0 };
	if (initial.kind === 'blocked') throw new Error(initial.detail);
	const parent = path.dirname(bundle.directory);
	await fs.mkdir(parent, { recursive: true });
	const lockPath = path.join(parent, `.skill-switchboard-${bundle.name}.lock`);
	await safeInstallPath(lockPath, vault, source);
	const lock = await fs.open(lockPath, 'wx');
	let staging: string | undefined;
	let displaced: string | undefined;
	let legacyDisplaced: string | undefined;
	try {
		staging = await fs.mkdtemp(path.join(parent, `.skill-switchboard-${bundle.name}-next-`));
		for (const file of bundle.files) {
			const target = path.join(staging, file.path);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, file.bytes, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 });
		}
		await verifyPrepared(bundle, staging);
		await options.beforeCommit?.();
		await materialize(bundle.sourceFiles);
		const entry = bundle.sourceFiles.find((file) => file.path === 'SKILL.md');
		if (!entry) throw new Error('Source entry is missing.');
		const freshSource = await snapshotSkillFiles(entry.source, source);
		if (JSON.stringify(freshSource) !== JSON.stringify(bundle.sourceFiles)) throw new Error('Source changed during distribution; check again.');
		await verifyPrepared(bundle, staging);
		const now = await inspectInstall(bundle);
		if (now.kind !== initial.kind || now.fingerprint !== initial.fingerprint) throw new Error('Target changed after preview; check and confirm again.');
		if (await safeInstallPath(bundle.directory, vault, source) !== path.resolve(bundle.directory)) throw new Error('Installation path changed while preparing the package.');
		const hasDirectory = await exists(bundle.directory);
		const hasLegacy = Boolean(bundle.legacyFlat && await exists(bundle.legacyFlat));
		const current = () => options.isCurrent?.() !== false;
		try {
			if (hasDirectory) {
				const old = path.join(parent, `.skill-switchboard-${bundle.name}-old-${randomUUID()}`);
				await retryFileOperation(() => fs.rename(bundle.directory, old), current);
				displaced = old;
			}
			if (hasLegacy && bundle.legacyFlat) {
				const oldFlat = path.join(parent, `.skill-switchboard-${bundle.name}-flat-${randomUUID()}`);
				await retryFileOperation(() => fs.rename(bundle.legacyFlat!, oldFlat), current);
				legacyDisplaced = oldFlat;
			}
			await options.afterDisplace?.();
			await retryFileOperation(() => fs.rename(staging!, bundle.directory), current); staging = undefined;
		}
		catch (error) {
			const recoveryErrors: string[] = [];
			if (displaced) {
				try { await retryFileOperation(() => fs.rename(displaced!, bundle.directory)); displaced = undefined; }
				catch { recoveryErrors.push(`Original directory preserved at ${displaced}`); }
			}
			if (legacyDisplaced && bundle.legacyFlat) {
				try { await retryFileOperation(() => fs.rename(legacyDisplaced!, bundle.legacyFlat!)); legacyDisplaced = undefined; }
				catch { recoveryErrors.push(`Legacy entry preserved at ${legacyDisplaced}`); }
			}
			if (recoveryErrors.length) throw new Error(`Swap failed; automatic restoration could not finish. ${recoveryErrors.join('; ')}.`);
			throw error;
		}
		const cleanupWarnings: string[] = [];
		try {
			await options.beforeCleanup?.();
			if (displaced) {
				if (await safeInstallPath(displaced, vault, source) !== path.resolve(displaced)) throw new Error('Temporary old directory was redirected.');
				await retryFileOperation(() => fs.rm(displaced!, { recursive: true, force: true }));
			}
			if (legacyDisplaced) {
				if (await safeInstallPath(legacyDisplaced, vault, source) !== path.resolve(legacyDisplaced)) throw new Error('Temporary legacy entry was redirected.');
				await retryFileOperation(() => fs.unlink(legacyDisplaced!));
			}
		} catch (error) {
			cleanupWarnings.push(`Canonical copy installed, but temporary old-file cleanup failed: ${error instanceof Error ? error.message : String(error)}. Check ${[displaced, legacyDisplaced].filter(Boolean).join('; ')}.`);
		}
		return { changed: true, files: bundle.files.length, cleanupWarnings };
	} finally {
		try {
			if (staging && await exists(staging)) {
				const resolved = await safeInstallPath(staging, vault, source).catch(() => null);
				if (resolved === path.resolve(staging)) await retryFileOperation(() => fs.rm(staging!, { recursive: true, force: true })).catch(() => undefined);
			}
		} finally {
			await lock.close();
			if (await safeInstallPath(lockPath, vault, source).catch(() => null) === path.resolve(lockPath)) await retryFileOperation(() => fs.unlink(lockPath));
		}
	}
}
