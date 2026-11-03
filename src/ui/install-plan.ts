import type { Strings } from '../i18n';
import type { TargetCheck } from '../sync/adapter-run';
import { planInstalls } from '../sync/install-plan';

/** Problems open first; healthy copies stay available without dominating the panel. */
export function renderInstallPlans(container: HTMLElement, checks: TargetCheck[], strings: Strings): void {
	const checked = checks.filter((check) => check.result.native?.kind !== 'error' && check.result.native?.installs?.length);
	if (!checked.length) return;
	const section = container.createDiv('skill-switchboard-install-plan');
	section.createEl('h3', { text: strings.installPlanTitle });
	section.createDiv({ text: strings.installPlanDescription, cls: 'skill-switchboard-evidence-note' });
	for (const check of checked) {
		const plan = planInstalls(check.result.native?.installs ?? []);
		const target = section.createEl('details', { cls: 'skill-switchboard-details' });
		target.open = plan.counts.blocked > 0;
		target.createEl('summary', { text: `${check.target.label.trim() || check.target.runtime} · ${strings.installPlanCounts(plan.counts)}` });
		const body = target.createDiv('skill-switchboard-resource-details');
		for (const action of ['blocked', 'install', 'update', 'current'] as const) {
			const items = plan.groups[action];
			if (!items.length) continue;
			const group = body.createEl('details', { cls: 'skill-switchboard-details' });
			group.setAttribute('data-install-group', action);
			group.open = action === 'blocked';
			group.createEl('summary', { text: `${strings.installAction(action)} · ${items.length}` });
			for (const item of items) {
				const row = group.createDiv('skill-switchboard-plan-item');
				row.createEl('strong', { text: `${item.name} · ${strings.installState(item.state)}` });
				if (action === 'blocked') row.createDiv({ text: item.detail, cls: 'skill-switchboard-evidence-note' });
				if (item.path) row.createDiv({ text: item.path, cls: 'skill-switchboard-path' });
			}
		}
	}
}
