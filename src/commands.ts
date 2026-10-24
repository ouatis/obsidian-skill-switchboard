import { Notice } from 'obsidian';
import { getStrings } from './i18n';
import type SkillSwitchboardPlugin from './main';
import { copyTextToClipboard } from './utils/clipboard';
import { latestTargetSnapshot, restoreTargetSnapshot } from './sync/target-snapshot';
import { confirmRepair } from './ui/confirm-modal';

export function registerCommands(plugin: SkillSwitchboardPlugin): void {
	const strings = getStrings(plugin.settings.language);

	plugin.addCommand({
		id: 'open-switchboard',
		name: strings.openSwitchboard,
		callback: () => void plugin.activateView(),
	});

	plugin.addCommand({
		id: 'refresh-skill-index',
		name: strings.refreshSkillIndex,
		callback: () => void plugin.refreshIndex(true),
	});

	plugin.addCommand({
		id: 'copy-adapter-check-output',
		name: strings.copyCheckOutput,
		callback: () => void copyLatestCheckOutput(plugin),
	});

	plugin.addCommand({
		id: 'restore-last-snapshot',
		name: strings.restoreLastSnapshot,
		callback: () => void restoreLastSnapshot(plugin),
	});
}

async function copyLatestCheckOutput(plugin: SkillSwitchboardPlugin): Promise<void> {
	const strings = getStrings(plugin.settings.language);
	const output = plugin.latestCheckOutput();
	if (!output) {
		new Notice(strings.noOutputToCopy);
		return;
	}
	const copied = await copyTextToClipboard(output);
	new Notice(copied ? strings.outputCopied : strings.copyFailed);
}

/** Restores the newest snapshot in the store; the snapshot records its own target. */
async function restoreLastSnapshot(plugin: SkillSwitchboardPlugin): Promise<void> {
	const strings = getStrings(plugin.settings.language);
	try {
		const snapshot = await latestTargetSnapshot(plugin.snapshotStore());
		if (!snapshot) {
			new Notice(strings.restoreNone);
			return;
		}
		const { skill, target } = snapshot.manifest;
		const confirmed = await confirmRepair(plugin.app, strings, strings.restoreConfirmMessage(skill, target), undefined, {
			title: strings.restoreTitle,
			confirm: strings.restoreConfirm,
		});
		if (!confirmed) return;
		const { files } = await restoreTargetSnapshot(snapshot.directory);
		new Notice(strings.restoreDone(skill, files));
	} catch (error) {
		new Notice(strings.restoreFailed(error instanceof Error ? error.message : String(error)));
	}
}
