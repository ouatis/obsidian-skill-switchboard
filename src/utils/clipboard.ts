/**
 * Clipboard helpers used by the switchboard view and the command palette.
 *
 * `navigator.clipboard` is available in recent Obsidian builds but can be missing
 * in some sandboxed contexts, so a hidden textarea fallback keeps copy working.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	if (await writeWithClipboardApi(text)) return true;
	return writeWithTextarea(text);
}

async function writeWithClipboardApi(text: string): Promise<boolean> {
	const clipboard = navigator.clipboard;
	if (!clipboard?.writeText) return false;
	try {
		await clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

function writeWithTextarea(text: string): boolean {
	const textarea = createEl('textarea', {
		cls: 'skill-switchboard-clipboard-textarea',
		attr: { readonly: '' },
	});
	textarea.value = text;
	activeDocument.body.appendChild(textarea);
	textarea.select();
	let copied = false;
	try {
		copied = runCopyCommand();
	} catch {
		copied = false;
	}
	activeDocument.body.removeChild(textarea);
	return copied;
}

/**
 * `document.execCommand` is deprecated on the web platform, but it is the only copy
 * path that still works when `navigator.clipboard` is unavailable inside Obsidian's
 * renderer. `eslint.config.mts` exempts this file for that reason.
 */
const runCopyCommand: () => boolean = () =>
	typeof activeDocument.execCommand === 'function'
		? activeDocument.execCommand('copy')
		: false;
