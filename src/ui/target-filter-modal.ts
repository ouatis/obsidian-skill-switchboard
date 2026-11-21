import { App, Modal, Setting } from 'obsidian';
import type { Strings } from '../i18n';
import type { RuntimeTarget, SkillFilter } from '../types';
import { parseSkillNamesInput } from '../sync/skill-filter';

type FilterMode = 'all' | 'include' | 'exclude';

export function editTargetSkillFilter(
	app: App,
	strings: Strings,
	target: RuntimeTarget,
	indexedSkillNames: readonly string[],
): Promise<SkillFilter | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: SkillFilter | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		let mode: FilterMode = target.includeSkills?.length
			? 'include'
			: target.excludeSkills?.length
				? 'exclude'
				: 'all';
		const selectedByMode = {
			include: new Set<string>(target.includeSkills ?? []),
			exclude: new Set<string>(target.excludeSkills ?? []),
		};
		const extraByMode = {
			include: '',
			exclude: '',
		};
		const knownNames = [...new Set([
			...indexedSkillNames,
			...(target.includeSkills ?? []),
			...(target.excludeSkills ?? []),
		])].sort((left, right) => left.localeCompare(right));

		const modal = new Modal(app);
		const titleTarget = target.label.trim()
			|| (target.runtime ? strings.runtimeLabel(target.runtime) : strings.unnamedTarget);
		modal.titleEl.setText(strings.targetFilterTitle(titleTarget));
		modal.contentEl.createEl('p', { text: strings.targetFilterDescription });

		new Setting(modal.contentEl)
			.setName(strings.targetFilterModeLabel)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('all', strings.targetFilterModeAll)
					.addOption('include', strings.targetFilterModeInclude)
					.addOption('exclude', strings.targetFilterModeExclude)
					.setValue(mode)
					.onChange((value) => {
						mode = value as FilterMode;
						renderBody();
					}),
			);

		const bodyEl = modal.contentEl.createDiv();
		const renderBody = () => {
			bodyEl.empty();
			if (mode === 'all') return;
			const currentSet = mode === 'include' ? selectedByMode.include : selectedByMode.exclude;
			if (knownNames.length > 0) {
				const list = bodyEl.createDiv('skill-switchboard-import-list');
				for (const name of knownNames) {
					const row = list.createEl('label', { cls: 'skill-switchboard-import-row' });
					const checkbox = row.createEl('input', { type: 'checkbox' });
					checkbox.checked = currentSet.has(name);
					checkbox.addEventListener('change', () => {
						if (checkbox.checked) currentSet.add(name);
						else currentSet.delete(name);
					});
					const info = row.createDiv('skill-switchboard-import-info');
					info.createEl('strong', { text: name });
				}
			}
			new Setting(bodyEl)
				.setName(strings.targetFilterExtraLabel)
				.addText((text) =>
					text
						.setValue(mode === 'include' ? extraByMode.include : extraByMode.exclude)
						.setPlaceholder(strings.targetFilterExtraPlaceholder)
						.onChange((value) => {
							if (mode === 'include') extraByMode.include = value;
							else extraByMode.exclude = value;
						}),
				);
		};
		renderBody();

		const buttons = modal.contentEl.createDiv('modal-button-container');
		const cancel = buttons.createEl('button', { text: strings.cancelRepair });
		cancel.addEventListener('click', () => {
			finish(null);
			modal.close();
		});

		const save = buttons.createEl('button', {
			text: strings.targetFilterSave,
			cls: 'mod-cta',
		});
		save.addEventListener('click', () => {
			if (mode === 'all') {
				finish({});
				modal.close();
				return;
			}
			const currentSet = mode === 'include' ? selectedByMode.include : selectedByMode.exclude;
			const extraText = mode === 'include' ? extraByMode.include : extraByMode.exclude;
			const names = [...new Set([...currentSet, ...parseSkillNamesInput(extraText)])]
				.sort((left, right) => left.localeCompare(right));
			if (names.length === 0) finish({});
			else if (mode === 'include') finish({ includeSkills: names });
			else finish({ excludeSkills: names });
			modal.close();
		});

		modal.onClose = () => finish(null);
		modal.open();
	});
}
