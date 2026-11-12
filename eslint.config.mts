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
		'scripts/test-packages.mjs',
		'scripts/test-install-boundaries.mjs',
		'scripts/test-install-plan.mjs',
		'scripts/test-automatic.mjs',
		'scripts/test-package-ui-live.mjs',
		'scripts/test-scanner.mjs',
		'scripts/test-readiness.mjs',
		'scripts/test-lifecycle.mjs',
		'scripts/test-machine-settings.mjs',
		'scripts/build-id-plugin.mjs',
		'scripts/test-build-id.mjs',
		'scripts/test-status-write-queue.mjs',
		'scripts/test-adapter-run.mjs',
		'scripts/test-vault-change-impact.mjs',
		'scripts/test-target-discovery.mjs',
		'scripts/test-distribution.mjs',
		'scripts/test-ui.mjs',
		'scripts/test-ui-live.mjs',
		'scripts/run-tests.mjs',
		'scripts/test-target-snapshot.mjs',
		'scripts/test-orphan-sweep.mjs',
		'scripts/capture-distribution.mjs',
		'scripts/check-runtime.mjs',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'scripts/test-release-validation.mjs',
						'scripts/validate-release.mjs',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Type-aware no-unsafe family: the community review bot lints with these
		// enabled. The codebase is clean under them as of 0.6.7, so they gate as
		// errors to keep it that way — findings surface locally, not only at
		// submission time.
		files: ['src/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'error',
			'@typescript-eslint/no-unsafe-call': 'error',
			'@typescript-eslint/no-unsafe-member-access': 'error',
			'@typescript-eslint/no-unsafe-argument': 'error',
			'@typescript-eslint/no-unsafe-return': 'error',
		},
	},
	{
		files: ['scripts/test-release-validation.mjs', 'scripts/validate-release.mjs'],
		languageOptions: {
			globals: globals.node,
		},
	},
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
