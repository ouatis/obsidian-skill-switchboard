import type { Strings } from '../i18n';
import type { TargetCheck } from '../sync/adapter-run';
import { planInstalls } from '../sync/install-plan';

/** Describe the checked scope, including entries that will stay untouched. */
export function repairPlanDetails(checks: TargetCheck[], strings: Strings): string {
	return checks.map((check) => {
		const native = check.result.native;
		const label = check.target.label || check.target.runtime;
		const installs = native?.kind !== 'error' ? native?.installs : undefined;
		const plan = installs ? planInstalls(installs) : null;
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
			if (!plan.writes) lines.push(strings.installPlanNoWrites);
		} else if (check.result.status === 'failed') lines.push(check.result.output);
		return lines.filter(Boolean).join('\n');
	}).join('\n\n');
}
