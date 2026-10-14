/** Scalar metadata used by shared cards; intentionally not an executable or YAML object loader. */
export function scalarFrontmatter(content: string): Record<string, string> {
	const values: Record<string, string> = {};
	const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
	for (const line of match?.[1]?.split(/\r?\n/) ?? []) {
		if (/^\s/.test(line)) continue;
		const separator = line.indexOf(':');
		if (separator <= 0) continue;
		values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
	}
	return values;
}
