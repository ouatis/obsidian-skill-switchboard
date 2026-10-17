<div align="center">

# Skill Switchboard

_One skill source. Connected agents. Clear status._

</div>

An Obsidian desktop plugin for indexing and inspecting Agent Skills across
configurable roots, runtime targets, adapters, and harness definitions. It
shows how one selected source connects to agent folders and checks their
current state.

The interface shares a quiet visual rhythm with Desk Lamp and Scriptorium,
while following the active Obsidian theme. Neither sibling plugin is required.
English and Simplified Chinese are available in settings.

> [!NOTE]
> Source and adapter checks are read-only. Repair is a separate, confirmed
> action; harness command templates and tool packages are never executed.

## Install

Requires Obsidian 1.7.2 or newer and runs on desktop.

For a manual install, use `main.js`, `manifest.json`, and `styles.css` from a
published [GitHub release](https://github.com/ouatis/obsidian-skill-switchboard/releases)
and place them in `<vault>/.obsidian/plugins/skill-switchboard/`. Then enable
Skill Switchboard under **Settings → Community plugins**. To test a source
checkout before release, follow the Development steps below.

## Features

- Index skills from selected vault or desktop roots and choose one canonical
  source for distribution.
- Inspect configured `copy`, `symlink`, and `wrapper` targets on an interactive
  map, with per-target checks and diagnostic output.
- Check wrappers, metadata, commands, reference files, paths, duplicates, and
  declared package resources without running agents or harness commands.
- Run quiet read-only checks automatically or refresh them from the command
  palette. Automatic checks never repair files.
- Repair enabled wrapper targets after confirmation, then run follow-up checks.
- Copy the latest check output from the view or command palette.

## Paths and packages

Use paths relative to the vault for vault roots. Use `~` paths for external
roots and runtime targets, such as `~/.codex/skills`; absolute paths are also
supported for machine-specific setups. Replace a Windows absolute path when
moving the vault to macOS or Linux.

A skill can keep supporting files in its source root with `package_path`, or
refer to a machine-local toolkit with `package_id`. Add `package_manifest` to
point to a schema-v1 inventory whose `files` entries contain package-relative
`{ path, sha256 }` records. Missing, changed, or unexpected files block
repair; without an inventory, resources are reported as unverified. A package
ID maps to a path in `~/.skill-switchboard/packages.json` on each machine. The
plugin does not download, update, or execute packages.

## Checks and repair

Only configured roots and targets are inspected. Automatic checks run on open,
after source or settings changes, and every five minutes. They never write
adapter files.

Repair validates source resources first and requires confirmation. It writes
only enabled wrapper targets resolved outside the vault. Files replaced or
removed are backed up outside the vault under
`~/.skill-switchboard/repair-backups/<vault-id>/`; each backup includes a
`backup-index.json` with recovery paths. Backups are local to the machine and
are never deleted automatically. Saving an external package path writes only
the machine-local `~/.skill-switchboard/packages.json` registry.

The hidden `.skill-switchboard-status.json` at the vault root records the
installed version, build ID, skill count, and latest check status/output. Its
metadata omits vault, source, and target paths. Exact check and repair output
is retained for diagnosis and may contain local manifest or backup paths, so
review it before sharing. The file does not prove another device synced files
or an agent loaded a skill. The plugin makes no network requests and collects
no telemetry.

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

Run the automated `test:*` scripts in `package.json` for the scanner,
readiness, repair, status, native adapter, distribution, UI, and release
checks. CI runs these suites on Node.js 20, 22, and 24, plus path checks on
Linux, macOS, and Windows. The production build creates `main.js`; copy it,
`manifest.json`, and `styles.css` to the plugin folder above to test in Obsidian.
