import { createHash } from 'node:crypto';
import type { ManifestCheckResult, SyncManifestSnapshot } from '../sync-provider';
import { sameSourceSnapshot } from './manifest';
import type { AdapterRun, RepairSummary } from './adapter-run';
import type { AutomaticScope } from './automatic-scope';

export const AUTOMATIC_QUIET_MS = 2000;
interface AutomaticHost {
	enabled: () => boolean;
	consent: () => string;
	busy: () => boolean;
	scope: () => Promise<AutomaticScope>;
	inspect: () => Promise<ManifestCheckResult>;
	requestCheck: () => void;
	revoke: () => Promise<void>;
	repair: (snapshot: SyncManifestSnapshot, current: () => boolean) => Promise<RepairSummary | null>;
	failure: (output: string) => void;
}

/** Only background checks enter this queue. Manual checks remain read-only. */
export class AutomaticDistribution {
	private timer: number | null = null;
	private generation = 0;
	private lastAttempt = '';
	private lastFailure = '';
	constructor(private readonly host: AutomaticHost) {}
	cancel(): void {
		this.generation++;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}
	reset(): void { this.cancel(); this.lastAttempt = ''; this.lastFailure = ''; }
	async validate(): Promise<boolean> {
		if (!this.host.enabled()) return false;
		const consent = this.host.consent();
		try {
			const scope = await this.host.scope();
			if (this.host.enabled() && this.host.consent() === consent && consent && consent === scope.key) return true;
		} catch { /* An invalid or redirected scope cannot retain write authorization. */ }
		if (this.host.enabled() && this.host.consent() === consent) { this.cancel(); await this.host.revoke(); }
		return false;
	}
	consider(run: AdapterRun): void {
		this.cancel();
		if (!this.host.enabled()) return;
		const generation = this.generation;
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.apply(run, generation).catch((error: unknown) => this.report(String(error)));
		}, AUTOMATIC_QUIET_MS);
	}
	private report(output: string, key = output): void {
		if (!this.host.enabled() || key === this.lastFailure) return;
		this.lastFailure = key;
		this.host.failure(output);
	}
	private async apply(run: AdapterRun, generation: number): Promise<void> {
		const consent = this.host.consent();
		const current = () => generation === this.generation && this.host.enabled() && this.host.consent() === consent;
		if (!current() || this.host.busy() || !await this.validate() || !current()) return;
		if (run.result.status === 'passed') { this.lastFailure = ''; this.lastAttempt = ''; return; }
		// A quiet interval alone is not enough: re-read the whole package snapshot.
		const fresh = await this.host.inspect();
		if (!current()) return;
		const stable = run.manifest.snapshot && fresh.snapshot ? sameSourceSnapshot(run.manifest.snapshot, fresh.snapshot)
			: !run.manifest.snapshot && !fresh.snapshot && run.manifest.output === fresh.output;
		if (!stable) { this.host.requestCheck(); return; }
		const key = createHash('sha256').update(JSON.stringify({ consent, source: fresh.snapshot ?? fresh.output,
			copies: run.checks.map((check) => [check.target.id, check.result.native?.installs ?? check.result.output]) })).digest('hex');
		if (key === this.lastAttempt) return;
		this.lastAttempt = key;
		if (!fresh.snapshot) { this.report(fresh.output, key); return; }
		const result = await this.host.repair(fresh.snapshot, current);
		if (!current() || !result) return;
		if (result.repair.status === 'failed') {
			// Ignore successful-copy counts and random staging paths when deduplicating alerts.
			this.report(result.repair.output, JSON.stringify({ scope: consent,
				issues: run.checks.map((check) => {
					const detail = result.details.find((item) => item.targetId === check.target.id);
					const latest = detail?.followUp ?? check.result;
					return [check.target.id, latest.native?.installs?.filter((item) => item.state !== 'current')
						.map((item) => [item.name, item.state, item.state === 'blocked' ? item.detail : ''])
						?? (latest.status === 'failed' ? latest.output : ''),
						latest.status === 'passed' && detail?.repair.status === 'failed' ? 'incomplete-cleanup' : ''];
				}) }));
		} else { this.lastFailure = ''; this.lastAttempt = ''; }
	}
}
