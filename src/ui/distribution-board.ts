import { setIcon } from 'obsidian';
import type { Strings } from '../i18n';
import { DECK_CENTER, deckPositions, type DistributionNode, type DistributionState } from './distribution-state';
import { describeSvg, drawPlate, drawRoute, drawStateMark, STATE_MARKS, svgElement } from './distribution-svg';

export interface DistributionBoardModel {
	nodes: DistributionNode[];
	sourcePath: string;
	sourceUnavailable: boolean;
	checkedAt: number;
	strings: Strings;
}

interface NodeElements {
	group: SVGGElement;
	description: SVGTitleElement;
	label: SVGTextElement;
	mark: SVGPathElement;
	route: SVGPathElement;
	item: HTMLLIElement;
	button: HTMLButtonElement;
	name: HTMLSpanElement;
	status: HTMLSpanElement;
}

/** A local, event-driven figure. At rest it has no animation loop or timers. */
export class DistributionBoard {
	readonly element: HTMLElement;
	private readonly title: HTMLElement;
	private readonly subtitle: HTMLElement;
	private readonly sourcePath: HTMLElement;
	private readonly hide: HTMLButtonElement;
	private readonly stage: HTMLElement;
	private readonly targets: HTMLUListElement;
	private readonly readoutTitle: HTMLElement;
	private readonly readoutDetail: HTMLElement;
	private readonly footer: HTMLElement;
	private elements = new Map<string, NodeElements>();
	private sourceGroup: SVGGElement | null = null;
	private sourceLabel: SVGTextElement | null = null;
	private sourceDescription: SVGTitleElement | null = null;
	private figureDescription: SVGTitleElement | null = null;
	private svg: SVGSVGElement | null = null;
	private signature = '';
	private hovered: string | null = null;
	private focused: string | null = null;
	private model: DistributionBoardModel;

	constructor(parent: HTMLElement, model: DistributionBoardModel, onHide: () => void) {
		this.model = model;
		this.element = parent.createDiv('ssb-deck');
		const header = this.element.createDiv('ssb-deck-header');
		const heading = header.createDiv();
		this.title = heading.createDiv('ssb-deck-title');
		this.subtitle = heading.createDiv('ssb-deck-subtitle');
		this.hide = header.createEl('button', { cls: 'ssb-deck-hide' });
		setIcon(this.hide, 'eye-off');
		this.hide.addEventListener('click', onHide);
		this.sourcePath = this.element.createEl('button', { cls: 'ssb-deck-source-path' });
		this.sourcePath.addEventListener('pointerenter', () => this.highlight('source', 'hover'));
		this.sourcePath.addEventListener('pointerleave', () => this.highlight(null, 'hover'));
		this.sourcePath.addEventListener('focus', () => this.highlight('source', 'focus'));
		this.sourcePath.addEventListener('blur', () => this.highlight(null, 'focus'));
		const body = this.element.createDiv('ssb-deck-body');
		this.stage = body.createDiv('ssb-deck-stage');
		const side = body.createDiv('ssb-deck-side');
		const readout = side.createDiv('ssb-deck-readout');
		readout.setAttribute('role', 'status');
		this.readoutTitle = readout.createDiv('ssb-deck-readout-title');
		this.readoutDetail = readout.createDiv('ssb-deck-readout-detail');
		this.targets = side.createEl('ul', { cls: 'ssb-deck-targets' });
		this.footer = this.element.createDiv('ssb-deck-footer');
		this.update(model);
	}

