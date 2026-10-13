import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-ui-'));
try {
	await esbuild.build({
		entryPoints: [path.join(repo, 'src/ui/open-settings.ts'), path.join(repo, 'src/i18n.ts')],
		bundle: true, platform: 'node', format: 'cjs', outdir: tempRoot, outExtension: { '.js': '.cjs' }, logLevel: 'silent',
	});
	const { openPluginSettings } = await import(pathToFileURL(path.join(tempRoot, 'ui/open-settings.cjs')).href);
	const { getStrings } = await import(pathToFileURL(path.join(tempRoot, 'i18n.cjs')).href);
	const events = [];
	const navigation = {
		open() { assert.equal(this, navigation); events.push('open'); },
		openTabById(id) { assert.equal(this, navigation); events.push(id); },
	};
	assert.equal(openPluginSettings({ setting: navigation }, 'skill-switchboard'), true);
	assert.deepEqual(events, ['open', 'skill-switchboard'], 'open the modal before selecting this plugin');
	for (const app of [{}, { setting: {} }, { setting: { open() {} } }, { setting: { openTabById() {} } }]) {
		assert.equal(openPluginSettings(app, 'skill-switchboard'), false, 'missing navigation should use the visible fallback');
	}
	assert.equal(openPluginSettings({ setting: { open() { throw new Error('unavailable'); }, openTabById() {} } }, 'skill-switchboard'), false);
	assert.equal(openPluginSettings({ setting: { open() {}, openTabById() { throw new Error('unavailable'); } } }, 'skill-switchboard'), false);
	assert.equal(getStrings('zh-CN').viewTitle, '技能接线台');
	assert.equal(getStrings('en').viewTitle, 'Skill Switchboard');
	for (const locale of ['en', 'zh-CN']) {
		assert.ok(getStrings(locale).viewDescription);
		assert.ok(getStrings(locale).skillLibrary);
	}
	console.log('UI checks passed: direct settings navigation, safe fallback, and bilingual page names.');
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}
