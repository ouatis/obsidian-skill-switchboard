import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'scripts/test-native.mjs',
		'scripts/test-scanner.mjs',
		'scripts/test-readiness.mjs',
		'scripts/test-lifecycle.mjs',
		'scripts/build-id-plugin.mjs',
		'scripts/test-build-id.mjs',
		'scripts/test-status-write-queue.mjs',
		'scripts/test-adapter-run.mjs',
		'scripts/test-vault-change-impact.mjs',
		'scripts/test-distribution.mjs',
		'scripts/test-ui.mjs',
		'scripts/test-ui-live.mjs',
		'scripts/capture-distribution.mjs',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// The clipboard fallback deliberately keeps the deprecated document.execCommand
		// as the only path that works when navigator.clipboard is unavailable inside
		// Obsidian's renderer. A single suppression with that explanation is clearer
		// than dropping a working code path.
		files: ['src/utils/clipboard.ts'],
		rules: {
			'@typescript-eslint/no-deprecated': 'off',
		},
	},
);
