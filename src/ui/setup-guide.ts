import { setIcon } from 'obsidian';
import type { Strings } from '../i18n';

export interface SetupGuideState {
	sourceReady: boolean;
	targetsReady: boolean;
	indexReady: boolean;
}

/** Show only while the board still needs its first connection; disappear when ready. */
export function renderSetupGuide(
	container: HTMLElement,
	strings: Strings,
	state: SetupGuideState,
	onSettings: () => void,
	onRefresh: () => void,
): boolean {
	if (state.sourceReady && state.targetsReady && state.indexReady) return false;
	const section = container.createDiv('ssb-setup-guide');
	const heading = section.createDiv('ssb-setup-heading');
	setIcon(heading.createSpan('ssb-setup-icon'), 'plug-zap');
	const copy = heading.createDiv();
	copy.createEl('h2', { text: strings.setupTitle });
	copy.createDiv({ text: strings.setupDescription, cls: 'ssb-setup-description' });
	const steps = section.createDiv('ssb-setup-steps');
	setupStep(steps, state.sourceReady, strings.setupSource, strings.setupSourceDone);
	setupStep(steps, state.targetsReady, strings.setupTargets, strings.setupTargetsDone);
	setupStep(steps, state.indexReady, strings.setupIndex, strings.setupIndexDone);
	const actions = section.createDiv('ssb-setup-actions');
	if (!state.sourceReady || !state.targetsReady) {
		const settings = actions.createEl('button', { text: strings.setupOpenSettings, cls: 'ssb-setup-button mod-cta' });
		settings.setAttribute('type', 'button');
		settings.addEventListener('click', onSettings);
	}
	if (state.sourceReady && !state.indexReady) {
		const refresh = actions.createEl('button', { text: strings.setupRefresh, cls: 'ssb-setup-button' });
		refresh.setAttribute('type', 'button');
		refresh.addEventListener('click', onRefresh);
	}
	return true;
}

function setupStep(container: HTMLElement, complete: boolean, pending: string, done: string): void {
	const step = container.createDiv(`ssb-setup-step ${complete ? 'is-complete' : 'is-pending'}`);
	setIcon(step.createSpan('ssb-setup-step-icon'), complete ? 'check' : 'circle');
	step.createSpan({ text: complete ? done : pending });
}
