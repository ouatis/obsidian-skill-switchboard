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
- copy the adapter check or repair output to the clipboard, either from the **Copy output** button above the output block or from the command palette (`Copy adapter check output`);
- use English by default, with an in-plugin switch to Simplified Chinese.

Paths are stored as configuration, so keep them portable when the vault will be used on more than one machine. Vault roots use paths relative to the vault. External roots and runtime targets should use `~` for the current user's home, such as `~/.codex/skills`, `~/.config/opencode/skills`, or `~/.gemini/config/skills`. Absolute paths remain supported for machine-specific setups. A Windows absolute path is not silently interpreted on macOS or Linux; replace it with a `~` path on the destination machine.

Only configured roots and runtime targets are scanned. The native implementation checks wrapper, metadata, reference-package, command, stale-term, duplicate, and retired-alias consistency. One-click repair writes native wrappers, metadata, commands, and Hermes reference packages directly, after resolving every target outside the vault. Existing files that will be overwritten or removed are backed up under `.skill-switchboard-repair-backups/`. The plugin has no Python runtime dependency.

For a JARDIN setup, configure `00-MEMORTE/shared/skills` as the single source root. Runtime folders are targets/adapters, not additional sources. Generated wrappers include the canonical vault-relative path and the resolved local path needed by the runtime on that machine.

## Development

```bash
npm install
npm run build
npm run test:adapter
npm run test:native
```

`test:adapter` uses a fake sync provider to cover the check/repair orchestration without a vault, so it also runs in CI. The production build writes `main.js` to the project root. For local testing, copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/skill-switchboard/
```

The native test reads the canonical JARDIN manifest and uses isolated temporary runtime targets. It also supports `npm run test:native -- --live` for live read-only checks against configured targets. The plugin has no Python runtime dependency. After installing a build, reload the plugin in Obsidian and inspect errors with the Obsidian CLI.
