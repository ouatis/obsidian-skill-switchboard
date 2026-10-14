import type { RepairSummary } from '../sync/adapter-run';

/** Counts describe recorded writes, never phrases in the output log. */
export function repairTotals(summary: RepairSummary): { targets: number; skills: number | null; files: number | null } {
	if (summary.details.some((detail) => !detail.repair.native)) return { targets: summary.repairedCount, skills: null, files: null };
	const changed = summary.details.filter((detail) => (detail.repair.native?.writtenFiles ?? 0) > 0 || (detail.repair.native?.replacedDirectories ?? 0) > 0);
	return {
		targets: changed.length,
		skills: new Set(changed.flatMap((detail) => detail.repair.native?.changedSkills ?? [])).size,
		files: changed.reduce((count, detail) => count + (detail.repair.native?.writtenFiles ?? 0), 0),
	};
}
