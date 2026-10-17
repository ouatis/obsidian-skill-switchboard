<div align="center">

# Skill Switchboard

_One skill source. Connected agents. Clear status._

[简体中文](./README.zh-CN.md)

</div>

An Obsidian desktop plugin for indexing Agent Skills and checking how one
canonical source connects to agent folders.

Quiet panels and thin rules share a visual rhythm with Desk Lamp and
Scriptorium. The interface follows your Obsidian theme; neither sibling plugin
is required. English and Simplified Chinese are available in settings.

> [!NOTE]
> Checks are read-only. Repair requires confirmation. The plugin never runs
> agents, harness commands, or tool packages.

## Install

Requires Obsidian 1.7.2 or newer on desktop.

For a manual install, download `main.js`, `manifest.json`, and `styles.css` from
the [releases page](https://github.com/ouatis/obsidian-skill-switchboard/releases)
and place them in `<vault>/.obsidian/plugins/skill-switchboard/`. Then enable
Skill Switchboard under **Settings → Community plugins**. To test an unreleased
version, use the Development steps below.

## Features

- Index skills from selected vault or desktop roots and choose a canonical
  source.
- Inspect `copy`, `symlink`, and `wrapper` targets on an interactive map.
- Check metadata, commands, references, duplicates, paths, and package resources
  without running agents or harness commands.
- Run read-only checks when the board opens, after changes, and every five
  minutes; refresh them from the command palette.
- Repair enabled wrapper targets after confirmation and copy check output for
  troubleshooting.

## Paths and safety

Use vault-relative paths for roots inside the vault and `~` paths for external
roots and targets to keep settings portable. Absolute paths are also supported
for machine-specific setups.

Sources, targets, enabled agents, and harness commands are local to each vault
checkout, in `~/.skill-switchboard/vaults/<vault-id>/settings.json`. Existing
connections migrate automatically, with a `legacy-settings.json` recovery copy;
new devices configure their own connections. The skill manifest stays shared.
Versions before 0.4.0 do not read this local configuration.

Skills can declare support files with `package_path` or reference a local
package with `package_id`. An optional schema-v1 `package_manifest` lists files
and SHA-256 hashes. Missing, changed, or unexpected files block that skill; without
an inventory, package resources are unverified. Each machine maps package IDs
to local paths in `~/.skill-switchboard/packages.json`. The plugin does not
download or update packages.

Only configured roots and targets are inspected. Repair first performs a
read-only check and previews the eligible and blocked skills for confirmation.
It writes enabled wrapper targets outside the vault, leaving resource-blocked
skill entries untouched. Independent skills can still be repaired; partial
results are reported explicitly. Replaced or removed files are backed up under
`~/.skill-switchboard/repair-backups/<vault-id>/` and kept until you remove
them; each backup includes a `backup-index.json` with recovery paths. Saving an
external package path updates only the local package registry.

The hidden `.skill-switchboard-status.json` in the vault root records this
installation's version, build ID, skill count, and latest check and repair
outputs. Its metadata omits vault, source, and target paths, but diagnostic
output can include local manifest or backup paths; review it before sharing.
It cannot confirm that another device synced files or that an agent loaded a
skill. The plugin makes no network requests and collects no telemetry.

## Commands

- **Open switchboard**
- **Refresh skill index**
- **Copy adapter check output**

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
```

Run the `test:*` scripts in `package.json`; `test:ui:live` also requires
Obsidian CLI and a test vault. The release validator needs the exact release
tag. CI checks Node.js 20, 22, and 24, with path behavior tested on Linux,
macOS, and Windows. To test in Obsidian, copy `main.js`, `manifest.json`, and
`styles.css` into the plugin folder above, then reload the app.

Created by [@ouatis](https://github.com/ouatis).
