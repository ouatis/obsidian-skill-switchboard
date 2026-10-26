import { Notice } from 'obsidian';
import { getStrings } from './i18n';
import type SkillSwitchboardPlugin from './main';
import { copyTextToClipboard } from './utils/clipboard';
import { restoreLatestSnapshot } from './ui/snapshots';

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
		callback: () => void restoreLatestSnapshot(plugin),
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

