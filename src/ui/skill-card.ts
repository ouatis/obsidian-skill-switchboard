import type { IndexedSkill, RootKind } from '../types';
import type { Strings } from '../i18n';

/** Render one source card and keep its action separate from the details disclosure. */
export function renderSkillCard(
	container: HTMLElement,
	skill: IndexedSkill,
	strings: Strings,
	onActivate: () => void,
): void {
	const card = container.createDiv('skill-switchboard-card');
	const opensInObsidian = skill.rootKind === 'vault';
	card.addClass('is-actionable');
	const action = card.createEl('button', { cls: 'skill-switchboard-card-action' });
	action.setAttribute('type', 'button');
	const actionLabel = opensInObsidian ? strings.openSource : strings.copySourcePath;
	action.setAttribute('aria-label', `${actionLabel}: ${skill.name}`);
	action.setAttribute('title', actionLabel);
	action.addEventListener('click', onActivate);

	const heading = action.createSpan('skill-switchboard-card-heading');
	heading.createEl('strong', { text: skill.name });
	if (!opensInObsidian) {
		heading.createSpan({ text: rootKindLabel(skill.rootKind, strings), cls: 'skill-switchboard-badge' });
	}

	action.createSpan({
		text: skill.description || strings.noDescription,
		cls: 'skill-switchboard-description',
	});

	const details = card.createEl('details', { cls: 'skill-switchboard-details' });
	details.createEl('summary', { text: strings.technicalDetails, cls: 'skill-switchboard-check-label' });
	const body = details.createDiv('skill-switchboard-card-meta');
	body.createDiv({ text: `${strings.sourcePath} ${skill.path}`, cls: 'skill-switchboard-path' });
	body.createDiv({ text: `${strings.sha256} ${skill.sha256.slice(0, 12)}…`, cls: 'skill-switchboard-hash' });
}

function rootKindLabel(kind: RootKind, strings: Strings): string {
	return kind === 'external' ? strings.externalRoot : strings.vaultRelative;
}
