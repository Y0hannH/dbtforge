# Changelog

All notable changes to the dbt Forge extension are documented in this file.

## [0.2.0] - 2026-07-08

### Added
- **Build Model** command/CodeLens — builds just the currently open model (`dbt build --select model`), without pulling in upstream or downstream dependencies.
- **Compile Project** command/button in the sidebar's view title bar — runs `dbt compile` directly from the Parents/Children/Tests panel, so newly created models get picked up without dropping to a terminal.

### Changed
- Activity bar icon now matches the marketplace hammer/anvil branding instead of the placeholder bar-chart icon.
- `dbtForge.pythonPath`, `projectDir`, `manifestPath`, `catalogPath`, and `compiledDir` settings are now `"scope": "resource"`, so a multi-root workspace with several dbt projects can configure a different value per folder instead of sharing a single value across the whole window.

## [0.1.0] - 2026-07-07

Initial release: ref()/source() autocomplete, snippet expansion, Go to Definition, column autocomplete (aliases + CTEs), Parents/Children/Tests panel, build/test shortcuts, compiled SQL preview, and the interactive lineage graph.
