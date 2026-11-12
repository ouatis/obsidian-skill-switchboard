import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A minimal fake element that records the tree the way the plugin builds it. */
function fakeElement(tagName) {
	const element = {
		tagName: tagName.toUpperCase(), className: '', textContent: '', children: [], parentElement: null,
		attributes: new Map(), listeners: new Map(),
		setAttribute(name, value) { this.attributes.set(name, value); },
		addEventListener(name, callback) { this.listeners.set(name, callback); },
		addClass(name) { this.className = `${this.className} ${name}`.trim(); },
	};
	const append = (tag, options) => {
		const child = fakeElement(tag);
		const attributes = typeof options === 'string' ? { cls: options } : options ?? {};
		child.className = attributes.cls ?? '';
		child.textContent = attributes.text ?? '';
		child.parentElement = element;
		element.children.push(child);
		return child;
	};
	element.createDiv = (options) => append('div', options);
	element.createEl = (tag, options) => append(tag, options);
	element.createSpan = (options) => append('span', options);
	return element;
}

function collect(node) {
	return [node.textContent, ...node.children.flatMap(collect)].filter((text) => text);
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switchboard-orphan-'));
const vault = path.join(temporary, 'vault');
const source = path.join(vault, 'skills');
const location = { sharedRoot: source, manifestPath: path.join(vault, 'skills-manifest.json'), confineToVault: true };
const store = path.join(temporary, 'snapshots');

async function write(file, bytes) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, bytes);
}

