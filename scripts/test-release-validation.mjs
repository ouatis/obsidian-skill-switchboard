import assert from 'node:assert/strict';
import { validateReleaseMetadata } from './validate-release.mjs';

const manifest = { version: '1.2.3', minAppVersion: '1.7.2' };
const versions = { '1.2.3': '1.7.2' };
const packageJson = { version: '1.2.3' };
const packageLock = { packages: { '': { version: '1.2.3' } } };

assert.equal(validateReleaseMetadata('1.2.3', manifest, versions, packageJson, packageLock), '1.2.3');
assert.throws(() => validateReleaseMetadata('v1.2.3', manifest, versions, packageJson, packageLock), /exactly match/);
assert.throws(() => validateReleaseMetadata('1.2.4', manifest, versions, packageJson, packageLock), /exactly match/);
assert.throws(() => validateReleaseMetadata('1.2.3', { ...manifest, version: '1.2' }, versions, packageJson, packageLock), /stable x\.y\.z version/);
assert.throws(() => validateReleaseMetadata('1.2.3', { ...manifest, minAppVersion: '' }, versions, packageJson, packageLock), /stable x\.y\.z minAppVersion/);
assert.throws(() => validateReleaseMetadata('1.2.3', manifest, {}, packageJson, packageLock), /must include a minimum Obsidian version/);
assert.throws(() => validateReleaseMetadata('1.2.3', manifest, { '1.2.3': '1.8.0' }, packageJson, packageLock), /requires "1\.7\.2"/);
assert.throws(() => validateReleaseMetadata('1.2.3', manifest, versions, { version: '1.2.2' }, packageLock), /package\.json version/);
assert.throws(() => validateReleaseMetadata('1.2.3', manifest, versions, packageJson, { packages: { '': { version: '1.2.2' } } }), /package-lock\.json version/);

process.stdout.write('Release validation checks passed: exact tag, stable versions, package and lockfile versions, and minimum Obsidian version mapping.\n');
