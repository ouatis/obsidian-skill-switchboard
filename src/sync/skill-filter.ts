import type { SkillFilter } from '../types';

export type SkillFilterListParse = { valid: true; value?: string[] } | { valid: false };

export function parseSkillFilterList(value: unknown): SkillFilterListParse {
	if (value === undefined) return { valid: true };
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		return { valid: false };
	}
	const normalized = [...new Set(
		(value as string[])
			.map((item) => item.trim())
			.filter(Boolean),
	)].sort((left, right) => left.localeCompare(right));
	return normalized.length > 0 ? { valid: true, value: normalized } : { valid: true };
}

export function targetSkillFilter(target?: SkillFilter): SkillFilter | undefined {
	if (!target) return undefined;
	const includeSkills = parseSkillFilterList(target.includeSkills);
	const excludeSkills = parseSkillFilterList(target.excludeSkills);
	const includeList = includeSkills.valid ? includeSkills.value : undefined;
	const excludeList = excludeSkills.valid ? excludeSkills.value : undefined;
	if (!includeList && !excludeList) return undefined;
	return {
		...(includeList ? { includeSkills: includeList } : {}),
		...(excludeList ? { excludeSkills: excludeList } : {}),
	};
}

export function matchesSkillFilter(skillName: string, filter?: SkillFilter): boolean {
	if (filter?.includeSkills?.length && !filter.includeSkills.includes(skillName)) return false;
	if (filter?.excludeSkills?.length && filter.excludeSkills.includes(skillName)) return false;
	return true;
}

export function sameSkillFilter(left?: SkillFilter, right?: SkillFilter): boolean {
	return JSON.stringify(targetSkillFilter(left) ?? null) === JSON.stringify(targetSkillFilter(right) ?? null);
}

export function parseSkillNamesInput(text: string): string[] {
	return [...new Set(
		text
			.split(/[,;\n\r]+/)
			.map((item) => item.trim())
			.filter(Boolean),
	)].sort((left, right) => left.localeCompare(right));
}

export function formatSkillNamesInput(names?: readonly string[]): string {
	return (names ?? []).join(', ');
}
