import { setIcon } from 'obsidian';
import type { Strings } from '../i18n';
import type { TargetCheck } from '../sync/adapter-run';
import { planInstalls, type InstallCounts } from '../sync/install-plan';

export interface AttentionSummaryOptions {
	checksStale: boolean;
	targetChecks: TargetCheck[];
	sourceBlocked: boolean;
	resourcesBlocked: boolean;
	autoDistribute: boolean;
	onRepair: () => void;
	/** Read-only counts folded into the status line (the former stat cards). */
	stats: { skills: number; roots: number; targets: number };
	scannedAt: number;
	checkedAt: number;
}

export interface AttentionCounts extends InstallCounts {
	failedTargets: number;
}

export function attentionCounts(checks: readonly TargetCheck[]): AttentionCounts {
	const counts: AttentionCounts = { install: 0, update: 0, blocked: 0, current: 0, failedTargets: 0 };
	for (const check of checks) {
		const installs = check.result.native?.installs;
		if (installs?.length) {
			const plan = planInstalls(installs).counts;
			counts.install += plan.install;
			counts.update += plan.update;
			counts.blocked += plan.blocked;
			counts.current += plan.current;
		} else if (check.result.status === 'failed') {
			counts.failedTargets++;
		}
	}
	return counts;
}

/**
 * The one status line at the top of the view: what needs attention, the
 * read-only counts, and the automation state. Replaces the former stat cards,
 * attention heading and footer timestamp.
 */
export function renderAttentionSummary(container: HTMLElement, strings: Strings, options: AttentionSummaryOptions): void {
	const section = container.createDiv('ssb-attention');
	const line = section.createDiv('ssb-attention-body');

	const counts = attentionCounts(options.targetChecks);
	const blocked = counts.blocked + counts.failedTargets;
	const sourceBlocked = options.sourceBlocked || options.resourcesBlocked;
	const writes = counts.install + counts.update;
	let status: 'unknown' | 'warning' | 'failed' | 'passed';
	let message: string;
	if (options.checksStale || !options.targetChecks.length) {
		status = 'unknown';
		message = strings.attentionNeedsCheck;
	} else if (sourceBlocked) {
		status = 'failed';
		message = strings.attentionSourceBlocked;
	} else if (blocked) {
		status = 'failed';
		message = strings.attentionNeedsAction;
	} else if (writes) {
		status = 'warning';
		message = strings.attentionReadyToRepair;
	} else {
		status = 'passed';
		message = strings.attentionAllClear;
	}
	line.addClass(`is-${status}`);

	const pill = line.createSpan('ssb-attention-pill');
	pill.addClass(`is-${status}`);
	pill.createSpan('ssb-attention-dot');
	pill.createSpan({ text: message, cls: 'ssb-attention-message' });

	const stats = line.createSpan('ssb-attention-stats');
	stats.setText(
		`${options.stats.skills} ${strings.skills} · ${options.stats.roots} ${strings.roots} · ${options.stats.targets} ${strings.targets}`,
	);

	if (!options.checksStale && options.targetChecks.length) {
		const metrics = line.createSpan('ssb-attention-metrics');
		attentionMetric(metrics, counts.install, strings.attentionInstall, 'download');
		attentionMetric(metrics, counts.update, strings.attentionOverwrite, 'replace');
		attentionMetric(metrics, blocked, strings.attentionBlocked, 'alert-triangle');
	}

	const actions = line.createDiv('ssb-attention-actions');
	const automation = actions.createSpan('ssb-attention-automation');
	setIcon(automation.createSpan('ssb-attention-automation-icon'), options.autoDistribute ? 'zap' : 'pause');
	automation.createSpan({ text: options.autoDistribute ? strings.attentionAutoOn : strings.attentionAutoOff });
	if (writes && !options.checksStale) {
		const repair = actions.createEl('button', { cls: 'ssb-attention-repair' });
		repair.setAttribute('type', 'button');
		repair.setAttribute('aria-label', strings.repairAllAdapters);
		setIcon(repair.createSpan('ssb-attention-repair-icon'), 'wrench');
		repair.createSpan({ text: strings.repairAllAdapters });
		repair.addEventListener('click', options.onRepair);
	}

	const meta = section.createDiv('ssb-attention-meta');
	const parts = [strings.readOnlyScan, `${strings.indexedAtLabel} ${new Date(options.scannedAt).toLocaleString()}`];
	if (options.checkedAt) parts.push(`${strings.checkedAtLabel} ${new Date(options.checkedAt).toLocaleString()}`);
	meta.setText(parts.join(' · '));
}

function attentionMetric(container: HTMLElement, value: number, label: string, icon: string): void {
	const metric = container.createDiv('ssb-attention-metric');
	metric.setAttribute('aria-label', `${label}: ${value}`);
	setIcon(metric.createSpan('ssb-attention-metric-icon'), icon);
	metric.createSpan({ text: String(value), cls: 'ssb-attention-metric-value' });
	metric.createSpan({ text: label, cls: 'ssb-attention-metric-label' });
}
