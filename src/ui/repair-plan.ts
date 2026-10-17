import type { Strings } from '../i18n';
import type { TargetCheck } from '../sync/adapter-run';

/** Describe the checked scope, including entries that will stay untouched. */
export function repairPlanDetails(checks: TargetCheck[], strings: Strings): string {
	return checks.map((check) => {
		const native = check.result.native;
		const blocked = native?.blockedSkills ?? [];
		const label = check.target.label || check.target.runtime;
		const heading = native && native.kind !== 'error'
			? strings.repairPlanLine(label, native.checkedSkillCount - blocked.length, blocked.length)
			: `${label} · ${check.result.status === 'passed' ? strings.distributionClean : check.repairable ? strings.distributionDrift : strings.distributionUnavailable}`;
		return [heading, check.targetPath || check.target.path, blocked.length ? `${strings.distributionBlocked}: ${blocked.join(', ')}` : ''].filter(Boolean).join('\n');
	}).join('\n\n');
}
