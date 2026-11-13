import type { RepairSummary } from '../sync/adapter-run';

/** Counts describe recorded writes and retirements, never phrases in the output log. */
export function repairTotals(summary: RepairSummary): { targets: number; skills: number | null; files: number | null } {
	if (summary.details.some((detail) => !detail.repair.native)) return { targets: summary.repairedCount, skills: null, files: null };
	// A target whose only work was retiring a copy changed nothing on disk, but it
	// did change, so counting it as repaired is what makes the summary honest.
	const changed = summary.details.filter((detail) => (detail.repair.native?.writtenFiles ?? 0) > 0
		|| (detail.repair.native?.replacedDirectories ?? 0) > 0
		|| (detail.repair.native?.retiredSkills ?? []).length > 0);
	return {
		targets: changed.length,
		skills: new Set(changed.flatMap((detail) => detail.repair.native?.changedSkills ?? [])).size,
		files: changed.reduce((count, detail) => count + (detail.repair.native?.writtenFiles ?? 0), 0),
	};
}

/** How many copies the last repair retired, and how many it kept back. */
export function orphanTotals(summary: RepairSummary): { retired: number; kept: number } {
	const details = summary.details.map((detail) => detail.repair.native);
	return {
		retired: details.reduce((count, native) => count + (native?.retiredSkills ?? []).length, 0),
		kept: details.reduce((count, native) => count + (native?.keptOrphans ?? []).length, 0),
	};
}
