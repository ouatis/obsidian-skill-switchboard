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

/** A compact answer to the only question users need after opening the board: what needs attention? */
export function renderAttentionSummary(container: HTMLElement, strings: Strings, options: AttentionSummaryOptions): void {
	const section = container.createDiv('ssb-attention');
	const heading = section.createDiv('ssb-attention-heading');
	const title = heading.createDiv('ssb-attention-title');
	setIcon(title.createSpan('ssb-attention-icon'), options.checksStale ? 'clock-3' : 'scan-line');
	title.createEl('h2', { text: strings.attentionTitle });

	const body = section.createDiv('ssb-attention-body');
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
	body.addClass(`is-${status}`);
	body.createDiv({ text: message, cls: 'ssb-attention-message' });

	if (!options.checksStale && options.targetChecks.length) {
		const metrics = body.createDiv('ssb-attention-metrics');
		attentionMetric(metrics, counts.install, strings.attentionInstall, 'download');
		attentionMetric(metrics, counts.update, strings.attentionOverwrite, 'replace');
		attentionMetric(metrics, blocked, strings.attentionBlocked, 'alert-triangle');
	}
	if (writes && !options.checksStale) {
		const repair = body.createEl('button', { cls: 'ssb-attention-repair' });
		repair.setAttribute('type', 'button');
		setIcon(repair.createSpan('ssb-attention-repair-icon'), 'wrench');
		repair.createSpan({ text: strings.repairAllAdapters });
		repair.addEventListener('click', options.onRepair);
	}

	const automation = section.createDiv('ssb-attention-automation');
	setIcon(automation.createSpan('ssb-attention-automation-icon'), options.autoDistribute ? 'zap' : 'pause');
	automation.createSpan({ text: options.autoDistribute ? strings.attentionAutoOn : strings.attentionAutoOff });
}

function attentionMetric(container: HTMLElement, value: number, label: string, icon: string): void {
	const metric = container.createDiv('ssb-attention-metric');
	setIcon(metric.createSpan('ssb-attention-metric-icon'), icon);
	metric.createSpan({ text: String(value), cls: 'ssb-attention-metric-value' });
	metric.createSpan({ text: label, cls: 'ssb-attention-metric-label' });
}
