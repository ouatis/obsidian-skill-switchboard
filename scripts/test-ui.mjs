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
		entryPoints: [path.join(repo, 'src/ui/open-settings.ts'), path.join(repo, 'src/ui/distribution-svg.ts'), path.join(repo, 'src/i18n.ts')],
		bundle: true, platform: 'node', format: 'cjs', outdir: tempRoot, outExtension: { '.js': '.cjs' }, logLevel: 'silent',
	});
	const { openPluginSettings } = await import(pathToFileURL(path.join(tempRoot, 'ui/open-settings.cjs')).href);
	const { getStrings } = await import(pathToFileURL(path.join(tempRoot, 'i18n.cjs')).href);
	const { describeSvg } = await import(pathToFileURL(path.join(tempRoot, 'ui/distribution-svg.cjs')).href);
	const document = { createElementNS(namespace, tag) { return element(tag, namespace); } };
	const element = (tag, namespace = 'http://www.w3.org/2000/svg') => ({
		tag, namespace, ownerDocument: document, attributes: new Map(), children: [],
		setAttribute(name, value) { this.attributes.set(name, value); },
		appendChild(child) { this.children.push(child); },
	});
	const ids = new Set();
	for (const tag of ['svg', 'g', 'g', 'svg']) {
		const parent = element(tag);
		const title = describeSvg(parent);
		const id = title.attributes.get('id');
		assert.equal(title.tag, 'title');
		assert.equal(title.namespace, 'http://www.w3.org/2000/svg');
		assert.equal(parent.children[0], title);
		assert.equal(parent.attributes.get('aria-labelledby'), id);
		assert.equal(parent.attributes.has('aria-label'), false, 'SVG must not enter the HTML-only tooltip handler');
		assert.ok(id && !ids.has(id), 'multiple nodes and boards need distinct accessible name IDs');
		ids.add(id);
	}
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
	const css = await fs.readFile(path.join(repo, 'styles.css'), 'utf8');
	assert.match(css, /--ssb-radius:\s*12px;/, 'family panels use a 12px radius');
	assert.match(css, /--ssb-control-radius:\s*8px;/, 'family controls use an 8px radius');
	assert.match(css, /--ssb-motion:\s*160ms;/, 'ordinary interactions share one motion rhythm');
	assert.match(css, /font-family:\s*var\(--font-interface\);/, 'interface type belongs to the host');
	assert.match(css, /summary:focus-visible/, 'disclosure controls keep a visible keyboard focus');
	assert.match(css, /prefers-reduced-motion:\s*reduce/, 'respect reduced-motion preferences');
	assert.doesNotMatch(css, /#[\da-f]{3,8}\b|https?:\/\//i, 'do not force a brand palette or load remote assets');
	assert.doesNotMatch(css, /(?:^|\n)(?:body\b|:root\b|\.theme-(?:light|dark)\b)/, 'do not override the host or other plugins');
	const board = await fs.readFile(path.join(repo, 'src/ui/distribution-board.ts'), 'utf8');
	assert.doesNotMatch(board, /(?:this\.svg\?|this\.sourceGroup\?|elements\.group)\.setAttribute\(['"]aria-label/, 'SVG nodes keep their tooltip-safe names when state changes');
	console.log('UI checks passed: settings navigation, bilingual names, safe SVG labels, and host-native family styling.');
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}
