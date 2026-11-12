import { promises as fs } from 'node:fs';
import path from 'node:path';
import { existingRealPath } from './filesystem';
import { createHash } from 'node:crypto';
import { RUNTIME_NAMES, type RuntimeName } from '../types';
import type { SkillBundle } from './skill-bundle';
import { fileHashes, readPackageTree } from './package-files';
import { exists } from './install-state';
import { isInside } from '../utils/paths';

/** Installs in this file describe what this plugin wrote, so a sweep can retire it. */
export const LEDGER = '.install-ledger.json';
/** A ledger that outgrows this is refused rather than truncated. */
export const MAX_LEDGER_ENTRIES = 5000;
/** One ledger entry is small, so this bound is about damaged files, not size. */
export const MAX_LEDGER_BYTES = 65536;

export interface LedgerEntry {
	skill: string;
	runtime: RuntimeName;
	/** The target as the user wrote it, so a report can name a path they know. */
	target: string;
	/** The digest the copy had at install time. */
	fingerprint: string;
	installedAt: string;
}

/** Why a copy is kept rather than retired. */
export type OrphanReason = 'unknown-copy' | 'edited' | 'read-failed';

export interface OrphanCandidate {
	/** The path as the scan spelled it, so the user can open it. */
	path: string;
	skill: string;
	/** The digest the install recorded, so a report can show what was expected. */
	fingerprint: string;
	/** Why the copy is kept rather than removed. Null means it is removable. */
	reason: OrphanReason | null;
	/** The target spelling the install recorded, so a report can name it. */
	target: string | null;
}

export interface OrphanScan {
	/** Orphans the ledger names as this plugin's work. */
	candidates: OrphanCandidate[];
	/** The subset whose tree still matches the entry: safe to remove. */
	sweepable: OrphanCandidate[];
	/** The subset kept back because the tree changed or could not be read. */
	kept: OrphanCandidate[];
}

interface ParsedLedger {
	version: number;
	entries: LedgerEntry[];
}

function ledgerPath(store?: string): string | null {
	return store ? path.join(store, LEDGER) : null;
}

/** Reads the ledger. A missing or damaged one reads as empty, never as an error. */
export async function readLedger(store?: string): Promise<LedgerEntry[]> {
	const file = ledgerPath(store);
	if (!file) return [];
	let stat;
	try { stat = await fs.lstat(file); } catch { return []; }
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LEDGER_BYTES) return [];
	let parsed: unknown;
	try { parsed = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
	if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ParsedLedger).entries)) return [];
	const entries: LedgerEntry[] = [];
	for (const item of (parsed as ParsedLedger).entries) {
		if (!item || typeof item !== 'object') continue;
		const entry = item as Partial<LedgerEntry>;
		const runtime = RUNTIME_NAMES.find((name) => name === entry.runtime);
		if (!runtime || typeof entry.skill !== 'string' || !entry.skill || entry.skill !== path.basename(entry.skill)) continue;
		if (typeof entry.target !== 'string' || !entry.target) continue;
		if (typeof entry.fingerprint !== 'string' || typeof entry.installedAt !== 'string') continue;
		entries.push({ skill: entry.skill, runtime, target: entry.target, fingerprint: entry.fingerprint, installedAt: entry.installedAt });
	}
	return entries.slice(0, MAX_LEDGER_ENTRIES);
}

async function writeLedger(store: string, entries: LedgerEntry[]): Promise<void> {
	await fs.mkdir(store, { recursive: true });
	const file = path.join(store, LEDGER);
	const temporary = path.join(store, `.${LEDGER}.${process.pid}.tmp`);
	await fs.writeFile(temporary, `${JSON.stringify({ version: 1, entries }, null, '\t')}\n`, { flag: 'wx' });
	try {
		await fs.rename(temporary, file);
	} finally {
		await fs.unlink(temporary).catch(() => undefined);
	}
}

/** Records one installed copy. Re-installing the same target replaces its entry. */
export async function recordInstall(store: string | undefined, entry: LedgerEntry): Promise<void> {
	if (!store) return;
	// One entry per skill and runtime, keyed by the skill rather than the target:
	// the target may be a symlinked spelling that never matches textually, and a
	// second entry for the same copy would hide the real one from a sweep.
	const entries = (await readLedger(store)).filter((item) => !(item.runtime === entry.runtime && item.skill === entry.skill));
	entries.push(entry);
	await writeLedger(store, entries);
}