async function bundleOf(name) {
	const bundle = path.join(temporary, `${name}.cjs`);
	await esbuild.build({ entryPoints: [path.join(repo, 'src/sync', `${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
	return import(pathToFileURL(bundle).href);
}

/** Loads one src entry on its own, so module state is never shared between callers. */
async function load(entry) {
	const bundle = path.join(temporary, `${entry.replaceAll('/', '-')}.cjs`);
	await esbuild.build({ entryPoints: [path.join(repo, 'src', `${entry}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
	return import(pathToFileURL(bundle).href);
}

try {
	const modules = {};
	for (const name of ['manifest', 'native-check', 'native-repair', 'install-ledger']) modules[name] = await bundleOf(name);
	// target-snapshot imports install-ledger, so it needs its own isolated bundle
	// (one shared outfile would carry two copies of the ledger module state).
	const snapshotBundle = path.join(temporary, 'target-snapshot.cjs');
	await esbuild.build({ entryPoints: [path.join(repo, 'src/sync/target-snapshot.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: snapshotBundle, logLevel: 'silent' });
	modules['target-snapshot'] = await import(pathToFileURL(snapshotBundle).href);

	const inspect = () => modules.manifest.inspectManifest(vault, location);
	const checkWith = (snapshot, target, extra = {}) => modules['native-check'].checkRuntimeNative(vault, 'codex', target, snapshot, { ...extra, ledgerDirectory: store });
	const repair = (snapshot, target, extra = {}) => modules['native-repair'].repairRuntimeNative(vault, 'codex', target, snapshot, { sweepOrphans: true, ...extra, ledgerDirectory: store, snapshotDirectory: store });
	const target = path.join(temporary, 'codex');
	const goneDirectory = path.join(target, 'gone');

	await write(path.join(source, 'drawing/SKILL.md'), '---\nname: drawing\ndescription: Draw diagrams.\n---\n\n# Drawing\n\nInstructions.\n');
	await write(path.join(source, 'gone/SKILL.md'), '---\nname: gone\ndescription: About to leave.\n---\n\n# Gone\n\nInstructions.\n');
	let inspected = await inspect();
	assert.equal(inspected.status, 'passed', inspected.output);
	assert.equal(inspected.snapshot.skillCount, 2);

	// Both skills are installed and recorded in the ledger.
	const first = await repair(inspected.snapshot, target);
	assert.equal(first.status, 'passed', first.output);
	assert.equal(first.writtenFiles, 4, 'two skills, one file each');
	assert.equal(first.retiredSkills.length, 0, 'nothing is retired while both sources exist');
	const afterInstall = await checkWith(inspected.snapshot, target);
	assert.equal(afterInstall.kind, 'clean');
	assert.equal(afterInstall.orphanCandidates.length, 0, 'no orphan is reported while the skill is in the source');

	// A fresh install is current, and the ledger is the only ownership evidence.
	assert.equal((await checkWith(inspected.snapshot, target)).installs.find((item) => item.name === 'gone').state, 'current');
	const ledgerPath = path.join(store, modules['install-ledger'].LEDGER);
	const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
	assert.equal(ledger.entries.length, 2, 'each installed copy gets a ledger entry');
	assert.deepEqual(ledger.entries.map((entry) => entry.skill).sort(), ['drawing', 'gone']);

	// The source loses one skill: its copy becomes an orphan, and only that copy.
	await fs.rm(path.join(source, 'gone'), { recursive: true, force: true });
	const reduced = await inspect();
	assert.equal(reduced.status, 'passed', reduced.output);
	assert.equal(reduced.snapshot.skillCount, 1);

	// The retired copy is not drift: the target is exactly what the reduced
	// source now installs. It is reported separately as an orphan, which is the
	// whole point — a clean target can still hold a copy nobody asked for.
	const scanned = await checkWith(reduced.snapshot, target);
	assert.equal(scanned.kind, 'clean', 'the target matches the reduced source');
	assert.equal(scanned.status, 'passed', scanned.output);
	const orphans = scanned.orphanCandidates;
	assert.equal(orphans.length, 1, `one sweepable orphan, got ${JSON.stringify(scanned.orphanEntries)}`);
	assert.equal(orphans[0].skill, 'gone');
	assert.equal(path.basename(orphans[0].path), 'gone');
	assert.equal(orphans[0].reason, null, 'an untouched copy is removable');

	// Repair retires exactly that copy, and leaves the other skill alone.
	const repaired = await repair(reduced.snapshot, target);
	assert.equal(repaired.status, 'passed', repaired.output);
	assert.equal(repaired.writtenFiles, 0, 'the surviving skill already matches, so nothing is rewritten');
	assert.equal(repaired.retiredSkills.length, 1, `one retired copy, got ${JSON.stringify(repaired.retiredSkills)}`);
	assert.equal(path.basename(repaired.retiredSkills[0]), 'gone');
	await assert.rejects(fs.access(path.join(goneDirectory, 'SKILL.md')), { code: 'ENOENT' }, 'the retired copy is really gone');
	assert.equal(await fs.readFile(path.join(target, 'drawing/SKILL.md'), 'utf8'), await fs.readFile(path.join(source, 'drawing/SKILL.md'), 'utf8'), 'the live copy is untouched');

	// A retirement is reversible: the snapshot holds the tree that was removed.
	const snapshots = await modules['target-snapshot'].latestTargetSnapshot(store, 'gone');
	assert.ok(snapshots, 'a snapshot exists for the retired copy');
	assert.equal(await fs.readFile(path.join(snapshots.directory, 'SKILL.md'), 'utf8'), '---\nname: gone\ndescription: About to leave.\n---\n\n# Gone\n\nInstructions.\n');

	// The ledger drops the retired entry, so a second repair has nothing to sweep.
	const afterLedger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
	assert.equal(afterLedger.entries.length, 1, 'the retired entry is forgotten');
	const again = await repair(reduced.snapshot, target);
	assert.equal(again.retiredSkills.length, 0, 'an already-retired copy is not reported again');

	// A directory the user wrote by hand is never retired, even without a ledger entry.
	await write(path.join(target, 'handmade/SKILL.md'), '---\nname: handmade\ndescription: Mine.\n---\n\n# Handmade\n');
	const kept = await checkWith(reduced.snapshot, target);
	assert.equal(kept.orphanCandidates.length, 0, 'an unmanaged directory is not sweepable');
	assert.equal(await fs.readFile(path.join(target, 'handmade/SKILL.md'), 'utf8'), '---\nname: handmade\ndescription: Mine.\n---\n\n# Handmade\n');

	// A copy whose source leaves but whose tree changed since install is
	// reported and kept: the source can no longer supply the original, so
	// nothing here can prove the tree is still the plugin's own work.
	await write(path.join(source, 'leaving/SKILL.md'), '---\nname: leaving\ndescription: Leaving now.\n---\n\n# Leaving\n');
	const withLeaving = await inspect();
	assert.equal(withLeaving.snapshot.skillCount, 2);
	assert.equal((await repair(withLeaving.snapshot, target)).status, 'passed');
	await fs.rm(path.join(source, 'leaving'), { recursive: true, force: true });
	await write(path.join(target, 'leaving/SKILL.md'), '---\nname: leaving\ndescription: Leaving now, locally edited.\n---\n\n# Leaving\n\nEdited.\n');
	const reduced2 = await inspect();
	const editedScan = await checkWith(reduced2.snapshot, target);
	const editedOrphan = editedScan.orphanEntries.find((entry) => entry.skill === 'leaving');
	assert.equal(editedOrphan.reason, 'edited', 'a changed copy is reported, not swept');
	const edited = await repair(reduced2.snapshot, target);
	assert.equal(edited.status, 'passed', edited.output);
	assert.equal(edited.retiredSkills.length, 0, 'an edited copy is never swept');
	assert.equal(edited.keptOrphans.length, 1, 'the kept copy is named');
	assert.equal(await fs.readFile(path.join(target, 'leaving/SKILL.md'), 'utf8'), '---\nname: leaving\ndescription: Leaving now, locally edited.\n---\n\n# Leaving\n\nEdited.\n');

	// A live skill is never retired, even when the ledger names it: this is the
	// guard that keeps a rename from taking a copy the source still installs.
	const stillLive = await checkWith(withLeaving.snapshot, target);
	assert.equal(stillLive.orphanCandidates.length, 0, 'a skill the source still installs is not an orphan');

	// The plan and the confirmation list name the copies that are about to go.
	const { getStrings } = await load('i18n');
	const { renderOrphanPlan } = await load('ui/install-plan');
	const { repairPlanDetails, orphanConfirmCount } = await load('ui/repair-plan');
	const en = getStrings('en');
	const zh = getStrings('zh-CN');
	// The UI reads a check's `native` payload, so wrap the native result the way
	// the provider does.
	const targetCheck = (result) => ({
		target: { id: 'codex', label: 'Codex', path: target, mode: 'copy', enabled: true, runtime: 'codex' },
		targetPath: target,
		result: { ...result, native: result },
		repairable: true,
	});

	// A fresh orphan in the source, so the panel and the plan have something to list.
	await write(path.join(source, 'fresh/SKILL.md'), '---\nname: fresh\ndescription: About to leave.\n---\n\n# Fresh\n');
	const withFresh = await inspect();
	assert.equal(withFresh.status, 'passed', withFresh.output);
	const installedFresh = await repair(withFresh.snapshot, target);
	assert.equal(installedFresh.retiredSkills.length, 0);
	await fs.rm(path.join(source, 'fresh'), { recursive: true, force: true });
	const reduced3 = await inspect();
	assert.equal(reduced3.status, 'passed', reduced3.output);
	const planned = await checkWith(reduced3.snapshot, target);
	assert.equal(planned.orphanCandidates.length, 1, `one sweepable copy, got ${JSON.stringify(planned.orphanEntries)}`);
	assert.equal(planned.orphanCandidates[0].skill, 'fresh');

	for (const locale of [en, zh]) {
		const container = fakeElement('div');
		renderOrphanPlan(container, [targetCheck(planned)], locale);
		const section = container.children[0];
		assert.equal(section.attributes.get('data-install-group'), 'orphan', 'the orphan panel is its own group');
		const texts = collect(section).join(' ');
		assert.match(texts, /fresh/, 'the copy to retire is named');
		assert.ok(texts.includes(locale.orphanRetire), 'the action is named in the panel');
		// A kept copy is still shown, but never as something about to be removed.
		const keptOnly = { ...planned, orphanCandidates: [], orphanEntries: planned.orphanEntries.map((entry) => ({ ...entry, reason: 'edited' })) };
		const keptContainer = fakeElement('div');
		renderOrphanPlan(keptContainer, [targetCheck(keptOnly)], locale);
		assert.equal(keptContainer.children.length, 1, 'a kept copy is reported in the panel');
		assert.ok(collect(keptContainer.children[0]).join(' ').includes(locale.orphanKept), 'a kept copy reads as kept');
		assert.ok(!collect(keptContainer.children[0]).join(' ').includes(locale.orphanRetire), 'a kept copy is not listed as something to retire');

		const plan = repairPlanDetails([targetCheck(planned)], locale);
		assert.ok(plan.includes(locale.orphanRetire), 'the confirmation list names the removal');
		assert.ok(plan.includes('fresh'));
		// The confirmation paragraph carries the count, so the user reads how many
		// copies are about to disappear without counting lines in the list.
		assert.equal(orphanConfirmCount([targetCheck(planned)]), 1);
		assert.ok(plan.includes(locale.orphanConfirm(1)), 'the paragraph says how many will be removed');
		// A kept-only scope must not claim any removal is coming.
		assert.equal(orphanConfirmCount([targetCheck(keptOnly)]), 0);
		const keptPlan = repairPlanDetails([targetCheck(keptOnly)], locale);
		assert.ok(keptPlan.includes(locale.orphanKept), 'a kept copy is reported, not counted as work');
		assert.ok(keptPlan.includes(locale.orphanReasonEdited('edited')));
		assert.ok(!keptPlan.includes(locale.orphanRetire), 'a kept copy is never listed as something to retire');
	}

	// Retiring it here leaves the target exactly as a real repair would.
	const swept = await repair(reduced3.snapshot, target);
	assert.equal(swept.retiredSkills.length, 1, `one copy retired, got ${JSON.stringify(swept.retiredSkills)}`);
	assert.equal(swept.keptOrphans.length, 1, 'the edited copy from earlier is still reported as kept');
	assert.equal(swept.keptOrphans[0].includes('leaving'), true, 'the kept copy is the edited one');
	await assert.rejects(fs.access(path.join(target, 'fresh/SKILL.md')), { code: 'ENOENT' }, 'the copy is really gone');
	console.log('Orphan retirement passed: install records ownership, source removal retires the copy, snapshot makes it reversible, hand-written and edited copies are kept, and the plan lists what will go.');
} finally {
	assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
	await fs.rm(temporary, { recursive: true, force: true });
}