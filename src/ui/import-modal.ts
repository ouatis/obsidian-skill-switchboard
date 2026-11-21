import { App, Modal } from 'obsidian';
import type { Strings } from '../i18n';
import type { ImportCandidate, ImportScanResult } from '../sync/import-skills';

export function chooseSkillsToImport(
	app: App,
	strings: Strings,
	scan: ImportScanResult,
): Promise<ImportCandidate[] | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: ImportCandidate[] | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		const ready = scan.candidates.filter((candidate) => candidate.status === 'ready');
		const skipped = scan.candidates.filter((candidate) => candidate.status !== 'ready');
		const selected = new Set<ImportCandidate>(ready);

		const modal = new Modal(app);
		modal.titleEl.setText(strings.importSkillsTitle);
		modal.contentEl.createEl('p', { text: strings.importSkillsConfirmMessage(scan.destinationRoot) });
		if (scan.hasManifest) {
			modal.contentEl.createDiv({ text: strings.importSkillsManifestNote, cls: 'skill-switchboard-evidence-note' });
		}

		const list = modal.contentEl.createDiv('skill-switchboard-import-list');
		let confirmButton: HTMLButtonElement | null = null;
		const updateConfirmButton = () => {
			if (!confirmButton) return;
			confirmButton.setText(strings.importSkillsConfirm(selected.size));
			confirmButton.disabled = selected.size === 0;
		};

		for (const candidate of ready) {
			const row = list.createEl('label', { cls: 'skill-switchboard-import-row' });
			const checkbox = row.createEl('input', { type: 'checkbox' });
			checkbox.checked = true;
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) selected.add(candidate);
				else selected.delete(candidate);
				updateConfirmButton();
			});
			const info = row.createDiv('skill-switchboard-import-info');
			info.createEl('strong', { text: candidate.name });
			info.createDiv({
				text: `${candidate.sourceLabel} · ${strings.importFileCount(candidate.fileCount)}`,
				cls: 'skill-switchboard-import-meta',
			});
			info.createDiv({ text: candidate.sourceDir, cls: 'skill-switchboard-path' });
		}

		if (skipped.length > 0) {
			const details = modal.contentEl.createEl('details', { cls: 'skill-switchboard-details' });
			details.createEl('summary', { text: strings.importSkillsSkippedSummary(skipped.length) });
			const body = details.createDiv('skill-switchboard-resource-details');
			for (const candidate of skipped) {
				const item = body.createDiv('skill-switchboard-plan-item');
				item.createEl('strong', {
					text: `${candidate.name} · ${candidate.sourceLabel} · ${strings.importSkipReason(candidate.status, candidate.reason)}`,
				});
				item.createDiv({ text: candidate.sourceDir, cls: 'skill-switchboard-path' });
			}
		}

		const buttons = modal.contentEl.createDiv('modal-button-container');
		const cancel = buttons.createEl('button', { text: strings.cancelRepair });
		cancel.addEventListener('click', () => {
			finish(null);
			modal.close();
		});

		confirmButton = buttons.createEl('button', {
			text: strings.importSkillsConfirm(selected.size),
			cls: 'mod-cta',
		});
		confirmButton.disabled = selected.size === 0;
		confirmButton.addEventListener('click', () => {
			finish([...selected]);
			modal.close();
		});

		modal.onClose = () => finish(null);
		modal.open();
	});
}
