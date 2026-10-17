<div align="center">

# Skill Switchboard

_One skill source. Connected agents. Clear status._

[简体中文](./README.zh-CN.md)

</div>

An Obsidian desktop plugin for indexing Agent Skills across selected roots and
checking how one canonical source connects to agent folders.

Its quiet interface shares a visual rhythm with Desk Lamp and Scriptorium while
following your Obsidian theme. Neither sibling plugin is required. English and
Simplified Chinese are available in settings.

> [!NOTE]
> Checks are read-only. Repair is a separate, confirmed action; harness commands
> and tool packages are never executed.

## Install

Requires Obsidian 1.7.2 or newer on desktop.

For a manual install, when a release is available, download `main.js`,
`manifest.json`, and `styles.css` from the
[releases page](https://github.com/ouatis/obsidian-skill-switchboard/releases)
and place them in `<vault>/.obsidian/plugins/skill-switchboard/`. Then enable
Skill Switchboard under **Settings → Community plugins**. To test an unreleased
version, follow the Development steps below.

## Features

- Index skills from selected vault or desktop roots and choose a canonical
  source.
- Inspect `copy`, `symlink`, and `wrapper` targets on an interactive map.
- Check metadata, commands, references, duplicates, paths, and package resources
  without running agents or harness commands.
- Read-only checks run on open, after changes, and every five minutes; refresh
  them from the command palette. Checks never repair files.
- Repair enabled wrapper targets after confirmation and copy check output for
  diagnosis.

## Paths and packages

Use vault-relative paths for vault roots and `~` paths for external roots and
targets to keep settings portable. Absolute paths are also supported for
machine-specific setups.

Skills can include support files with `package_path` or refer to a local package
with `package_id`. A schema-v1 `package_manifest` can list package-relative files
and SHA-256 hashes. Missing, changed, or unexpected files block repair; without
an inventory, package resources are marked unverified. Each machine maps package
IDs to local paths in `~/.skill-switchboard/packages.json`. The plugin does not
download or update packages.

## Checks and repair

Only configured roots and targets are inspected. Repair validates source
resources, asks for confirmation, and writes enabled wrapper targets outside the
vault. Replaced or removed files are backed up under
`~/.skill-switchboard/repair-backups/<vault-id>/`; backups are retained until you
remove them, and each includes a `backup-index.json` with recovery paths. Saving
an external package path updates only the local package registry.

The hidden `.skill-switchboard-status.json` records this installation's version,
build ID, skill count, and latest check and repair outputs. It omits vault,
source, and target paths, but diagnostic output can include local manifest or
backup paths; review it before sharing. The file does not confirm that another
device synced files or loaded a skill. The plugin makes no network requests and
collects no telemetry.

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

Run the `test:*` and `validate:release` scripts in `package.json`. CI tests on
Node.js 20, 22, and 24, with path checks on Linux, macOS, and Windows. To test in
Obsidian, copy `main.js`, `manifest.json`, and `styles.css` into the plugin folder
above and reload the app.

Created by [@ouatis](https://github.com/ouatis).
