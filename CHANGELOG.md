# Changelog

All notable changes to the dbt Forge extension are documented in this file.

## [0.13.0] - 2026-08-20

### Added
- **`Ctrl+Enter` previews the CTE the cursor is in** ([#16](https://github.com/Y0hannH/dbtforge/issues/16)). Put the cursor anywhere inside a CTE and the shortcut previews that CTE; leave it in the final SELECT, above the WITH clause, or in a model with no CTEs, and it previews the whole model as before. It is the keyboard equivalent of the Preview CTE button that was already on each CTE — the point of a shortcut being that you don't have to go and find the button.
  - Only the shortcut and the command palette follow the cursor. Every menu item and CodeLens passes the file it was drawn on, and that is what tells them apart: a button says which scope it means, so **Preview Data** in the title-bar menu or the CodeLens row stays the whole model. The panel header names what actually ran (`model › cte`), so the two are never confused after the fact.
  - A cursor in a nested CTE resolves to the top-level CTE containing it, which is the innermost thing dbt can actually be asked to run. A model whose SQL can't be parsed previews whole rather than guessing.

## [0.12.0] - 2026-08-20

Five issues from the same reporter, and three of them turned out to be things that were simply wrong.

### Added
- **The lineage graph has a scope, and you set it** ([#4](https://github.com/Y0hannH/dbtforge/issues/4)). A toolbar above the graph carries two depth controls — how many hops of parents, how many of children — plus what to leave out. `3+model+1` is now two dropdowns, and *All* in both draws the model's whole DAG in one go. Everything is answered from `manifest.json`'s `parent_map`/`child_map`, so the graph redraws instantly and no `dbt ls` is ever run; deliberately not a selector text field, which would have made the whole control as slow as its slowest case.
  - **Tests** are a checkbox, off by default (see below).
  - **Materializations** are chips: click `ephemeral` to drop every ephemeral node from the graph. A hidden node is not traversed through either, matching what dbt's own `--exclude` does. Excluded chips stay visible and struck through, so an empty graph is never mistaken for a broken one.
  - The model you have open is always drawn, even when a filter would hide it.
- **`{{ doc('...') }}` is resolved against the project** ([#7](https://github.com/Y0hannH/dbtforge/issues/7)) — the half of that issue that needs to know your dbt project.
  - **Autocomplete** inside `{{ doc('` lists the `{% docs %}` blocks the project declares, each with a preview of its markdown read from the manifest. Offered in `.yml` as well as `.sql`, since that is where doc() is actually written.
  - **Go to Definition** on a `doc('x')` lands on the `{% docs x %}` line, not the top of the file — a `.md` usually holds many blocks.
  - **A diagnostic** when a `doc()` doesn't resolve, worded like the existing `ref()`/`source()` ones, and checked in `.yml` and `.sql` alike.
  - **A `docs` snippet** in markdown files, expanding to a full `{% docs %} … {% enddocs %}` block.
  - Doc names collide across packages the way macro names do (not the way model names do), so resolution is explicit: the root project wins, a `doc('package', 'block')` call is matched exactly with no fallback, and your own blocks lead the completion list.
- **The lineage graph can live in the bottom panel** ([#15](https://github.com/Y0hannH/dbtforge/issues/15)). `dbtForge.lineageLocation` switches it between an editor tab (default, unchanged) and a tab in the bottom panel beside Data Preview and Terminal. The graph itself is identical in both — only the frame differs.
  - **Switch Lineage Placement** — a button in the Lineage view's own title bar, which flips the setting and immediately draws the open model. The Lineage view is registered regardless of the setting, so it is possible to find it sitting empty in the panel while lineages keep opening in the editor; its empty state now says which of the two is happening instead of promising a graph that would never arrive.
- **The build actions are in the editor title bar, and on keyboard shortcuts** ([#16](https://github.com/Y0hannH/dbtforge/issues/16)). A single dbt Forge icon in the editor's title bar opens a menu with all eight actions, grouped: preview (Data, Compiled SQL, Lineage), build (Model, Upstream, Downstream, Test), then Compile This File. One icon rather than several, because `editor/title` sorts every extension's contributions into one shared `navigation` group — separate icons get interleaved with whatever else is installed, and there is no way to pin them together. A submenu is the only grouping the API actually offers. The title bar doesn't scroll away, which the CodeLens row at line 1 does on a long model.
  - New shortcuts, all scoped to a dbt model in the editor and the zero-click path: `Ctrl+K B` build, `Ctrl+K U` build upstream, `Ctrl+K D` build downstream, `Ctrl+K T` test, `Ctrl+K L` lineage.

### Fixed
- **Tests are no longer drawn as nodes in the lineage graph** ([#4](https://github.com/Y0hannH/dbtforge/issues/4)). `child_map` lists a model's tests among its children, and nothing filtered on resource type — so a model with six tests rendered as a model with six extra children, and the expand button counted them in its badge. Tests are now hidden by default and the counts only ever promise what a click will actually reveal. The checkbox brings them back.
- **One lineage tab, not one per model** ([#15](https://github.com/Y0hannH/dbtforge/issues/15)). Every Show Lineage created a new webview panel, so looking at three models in a row left three `Lineage: …` tabs behind. The tab is now reused and retargeted.
- **The lineage minimap follows your theme** ([#17](https://github.com/Y0hannH/dbtforge/issues/17)). It was rendering with React Flow's stock light-theme colours, which ignore VS Code entirely — hence a washed-out copy of the graph and a viewport box you could barely find. Node fills now come from the theme (and from the project's own `node_color` where one is declared), the dimming mask is derived from the editor background, and the viewport box is outlined in the focus colour. Colours are re-read when you switch theme.
  - The minimap now only appears once the graph passes 10 nodes. Below that it was a smaller copy of something already fully on screen — which is exactly the state the initial one-hop view is in.

### Changed
- The bottom panel container is now titled **dbt Forge** rather than *dbt Preview*, since it holds both Data Preview and Lineage.

## [0.11.0] - 2026-08-14

The first release driven by user reports: two bugs found in real projects, and the lineage graph starting to say more about what it draws.

### Added
- **Lineage nodes show what they materialize as, and wear the colour the project gave them** ([#5](https://github.com/Y0hannH/dbtforge/issues/5)). The row above a node's name now reads `model · incremental` (or `· view`, `· ephemeral`, `· materialized_view`…), so the graph answers what a node *is* and not only what it is called. Seeds and snapshots keep their single-word label, since their materialization only repeats their resource type.
  - A node's `node_color` — declared in `dbt_project.yml` under `+docs:` or via `config(docs={'node_color': ...})` — paints a stripe down the left edge of its box. It is read from both places dbt records it, and validated before it reaches the webview: a hex code or a CSS colour keyword is used, anything else is ignored and the node keeps its default border. The stripe deliberately isn't the border itself, which already carries the "this is the node you opened" highlight.
  - Both are read straight from `manifest.json`, so they cost no extra dbt run.

### Fixed
- **Lineage nodes no longer collide when model names are long.** Every node was laid out as if it were 170px wide while the box itself grew to fit its text, so a long name overflowed the slot dagre had reserved for it and landed on top of the next rank — over its neighbour's expand button, and often over the neighbour itself ([#3](https://github.com/Y0hannH/dbtforge/issues/3)). Each node is now measured from its own name and that single width drives both the layout and the rendered box, so they can't disagree. Widths are clamped: short names keep the previous 170px floor, and anything past 340px ellipsizes with the full name in the node's tooltip rather than pushing the rest of the graph off-screen.
  - Nodes in the same column are aligned on their left edge instead of on their centres, which is what dagre does by default and what made a column of mixed-width boxes look ragged.
- **`ref()` on a seed or a snapshot resolves like any other ref.** The index only ever held `model` nodes, so `{{ ref('my_seed') }}` was reported in the Problems panel as a model that doesn't exist, Ctrl+click did nothing, and hover showed nothing — even though the seed was right there in the manifest and showed up in the lineage of the model referencing it. Models, seeds and snapshots are now indexed together, matching what dbt itself lets `ref()` target ([#6](https://github.com/Y0hannH/dbtforge/issues/6)).
  - Autocomplete inside `{{ ref('...` suggests seeds and snapshots too, each labelled with its resource type rather than all of them as "model".
  - The diagnostic's wording follows: *No model, seed or snapshot named "x" in the manifest*.
- **Lineage opens on a seed.** A seed's `.csv` is now mapped to its manifest node, so the Lineage action is available on one (CodeLens at the top of the file, or the editor's right-click menu) and the Parents/Children/Tests panel fills in — previously only `.sql` files were matched to a node, which left a seed with no way to be the root of its own graph. Snapshots get the same Lineage action.
- **Find All References works from inside a snapshot's file**, the same whole-file way it already did from a model's.

## [0.10.0] - 2026-08-13

Data preview, the one thing the extension was most often asked for.

### Added
- **Preview Data** — runs `dbt show` through your venv and selected environment, and shows the rows in a **Data Preview tab in the bottom panel**, next to Terminal and Problems. Available from the CodeLens row, the editor's right-click menu, the palette, and `Ctrl+Enter` (`Cmd+Enter` on macOS). Because it goes through `dbt show`, it works on models that have never been materialized and on `ephemeral` ones — though their upstream `ref()`s still have to exist in the warehouse. The run is cancellable, and a second preview supersedes the first rather than racing it.
  - Unlike every other dbt command in the extension, this one does **not** go to the integrated terminal: a preview has to read what dbt printed, so it spawns dbt directly and parses its JSON output. Errors are reported in the panel and the full dbt output goes to the dbt Forge output channel.
  - A preview runs a real query against whichever warehouse your selected target points at.
- **Preview CTE** — a preview action on every CTE in the file, on the line where it is declared. The model is truncated just after the chosen CTE and given a `select * from <cte>`, so an intermediate step can be inspected without commenting out the rest of the query. Earlier CTEs are kept (the chosen one may depend on them) along with anything preceding the `WITH` clause; later ones are dropped, which is safe since a non-recursive CTE can only reference those declared before it.
- **Re-run Data Preview** — refresh button in the Data Preview title bar.

### Added (settings)
- `dbtForge.previewRowLimit` — rows a preview asks dbt for (`dbt show --limit`). Defaults to 100; `-1` fetches every row.

### Fixed
- **Preview works on `SELECT DISTINCT` models on Fabric / SQL Server / Synapse.** `dbt-fabric`'s `get_limit_sql` appends `order by (select null) offset 0 rows fetch first N rows only` to the model's own SQL rather than wrapping it, which SQL Server rejects on a `SELECT DISTINCT` (error 145: ORDER BY items must appear in the select list). Those models are now previewed by carrying the limit ourselves — `select top N * from ( <final select> ) as dbtforge_preview`, with any CTEs left at the top level where T-SQL requires them — and asking dbt for no limit at all. The deviation is entered only for models that would otherwise fail, on those adapters only, since `--inline` doesn't apply the model's config; everything else keeps the ordinary path. When the SQL can't be rewritten with certainty, the preview runs unchanged so dbt reports the real error, rather than sending a query whose row limit isn't guaranteed.

## [0.9.0] - 2026-08-12

### Added
- **Tags view** in the dbt Forge sidebar — lists every tag declared in the project (models, tests, seeds, snapshots and sources), each expandable to the resources carrying it, with inline Build / Build Upstream (`+tag:`) / Build Downstream (`tag:+`) / Test buttons. Tags are read from both a node's top-level `tags` and its `config.tags`, unioned, since manifests don't populate the two identically. Every tag command carries the environment selected in the status bar.
- **Build Tag / Build Tag Upstream / Build Tag Downstream / Test Tag** commands — also available from the palette, where they prompt with a quick pick of the project's tags.

## [0.8.0] - 2026-08-12

Faster feedback loop on files dbt hasn't parsed yet.

### Added
- **Compile This File** command (`dbt compile --select path:<file>`) — compiles only the open model instead of the whole project, so a file that was just created gets into the manifest without waiting on a full `dbt compile`. Available from the editor's right-click menu, the sidebar's title bar, and the panel's welcome view. Works on files dbt doesn't know yet: the selector is derived from the file path, not from the manifest. Like every other dbt invocation, it carries the environment selected in the status bar.
- **Refresh Manifest (dbt parse)** command — regenerates `manifest.json` without compiling any SQL or touching the warehouse, the fastest way to get newly added models recognized.
- **Welcome view on the Parents/Children/Tests panel** — instead of an empty panel, an unindexed `.sql` file now explains why and offers Compile This File / Refresh Manifest inline.

### Fixed
- The Parents/Children/Tests panel and the CodeLens row no longer wait for an editor switch to pick up a manifest reload — they refresh as soon as the index reloads, so a model appears in the panel right after the dbt run that indexed it finishes.

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
