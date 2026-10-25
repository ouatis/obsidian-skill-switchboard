import { DECK_CENTER, type DeckPoint } from './distribution-state';

export function svgElement<K extends keyof SVGElementTagNameMap>(
	parent: Element,
	tag: K,
	attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
	const element = (parent as Element & { createSvg: (tag: K) => SVGElementTagNameMap[K] }).createSvg(tag);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
	parent.appendChild(element);
	return element;
}

let descriptionId = 0;

/** Obsidian treats aria-label as an HTML tooltip hook; SVG uses a named title instead. */
export function describeSvg(parent: SVGElement): SVGTitleElement {
	const id = `ssb-deck-description-${++descriptionId}`;
	const title = svgElement(parent, 'title', { id });
	parent.setAttribute('aria-labelledby', id);
	return title;
}

/** Original SVG geometry; no Hairline code, assets, or runtime dependency. */
export function drawPlate(parent: Element, halfWidth: number, halfHeight: number, depth: number): void {
	const w = halfWidth, h = halfHeight;
	svgElement(parent, 'path', {
		d: `M ${-w} 0 L 0 ${h} L ${w} 0 L ${w} ${depth} L 0 ${h + depth} L ${-w} ${depth} Z`,
		class: 'ssb-deck-plate-side',
	});
	svgElement(parent, 'path', {
		d: `M 0 ${-h} L ${w} 0 L 0 ${h} L ${-w} 0 Z`,
		class: 'ssb-deck-plate-top',
	});
	svgElement(parent, 'path', { d: `M 0 ${h} V ${h + depth}`, class: 'ssb-deck-crease' });
}

export function drawRoute(parent: Element, point: DeckPoint): SVGPathElement {
	const dx = point.x - DECK_CENTER.x, dy = point.y - DECK_CENTER.y;
	return svgElement(parent, 'path', {
		d: `M ${DECK_CENTER.x + dx * 0.23} ${DECK_CENTER.y + dy * 0.23 + 6} L ${point.x - dx * 0.17} ${point.y - dy * 0.17 + 6}`,
		class: 'ssb-deck-route is-unknown',
	});
}

export function drawStateMark(parent: Element): SVGPathElement {
	return svgElement(parent, 'path', { class: 'ssb-deck-mark' });
}

export const STATE_MARKS = {
	unknown: 'M -4 0 H 4',
	checking: 'M -4 -2 H 4 M -4 2 H 1',
	repairing: 'M -4 0 H 4 M 0 -4 V 4',
	clean: 'M -5 0 L -1 3 L 5 -3',
	drift: 'M 0 -4 V 1 M 0 4 h .01',
	blocked: 'M -4 -2 H 4 M -4 2 H 4',
	unavailable: 'M -3 -3 L 3 3 M 3 -3 L -3 3',
	'repair-failed': 'M -3 -3 L 3 3 M 3 -3 L -3 3',
};
