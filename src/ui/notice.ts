import { Notice } from 'obsidian';
import type { Strings } from '../i18n';
import { copyTextToClipboard } from '../utils/clipboard';

/**
 * Shows the result notice with an inline copy button, so the output is reachable
 * even when the switchboard view is closed or scrolled away.
 */
export function notifyWithCopy(strings: Strings, message: string, output: string): void {
	const trimmed = output.trim();
	if (!trimmed) {
		new Notice(message);
		return;
	}

	// Surface the first few problems inline: without them a failure notice only shows the exit code.
	const notice = new Notice(`${message}\n${summarize(trimmed)}`, 20000);
	const button = resolveMessageEl(notice).createEl('button', {
		text: strings.copyOutput,
		cls: 'skill-switchboard-notice-copy',
	});
	button.addEventListener('click', () => {
		void (async () => {
			const copied = await copyTextToClipboard(output);
			new Notice(copied ? strings.outputCopied : strings.copyFailed);
		})();
	});
}

/**
 * `messageEl` is the current element, but it only exists in Obsidian 1.8.7+ while
 * this plugin still supports 1.7.2. The legacy element is read through a local type
 * because it is deprecated in the API but still required for 1.7.2–1.8.6.
 */
type NoticeElements = {
	messageEl?: HTMLElement;
	noticeEl?: HTMLElement;
};

function resolveMessageEl(notice: Notice): HTMLElement {
	const elements = notice as unknown as NoticeElements;
	const el = elements.messageEl ?? elements.noticeEl;
	if (!el) throw new Error('Notice has no message element on this Obsidian version.');
	return el;
}

function summarize(output: string, maxLines = 6): string {
	const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
	const shown = lines.slice(0, maxLines).map((line) => `· ${line}`);
	const hidden = lines.length - shown.length;
	if (hidden > 0) shown.push(`… ${hidden} more line(s), use copy to get the full output`);
	return shown.join('\n');
}
