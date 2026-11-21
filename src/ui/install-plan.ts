import type { Strings } from '../i18n';
import type { TargetCheck } from '../sync/adapter-run';
import type { SkillDriftDiff } from '../sync/drift-diff';
import { planInstalls } from '../sync/install-plan';

function renderDriftDiff(container: HTMLElement, skillName: string, diff: SkillDriftDiff, strings: Strings): void {
	const counts = { added: diff.added.length, removed: diff.removed.length, modified: diff.modified.length };
	if (!counts.added && !counts.removed && !counts.modified) return;
	const details = container.createEl('details', { cls: 'skill-switchboard-details skill-switchboard-diff-details' });
	details.setAttribute('data-drift-diff', skillName);
	details.createEl('summary', { text: strings.driftDiffSummary(counts) });
	const body = details.createDiv('skill-switchboard-diff-body');
	const files = body.createDiv('skill-switchboard-diff-files');
	for (const filePath of diff.modified) {
		files.createDiv({ text: `~ ${filePath} (${strings.diffFileStatus('modified')})`, cls: 'skill-switchboard-diff-file is-modified' });
	}
	for (const filePath of diff.added) {
		files.createDiv({ text: `+ ${filePath} (${strings.diffFileStatus('added')})`, cls: 'skill-switchboard-diff-file is-added' });
	}
	for (const filePath of diff.removed) {
		files.createDiv({ text: `- ${filePath} (${strings.diffFileStatus('removed')})`, cls: 'skill-switchboard-diff-file is-removed' });
	}
	if (diff.skillMdDiff) {
		body.createDiv({ text: strings.diffSkillHeading, cls: 'skill-switchboard-diff-heading' });
		if (diff.skillMdDiff.omittedReason) {
			body.createDiv({ text: strings.diffOmitted(diff.skillMdDiff.omittedReason), cls: 'skill-switchboard-evidence-note' });
		} else if (diff.skillMdDiff.lines.length > 0) {
			const preview = body.createDiv('skill-switchboard-diff-preview');
			for (const line of diff.skillMdDiff.lines) {
				const prefix = line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  ';
				preview.createDiv({ text: `${prefix}${line.text}`, cls: `skill-switchboard-diff-line is-${line.kind}` });
			}
			if (diff.skillMdDiff.truncated) {
				body.createDiv({ text: strings.diffTruncated, cls: 'skill-switchboard-evidence-note' });
			}
		}
	}
}

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
				if (action === 'update' && item.diff) renderDriftDiff(row, item.name, item.diff, strings);
			}
		}
	}
}

/**
 * Copies whose source skill is gone.
 *
 * These are the only copies a repair removes, so they are shown separately from
 * the install plan: the plan is about what the source installs, this is about
 * what the source no longer installs but the ledger still owns.
 */
export function renderOrphanPlan(container: HTMLElement, checks: TargetCheck[], strings: Strings): void {
	const rows = checks.flatMap((check) => {
		const sweepable = check.result.native?.orphanCandidates ?? [];
		const kept = (check.result.native?.orphanEntries ?? []).filter((entry) => entry.reason !== null);
		if (!sweepable.length && !kept.length) return [];
		const label = check.target.label.trim() || check.target.runtime;
		return [{ label, sweepable, kept }];
	});
	if (!rows.length) return;
	const section = container.createDiv('skill-switchboard-install-plan');
	section.setAttribute('data-install-group', 'orphan');
	section.createEl('h3', { text: strings.orphanPlanTitle });
	section.createDiv({ text: strings.orphanPlanDescription, cls: 'skill-switchboard-evidence-note' });
	for (const row of rows) {
		const details = section.createEl('details', { cls: 'skill-switchboard-details' });
		details.open = row.sweepable.length > 0;
		// A target with nothing to remove still lists the copies it kept, so the
		// summary counts what is actually there rather than saying "retire 0".
		const summary = row.sweepable.length
			? `${row.label} · ${strings.orphanRetire} ${row.sweepable.length}`
			: `${row.label} · ${strings.orphanKept} ${row.kept.length}`;
		details.createEl('summary', { text: summary });
		const body = details.createDiv('skill-switchboard-resource-details');
		for (const candidate of row.sweepable) {
			const item = body.createDiv('skill-switchboard-plan-item');
			item.createEl('strong', { text: `${candidate.skill} · ${strings.orphanRetire}` });
			if (candidate.target) item.createDiv({ text: candidate.target, cls: 'skill-switchboard-evidence-note' });
			if (candidate.path) item.createDiv({ text: candidate.path, cls: 'skill-switchboard-path' });
		}
		for (const candidate of row.kept) {
			const item = body.createDiv('skill-switchboard-plan-item');
			const reason = candidate.reason ?? 'unknown-copy';
			item.createEl('strong', { text: `${candidate.skill} · ${strings.orphanKept} · ${strings.orphanReasonEdited(reason)}` });
			if (candidate.path) item.createDiv({ text: candidate.path, cls: 'skill-switchboard-path' });
		}
	}
}