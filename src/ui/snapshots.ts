import { Notice } from 'obsidian';
import { getStrings } from '../i18n';
import type SkillSwitchboardPlugin from '../main';
import { latestTargetSnapshot, restoreTargetSnapshot } from '../sync/target-snapshot';
import { confirmRepair } from './confirm-modal';

/**
 * Restores the newest snapshot in the store; the snapshot records its own
 * target. Shared by the command palette entry and the settings-tab section.
 */
export async function restoreLatestSnapshot(plugin: SkillSwitchboardPlugin): Promise<void> {
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

/** Latest snapshot summary for display, or null when the store is empty. */
export async function latestSnapshotSummary(plugin: SkillSwitchboardPlugin) {
	try {
		return await latestTargetSnapshot(plugin.snapshotStore());
	} catch {
		return null;
	}
}
