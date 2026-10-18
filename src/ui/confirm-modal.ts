import { App, Modal } from 'obsidian';
import { Strings } from '../i18n';

/**
 * Confirmation gate for operations that rewrite files outside the vault.
 * Obsidian ships no ConfirmModal in the public typings, so this wraps the base
 * Modal and resolves a promise once the user picks an option.
 */
export function confirmRepair(app: App, strings: Strings, message: string, details?: string, labels?: { title: string; confirm: string }): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: boolean) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const modal = new Modal(app);
		modal.titleEl.setText(labels?.title ?? strings.repairAllAdapters);
		modal.contentEl.createEl('p', { text: message });
		if (details) modal.contentEl.createEl('pre', { text: details, cls: 'skill-switchboard-repair-plan' });

		const buttons = modal.contentEl.createDiv('modal-button-container');
		const cancel = buttons.createEl('button', { text: strings.cancelRepair });
		cancel.addEventListener('click', () => {
			finish(false);
			modal.close();
		});

		const confirm = buttons.createEl('button', {
			text: labels?.confirm ?? strings.confirmRepair,
			cls: 'mod-warning',
		});
		confirm.addEventListener('click', () => {
			finish(true);
			modal.close();
		});

		// Closing with Escape or the backdrop counts as a cancel.
		modal.onClose = () => finish(false);
		modal.open();
	});
}
