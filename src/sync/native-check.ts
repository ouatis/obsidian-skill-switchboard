import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RuntimeName } from '../types';
import type { AdapterCheckResult } from './result';
import { adapterFor, type SyncManifestSnapshot } from './manifest';
import { skillBundle, type SkillBundle } from './skill-bundle';
import { inspectInstall, exists, type InstallState } from './install-state';
import { safeInstallPath } from './install-package';
import { existingRealPath } from './filesystem';
import { resolveConfiguredPath } from '../utils/paths';
import { blockedResourceSkills } from './resources';
import { findOrphans, type OrphanCandidate, type OrphanScan } from './install-ledger';

export { inspectManifest } from './manifest';
export type NativeCheckKind = 'clean' | 'drift' | 'blocked' | 'error';
export interface SkillInstallCheck { name: string; path: string; state: InstallState['kind']; detail: string; fingerprint: string }
export interface NativeCheckResult extends AdapterCheckResult {
	kind: NativeCheckKind;
	problems: string[];
	checkedSkillCount: number;
	blockedSkills?: string[];
	installs?: SkillInstallCheck[];
	unmanagedEntries?: string[];
	/** Copies this plugin installed whose skill has since left the source. */
	orphanEntries?: OrphanCandidate[];
	/** The orphans whose tree still matches the install, so they can be retired. */
	orphanCandidates?: OrphanCandidate[];
}
export interface NativeCheckOptions {
	opencodeCommandsDir?: string;
	/** Where install evidence is kept; without it no orphan can be identified. */
	ledgerDirectory?: string;
}
export interface PreparedSkill { name: string; bundle?: SkillBundle; state: InstallState }

export async function prepareRuntime(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot: SyncManifestSnapshot): Promise<PreparedSkill[]> {
	// The configured path is what the user wrote; the resolved one is what the
	// filesystem needs. Both are needed: the resolved path is where files go,
	// the configured one is what a path reported back to them must look like.
	const configured = resolveConfiguredPath(targetPath, vaultPath);
	const target = await safeInstallPath(configured, snapshot.vaultPath, snapshot.sharedRoot);
	const candidates = snapshot.skills.filter((skill) => adapterFor(skill, runtime) !== null);
	if (!candidates.length) throw new Error(`No skills enable the ${runtime} adapter in the configured source.`);
	const blocked = new Set(blockedResourceSkills(snapshot.resources, candidates));
	const plans: PreparedSkill[] = [];
	for (const source of candidates) {
		try {
			if (blocked.has(source.name)) throw new Error('Package resources are incomplete; existing installation left unchanged.');
			const bundle = await skillBundle(snapshot, runtime, target, source, configured);
			await safeInstallPath(bundle.directory, snapshot.vaultPath, snapshot.sharedRoot);
			plans.push({ name: source.name, bundle, state: await inspectInstall(bundle) });
		} catch (error) {
			plans.push({ name: source.name, state: { kind: 'blocked', fingerprint: 'blocked', detail: error instanceof Error ? error.message : String(error) } });
		}
	}
	return plans;
}

/** A found skill is not automatically owned; unrelated installations are informational. */
export async function otherEntries(target: string, managed: Set<string>, runtime: RuntimeName): Promise<string[]> {
	if (!await exists(target)) return [];
	const found: string[] = [];
	// The managed set is built from install directories that went through
	// safeInstallPath, so those paths are resolved. The scan walks the
	// configured path, which is not. Wherever a symlink sits between the
	// two — macOS resolves /var to /private/var — one directory is spelled
	// two ways and a managed skill is reported as unmanaged. Compare
	// resolved paths on both sides, and keep reporting the scanned path
	// unchanged so what the user sees does not depend on this fix.
	const managedPaths = new Set<string>();
	for (const entry of managed) {
		if (entry) managedPaths.add(await existingRealPath(entry));
	}
	async function inspect(directory: string, categories: boolean): Promise<void> {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			if (entry.name.startsWith('.')) continue;
			const full = path.join(directory, entry.name);
			if (entry.isDirectory() && await exists(path.join(full, 'SKILL.md'))) {
				if (!managedPaths.has(await existingRealPath(full))) found.push(full);
			} else if (categories && entry.isDirectory()) await inspect(full, false);
			else if (runtime === 'dsh' && entry.isFile() && entry.name.endsWith('.md')) found.push(full);
		}
	}
	await inspect(target, runtime === 'hermes');
	return found;
}

