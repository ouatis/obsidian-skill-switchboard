import os from 'node:os';
import path from 'node:path';

/**
 * Resolve a path stored in plugin settings without tying the vault to one
 * machine. `~` and the common home-directory environment variables resolve to
 * the current user's home directory. Bare relative paths resolve from the
 * supplied base directory (the vault for plugin operations).
 */
export function resolveConfiguredPath(value: string, basePath = process.cwd()): string {
	const raw = value.trim();
	if (!raw) return path.resolve(basePath);

	const expanded = expandHomeVariables(raw).replace(/^[/\\]~(?=[/\\]|$)/, '~');
	if (isForeignWindowsAbsolutePath(expanded)) {
		throw new Error(
			`Path uses Windows absolute syntax: ${value}. Use a portable path such as ~/.codex/skills.`,
		);
	}

	const normalized = path.sep === '/' ? expanded.replaceAll('\\', '/') : expanded;
	if (normalized === '~') return os.homedir();
	if (/^~[\\/]/.test(normalized)) {
		return `${os.homedir().replace(/[\\/]$/, '')}${path.sep}${normalized.slice(2)}`;
	}
	if (isAbsolutePath(normalized)) return normalized;
	return path.resolve(basePath, normalized);
}

function expandHomeVariables(value: string): string {
	const home = os.homedir();
	return value
		.replace(/\$\{HOME\}|\$HOME|%USERPROFILE%|%HOME%/gi, home)
		.replace(/\$\{USERPROFILE\}|\$USERPROFILE/gi, home);
}

function isForeignWindowsAbsolutePath(value: string): boolean {
	if (path.sep === '\\') return false;
	return /^(?:\/)?[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

export function isAbsolutePath(value: string): boolean {
	if (path.sep === '/') return value.startsWith('/');
	return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}