	update(model: DistributionBoardModel): void {
		this.model = model;
		const strings = model.strings;
		this.title.setText(strings.distributionBoard);
		this.subtitle.setText(strings.distributionSubtitle(model.nodes.length));
		this.sourcePath.setText(model.sourcePath);
		this.sourcePath.setAttribute('title', model.sourcePath);
		this.sourcePath.setAttribute('aria-label', `${strings.distributionSource}: ${model.sourcePath}`);
		this.hide.setAttribute('aria-label', strings.distributionHide);
		this.hide.setAttribute('title', strings.distributionHide);
		const signature = JSON.stringify(model.nodes.map((node) => node.id));
		if (signature !== this.signature || !this.svg) {
			this.signature = signature;
			this.buildFigure();
		}
		if (this.figureDescription) this.figureDescription.textContent = strings.distributionSubtitle(model.nodes.length);
		this.sourceGroup?.classList.toggle('is-unavailable', model.sourceUnavailable);
		if (this.sourceDescription) this.sourceDescription.textContent = `${strings.distributionSource}: ${model.sourcePath}${model.sourceUnavailable ? ` · ${strings.distributionUnavailable}` : ''}`;
		if (this.sourceLabel) this.sourceLabel.textContent = strings.distributionSource;
		for (const node of model.nodes) {
			const elements = this.elements.get(node.id);
			if (!elements) continue;
			const state = this.stateLabel(node.state);
			elements.group.setAttribute('class', `ssb-deck-node is-${node.state}`);
			elements.description.textContent = `${node.label}: ${state}`;
			elements.group.dataset.state = node.state;
			elements.label.textContent = node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label;
			elements.mark.setAttribute('d', STATE_MARKS[node.state]);
			elements.route.setAttribute('class', `ssb-deck-route is-${node.state}`);
			elements.item.className = `ssb-deck-target is-${node.state}`;
			elements.item.setAttribute('title', `${node.label}: ${state}\n${node.path}`);
			elements.button.setAttribute('aria-label', `${node.label}: ${state} · ${node.path}`);
			elements.name.setText(node.label);
			elements.status.setText(state);
		}
		this.targets.hidden = model.nodes.length === 0;
		const time = model.checkedAt
			? `${strings.distributionLastCheck} ${new Date(model.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · `
			: '';
		this.footer.setText(`${time}${strings.distributionDisclaimer}`);
		this.updateReadout();
	}

	destroy(): void {
		this.element.remove();
		this.elements.clear();
		this.svg = null;
		this.figureDescription = null;
		this.sourceDescription = null;
	}

	private buildFigure(): void {
		this.stage.empty();
		this.targets.empty();
		this.elements.clear();
		this.hovered = null;
		this.focused = null;
		const svg = svgElement(this.stage, 'svg', { viewBox: '0 0 420 235', role: 'group', class: 'ssb-deck-svg' });
		this.svg = svg;
		this.figureDescription = describeSvg(svg);
		svgElement(svg, 'path', { d: 'M 20 108 L 210 13 L 400 108 L 210 203 Z M 67 132 L 257 37 M 115 156 L 305 61 M 162 180 L 352 85 M 67 85 L 257 180 M 115 61 L 305 156 M 162 37 L 352 132', class: 'ssb-deck-grid' });
		const routes = svgElement(svg, 'g', { 'aria-hidden': 'true' });
		const positions = deckPositions(this.model.nodes.length);
		for (const [index, node] of this.model.nodes.entries()) {
			const point = positions[index];
			if (!point) continue;
			const route = drawRoute(routes, point);
			// Native HTML controls below own keyboard focus; Obsidian's focus helpers do not support SVG elements.
			const group = svgElement(svg, 'g', { transform: `translate(${point.x} ${point.y})`, role: 'img', 'data-target-id': node.id });
			const description = describeSvg(group);
			svgElement(group, 'path', { d: 'M 0 -10 L 23 1 L 0 13 L -23 1 Z', class: 'ssb-deck-footprint', 'aria-hidden': 'true' });
			const tile = svgElement(group, 'g', { class: 'ssb-deck-tile', 'aria-hidden': 'true' });
			drawPlate(tile, 23, 11, 7);
			const mark = drawStateMark(tile);
			const label = svgElement(group, 'text', { y: '35', 'text-anchor': 'middle', class: 'ssb-deck-node-label', 'aria-hidden': 'true' });
			const item = this.targets.createEl('li', { cls: 'ssb-deck-target' });
			const button = item.createEl('button', { cls: 'ssb-deck-target-button' });
			button.createSpan({ cls: 'ssb-deck-dot', attr: { 'aria-hidden': 'true' } });
			const name = button.createSpan('ssb-deck-target-name');
			const status = button.createSpan('ssb-deck-target-status');
			group.addEventListener('pointerenter', () => this.highlight(node.id, 'hover'));
			group.addEventListener('pointerleave', () => this.highlight(null, 'hover'));
			button.addEventListener('focus', () => this.highlight(node.id, 'focus'));
			button.addEventListener('blur', () => this.highlight(null, 'focus'));
			item.addEventListener('pointerenter', () => this.highlight(node.id, 'hover'));
			item.addEventListener('pointerleave', () => this.highlight(null, 'hover'));
			this.elements.set(node.id, { group, description, label, mark, route, item, button, name, status });
		}
		const source = svgElement(svg, 'g', { transform: `translate(${DECK_CENTER.x} ${DECK_CENTER.y})`, class: 'ssb-deck-source', role: 'img' });
		this.sourceGroup = source;
		this.sourceDescription = describeSvg(source);
		const stack = svgElement(source, 'g', { class: 'ssb-deck-tile', 'aria-hidden': 'true' });
		for (const y of [9, 4, -1]) drawPlate(svgElement(stack, 'g', { transform: `translate(0 ${y})` }), 31, 15, 5);
		svgElement(stack, 'path', { d: 'M -8 -3 L 4 -9 M -3 0 L 9 -6', class: 'ssb-deck-source-mark' });
		this.sourceLabel = svgElement(source, 'text', { y: '44', 'text-anchor': 'middle', class: 'ssb-deck-node-label', 'aria-hidden': 'true' });
		source.addEventListener('pointerenter', () => this.highlight('source', 'hover'));
		source.addEventListener('pointerleave', () => this.highlight(null, 'hover'));
	}

