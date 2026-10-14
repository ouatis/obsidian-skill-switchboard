# Skill Switchboard

An Obsidian desktop plugin for indexing and inspecting Agent Skills across configurable roots, runtime targets, adapters, and harness definitions.

## Current scope

The first MVP keeps indexing read-only. Adapter repair is explicit through one button:

- scan vault-relative roots and explicitly configured desktop folders;
- discover canonical Markdown cards directly under a configured root, plus folders containing `SKILL.md` adapters;
- treat a top-level card's `package_path` directory as supporting resources, not additional skills;
- check declared resource inventories for missing, changed, unexpected, or non-portable files;
- display name, description, source path, and SHA-256;
- record runtime targets as `copy`, `symlink`, or `wrapper` destinations;
- record harness command templates without executing them;
- validate the shared manifest before checking targets;
- run a native, read-only comparison for every configured runtime target;
- recheck every enabled wrapper target, repair all drift automatically, and run follow-up checks;
- invalidate outdated results immediately and perform quiet, read-only automatic checks;
- summarize actual repaired agents, unique changed skills, written files, and recovery paths;
- copy the adapter check or repair output to the clipboard, either from the **Copy output** button above the output block or from the command palette (`Copy adapter check output`);
- use English by default, with an in-plugin switch to Simplified Chinese.

### Local distribution-deck preview

An optional line-work distribution deck shows the canonical source and enabled wrapper targets. Hover a node or keyboard-focus an agent in the status list to inspect it; checking and repairing briefly trace the active route. Status comes from structured per-target check results, including the repair follow-up check, not from decorative animation or parsed console output. A passing check means the existing adapter checks passed, not proof of complete byte-for-byte identity or that an agent has loaded or executed the skill. This preview does not broaden the adapter checks themselves.

Hide the deck using its eye button, or toggle it in settings; the choice survives reloads. While hidden, the toolbar offers a button to show it again. The figure respects reduced-motion preferences, follows Obsidian theme colors, and does no work at rest. Its original SVG geometry is inspired by Hairline's restrained interaction style; it adds no package, React, remote asset, or telemetry dependency.

The local preview uses one coordinated layout for the toolbar, connections, counters, diagnostics, search, and skill library. Wide panels place the map beside target status; narrow panels stack them. The Settings button and configuration counters open this plugin's settings directly. The Chinese page title is 技能接线台; the English title remains Skill Switchboard.

The interface shares a quiet visual rhythm with Desk Lamp and Scriptorium: thin rules, 12px panels, 8px controls, and restrained 160ms transitions. Fonts, surfaces, accent colors, and state colors still come from the active Obsidian theme; neither sibling product is required. These presentation rules do not change checks, repair confirmation, target layout, or saved settings.

SVG figures use linked native titles for accessible names, so hovering the map does not enter Obsidian's HTML-only tooltip handler. Native HTML buttons keep both their accessible labels and keyboard focus behavior.

Paths are stored as configuration, so keep them portable when the vault will be used on more than one machine. Vault roots use paths relative to the vault. External roots and runtime targets should use `~` for the current user's home, such as `~/.codex/skills`, `~/.config/opencode/skills`, or `~/.gemini/config/skills`. Absolute paths remain supported for machine-specific setups. A Windows absolute path is not silently interpreted on macOS or Linux; replace it with a `~` path on the destination machine.

Only configured roots and runtime targets are scanned. The native implementation checks wrapper, metadata, reference-package, command, stale-term, duplicate, and retired-alias consistency. One-click repair writes native wrappers, metadata, commands, and Hermes reference packages directly, after resolving every target outside the vault. Existing files that will be overwritten or removed are backed up under `.skill-switchboard-repair-backups/`. The plugin has no Python runtime dependency.

Choose a canonical source from the configured roots under **Distribution source**. The adapter manifest is configurable; leaving it blank uses `skills-manifest.json` beside that source directory. New installations default to a `skills` root. Existing installations infer their already configured source without moving it. Runtime folders are targets/adapters, not additional sources. Generated wrappers name the chosen vault-relative path when available and the resolved local path on that machine. External sources are also supported explicitly.

For an existing JARDIN setup, keep `00-MEMORTE/shared/skills` as the source and its existing sibling manifest. This is configuration, not a path built into the plugin. The map, checks, generated wrappers, and repair all use the same selected source.

### Supporting tool packages

A top-level skill card may declare `package_path: packages/toolkit`. The path is relative to the configured skill root, must stay within that root, and excludes only that exact directory and its descendants from skill discovery. Its original `SKILL.md`, examples, and documentation remain ordinary resource files. The same rule applies to vault and desktop roots; undeclared skill directories continue to be discovered normally.

