# Skill Switchboard

An Obsidian desktop plugin for indexing and inspecting Agent Skills across configurable roots, runtime targets, adapters, and harness definitions.

## Current scope

The first MVP keeps indexing read-only. Adapter repair is explicit through one button:

- scan vault-relative roots and explicitly configured desktop folders;
- discover canonical Markdown cards directly under a configured root, plus folders containing `SKILL.md` adapters;
- display name, description, source path, and SHA-256;
- record runtime targets as `copy`, `symlink`, or `wrapper` destinations;
- record harness command templates without executing them;
- validate the shared manifest before checking targets;
- run a native, read-only comparison for every configured runtime target;
- recheck every enabled wrapper target, repair all drift automatically, and run follow-up checks;
- use English by default, with an in-plugin switch to Simplified Chinese.

Only configured roots and runtime targets are scanned. The native implementation checks wrapper, metadata, reference-package, command, stale-term, duplicate, and retired-alias consistency. One-click repair writes native wrappers, metadata, commands, and Hermes reference packages directly, after resolving every target outside the vault. Existing files that will be overwritten or removed are backed up under `.skill-switchboard-repair-backups/`. The plugin has no Python runtime dependency.

For a JARDIN setup, configure `00-MEMORTE/shared/skills` as the single source root. Runtime folders are targets/adapters, not additional sources.

## Development

```bash
npm install
npm run build
npm run test:native
```

The production build writes `main.js` to the project root. For local testing, copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/skill-switchboard/
```

The native test uses isolated temporary targets and also supports `npm run test:native -- --live` for live read-only checks. The plugin has no Python runtime dependency; the JARDIN Python sync layer was retired after an external, hash-verified backup. Then reload the plugin in Obsidian and inspect errors with the Obsidian CLI.