	private highlight(id: string | null, mode: 'hover' | 'focus'): void {
		if (mode === 'hover') this.hovered = id;
		else this.focused = id;
		this.updateReadout();
	}

	private updateReadout(): void {
		const selected = this.focused ?? this.hovered;
		for (const [id, elements] of this.elements) {
			elements.group.classList.toggle('is-highlighted', id === selected);
			elements.route.classList.toggle('is-highlighted', id === selected);
			elements.item.classList.toggle('is-highlighted', id === selected);
		}
		this.sourceGroup?.classList.toggle('is-highlighted', selected === 'source');
		const node = this.model.nodes.find((item) => item.id === selected)
			?? this.model.nodes.find((item) => item.state === 'checking' || item.state === 'repairing');
		const strings = this.model.strings;
		if (selected === 'source') {
			this.readoutTitle.setText(strings.distributionSource);
			this.readoutDetail.setText(this.model.sourceUnavailable ? strings.distributionUnavailable : this.model.sourcePath);
		} else if (node) {
			this.readoutTitle.setText(`${node.label} · ${this.stateLabel(node.state)}`);
			this.readoutDetail.setText(node.path);
		} else if (this.model.sourceUnavailable) {
			this.readoutTitle.setText(`${strings.distributionSource} · ${strings.distributionUnavailable}`);
			this.readoutDetail.setText(this.model.sourcePath);
		} else if (this.model.checkedAt && this.model.nodes.length) {
			const passed = this.model.nodes.filter((item) => item.state === 'clean').length;
			this.readoutTitle.setText(strings.distributionChecked(passed, this.model.nodes.length));
			this.readoutDetail.setText(strings.distributionInspect);
		} else {
			this.readoutTitle.setText(strings.distributionSubtitle(this.model.nodes.length));
			this.readoutDetail.setText(this.model.nodes.length ? strings.distributionHint : strings.distributionEmpty);
		}
	}

	private stateLabel(state: DistributionState): string {
		const strings = this.model.strings;
		return {
			unknown: strings.distributionUnknown,
			checking: strings.distributionChecking,
			repairing: strings.distributionRepairing,
			clean: strings.distributionClean,
			drift: strings.distributionDrift,
			blocked: strings.distributionBlocked,
			unavailable: strings.distributionUnavailable,
			'repair-failed': strings.distributionRepairFailed,
		}[state];
	}
}