/** The orphans under a target, using the same rule the repair follows. */
export async function orphanScan(
	vaultPath: string,
	runtime: RuntimeName,
	targetPath: string,
	snapshot: SyncManifestSnapshot,
	ledgerDirectory?: string,
): Promise<OrphanScan> {
	const configured = resolveConfiguredPath(targetPath, vaultPath);
	const target = await safeInstallPath(configured, snapshot.vaultPath, snapshot.sharedRoot);
	const plans = await prepareRuntime(vaultPath, runtime, targetPath, snapshot);
	// Only what the source still installs counts as managed. A plan without a
	// bundle is blocked, so its directory is not an install the user asked for.
	const managed = new Set(plans.flatMap((plan) => plan.bundle ? [plan.bundle.directory] : []));
	const unmanagedEntries = await otherEntries(target, managed, runtime);
	return findOrphans({ store: ledgerDirectory, entries: unmanagedEntries, runtime, live: managed, targets: [configured, target] });
}

export async function checkRuntimeNative(vaultPath: string, runtime: RuntimeName, targetPath: string, snapshot: SyncManifestSnapshot, options: NativeCheckOptions = {}): Promise<NativeCheckResult> {
	try {
		const plans = await prepareRuntime(vaultPath, runtime, targetPath, snapshot);
		const installs = plans.map(({ name, bundle, state }) => ({ name, path: bundle?.directory ?? '', state: state.kind, detail: state.detail, fingerprint: state.fingerprint }));
		const blockedSkills = installs.filter((item) => item.state === 'blocked').map((item) => item.name);
		const drift = installs.some((item) => item.state === 'missing' || item.state === 'update');
		const problems = installs.filter((item) => item.state !== 'current').map((item) => `${item.state}: ${item.name} — ${item.detail}`);
		const kind: NativeCheckKind = drift ? 'drift' : blockedSkills.length ? 'blocked' : 'clean';
		const resolvedTarget = resolveConfiguredPath(targetPath, vaultPath);
		const managed = new Set(installs.map((item) => item.path));
		const unmanagedEntries = await otherEntries(resolvedTarget, managed, runtime);
		const orphans = await findOrphans({
			store: options.ledgerDirectory,
			entries: unmanagedEntries,
			runtime,
			live: managed,
			targets: [resolveConfiguredPath(targetPath, vaultPath), await safeInstallPath(resolvedTarget, vaultPath, snapshot.sharedRoot)],
		});
		return {
			status: kind === 'clean' ? 'passed' : 'failed',
			kind,
			checkedSkillCount: plans.length,
			blockedSkills,
			installs,
			unmanagedEntries,
			orphanEntries: [...orphans.sweepable, ...orphans.kept],
			orphanCandidates: orphans.sweepable,
			problems,
			exitCode: kind === 'clean' ? 0 : 1,
			output: [
				`[native] ${kind === 'clean' ? 'PASS' : kind.toUpperCase()}`,
				...problems,
				...(unmanagedEntries.length ? [`Found ${unmanagedEntries.length} other skill(s); not managed or changed by this plugin.`] : []),
				...(orphans.sweepable.length ? [`Found ${orphans.sweepable.length} orphaned skill copy(s) this plugin installed; ready to retire.`] : []),
				...(orphans.kept.length ? [`Kept ${orphans.kept.length} orphaned copy/copies that changed since install or could not be read.`] : []),
			].join('\n'),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: 'failed', kind: 'error', checkedSkillCount: 0, problems: [message], exitCode: 2, output: `[native] UNAVAILABLE\n${message}` };
	}
}
