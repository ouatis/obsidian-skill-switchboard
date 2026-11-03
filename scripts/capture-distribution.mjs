import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Capture only the plugin surface, so unrelated vault content stays out of previews.
const [cli, vault, output, selector = '.ssb-deck'] = process.argv.slice(2);
if (!cli || !vault || !output) throw new Error('Usage: node scripts/capture-distribution.mjs <obsidian-cli> <vault> <output.png> [selector]');
const call = (...args) => {
	const stdout = execFileSync(cli, [`vault=${vault}`, ...args], {
		encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024,
	});
	return JSON.parse(stdout.trim().replace(/^=>\s*/, ''));
};
const rect = call('eval', `code=JSON.stringify((()=>{const leaf=app.workspace.getLeavesOfType("skill-switchboard-view").find(l=>l===app.workspace.getMostRecentLeaf())??app.workspace.getLeavesOfType("skill-switchboard-view").find(l=>l.view.contentEl.getBoundingClientRect().width>0);const content=leaf.view.contentEl;const el=content.matches(${JSON.stringify(selector)})?content:content.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();const x=Math.max(0,r.x),y=Math.max(0,r.y);return{x,y,width:Math.min(innerWidth,r.right)-x,height:Math.min(innerHeight,r.bottom)-y};})())`);
if (rect.width <= 0 || rect.height <= 0) throw new Error('The plugin surface is not visible.');
const capture = call('dev:cdp', 'method=Page.captureScreenshot', `params=${JSON.stringify({
	format: 'png',
	clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
})}`);
if (typeof capture.data !== 'string') throw new Error('The screenshot did not return image data.');
await writeFile(path.resolve(output), Buffer.from(capture.data, 'base64'));
console.log(`Captured distribution deck: ${path.resolve(output)}`);