Use a normal, visible directory for resources that should travel through Obsidian Sync. The plugin does not download, unpack, copy, or execute the toolkit and does not control Obsidian Sync. Hidden upstream files remain subject to Obsidian's sync exclusions.

For a completeness check, add `package_manifest: packages/toolkit.json` to the card (relative to the source root). Its JSON shape is:

```json
{
  "schema_version": 1,
  "files": [
    { "path": "SKILL.md", "sha256": "<64 hexadecimal SHA-256 characters>" }
  ]
}
```

Paths in the inventory are relative to the package directory. Include its entrypoint (`SKILL.md`, or a `package_entry` override) and all required runtime files. Checks are read-only: missing/changed/unexpected files are errors; resources without an inventory are explicitly unverified, not proven complete. Inventories are maintained with approved source updates, never regenerated by repair to hide a discrepancy. Paths escaping the source/package are rejected. Missing resources block adapter repair; restoring or updating an upstream toolkit is a separate operation.

The interface separates agent-entry checks, local resource integrity, and other-device verification. Local success never proves that another device downloaded files or that an agent loaded a skill. Required hidden paths receive a sync-risk warning.

#### Machine-local external packages

To keep a toolkit outside the vault without moving its shared skill card, declare `package_id: drawing-toolkit` instead of `package_path`. Keep `package_manifest` relative to the shared source as before. Using both path and ID is rejected.

Under **External tool packages**, save that ID's directory on this computer. This explicit action writes only `~/.skill-switchboard/packages.json`, not the vault or synced plugin settings:

```json
{
  "schema_version": 1,
  "packages": { "drawing-toolkit": "~/tools/drawing-toolkit" }
}
```

Agents can read the same registry to find the original toolkit entrypoint and resolve its relative instructions. The shared card should identify the package ID and this registry rather than embed one machine's absolute path. Missing mappings or files block resource readiness and adapter repair. The toolkit must be outside the vault and shared source, and entry/inventory file paths cannot escape their roots. Checks never create a registry, download files, or update the toolkit. The only external write added here is the user-requested path registration.

External packages are explicitly labeled local-only: neither the toolkit nor this registry travels through Obsidian Sync. Each other computer needs its own installation and path registration. Saving a path invalidates old checks immediately; edits made outside the plugin are discovered on the next manual or periodic check.

Both older and newer Obsidian settings render the source, target, harness, and external-package editors. Native controls use the same persistence and readiness-invalidation route; language choices are saved and the tab is rebuilt in that language.

### Automatic checks and repair records

Automatic checking is enabled by default. It runs quietly on opening, after source/manifest/settings changes, and every five minutes. Source changes invalidate previous green states immediately; a result that finishes after another change is discarded and followed by a fresh check. Automatic checks never repair runtime files. You can disable them in settings and check manually. Runtime-folder changes outside the vault are discovered on the next check, not claimed as continuously watched.

One-click repair still requires confirmation. It validates source resources before writing, records changed skills/files and recovery paths, and rechecks each changed target. The summary counts structured write records, not log text; partial failures remain visible. Old repair results are labeled as history rather than current readiness.

### Adapter manifest

The schema remains version 1. `skills` contains named cards and per-runtime `adapters`; `shared_file` may be a top-level filename or a path prefixed with the chosen vault-relative source. Optional `adapter_defaults` provide metadata inherited by enabled adapters, for example `{"hermes":{"category":"team"}}`. The generic Hermes default is `shared`; existing installations can preserve their earlier directory explicitly in the manifest. Targets with zero declared adapter skills are not marked successful.

Optional `validation_policy` defines installation-specific `retired_names`, `forbidden_literals`, and `reject_example_absolute_path`. A `default` object can be overridden for each runtime. None of those rules are personal defaults embedded in the plugin. Without a policy, native checks still validate configured wrappers, metadata, references, commands, paths, and duplicate names.

## Development

```bash
npm install
npm run build
npm run test:scanner
npm run test:readiness
npm run test:lifecycle
npm run test:adapter
npm run test:native
npm run test:distribution
npm run test:ui
```

`test:adapter` uses a fake sync provider to cover the check/repair orchestration without a vault, so it also runs in CI. The production build writes `main.js` to the project root. For local testing, copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/skill-switchboard/
```

The native tests build isolated generic vaults and temporary runtime targets; no personal vault is needed for CI. For live read-only checks, pass the intended vault explicitly: `npm run test:native -- --live /absolute/path/to/vault`. The readiness and lifecycle suites cover resource corruption, portable sources, late-result rejection, silent background checks, and structured repair totals. The plugin has no Python runtime dependency. After installing a build, reload the plugin in Obsidian and inspect errors with the Obsidian CLI.
