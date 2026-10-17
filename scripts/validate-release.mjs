import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateReleaseMetadata(tag, manifest, versions, packageJson, packageLock) {
	const errors = [];
	const version = manifest?.version;
	if (typeof version !== 'string' || !semver.test(version)) {
		errors.push('manifest.json must declare a stable x.y.z version.');
	} else {
		if (tag !== version) errors.push(`Git tag "${tag}" must exactly match manifest version "${version}" (without a v prefix).`);
		if (packageJson?.version !== version) errors.push(`package.json version "${packageJson?.version ?? ''}" must match manifest version "${version}".`);
		const lockVersion = packageLock?.packages?.['']?.version ?? packageLock?.version;
		if (lockVersion !== version) errors.push(`package-lock.json version "${lockVersion ?? ''}" must match manifest version "${version}".`);
		if (typeof manifest.minAppVersion !== 'string' || !semver.test(manifest.minAppVersion)) {
			errors.push('manifest.json must declare a stable x.y.z minAppVersion.');
		}
		if (!versions || typeof versions !== 'object' || Array.isArray(versions) || !Object.hasOwn(versions, version)) {
			errors.push(`versions.json must include a minimum Obsidian version for ${version}.`);
		} else if (versions[version] !== manifest.minAppVersion) {
			errors.push(`versions.json maps ${version} to "${versions[version]}", but manifest.json requires "${manifest.minAppVersion}".`);
		}
	}
	if (errors.length > 0) throw new Error(errors.join('\n'));
	return version;
}

function readJson(root, file) {
	try {
		return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
	} catch (error) {
		throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const tag = process.argv[2] ?? '';
	try {
		const version = validateReleaseMetadata(
			tag,
			readJson(root, 'manifest.json'),
			readJson(root, 'versions.json'),
			readJson(root, 'package.json'),
			readJson(root, 'package-lock.json'),
		);
		process.stdout.write(`Release metadata is consistent for ${version}.\n`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
