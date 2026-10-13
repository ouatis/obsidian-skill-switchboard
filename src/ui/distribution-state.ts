import type { RuntimeTarget } from '../types';
import { getRepairTargets, type TargetActivity, type TargetCheck } from '../sync/adapter-run';

export type DistributionState = 'unknown' | 'checking' | 'repairing' | 'clean' | 'drift' | 'unavailable' | 'repair-failed';

export interface DistributionNode {
	id: string;
	label: string;
	path: string;
	state: DistributionState;
}

export interface DistributionInput {
	targets: RuntimeTarget[];
	checks: TargetCheck[];
	activity: TargetActivity | null;
	blocked: boolean;
}

/** Read structured check results, never infer success from an aggregate log. */
export function distributionNodes(input: DistributionInput): DistributionNode[] {
	return getRepairTargets(input.targets).map((target) => {
		// An old result must not follow a target to a different path or runtime.
		const check = input.checks.find((item) => item.target.id === target.id
			&& item.target.path === target.path && item.target.runtime === target.runtime);
		let state: DistributionState = 'unknown';
		if (input.activity?.targetId === target.id) state = input.activity.phase;
		else if (check?.repairFailed) state = 'repair-failed';
		else if (check) {
			if (!check.repairable || check.result.native?.kind === 'error' || check.result.exitCode === 2) state = 'unavailable';
			else state = check.result.status === 'passed' ? 'clean' : 'drift';
		} else if (input.blocked) state = 'unavailable';
		return { id: target.id, label: target.label.trim() || target.runtime, path: target.path, state };
	});
}

export interface DeckPoint { x: number; y: number }

export const DECK_CENTER: DeckPoint = { x: 210, y: 104 };

/** Geometry follows the configured target count; it is not a fixed six-agent illustration. */
export function deckPositions(count: number): DeckPoint[] {
	return Array.from({ length: count }, (_, index) => {
		const angle = count <= 2 ? index * Math.PI : -Math.PI / 2 + index * 2 * Math.PI / count;
		return { x: DECK_CENTER.x + Math.cos(angle) * 140, y: DECK_CENTER.y + Math.sin(angle) * 72 };
	});
}
