import type { App } from 'obsidian';

interface SettingsNavigation {
	open(): void;
	openTabById(id: string): void;
}

/** Obsidian's settings navigation is not in App's public typings; guard it locally. */
export function openPluginSettings(app: App, pluginId: string): boolean {
	const navigation = (app as App & { setting?: Partial<SettingsNavigation> }).setting;
	if (typeof navigation?.open !== 'function' || typeof navigation.openTabById !== 'function') return false;
	try {
		navigation.open();
		navigation.openTabById(pluginId);
		return true;
	} catch {
		return false;
	}
}
