import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Load through Obsidian's real module loader, but give it an isolated app/vault.
// No file, setting, plugin installation or Agent target in the real vault is changed.
const [cli, vault, screenshot] = process.argv.slice(2);
if (!cli || !vault) throw new Error('Usage: node scripts/test-package-ui-live.mjs <obsidian-cli> <host-vault> [screenshot-path]');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-ui-packages-'));
const key = `__switchboardPackageTest${Date.now()}`;
const evaluate = (expression) => {
	const stdout = execFileSync(cli, [`vault=${vault}`, 'eval', `code=(async()=>JSON.stringify(await (${expression})))()`], { encoding: 'utf8', windowsHide: true, timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
	return JSON.parse(stdout.trim().replace(/^=>\s*/, ''));
};
async function write(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); }
try {
	await write(path.join(temporary, 'vault/skills/drawing/SKILL.md'), '---\nname: drawing\ndescription: Draw a diagram.\n---\n# Drawing\nFULL DRAWING RULES\n');
	await write(path.join(temporary, 'vault/skills/drawing/references/support.md'), '# Support\n');
	await write(path.join(temporary, 'vault/skills/new-skill/SKILL.md'), '---\nname: new-skill\ndescription: A missing installation.\n---\n# New skill\n');
	await write(path.join(temporary, 'vault/skills/broken.md'), '# Broken\n\nRequired [resource](references/missing.md).\n');
	await write(path.join(temporary, 'vault/skills-manifest.json'), JSON.stringify({ schema_version: 1, total_skills: 3, skills: [
		{ name: 'drawing', shared_file: 'drawing/SKILL.md', adapters: { codex: true } },
		{ name: 'new-skill', shared_file: 'new-skill/SKILL.md', adapters: { codex: true } },
		{ name: 'broken', shared_file: 'broken.md', adapters: { codex: true } },
	] }));
	await write(path.join(temporary, 'runtime/drawing/SKILL.md'), 'USER OWNED SKILL');
	await write(path.join(temporary, 'styles.css'), await fs.readFile(path.join(repo, 'styles.css')));
	const source = await fs.readFile(path.join(repo, 'main.js'), 'utf8');
	await write(path.join(temporary, 'main.js'), source + `\n;globalThis[${JSON.stringify(key)}]={api:require('obsidian'),Original:module.exports.default};module.exports={default:class extends module.exports.default{async onload(){}async loadCSS(){}}};`);
	const opened = evaluate(`(async()=>{
		const root=${JSON.stringify(temporary)},fs=require('node:fs').promises,path=require('node:path');
		const appCopy=Object.create(app),vaultCopy=Object.create(app.vault),adapter=Object.create(app.vault.adapter);
		adapter.read=(file)=>fs.readFile(file,'utf8');adapter.getBasePath=()=>path.join(root,'vault');
		Object.defineProperty(vaultCopy,'adapter',{value:adapter});
		vaultCopy.getName=()=> 'Package test';vaultCopy.getMarkdownFiles=()=>[{name:'SKILL.md',path:'skills/drawing/SKILL.md'}];
		vaultCopy.read=(file)=>fs.readFile(path.join(root,'vault',file.path),'utf8');vaultCopy.on=()=>({});
		Object.defineProperty(appCopy,'vault',{value:vaultCopy});
		const workspace=Object.create(app.workspace);workspace.getLeavesOfType=()=>[];workspace.on=()=>({});workspace.onLayoutReady=(fn)=>fn();
		Object.defineProperty(appCopy,'workspace',{value:workspace});
		const manager=new app.plugins.constructor(appCopy);manager.isEnabled=()=>true;
		const id='switchboard-isolated-package-test';manager.manifests[id]={id,name:'Package test',version:'0.6.0',minAppVersion:'1.7.2',dir:root};
		await manager.loadPlugin(id);
		const state=globalThis[${JSON.stringify(key)}],p=new state.Original(appCopy,manager.manifests[id]);
		state.manager=manager;state.p=p;
		p.loadData=async()=>({language:'zh-CN',autoCheck:false,autoScan:false,roots:[{id:'source',label:'Source',kind:'vault',path:'skills',enabled:true}],syncRootId:'source',targets:[{id:'codex',label:'Codex',path:path.join(root,'runtime'),mode:'copy',runtime:'codex',enabled:true}]});
		p.saveData=async(data)=>{state.shared=structuredClone(data);};Object.defineProperty(p,'machineSettingsPath',{get:()=>path.join(root,'machine/settings.json')});
		Object.defineProperty(p,'packageRegistryPath',{value:path.join(root,'packages.json')});
		p.registerView=(_type,factory)=>state.factory=factory;p.addRibbonIcon=()=>document.createElement('div');p.addCommand=()=>{};p.addSettingTab=(tab)=>state.tab=tab;p.registerEvent=()=>{};
		await p.load();await p.checkAdapters(false);
		state.previousLeaf=app.workspace.activeLeaf;state.leaf=app.workspace.getLeaf(true);
		state.view=state.factory(state.leaf);await state.view.onOpen();
		state.host=document.createElement('div');state.host.className='switchboard-isolated-test';state.host.style.cssText='position:fixed;left:40px;top:40px;width:calc(100vw - 80px);height:calc(100vh - 80px);display:block;z-index:9999;overflow:auto;background:var(--background-primary)';document.body.appendChild(state.host);state.host.appendChild(state.view.containerEl);
		state.style=document.createElement('style');state.style.textContent=await fs.readFile(path.join(root,'styles.css'),'utf8');document.head.appendChild(state.style);
		state.view.containerEl.style.cssText='height:100%;width:100%;display:flex;flex-direction:column';
		return {version:p.manifest.version,source:p.settings.roots[0].path,states:p.targetChecks.flatMap(c=>c.result.native?.installs??[]).map(i=>i.state),text:state.host.textContent};
	})()`);
	assert.equal(opened.version, '0.6.0');
	assert.deepEqual(opened.states, ['update', 'missing', 'blocked']);
	assert(opened.text.includes('待按源覆盖'));
	assert(!opened.text.includes('检查并替换冲突副本'));
	assert(opened.text.includes('1 待安装 · 1 待覆盖 · 1 受阻'));
	const groups = evaluate(`(()=>{const s=globalThis[${JSON.stringify(key)}];return Array.from(s.host.querySelectorAll('[data-install-group]')).map(g=>({action:g.dataset.installGroup,open:g.open,text:g.textContent}));})()`);
	assert.deepEqual(groups.map((group) => group.action), ['blocked', 'install', 'update']);
	assert.deepEqual(groups.map((group) => group.open), [true, false, false]);
	assert(groups[0].text.includes('missing.md'));
	const bilingual = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}],out=[];for(const language of ['en','zh-CN']){s.p.settings.language=language;s.view.renderIndex();out.push({language,title:s.host.querySelector('h1').textContent,resolve:Array.from(s.host.querySelectorAll('button')).find(b=>b.textContent===(language==='en'?'Review and replace conflicting copies':'检查并替换冲突副本'))?.textContent,wrapperOption:s.host.textContent.includes('Wrapper')});}return out;})()`);
	assert.equal(bilingual[0].title, 'Skill Switchboard');
	assert.equal(bilingual[1].title, '技能接线台');
	assert(bilingual.every((item) => !item.resolve && !item.wrapperOption));
	// Use the real confirmation UI: cancel and verify no disk or source changes.
	{
		const cancelled = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}],existing=new Set(document.querySelectorAll('.modal-container'));const pending=s.p.repairAllAdapters();let modal;for(let n=0;n<100;n++){modal=Array.from(document.querySelectorAll('.modal-container')).find(m=>!existing.has(m)&&m.textContent.includes(${JSON.stringify(temporary)}));if(modal)break;await new Promise(r=>setTimeout(r,20));}if(!modal)throw new Error('The isolated fixture confirmation did not open');const text=modal.textContent;modal.querySelector('.modal-button-container button:not(.mod-warning)').click();await pending;return {text,state:s.p.targetChecks[0].result.native.installs[0].state};})()`);
		assert(cancelled.text.includes('1 待安装'));
		assert(cancelled.text.includes('1 待覆盖'));
		assert(cancelled.text.includes('1 受阻'));
		assert(cancelled.text.includes('不保留历史备份'));
		assert(cancelled.text.includes('回写来源'));
		assert.equal(cancelled.state, 'update');
	}
	assert.equal(await fs.readFile(path.join(temporary, 'runtime/drawing/SKILL.md'), 'utf8'), 'USER OWNED SKILL');
	await assert.rejects(fs.access(path.join(temporary, 'runtime/new-skill')), { code: 'ENOENT' });
	if (screenshot && evaluate('document.visibilityState') !== 'visible') {
		console.log('Screenshot skipped: the host window is hidden; live DOM layout and interaction checks still run.');
	} else if (screenshot) {
		const visible = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}],planEl=s.host.querySelector('.skill-switchboard-install-plan');planEl.scrollIntoView({block:'start'});await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(r,250))]);const header=s.host.querySelector('.skill-switchboard-header').getBoundingClientRect();s.view.contentEl.scrollTop-=Math.max(0,header.bottom-planEl.getBoundingClientRect().top+16);await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(r,250))]);const rect=s.host.getBoundingClientRect(),plan=planEl.getBoundingClientRect();return {width:rect.width,height:rect.height,planWidth:plan.width,planHeight:plan.height,headingClear:plan.top>=s.host.querySelector('.skill-switchboard-header').getBoundingClientRect().bottom,onTop:s.host.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2))};})()`);
		assert(visible.width > 300 && visible.height > 300 && visible.planWidth > 100 && visible.planHeight > 100 && visible.onTop, JSON.stringify(visible));
		assert(visible.headingClear, 'sticky header must not hide the fixture plan heading');
		const result = execFileSync(cli, [`vault=${vault}`, 'dev:screenshot', `path=${path.resolve(screenshot)}`], { encoding: 'utf8', windowsHide: true, timeout: 25000 });
		assert(!/^Error/m.test(result), result);
		console.log('Isolated visual fixture is visible:', JSON.stringify(visible));
	}
	// Settings rendering uses the actual Obsidian controls, outside the real settings tab.
	const settings = evaluate(`(()=>{const s=globalThis[${JSON.stringify(key)}];s.tab.containerEl=document.createElement('div');s.host.appendChild(s.tab.containerEl);s.tab.display();return {text:s.tab.containerEl.textContent,options:Array.from(s.tab.containerEl.querySelectorAll('option')).map(o=>o.value)};})()`);
	assert(settings.text.includes('完整技能包'));
	assert(!settings.options.includes('wrapper') && !settings.options.includes('symlink'));
	// Confirm once in this isolated fixture only; real Agent folders stay untouched.
	const repaired = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}],existing=new Set(document.querySelectorAll('.modal-container'));const pending=s.p.repairAllAdapters();let modal;for(let n=0;n<100;n++){modal=Array.from(document.querySelectorAll('.modal-container')).find(m=>!existing.has(m)&&m.textContent.includes(${JSON.stringify(temporary)}));if(modal)break;await new Promise(r=>setTimeout(r,20));}if(!modal)throw new Error('Isolated repair confirmation missing');modal.querySelector('.modal-button-container button.mod-warning').click();await pending;return {states:s.p.targetChecks[0].result.native.installs.map(i=>i.state),text:s.host.textContent};})()`);
	assert.deepEqual(repaired.states, ['current', 'current', 'blocked']);
	assert.match(await fs.readFile(path.join(temporary, 'runtime/drawing/SKILL.md'), 'utf8'), /FULL DRAWING RULES/);
	assert.equal(await fs.readFile(path.join(temporary, 'runtime/drawing/references/support.md'), 'utf8'), '# Support\n');
	await fs.access(path.join(temporary, 'runtime/new-skill/SKILL.md'));
	await assert.rejects(fs.access(path.join(temporary, 'runtime/drawing/.skill-switchboard.json')), { code: 'ENOENT' });
	assert(!(await fs.readdir(path.join(temporary, 'runtime'))).some(name=>name.startsWith('.skill-switchboard-')));
	assert.equal(await fs.readFile(path.join(temporary, 'vault/skills/drawing/SKILL.md'), 'utf8'), '---\nname: drawing\ndescription: Draw a diagram.\n---\n# Drawing\nFULL DRAWING RULES\n');
	// Exercise the real toggle and consent modal, then let background events do the writes.
	await write(path.join(temporary, 'vault/skills/references/missing.md'), '# Restored required resource\n');
	evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}];await s.p.checkAdapters(false);s.tab.update=()=>s.tab.display();s.tab.display();return true;})()`);
	for (const accept of [false, true]) {
		const consent = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}],existing=new Set(document.querySelectorAll('.modal-container')),original=s.p.setAutoDistributionEnabled.bind(s.p);s.p.setAutoDistributionEnabled=value=>{s.consentPending=original(value);return s.consentPending;};const row=Array.from(s.tab.containerEl.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent==='自动分发');if(!row)throw new Error('Automatic toggle missing');row.querySelector('.checkbox-container').click();let modal;for(let n=0;n<100;n++){modal=Array.from(document.querySelectorAll('.modal-container')).find(m=>!existing.has(m)&&m.textContent.includes('允许今后'));if(modal)break;await new Promise(r=>setTimeout(r,20));}if(!modal)throw new Error('Local authorization modal missing');const text=modal.textContent;modal.querySelector(${JSON.stringify(accept ? '.modal-button-container button.mod-warning' : '.modal-button-container button:not(.mod-warning)')}).click();await s.consentPending;s.p.setAutoDistributionEnabled=original;return {enabled:s.p.settings.autoDistribute,scope:s.p.settings.autoDistributeScope,text,shared:s.shared};})()`);
		assert.equal(consent.enabled, accept); assert.equal(consent.scope.length, accept ? 64 : 0);
		assert(consent.text.includes('不保留历史备份') && consent.text.includes(temporary));
		assert.equal(consent.shared.autoDistribute, undefined); assert.equal(consent.shared.autoDistributeScope, undefined);
	}
	const automatic = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}];for(let n=0;n<400;n++){if(s.p.lastRepairSummary?.repair.status==='passed'&&!s.p.adapterRepairRunning)break;await new Promise(r=>setTimeout(r,20));}return {status:s.p.lastRepairSummary?.repair.status,states:s.p.targetChecks[0].result.native.installs.map(i=>i.state)};})()`);
	assert.equal(automatic.status, 'passed'); assert.deepEqual(automatic.states, ['current', 'current', 'current']);
	await write(path.join(temporary, 'vault/skills/drawing/references/support.md'), '# Support revised automatically\n');
	const updated = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}],before=s.p.lastRepairSummary;s.p.onVaultChanged('skills/drawing/references/support.md');for(let n=0;n<500;n++){if(s.p.lastRepairSummary!==before&&s.p.lastRepairSummary?.repair.status==='passed'&&!s.p.adapterRepairRunning)break;await new Promise(r=>setTimeout(r,20));}return {newRun:s.p.lastRepairSummary!==before,status:s.p.lastRepairSummary?.repair.status,changed:s.p.lastRepairSummary?.details.flatMap(d=>d.repair.native?.changedSkills??[])};})()`);
	assert.equal(updated.newRun, true); assert.equal(updated.status, 'passed'); assert.deepEqual(updated.changed, ['drawing']);
	assert.equal(await fs.readFile(path.join(temporary, 'runtime/drawing/references/support.md'), 'utf8'), '# Support revised automatically\n');
	const revoked = evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}];s.p.settings.targets[0].path=${JSON.stringify(path.join(temporary, 'not-authorized'))};await s.p.saveSettings();return {enabled:s.p.settings.autoDistribute,scope:s.p.settings.autoDistributeScope,checked:s.tab.containerEl.querySelector('.checkbox-container')?.getAttribute('aria-checked')};})()`);
	assert.equal(revoked.enabled, false); assert.equal(revoked.scope, '');
	await assert.rejects(fs.access(path.join(temporary, 'not-authorized')), { code: 'ENOENT' });
	console.log('Real Obsidian package UI passed: isolated loader/app/vault, bilingual plans, one authoritative repair confirmation, cancel writes nothing, overwrite keeps no receipts or temporary originals, and unrelated live files stay untouched.');
	console.log('Automatic UI passed: actual toggle, cancel/grant modal, local-only consent, background source/resource updates, and scope-change revocation.');
} finally {
	try { evaluate(`(async()=>{const s=globalThis[${JSON.stringify(key)}];if(!s)return true;await s.view?.onClose();s.host?.remove();s.style?.remove();s.leaf?.detach();if(s.previousLeaf)await app.workspace.revealLeaf(s.previousLeaf);s.p?.unload();await s.manager?.unloadPlugin('switchboard-isolated-package-test');delete globalThis[${JSON.stringify(key)}];return true;})()`); }
	finally { assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(temporary, { recursive: true, force: true }); }
}