/** Drops the entry for one target. A missing entry is not an error. */
export async function forgetInstall(store: string | undefined, runtime: RuntimeName, target: string): Promise<void> {
	if (!store) return;
	const entries = await readLedger(store);
	const skill = path.basename(target);
	const remaining = entries.filter((item) => !(item.runtime === runtime && (item.skill === skill || item.target === target)));
	if (remaining.length !== entries.length) await writeLedger(store, remaining);
}

/**
 * The digest of a tree's file hashes.
 *
 * `inspectInstall` reports exactly this value, so a ledger entry and the directory
 * it describes can be compared without a marker file inside the copy: any extra
 * file would itself change the hash and make every install read as drift forever.
 */
export function packageDigest(hashes: Record<string, string>): string {
	const content = JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
	return createHash('sha256').update(content).digest('hex');
}

/**
 * The digest a successful install records for a package.
 *
 * A staged copy is verified with `inspectInstall` before the swap, so its
 * fingerprint is exactly what the installed tree reports afterwards. That is
 * what makes a ledger entry comparable to the directory it describes.
 */
export function bundleDigest(bundle: SkillBundle): string {
	return packageDigest(fileHashes(bundle.files));
}

/** Whether two spellings name the same directory. */
export async function sameDirectory(left: string, right: string): Promise<boolean> {
	if (left === right) return true;
	return await existingRealPath(left) === await existingRealPath(right);
}

/** Whether a copy still holds what the install recorded, and whether it could be read. */
async function copyMatches(directory: string, fingerprint: string): Promise<[matches: boolean, readable: boolean]> {
	try {
		const actual = packageDigest(fileHashes(await readPackageTree(directory, false, true)));
		return [actual === fingerprint, true];
	} catch {
		return [false, false];
	}
}

/**
 * The ledger entry that owns a copy.
 *
 * An entry is keyed by skill and runtime, so the name decides ownership and the
 * target only has to agree that this is the same agent folder. That matters when
 * the parent is a symlinked spelling: comparing target text would miss, and
 * falling back to "anything inside the target" would let one skill's entry claim
 * another's copy.
 */
async function findEntry(ledger: LedgerEntry[], runtime: RuntimeName, directory: string, skill: string, targets: string[]): Promise<LedgerEntry | null> {
	const own = ledger.filter((entry) => entry.runtime === runtime && entry.skill === skill);
	for (const entry of own) if (await sameDirectory(entry.target, directory)) return entry;
	const real = await existingRealPath(directory);
	for (const entry of own) {
		for (const target of targets) {
			if (!isInside(target, directory)) continue;
			const realTarget = await existingRealPath(target);
			if (real.startsWith(realTarget + path.sep)) return entry;
		}
	}
	return null;
}

/**
 * Finds installed directories whose skill left the source.
 *
 * A directory is only removable when the ledger says this plugin installed it and
 * the tree still matches the recorded fingerprint: a copy the user has edited
 * since, or wrote by hand, is reported as a candidate but never removed.
 */
export async function findOrphans(options: {
	store?: string;
	entries: string[];
	runtime: RuntimeName;
	/** Installed copies this source still lists, so a live skill is never retired. */
	live: ReadonlySet<string>;
	/** Every target spelling the ledger holds, so a symlinked parent still matches. */
	targets: string[];
}): Promise<OrphanScan> {
	const ledger = options.store ? await readLedger(options.store) : [];
	const live = new Set<string>();
	for (const directory of options.live) live.add(await existingRealPath(directory));
	const claimed: OrphanCandidate[] = [];
	for (const entry of options.entries) {
		const resolved = await existingRealPath(entry);
		// A skill the manifest still installs is not an orphan, whatever the
		// ledger says. This is the guard that keeps a rename from retiring a copy.
		if (live.has(resolved)) continue;
		const stat = await fs.lstat(entry).catch(() => null);
		if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) continue;
		// A directory without SKILL.md is not a skill copy, even if the ledger
		// once named it: half a tree is never a safe thing to remove.
		if (!await exists(path.join(entry, 'SKILL.md'))) continue;
		const skill = path.basename(entry);
		const recorded = await findEntry(ledger, options.runtime, entry, skill, options.targets);
		// Only the ledger can name a directory as this plugin's own work.
		if (!recorded) continue;
		const own = await copyMatches(entry, recorded.fingerprint);
		claimed.push({
			path: entry,
			skill,
			fingerprint: recorded.fingerprint,
			reason: !own[1] ? 'read-failed' : own[0] ? null : 'edited',
			target: recorded.target,
		});
	}
	const sweepable = claimed.filter((candidate) => candidate.reason === null);
	const kept = claimed.filter((candidate) => candidate.reason !== null);
	return { candidates: claimed, sweepable, kept };
}