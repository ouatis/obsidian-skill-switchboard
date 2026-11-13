import type { SkillInstallCheck } from './native-check';

export type InstallAction = 'install' | 'update' | 'blocked' | 'current';
export type InstallCounts = Record<InstallAction, number>;
export interface InstallPlan {
	groups: Record<InstallAction, SkillInstallCheck[]>;
	counts: InstallCounts;
	writes: number;
}

/** A plan describes checked copies, not unique source skills or execution readiness. */
export function planInstalls(installs: readonly SkillInstallCheck[]): InstallPlan {
	const groups: InstallPlan['groups'] = { install: [], update: [], blocked: [], current: [] };
	for (const item of installs) {
		let action: InstallAction;
		if (item.state === 'missing') action = 'install';
		else action = item.state;
		groups[action].push(item);
	}
	const counts: InstallCounts = {
		install: groups.install.length, update: groups.update.length, blocked: groups.blocked.length, current: groups.current.length,
	};
	return { groups, counts, writes: counts.install + counts.update };
}
