# Changelog

All notable changes to the dbt Forge extension are documented in this file.

## [0.7.0] - 2026-08-12

### Added
- **Hover documentation** on `ref()`/`source()`/macro calls (and macro definition lines) — shows the model/source/macro's manifest description, and a macro's argument signature when documented.
- **Diagnostics** for `ref()`/`source()` calls that don't resolve against the loaded manifest — surfaced as warnings in the editor and the Problems panel, refreshed on edit, file open/close, and manifest reload. Scoped to `ref()`/`source()` only (unambiguous call syntax); macro calls are excluded to avoid false positives against built-in Jinja functions.

## [0.6.0] - 2026-08-11

### Added
- **Generate Docs** command and title-bar button — runs `dbt docs generate` through your venv and selected environment. `catalog.json` is what column autocomplete reads, and only `dbt docs generate` writes it: neither `compile` nor `build` produces or refreshes it, so until now the extension had no way to produce the one file its column suggestions depend on. The index watches `catalog.json`, so suggestions light up as soon as dbt finishes.

### Changed
- Renamed **Refresh Manifest/Catalog Index** to **Reload Manifest/Catalog from Disk**. It never ran dbt — it re-reads the files dbt produced — and the old name read as "refresh my catalog", which is exactly the confusion the new Generate Docs button resolves.
- README now documents what column autocomplete actually requires: the two independent paths (same-file CTEs need nothing; model/source aliases need `dbt docs generate`), that the alias is mandatory, and that only single-argument `ref()`/`source()` calls are detected.

## [0.5.0] - 2026-08-11

### Added
- **Environment switching.** A status bar item shows which dbt profile/target dbt Forge runs against; clicking it lists the profiles found in your `profiles.yml` (and their targets, when a profile has several). Every dbt command the extension launches — Build Model, Build Folder, Test, Compile, Build Project — then carries the matching `--profile`/`--target`, so a dev branch can point at a different Fabric workspace than main without editing `profiles.yml`.
  - The choice is stored per dbt project in the workspace state, not in settings: it's a per-checkout, per-machine decision and has no business in a committed `.vscode/settings.json`.
  - `profiles.yml` is looked up the way dbt looks it up: the new `dbtForge.profilesDir` setting, then `DBT_PROFILES_DIR`, then the project root, then `~/.dbt`.
  - Switching offers to run `dbt compile`, since the indexed `manifest.json` still describes the previous environment.
  - Nothing is ever written to `profiles.yml`; only command-line flags change.

### Added (settings)
- `dbtForge.profilesDir` — directory holding `profiles.yml`. Empty by default (search where dbt does); when set, it's also passed to dbt as `--profiles-dir`.

## [0.4.1] - 2026-08-11

### Fixed
- **Go to Definition no longer hijacks plain SQL.** dbt ships macros named after SQL functions (`replace`, `length`, `concat`, `left`, `position`, ...), so Ctrl+click on an ordinary `replace(col, 'a', 'b')` jumped into dbt's internals. A macro call is now only recognised inside a Jinja tag (`{{ ... }}` / `{% ... %}`).
- **Definitions in installed packages open the right file.** A package's `original_file_path` is relative to the package root, not the project root, so every macro from `dbt_utils` & co resolved to a path that doesn't exist. Package entities now resolve under `dbt_packages/<package>/`, and navigation falls back to "no result" instead of opening a broken editor when the file isn't in the project (dbt's built-in macros ship with the Python package).
- **Macro name collisions resolve deterministically.** Macro names are not unique across packages (`dbt_utils.star` vs `spark_utils.star`, a project macro shadowing a package one). The root project now wins over any package, a namespaced call (`dbt_utils.star(...)`) resolves to that exact package, and manifest ordering no longer decides.
- **Go to Definition on a macro jumps to its `{% macro %}` line** instead of the top of a file that may define a dozen macros. Same for the declaration entry in Find All References.
- **Find All References no longer drops call sites it can't pin down.** `ref('package', 'model')` and `ref('model', version=2)` are now parsed, and a caller whose call site can't be located on a single line is reported at the file level rather than silently omitted.
- **Cross-package false positives removed** from Find All References: `ref('other_package', 'x')` and `other_package.my_macro()` are no longer reported as call sites for a same-named entity in a different package.

### Changed
- Find All References honours cancellation, reads caller files directly instead of opening a `TextDocument` per file, and reads them in parallel batches — noticeably cheaper on a source with hundreds of children. Generic tests declared in a `schema.yml` are skipped, since they contain no call site to find.
## [0.4.0] - 2026-07-13

### Added
- **Find All References** (`Shift+F12` / right-click) for models, sources, and macros — lists every `ref()`/`source()`/macro call site across the project, resolved from the manifest's dependency graph (no full-project text scan).
- **Go to Definition** for macro calls (`{{ my_macro(...) }}` or namespaced `{{ dbt_utils.my_macro(...) }}`) — jumps straight to the macro's `.sql` file, same as the existing ref()/source() Go to Definition.

## [0.3.0] - 2026-07-10

### Added
- **Build Folder**, **Build Folder Upstream (+folder)**, and **Build Folder Downstream (folder+)** commands, available from the right-click context menu on any folder in the Explorer. Builds every model under that folder (via dbt's `path:` selector) without having to select models one by one.

## [0.2.0] - 2026-07-08

### Added
- **Build Model** command/CodeLens — builds just the currently open model (`dbt build --select model`), without pulling in upstream or downstream dependencies.
- **Compile Project** command/button in the sidebar's view title bar — runs `dbt compile` directly from the Parents/Children/Tests panel, so newly created models get picked up without dropping to a terminal.

### Changed
- Activity bar icon now matches the marketplace hammer/anvil branding instead of the placeholder bar-chart icon.
- `dbtForge.pythonPath`, `projectDir`, `manifestPath`, `catalogPath`, and `compiledDir` settings are now `"scope": "resource"`, so a multi-root workspace with several dbt projects can configure a different value per folder instead of sharing a single value across the whole window.

## [0.1.0] - 2026-07-07

Initial release: ref()/source() autocomplete, snippet expansion, Go to Definition, column autocomplete (aliases + CTEs), Parents/Children/Tests panel, build/test shortcuts, compiled SQL preview, and the interactive lineage graph.
