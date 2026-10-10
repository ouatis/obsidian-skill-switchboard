import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdapterCheckResult } from './result';
import type { RuntimeName } from '../types';
import { isInside, type SyncManifestSnapshot } from './manifest';
import {
	agentMetadataFor,
	commandFor,
	loadRuntimeSkills,
	wrapperFor,
} from './templates';
import {
	existingRealPath,
	pathExists,
	readBytes,
	readText,
	walkFiles,
} from './filesystem';
import { referencedSharedFiles } from './native-check';

export interface NativeRepairResult extends AdapterCheckResult {
	writtenFiles: number;
	replacedDirectories: number;
	backupPath?: string;
}

export interface NativeRepairOptions {
	/** Test-only override; production follows OPENCODE_CONFIG like the Python adapter. */
	opencodeCommandsDir?: string;
	/** Test-only override so isolated fixtures never create a backup in the live vault. */
	backupRoot?: string;
}

export async function repairRuntimeNative(
	vaultPath: string,
	runtime: RuntimeName,
	targetPath: string,
	snapshot: SyncManifestSnapshot,
	options: NativeRepairOptions = {},
): Promise<NativeRepairResult> {
	const state = new RepairState(snapshot.vaultPath, snapshot.sharedRoot, targetPath, runtime, options.backupRoot);
	try {
		const resolvedTarget = await state.assertOutsideVault(targetPath);
		const skills = loadRuntimeSkills(snapshot, runtime);
		const commandRoot = runtime === 'opencode'
			? path.resolve(options.opencodeCommandsDir ?? defaultOpenCodeCommandsDir())
			: undefined;
		if (commandRoot) await state.assertOutsideVault(commandRoot);

		for (const skill of skills) {
			const categoryRoot = runtime === 'hermes' ? path.join(resolvedTarget, skill.category) : resolvedTarget;
			const skillDir = await existingRealPath(path.join(categoryRoot, skill.name));
			await state.assertOutsideVault(skillDir);
			const wrapperPath = runtime === 'dsh'
				? path.join(resolvedTarget, `${skill.name}.md`)
				: path.join(skillDir, 'SKILL.md');
			await state.syncText(wrapperPath, wrapperFor(skill, runtime, snapshot));

			if (runtime === 'hermes') {
				await state.syncHermesReferences(skillDir, await referencedSharedFiles(skill.sharedPath, snapshot.sharedRoot));
			} else if (runtime === 'codex') {
				await state.syncText(path.join(skillDir, 'agents', 'openai.yaml'), agentMetadataFor(skill));
			} else if (runtime === 'opencode' && commandRoot) {
				await state.syncText(path.join(commandRoot, `${skill.name}.md`), commandFor(skill));
			}
		}

		return await state.successResult();
	} catch (error) {
		return await state.failureResult(error instanceof Error ? error.message : String(error));
	}
}

class RepairState {
	private backupRoot?: string;
	private backupIndex: Array<{ source: string; backup: string }> = [];
	private backupNumber = 0;
	writtenFiles = 0;
	replacedDirectories = 0;

	constructor(
		private readonly vaultPath: string,
		private readonly sharedRoot: string,
		private readonly targetPath: string,
		private readonly runtime: RuntimeName,
		backupRoot?: string,
	) {
		this.backupRoot = backupRoot;
	}

	async assertOutsideVault(candidate: string): Promise<string> {
		const resolved = await existingRealPath(candidate);
		if (isInside(this.vaultPath, resolved)) {
			throw new Error(`Native repair refused a target inside the vault: ${resolved}`);
		}
		return resolved;
	}

	async syncText(filePath: string, expected: string): Promise<void> {
		await this.assertOutsideVault(filePath);
		if (await pathExists(filePath) && await readText(filePath) === expected) return;
		await this.backupExisting(filePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, expected, 'utf8');
		this.writtenFiles += 1;
	}

	async syncHermesReferences(skillDir: string, references: string[]): Promise<void> {
		const referencesDir = path.join(skillDir, 'references');
		const expected = references.map((source) => ({
			source,
			target: path.join(skillDir, path.relative(this.vaultSharedRoot, source)),
		}));
		const installed = await walkFiles(referencesDir);
		let changed = installed.length !== expected.length;
		if (!changed) {
			for (const item of expected) {
				if (!(await pathExists(item.target)) || !(await readBytes(item.target)).equals(await readBytes(item.source))) {
					changed = true;
					break;
				}
			}
		}
		if (!changed) return;

		await this.assertOutsideVault(referencesDir);
		await this.backupExisting(referencesDir);
		await fs.rm(referencesDir, { recursive: true, force: true });
		this.replacedDirectories += 1;
		for (const item of expected) {
			await this.assertOutsideVault(item.target);
			await fs.mkdir(path.dirname(item.target), { recursive: true });
			await fs.copyFile(item.source, item.target);
			this.writtenFiles += 1;
		}
	}

	private get vaultSharedRoot(): string {
		return this.sharedRoot;
	}

	private async backupExisting(source: string): Promise<void> {
		if (!(await pathExists(source))) return;
		if (!this.backupRoot) {
			const stamp = new Date().toISOString().replace(/[.:]/g, '-');
			this.backupRoot = path.join(
				this.vaultPath,
				'.skill-switchboard-repair-backups',
				`${stamp}-${this.runtime}`,
			);
		}
		await fs.mkdir(this.backupRoot, { recursive: true });
		const backupName = `${String(this.backupNumber).padStart(4, '0')}-${path.basename(source) || 'root'}`;
		this.backupNumber += 1;
		const destination = path.join(this.backupRoot, backupName);
		await fs.cp(source, destination, { recursive: true, force: true });
		this.backupIndex.push({ source, backup: destination });
	}

	async successResult(): Promise<NativeRepairResult> {
		await this.writeBackupIndex();
		const backupNote = this.backupRoot ? ` Backup: ${this.backupRoot}` : '';
		return {
			status: 'passed',
			output: `[native repair] PASS\nWrote ${this.writtenFiles} file(s) and replaced ${this.replacedDirectories} reference director${this.replacedDirectories === 1 ? 'y' : 'ies'}.${backupNote}`,
			exitCode: 0,
			writtenFiles: this.writtenFiles,
			replacedDirectories: this.replacedDirectories,
			backupPath: this.backupRoot,
		};
	}

	async failureResult(message: string): Promise<NativeRepairResult> {
		await this.writeBackupIndex();
		return {
			status: 'failed',
			output: `[native repair] FAIL\n${message}${this.backupRoot ? `\nBackup: ${this.backupRoot}` : ''}`,
			exitCode: 1,
			writtenFiles: this.writtenFiles,
			replacedDirectories: this.replacedDirectories,
			backupPath: this.backupRoot,
		};
	}

	private async writeBackupIndex(): Promise<void> {
		if (!this.backupRoot || this.backupIndex.length === 0) return;
		await fs.writeFile(
			path.join(this.backupRoot, 'backup-index.json'),
			JSON.stringify({ runtime: this.runtime, target: this.targetPath, entries: this.backupIndex }, null, 2),
			'utf8',
		);
	}
}

function defaultOpenCodeCommandsDir(): string {
	const configured = process.env.OPENCODE_CONFIG;
	const root = configured ? expandHome(configured) : path.join(os.homedir(), '.config', 'opencode');
	return path.join(root, 'commands');
}

function expandHome(value: string): string {
	return value === '~' ? os.homedir() : /^~[\\/]/.test(value) ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}
