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
	document.body.appendChild(textarea);
	textarea.select();
	let copied = false;
	try {
		copied = document.execCommand('copy');
	} catch {
		copied = false;
	}
	document.body.removeChild(textarea);
	return copied;
}
