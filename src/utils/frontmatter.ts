/** Scalar metadata used by shared cards; intentionally not an executable or YAML object loader. */
export function scalarFrontmatter(content: string): Record<string, string> {
	const values: Record<string, string> = {};
	const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
	const lines = match?.[1]?.split(/\r?\n/) ?? [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		if (/^\s/.test(line)) continue;
		const separator = line.indexOf(':');
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (/^[>|][+-]?$/.test(value)) {
			const folded = value.startsWith('>');
			const body: string[] = [];
			while (index + 1 < lines.length && (/^\s/.test(lines[index + 1]!) || !lines[index + 1]!.trim())) body.push(lines[++index]!.trim());
			value = body.join(folded ? ' ' : '\n').trim();
		} else if (value.startsWith('"') && value.endsWith('"')) {
			try { value = JSON.parse(value) as string; } catch { value = value.slice(1, -1); }
		} else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'");
		values[key] = value;
	}
	return values;
}
