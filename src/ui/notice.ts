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

	// A clean run can produce dozens of identical PASS lines. Showing them buries the
	// one thing the user needs: whether anything needs attention.
	const problems = findProblemLines(trimmed);
	if (problems.length === 0) {
		new Notice(message, 8000);
		return;
	}

	// Surface the problems inline: without them a failure notice only shows the exit code.
	const notice = new Notice(`${message}\n${summarize(problems, strings, trimmed)}`, 20000);
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
 * Lines that mark a real problem. Adapter output is written as `[target] STATE`
 * headers, so the status word on its own line is what identifies a failure.
 */
const PROBLEM_STATES = new Set(['DRIFT', 'FAIL']);

function findProblemLines(output: string): string[] {
	const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
	const problems: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const header = /^\[.*\]\s*(\w+)$/.exec(line ?? '');
		const state = header?.[1];
		if (!state || !PROBLEM_STATES.has(state)) continue;
		problems.push(line ?? '');
		// Keep the detail line that follows the status header.
		const detail = lines[index + 1];
		if (detail !== undefined) problems.push(detail);
	}
	return problems;
}

function summarize(problems: string[], strings: Strings, output: string, maxLines = 6): string {
	const shown = problems.slice(0, maxLines).map((line) => `· ${line}`);
	const hidden = problems.length - shown.length;
	if (hidden > 0) {
		shown.push(`· ${strings.moreLines(hidden)}`);
	} else {
		const total = output.split('\n').filter((line) => line.trim()).length;
		const unseen = total - problems.length;
		if (unseen > 0) shown.push(`· ${strings.moreLines(unseen)}`);
	}
	return shown.join('\n');
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
