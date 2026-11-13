import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isInside } from '../utils/paths';
import { scalarFrontmatter } from '../utils/frontmatter';

export interface SourceFile { path: string; source: string; sha256: string; executable: boolean }
export interface PackageFile { path: string; bytes: Buffer; executable: boolean }
export const PACKAGE_MARKER = '.skill-switchboard.json';
const OMIT = new Set(['.git', '.DS_Store', 'node_modules', '__pycache__']);
const MAX_BYTES = 128 * 1024 * 1024;
export const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** No links, special files, silent truncation, or partial reads in installable packages. */
export async function readPackageTree(root: string, source = false, includeLegacyMarker = false): Promise<PackageFile[]> {
	const files: PackageFile[] = [];
	let bytes = 0;
	async function visit(directory: string): Promise<void> {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			if ((!includeLegacyMarker && directory === root && entry.name === PACKAGE_MARKER) || entry.name === '.DS_Store' || (source && OMIT.has(entry.name))) continue;
			const full = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Package contains a symbolic link: ${full}`);
			if (entry.isDirectory()) { await visit(full); continue; }
			if (!entry.isFile()) throw new Error(`Package contains a special file: ${full}`);
			const stat = await fs.stat(full);
			bytes += stat.size;
			if (bytes > MAX_BYTES || files.length >= 10000) throw new Error('Skill package exceeds the 128 MiB / 10000 file limit.');
			files.push({ path: path.relative(root, full).replaceAll(path.sep, '/'), bytes: await fs.readFile(full), executable: Boolean(stat.mode & 0o111) });
		}
	}
	await visit(root);
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function fileHashes(files: PackageFile[]): Record<string, string> {
	const entries: [string, string][] = files.map((file) => [file.path, digest(Buffer.concat([Buffer.from(file.executable ? 'x' : '-'), file.bytes]))]);
	return Object.fromEntries<string>(entries.sort(([a], [b]) => a.localeCompare(b)));
}

export async function sourceTree(root: string): Promise<SourceFile[]> {
	return (await readPackageTree(root, true)).map((file) => ({ path: file.path, source: path.join(root, file.path), sha256: digest(file.bytes), executable: file.executable }));
}

/** Link-shaped regex/code examples are not Markdown resource declarations. */
function markdownProse(text: string): string {
	let fence: { character: string; length: number } | undefined;
	return text.split(/\r?\n/).map((line) => {
		const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (delimiter) {
			const token = delimiter[1]!;
			if (!fence) fence = { character: token[0]!, length: token.length };
			else if (token[0] === fence.character && token.length >= fence.length && !delimiter[2]?.trim()) fence = undefined;
			return '';
		}
		return fence ? '' : line;
	}).join('\n').replace(/(`+)([\s\S]*?)\1/g, '');
}

/** Legacy cards become full documents, with the explicitly referenced local file closure. */
export async function cardFiles(entry: string, root: string): Promise<SourceFile[]> {
	const pending = [entry];
	const seen = new Map<string, SourceFile>();
	let total = 0;
	while (pending.length) {
		const file = pending.pop()!;
		const real = await fs.realpath(file);
		if (!isInside(root, real)) throw new Error(`Skill reference escapes its source: ${file}`);
		if (seen.has(real)) continue;
		if ((await fs.lstat(file)).isSymbolicLink()) throw new Error(`Symbolic skill reference: ${file}`);
		const stat = await fs.stat(real);
		if (!stat.isFile()) throw new Error(`Skill reference is not a file: ${file}`);
		total += stat.size;
		if (total > MAX_BYTES || seen.size >= 10000) throw new Error('Skill references exceed the package limit.');
		const bytes = await fs.readFile(real);
		seen.set(real, { path: real === entry ? 'SKILL.md' : path.relative(root, real).replaceAll(path.sep, '/'), source: real, sha256: digest(bytes), executable: Boolean(stat.mode & 0o111) });
		if (!real.endsWith('.md')) continue;
		const text = bytes.toString('utf8');
		if (real === entry) {
			const metadata = scalarFrontmatter(text);
			if (metadata.package_path) {
				const relative = metadata.package_path.replaceAll('\\', '/');
				if (relative.startsWith('/') || relative.startsWith('~') || relative.split('/').includes('..') || /^[a-z]+:/i.test(relative)) throw new Error('Invalid bundled package_path.');
				const packageRoot = await fs.realpath(path.join(root, relative));
				if (!isInside(root, packageRoot)) throw new Error('Bundled package escapes the source.');
				for (const resource of await sourceTree(packageRoot)) seen.set(resource.source, { ...resource, path: `${relative}/${resource.path}` });
			}
			if (metadata.package_manifest) pending.push(path.resolve(root, metadata.package_manifest));
		}
		const links = [...markdownProse(text).matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)].map((match) => match[1]!);
		// Only a complete package-relative token, never the tail of ~/tools/scripts/x.py
		// or another vault-relative path. Such dependencies need an explicit package_path.
		const literals = [...text.matchAll(/(?:^|[^\w./\\~:-])((?:references|scripts|assets)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)/g)].map((match) => match[1]!);
		for (const link of [...links, ...literals]) {
			if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(link)) continue;
			const relative = decodeURIComponent(link.split('#')[0]!);
			if (!relative) continue;
			const candidate = relative.startsWith('references/') ? path.resolve(root, relative) : path.resolve(path.dirname(real), relative);
			pending.push(candidate);
		}
	}
	return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function materialize(files: SourceFile[]): Promise<PackageFile[]> {
	return Promise.all(files.map(async (file) => {
		const stat = await fs.lstat(file.source);
		if (stat.isSymbolicLink() || await fs.realpath(file.source) !== file.source) throw new Error('Source changed to a symbolic link; check again.');
		if (!stat.isFile() || Boolean(stat.mode & 0o111) !== file.executable) throw new Error('Source changed during distribution; check again.');
		const bytes = await fs.readFile(file.source);
		if (digest(bytes) !== file.sha256) throw new Error('Source changed during distribution; check again.');
		return { path: file.path, bytes, executable: file.executable };
	}));
}
