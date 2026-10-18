import { setIcon } from 'obsidian';
import type { Strings } from '../i18n';
import type { RepairSummary, TargetCheck } from '../sync/adapter-run';
import type { AdapterCheckResult } from '../sync/result';
import type { ManifestCheckResult } from '../sync-provider';
import { repairTotals } from './repair-summary';
import { renderInstallPlans } from './install-plan';

export interface AdapterStatusState {
	checksStale: boolean;
	targetCheckedAt: number;
	adapterCheck: AdapterCheckResult | null;
	adapterCheckRunning: boolean;
	targetChecks: TargetCheck[];
	manifestCheck: ManifestCheckResult | null;
	adapterRepair: AdapterCheckResult | null;
	adapterRepairRunning: boolean;
	lastRepairSummary: RepairSummary | null;
}

/** Render read-only check and repair evidence without coupling it to the view lifecycle. */
export function renderAdapterStatus(
	contentEl: HTMLElement,
	state: AdapterStatusState,
	strings: Strings,
	onCopyOutput: (output: string) => Promise<void>,
): void {
	const check = state.adapterCheck;
	const checkRunning = state.adapterCheckRunning;
	const repair = state.adapterRepair;
	const repairRunning = state.adapterRepairRunning;
	const section = contentEl.createDiv('skill-switchboard-check');
	if (!state.checksStale) {
		renderInstallPlans(section, state.targetChecks, strings);
		const found = state.targetChecks.flatMap((check) => check.result.native?.unmanagedEntries ?? []);
		if (found.length) {
			const details = section.createEl('details');
			details.createEl('summary', { text: `${strings.foundUnmanaged} · ${found.length}` });
			for (const entry of found) details.createDiv({ text: entry, cls: 'skill-switchboard-path' });
		}
	}
	if (state.checksStale && !checkRunning && !repairRunning) {
		renderStatusRow(section, state.targetCheckedAt ? strings.checksStale : strings.checkNotYet, 'unknown', 'clock');
	}
	if (checkRunning || check) {
		const passed = check?.status === 'passed' || (state.targetChecks.length > 0 && state.targetChecks.every((item) => item.result.status === 'passed'));
		const text = checkRunning
			? strings.adapterCheckRunning
			: passed
				? strings.adapterCheckPassed
				: strings.adapterCheckFailed(check?.exitCode ?? 1);
		renderStatusRow(section, text, checkRunning ? 'running' : passed ? 'passed' : 'failed', checkRunning ? 'scan-line' : passed ? 'check-circle' : 'alert-triangle');
		if (check?.output && !passed) {
			renderOutputBlock(section, strings, strings.adapterCheckOutput, check.output, onCopyOutput);
		}
	}
	const resources = state.manifestCheck?.resources;
	if (resources && !state.checksStale) {
		const text = resources.status === 'failed' ? strings.resourcesFailed : resources.status === 'warning' ? strings.resourcesWarning
			: resources.packages.length ? strings.resourcesComplete(resources.packages.length, resources.packages.reduce((count, item) => count + item.verifiedFiles, 0)) : strings.resourcesNone;
		renderStatusRow(section, `${strings.resourcesLabel} · ${text}`, resources.status === 'failed' ? 'failed' : resources.status === 'warning' ? 'warning' : 'passed', resources.status === 'passed' ? 'package-check' : 'package-search');
		if (resources.status === 'failed') section.createDiv({ text: strings.sourceResourcesBlocked, cls: 'skill-switchboard-evidence-note' });
		if (resources.packages.length) {
			const details = section.createEl('details', { cls: 'skill-switchboard-details' });
			details.createEl('summary', { text: strings.resourceDetails, cls: 'skill-switchboard-check-label' });
			const body = details.createDiv('skill-switchboard-resource-details');
			for (const item of resources.packages) {
				body.createEl('strong', { text: `${item.skill} · ${item.verifiedFiles}/${item.files}` });
				if (item.location === 'external') body.createDiv({ text: strings.externalPackageStorage, cls: 'skill-switchboard-evidence-note' });
				body.createDiv({ text: item.path, cls: 'skill-switchboard-path' });
				for (const issue of item.issues.slice(0, 30)) body.createDiv({ text: `${strings.resourceIssue(issue.code)} · ${issue.path}` });
				if (item.issues.length > 30) body.createDiv({ text: strings.moreLines(item.issues.length - 30) });
			}
		}
	}
	section.createDiv({ text: `${strings.crossDeviceLabel} · ${strings.crossDeviceUnverified}`, cls: 'skill-switchboard-evidence-note' });

	if (repairRunning || repair) {
		const passed = repair?.status === 'passed';
		const summary = state.lastRepairSummary;
		const totals = summary ? repairTotals(summary) : null;
		const text = repairRunning
			? strings.repairAllRunning
			: passed
				? totals?.targets ? strings.repairSummary(totals.targets, totals.skills, totals.files) : strings.repairAllNoDrift
				: summary && !summary.aborted && totals ? strings.repairPartial(totals.files, summary.failedCount) : strings.adapterCheckFailed(repair?.exitCode ?? 1);
		renderStatusRow(section, repairRunning ? text : `${strings.lastRepairResult} · ${text}`, repairRunning ? 'running' : state.checksStale ? 'unknown' : passed ? 'passed' : 'failed', repairRunning || passed ? 'wrench' : 'alert-triangle');
		if (summary?.details.length) {
			const details = section.createEl('details', { cls: 'skill-switchboard-details' });
			details.createEl('summary', { text: strings.repairChanges, cls: 'skill-switchboard-check-label' });
			const body = details.createDiv('skill-switchboard-resource-details');
			for (const item of summary.details) {
				body.createEl('strong', { text: `${item.label} · ${item.repair.native?.changedSkills.join(', ') || (item.followUp?.status === 'passed' ? strings.adapterCheckPassed : strings.repairAllFailed(1))}` });
				for (const change of item.repair.native?.changes ?? []) body.createDiv({ text: `${strings.changeLabel(change.kind, change.action)} · ${change.path}`, cls: 'skill-switchboard-path' });
			}
		}
		if (repair?.output && !passed) {
			renderOutputBlock(section, strings, strings.repairAllOutput, repair.output, onCopyOutput);
		}
	}
}

function renderStatusRow(container: HTMLElement, text: string, state: 'passed' | 'failed' | 'running' | 'warning' | 'unknown', icon: string): void {
	const row = container.createDiv('skill-switchboard-status');
	row.addClass(`is-${state}`);
	const marker = row.createSpan('skill-switchboard-status-icon');
	setIcon(marker, icon);
	row.createSpan({ text });
}

function renderOutputBlock(
	container: HTMLElement,
	strings: Strings,
	label: string,
	output: string,
	onCopyOutput: (output: string) => Promise<void>,
): void {
	const details = container.createEl('details', { cls: 'skill-switchboard-details' });
	details.createEl('summary', { text: label, cls: 'skill-switchboard-check-label' });
	const body = details.createDiv('skill-switchboard-output-body');
	const copyButton = body.createEl('button', {
		text: strings.copyOutput,
		cls: 'skill-switchboard-copy-button',
	});
	copyButton.setAttribute('aria-label', strings.copyOutput);
	copyButton.addEventListener('click', () => void onCopyOutput(output));
	body.createEl('pre', { text: output, cls: 'skill-switchboard-check-output' });
}
