export function buildIdentityPlugin(buildRevision = 'local', options = {}) {
	const deterministic = options.deterministic ?? false;
	let buildId = '';
	let lastBuildAt = 0;

	return {
		name: 'skill-switchboard-build-identity',
		setup(build) {
			build.onStart(() => {
				// Production builds must be reproducible: the revision alone
				// identifies the source, so a rebuild from the same commit and
				// lockfile is byte-identical. Dev watch keeps a fresh timestamp
				// per rebuild so developers can tell rebuilds apart.
				if (deterministic) {
					buildId = buildRevision;
					return;
				}
				lastBuildAt = Math.max(Date.now(), lastBuildAt + 1);
				buildId = `${buildRevision}-${new Date(lastBuildAt).toISOString()}`;
			});
			build.onResolve({ filter: /^virtual:skill-switchboard-build-info$/ }, () => ({
				path: 'build-info',
				namespace: 'skill-switchboard-build-identity',
			}));
			build.onLoad({ filter: /.*/, namespace: 'skill-switchboard-build-identity' }, () => ({
				contents: `export const BUILD_ID = ${JSON.stringify(buildId)};`,
				loader: 'js',
			}));
		},
	};
}
