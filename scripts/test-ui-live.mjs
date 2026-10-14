import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [cli, vault] = process.argv.slice(2);
if (!cli || !vault) throw new Error('Usage: node scripts/test-ui-live.mjs <obsidian-cli> <vault>');
const evaluate = (expression) => {
	const stdout = execFileSync(cli, [`vault=${vault}`, 'eval', `code=(async()=>JSON.stringify(await (${expression})))()`], {
		encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024,
	});
	return JSON.parse(stdout.trim().replace(/^=>\s*/, ''));
};
const inView = (body) => evaluate(`(()=>{const p=app.plugins.plugins["skill-switchboard"],v=app.workspace.getLeavesOfType("skill-switchboard-view")[0].view,w=v.contentEl.win;${body}})()`);

const baseline = inView(`
	return {language:p.settings.language,width:v.contentEl.style.width,query:v.query,
		settings:JSON.stringify(p.settings),themeLight:w.document.body.classList.contains('theme-light'),
		themeDark:w.document.body.classList.contains('theme-dark'),scrollTop:v.contentEl.scrollTop};
`);
try {
	const accessibleMap = inView(`
		const labelled=Array.from(v.contentEl.querySelectorAll('.ssb-deck-svg,[data-target-id],.ssb-deck-source'));
		return {htmlTooltipHooks:v.contentEl.querySelectorAll('svg[aria-label],svg [aria-label]').length,
			ids:labelled.map(e=>e.getAttribute('aria-labelledby')),
			names:labelled.map(e=>w.document.getElementById(e.getAttribute('aria-labelledby'))?.textContent)};
	`);
	assert.equal(accessibleMap.htmlTooltipHooks, 0, 'SVG must not enter Obsidian HTML-only tooltips');
	assert.ok(accessibleMap.names.every(name => typeof name === 'string' && name.length > 0));
	assert.equal(new Set(accessibleMap.ids).size, accessibleMap.ids.length);

	// Real mouse moves exercise the delegated tooltip handler; synthetic PointerEvents are suppressed by Obsidian.
	inView(`
		v.tooltipRegressionErrors=[];v.tooltipRegressionMoves=0;
		v.tooltipRegressionHandler=e=>v.tooltipRegressionErrors.push(e.message);
		v.tooltipRegressionMoveHandler=()=>v.tooltipRegressionMoves++;
		w.addEventListener('error',v.tooltipRegressionHandler);
		v.contentEl.addEventListener('pointermove',v.tooltipRegressionMoveHandler);return true;
	`);
	try {
		for (const selector of ['.ssb-deck-node', '.ssb-deck-source', '.ssb-deck-target-button']) {
			inView(`v.contentEl.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});return true;`);
			const beforeMoves = inView('return v.tooltipRegressionMoves;');
			const point = inView(`const r=v.contentEl.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};`);
			for (const offset of [-2, 2]) {
				execFileSync(cli, [`vault=${vault}`, 'dev:cdp', 'method=Input.dispatchMouseEvent',
					`params=${JSON.stringify({ type: 'mouseMoved', x: point.x + offset, y: point.y })}`],
				{ encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
			}
			evaluate(`new Promise(resolve=>setTimeout(()=>resolve(true),800))`);
			assert.ok(inView('return v.tooltipRegressionMoves;') > beforeMoves, `${selector}: hover must reach this view`);
		}
		assert.deepEqual(inView('return v.tooltipRegressionErrors;'), [], 'map hover and native button tooltips must not throw');
	} finally {
		inView(`
			w.removeEventListener('error',v.tooltipRegressionHandler);
			v.contentEl.removeEventListener('pointermove',v.tooltipRegressionMoveHandler);
			delete v.tooltipRegressionHandler;delete v.tooltipRegressionErrors;
			delete v.tooltipRegressionMoveHandler;delete v.tooltipRegressionMoves;return true;
		`);
	}

	const family = inView(`
		const root=w.getComputedStyle(v.contentEl),deck=w.getComputedStyle(v.contentEl.querySelector('.ssb-deck'));
		const control=w.getComputedStyle(v.contentEl.querySelector('.skill-switchboard-actions button'));
		return {panel:deck.borderTopLeftRadius,control:control.borderTopLeftRadius,
			motion:root.getPropertyValue('--ssb-motion').trim(),font:root.fontFamily,
			hostFont:root.getPropertyValue('--font-interface').trim()};
	`);
	assert.equal(family.panel, '12px');
	assert.equal(family.control, '8px');
	assert.ok(['160ms', '0ms'].includes(family.motion), 'motion follows the user preference');
	assert.ok(family.hostFont && family.font, 'keep the host interface font');

	// Test the actual button, including Obsidian's separate settings window.
	inView(`v.contentEl.querySelector('.skill-switchboard-utility-actions button[aria-label="'+(p.settings.language==='zh-CN'?'设置':'Settings')+'"]').click();return true;`);
	const navigation = evaluate(`({selected:app.setting.activeTab?.id,open:app.setting.isOpen,visible:app.setting.modalEl.isConnected&&app.setting.modalEl.getBoundingClientRect().width>0})`);
	assert.equal(navigation.selected, 'skill-switchboard');
	assert.equal(navigation.open, true);
	assert.equal(navigation.visible, true);
	const settingsEditors = evaluate(`new Promise(resolve=>setTimeout(()=>{
		const p=app.plugins.plugins['skill-switchboard'],el=app.setting.activeTab.containerEl;
		resolve({names:Array.from(el.querySelectorAll('.setting-item-name')).map(e=>e.textContent),
			packages:p.index.skills.map(s=>s.frontmatter.package_id).filter(Boolean),
			overflow:el.scrollWidth-el.clientWidth,
			registryVisible:el.textContent.includes(p.packageRegistryPath)});
	},300))`);
	assert(settingsEditors.names.includes(baseline.language==='zh-CN'?'唯一来源':'Canonical source'),'distribution-source editor must be visible');
	assert(settingsEditors.registryVisible,'machine-local registry location must be visible');
	assert(settingsEditors.overflow<=1,'dynamic settings must fit the actual settings window');
	for(const id of settingsEditors.packages)assert(settingsEditors.names.includes(id),`external package editor missing: ${id}`);
	evaluate(`(app.setting.close(),true)`);
	inView(`v.contentEl.querySelectorAll('.skill-switchboard-stat')[2].click();return true;`);
	assert.equal(evaluate(`app.setting.activeTab?.id`), 'skill-switchboard');
	assert.equal(evaluate(`app.setting.isOpen`), true);
	evaluate(`(app.setting.close(),true)`);

	for (const language of ['en', 'zh-CN']) {
		const focus = inView(`
			const button=v.contentEl.querySelector('.ssb-deck-target-button');button.focus();
			return {native:button.ownerDocument.activeElement===button,highlighted:v.contentEl.querySelectorAll('.ssb-deck-node.is-highlighted').length,svgStops:v.contentEl.querySelectorAll('svg [tabindex]').length};
		`);
		assert.equal(focus.native, true);
		assert.equal(focus.highlighted, 1);
		assert.equal(focus.svgStops, 0, 'do not hand SVG focus to Obsidian HTMLElement-only helpers');
		const title = inView(`p.settings.language=${JSON.stringify(language)};v.renderIndex();return v.contentEl.querySelector('h1').textContent;`);
		assert.equal(title, language === 'en' ? 'Skill Switchboard' : '技能接线台');
		for (const width of ['100%', '960px', '560px', '390px', '320px']) {
			inView(`v.contentEl.style.width=${JSON.stringify(width)};return true;`);
			const layout = inView(`
				const r=v.contentEl.getBoundingClientRect(),body=v.contentEl.querySelector('.ssb-deck-body'),svg=v.contentEl.querySelector('.ssb-deck-svg');
				const style=w.getComputedStyle(v.contentEl);
				return {overflow:v.contentEl.scrollWidth-v.contentEl.clientWidth,
					containerWidth:v.contentEl.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
					outside:Array.from(v.contentEl.querySelectorAll('button,.ssb-deck-target,.skill-switchboard-search')).filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.left<r.left-1||b.right>r.right+1);}).map(e=>e.className),
					columns:w.getComputedStyle(body).gridTemplateColumns.split(' ').length,svgWidth:svg.getBoundingClientRect().width};
			`);
			assert.ok(layout.overflow <= 1, `${language}/${width}: horizontal overflow ${layout.overflow}`);
			assert.deepEqual(layout.outside, [], `${language}/${width}: controls outside the page`);
			assert.ok(layout.svgWidth > 0);
			assert.equal(layout.columns, layout.containerWidth >= 680 ? 2 : 1);
		}
	}

	inView(`v.contentEl.style.width='100%';p.settings.language=${JSON.stringify(baseline.language)};v.renderIndex();return true;`);
	const total = inView(`return v.contentEl.querySelectorAll('.skill-switchboard-card').length;`);
	assert.ok(total > 0, 'this live test expects an indexed skill');
	for (const query of ['jardin', '__switchboard_no_matching_skill__']) {
		const search = inView(`
			const input=v.contentEl.querySelector('input[type=search]');input.value=${JSON.stringify(query)};input.dispatchEvent(new w.Event('input',{bubbles:true}));
			const result=v.contentEl.querySelector('.skill-switchboard-list,.skill-switchboard-no-results');
			return {cards:v.contentEl.querySelectorAll('.skill-switchboard-card').length,sibling:result.previousElementSibling.classList.contains('skill-switchboard-search'),focusRetained:input===v.contentEl.querySelector('input[type=search]')};
		`);
		assert.equal(search.sibling, true, 'filtered results belong after the search field, not inside it');
		assert.equal(search.focusRetained, true);
		if (query.startsWith('__')) assert.equal(search.cards, 0);
		const reset = inView(`
			v.contentEl.querySelector('.skill-switchboard-search-clear').click();
			return {cards:v.contentEl.querySelectorAll('.skill-switchboard-card').length,
				filtering:v.contentEl.querySelector('.skill-switchboard-search').classList.contains('is-filtering'),
				count:v.contentEl.querySelector('.skill-switchboard-search-count').textContent};
		`);
		assert.equal(reset.cards, total);
		assert.equal(reset.filtering, false);
		assert.equal(reset.count, '');
	}

	for (const theme of ['theme-light', 'theme-dark']) {
		const contrast = inView(`
			w.document.body.classList.remove('theme-light','theme-dark');w.document.body.classList.add(${JSON.stringify(theme)});
			const canvas=w.document.createElement('canvas'),ctx=canvas.getContext('2d');
			const luminance=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(n=>{const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
			const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
			const deck=v.contentEl.querySelector('.ssb-deck'),c=w.getComputedStyle(deck),background=c.backgroundColor;
			return {text:ratio(c.color,background),success:ratio(c.getPropertyValue('--ssb-success'),background),warning:ratio(c.getPropertyValue('--ssb-warning'),background),error:ratio(c.getPropertyValue('--ssb-error'),background)};
		`);
		for (const [state, ratio] of Object.entries(contrast)) assert.ok(ratio >= 4.5, `${theme}/${state}: contrast ${ratio}`);
	}
	console.log('Live UI checks passed: tooltip-safe accessible SVG, native hover, family styling, settings navigation, bilingual layouts, search/reset, and light/dark status contrast.');
} finally {
	inView(`
		p.settings.language=${JSON.stringify(baseline.language)};v.query=${JSON.stringify(baseline.query)};v.contentEl.style.width=${JSON.stringify(baseline.width)};
		w.document.body.classList.toggle('theme-light',${baseline.themeLight});w.document.body.classList.toggle('theme-dark',${baseline.themeDark});
		v.renderIndex();v.contentEl.scrollTop=${baseline.scrollTop};return true;
	`);
	assert.equal(inView(`return JSON.stringify(p.settings);`), baseline.settings, 'live verification must preserve settings');
}
