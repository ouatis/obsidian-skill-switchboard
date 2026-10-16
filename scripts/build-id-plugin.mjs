export function buildIdentityPlugin(buildRevision = 'local') {
	let buildId = '';
	let lastBuildAt = 0;

	return {
		name: 'skill-switchboard-build-identity',
		setup(build) {
			build.onStart(() => {
				lastBuildAt = Math.max(Date.now(), lastBuildAt + 1);
				buildId = `${buildRevision}-${new Date(lastBuildAt).toISOString()}`;
			});
			build.onResolve({ filter: /^virtual:skill-switchboard-build-info$/ }, () => ({
				path: 'build-info',
				namespace: 'skill-switchboard-build-info',
			}));
			build.onLoad({ filter: /.*/, namespace: 'skill-switchboard-build-info' }, () => ({
				contents: `export const BUILD_ID = ${JSON.stringify(buildId)};`,
				loader: 'js',
			}));
		},
	};
}
