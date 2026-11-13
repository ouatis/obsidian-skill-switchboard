import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SkillBundle } from './skill-bundle';
import type { RuntimeName } from '../types';
import { materialize } from './package-files';
import { exists, inspectInstall } from './install-state';
import { existingRealPath } from './filesystem';
import { isInside, pathsOverlap } from '../utils/paths';
import { snapshotSkillFiles } from './source-catalog';
import { retryFileOperation } from './file-retry';
import { createTargetSnapshot } from './target-snapshot';
import { bundleDigest, recordInstall } from './install-ledger';

export interface InstallOptions {
	isCurrent?: () => boolean;
	/** When set, the displaced target tree is copied here before the swap succeeds. */
	snapshotDirectory?: string;
	/** Test seam: inject a failure after preparation without changing the real filesystem API. */
	beforeCommit?: () => Promise<void>;
	afterDisplace?: () => Promise<void>;
	beforeCleanup?: () => Promise<void>;
	/**
	 * Where install evidence is recorded. Repair passes the snapshot store so a
	 * later sweep can tell a managed copy from a directory the user wrote by hand.
	 */
	ledgerDirectory?: string;
	/** The runtime the copy belongs to. Without it no entry is written. */
	runtime?: RuntimeName;
	/**
	 * How the target is spelled in the settings, which is how the scan finds the
	 * copy again. Without it the resolved directory is recorded instead, and a
	 * target written with a symlink or a short name reads as a different path.
	 */
	targetLabel?: string;
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
		const earlyWarnings: string[] = [];
		// Snapshot the tree the swap is about to displace. A failed snapshot is
		// reported but never blocks distribution; the swap itself still restores
		// the old tree on any failure.
		if (hasDirectory && options.snapshotDirectory) {
			try {
				await createTargetSnapshot({
					skill: bundle.name,
					source: bundle.directory,
					store: options.snapshotDirectory,
					fingerprint: initial.fingerprint,
				});
			} catch (error) {
				earlyWarnings.push(`Target snapshot could not be created; distribution continued without one: ${error instanceof Error ? error.message : String(error)}.`);
			}
		}
		// The leftover names are derived from the same rule that created them,
		// so the reported path can be rebuilt from the configured spelling
		// without parsing a resolved path. The resolved path expands Windows
		// short names and macOS symlinked roots, which produced a path the
		// user could not open.
		let oldName: string | undefined;
		let oldFlatName: string | undefined;
		const displayOf = (name: string): string =>
			bundle.displayParent ? path.join(bundle.displayParent, name) : name;
		try {
			if (hasDirectory) {
				oldName = `.skill-switchboard-${bundle.name}-old-${randomUUID()}`;
				const old = path.join(parent, oldName);
				await retryFileOperation(() => fs.rename(bundle.directory, old), current);
				displaced = old;
			}
			if (hasLegacy && bundle.legacyFlat) {
				oldFlatName = `.skill-switchboard-${bundle.name}-flat-${randomUUID()}`;
				const oldFlat = path.join(parent, oldFlatName);
				await retryFileOperation(() => fs.rename(bundle.legacyFlat!, oldFlat), current);
				legacyDisplaced = oldFlat;
			}
			await options.afterDisplace?.();
			await retryFileOperation(() => fs.rename(staging!, bundle.directory), current); staging = undefined;
		}
		catch (error) {
			const recoveryErrors: string[] = [];
			if (displaced) {
				const leftover = displaced;
				const name = oldName ?? path.basename(leftover);
				try { await retryFileOperation(() => fs.rename(leftover, bundle.directory)); displaced = undefined; }
				catch { recoveryErrors.push(`Original directory preserved at ${displayOf(name)}`); }
			}
			if (legacyDisplaced && bundle.legacyFlat) {
				const leftover = legacyDisplaced;
				const name = oldFlatName ?? path.basename(leftover);
				try { await retryFileOperation(() => fs.rename(leftover, bundle.legacyFlat!)); legacyDisplaced = undefined; }
				catch { recoveryErrors.push(`Legacy entry preserved at ${displayOf(name)}`); }
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
			// Report the leftovers in the configured spelling of the target, so
			// the path the user is told to check is one they can open. The
			// resolved path expands Windows short names and macOS symlinked
			// roots; the files themselves never move.
			const leftovers: string[] = [];
			if (displaced) leftovers.push(displayOf(oldName ?? path.basename(displaced)));
			if (legacyDisplaced) leftovers.push(displayOf(oldFlatName ?? path.basename(legacyDisplaced)));
			cleanupWarnings.push(`Canonical copy installed, but temporary old-file cleanup failed: ${error instanceof Error ? error.message : String(error)}. Check ${leftovers.join('; ')}.`);
		}
		// The ledger is what makes a later sweep able to tell a copy this plugin
		// installed from a directory the user wrote by hand. A failed write is
		// reported but never undoes the copy that is already in place.
		if (options.runtime) {
			try {
				await recordInstall(options.ledgerDirectory, {
					skill: bundle.name,
					runtime: options.runtime,
					target: options.targetLabel ?? path.resolve(bundle.directory),
					fingerprint: bundleDigest(bundle),
					installedAt: new Date().toISOString(),
				});
			} catch (error) {
				cleanupWarnings.push(`Install ledger could not be updated; this copy is installed but not recorded as managed: ${error instanceof Error ? error.message : String(error)}.`);
			}
		}
		return { changed: true, files: bundle.files.length, cleanupWarnings: [...earlyWarnings, ...cleanupWarnings] };
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
