import type { Strings } from '../i18n';
import type { TargetCheck } from '../sync/adapter-run';
import { planInstalls } from '../sync/install-plan';

/**
 * Describe the checked scope, including entries that will stay untouched.
 *
 * The orphan section is deliberately separate from the install counts: the plan
 * is about what the source installs, this is about what the source no longer
 * installs but the ledger still owns. Only sweepable copies are counted as work;
 * a kept copy is shown with its reason so it reads as "reported, not removed".
 */
export function repairPlanDetails(checks: TargetCheck[], strings: Strings): string {
	return checks.map((check) => {
		const native = check.result.native;
		const label = check.target.label || check.target.runtime;
		const installs = native?.kind !== 'error' ? native?.installs : undefined;
		const plan = installs ? planInstalls(installs) : null;
		const orphans = native?.kind !== 'error' ? native?.orphanEntries ?? [] : [];
		const sweepable = orphans.filter((entry) => entry.reason === null);
		const kept = orphans.filter((entry) => entry.reason !== null);
		const heading = `${label} · ${plan ? strings.installPlanCounts(plan.counts) : check.result.status === 'passed' ? strings.distributionClean : check.repairable ? strings.distributionDrift : strings.distributionUnavailable}`;
		const lines = [heading, check.targetPath || check.target.path];
		if (plan) {
			for (const action of ['install', 'update', 'blocked'] as const) {
				for (const item of plan.groups[action]) {
					lines.push(`${strings.installAction(action)} · ${item.name}`);
					if (action === 'blocked') lines.push(item.detail);
					if (item.path) lines.push(item.path);
				}
			}
		}
		// The retirement paragraph goes above the rows it explains: the rows are
		// evidence, so the summary should be read before the paths.
		if (sweepable.length) lines.push(strings.orphanConfirm(sweepable.length));
		for (const entry of sweepable) lines.push(`${strings.orphanRetire} · ${entry.skill}${entry.target ? ` · ${entry.target}` : ''}`);
		for (const entry of kept) lines.push(`${strings.orphanKept} · ${entry.skill} · ${strings.orphanReasonEdited(entry.reason ?? 'unknown-copy')}`);
		// A target with no writes and no retirement is clean; saying "no writes"
		// for a target that is about to remove copies would read backwards.
		if (plan && !plan.writes && !sweepable.length) lines.push(strings.installPlanNoWrites);
		else if (!plan && check.result.status === 'failed') lines.push(check.result.output);
		return lines.filter(Boolean).join('\n');
	}).join('\n\n');
}

/**
 * How many copies the confirmation is about to remove, across every target.
 * Zero means the paragraph is left out rather than saying "0 copies".
 */
export function orphanConfirmCount(checks: TargetCheck[]): number {
	return checks.reduce((count, check) => {
		const orphans = check.result.native?.kind === 'error' ? [] : check.result.native?.orphanEntries ?? [];
		return count + orphans.filter((entry) => entry.reason === null).length;
	}, 0);
}
