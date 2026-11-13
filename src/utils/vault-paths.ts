/** Normalize a vault-relative path to Obsidian's forward-slash form. */
export function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}
