# 🔨 dbt Forge

> A smoother dbt workflow, without leaving VS Code — and without your SQL ever leaving your machine.

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/evolve-data.dbtforge?style=flat-square&label=Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=evolve-data.dbtforge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/evolve-data.dbtforge?style=flat-square&color=00B4D8)](https://marketplace.visualstudio.com/items?itemName=evolve-data.dbtforge)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85-007ACC?style=flat-square&logo=visualstudiocode)
![License](https://img.shields.io/badge/License-MIT-00B4D8?style=flat-square)

[Getting started](#getting-started) · [Features](#features) · [Column autocomplete](#column-autocomplete-what-it-needs) · [Commands](#commands) · [Shortcuts](#keyboard-shortcuts) · [Settings](#configuration) · [Privacy](#local-data--privacy) · [Non-goals](#non-goals) · [What's next](#whats-next)

---

## What is dbt Forge?

dbt Forge is a VS Code extension for data engineers working on dbt projects (built and tested against `dbt-fabric` / Microsoft Fabric, but not tied to it). It fills the gaps left by existing dbt tooling — column-level autocomplete, an interactive lineage graph, and one-click build shortcuts — while keeping everything **100% local**.

Nothing is sent anywhere. No account, no API key, no third-party backend. dbt Forge only reads the files your own `dbt` already produces (`manifest.json`, `catalog.json`, compiled SQL) and runs `dbt` through your own project's Python environment.

---

## Getting started

### Prerequisites

- VS Code 1.85+
- A dbt project (`dbt_project.yml`) with its own Python virtual environment (dbt-core + your adapter installed inside it)
- `manifest.json`, generated at least once (`dbt compile` or `dbt build`) — autocomplete, lineage and the panels read it
- `catalog.json` (`dbt docs generate`, or the **Generate Docs** button) — column autocomplete on already-built models reads it

### Install

Open the Extensions view (`Ctrl+Shift+X`), search for **dbt Forge**, and click Install — or from a terminal:

```bash
code --install-extension evolve-data.dbtforge
```

The extension is also on the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=evolve-data.dbtforge), and activates on its own as soon as the folder you open contains a `dbt_project.yml`.

<details>
<summary><strong>From a .vsix</strong> (a release download, or your own build)</summary>

```bash
code --install-extension dbtforge-0.20.0.vsix
```

</details>

<details>
<summary><strong>From source</strong> (to hack on the extension)</summary>

```bash
git clone https://github.com/Y0hannH/dbtforge
cd dbtforge
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host with dbt Forge loaded, and open your dbt project in that window. `npm test` runs the unit suite; `npx vsce package` produces an installable `.vsix`.

</details>

### First run

1. Open your dbt project folder (containing `dbt_project.yml`, or nested inside a larger workspace)
2. Set `dbtForge.pythonPath` to your project's venv Python (e.g. `C:/path/to/project/.venv/Scripts/python.exe`)
3. Run `dbt compile` (or `dbt build`) at least once so `manifest.json` exists
4. Run **dbt Forge: Generate Docs** (the 📖 button in the panel's title bar) so `catalog.json` exists — column autocomplete needs it
5. Open a model `.sql` file — autocomplete, CodeLens, and the Parents/Children/Tests panel activate automatically

---

## Features

### Write SQL

- **`ref()` / `source()` autocomplete** — model, seed, snapshot and source names as you type inside `{{ ref('...` / `{{ source('...', '...`.
- **Snippets** — type `ref` or `source` in plain SQL to expand the full `{{ ref("") }}` tag, cursor ready to autocomplete.
- **Column autocomplete** — column names after `alias.`, from `catalog.json` and from same-file CTEs; unqualified in a model that reads a single table. **Needs `dbt docs generate`** for models and sources — [details below](#column-autocomplete-what-it-needs).
- **Doc blocks** — autocomplete inside `{{ doc('...` from the `{% docs %}` blocks your project declares, Go to Definition onto the block, and a warning when a `doc()` doesn't resolve — in `.yml` as well as `.sql`.

### Navigate

- **Go to Definition** — `Ctrl+click` a `ref()` / `source()` / macro call to jump to the file it resolves to: a model's or macro's `.sql`, a seed's `.csv`.
- **Find All References** — `Shift+F12` (or right-click) on a model, source or macro lists every call site across the project.
- **Hover documentation** — hover a `ref()` / `source()` / macro call for its description (and a macro's argument signature), straight from the manifest.
- **Parents / Children / Tests panel** — sidebar view of the current model's direct dependencies and dependents.
- **Tags panel** — every tag declared in the project, expandable to its resources, with one-click Build / Build Upstream / Build Downstream / Test per tag.

### Catch mistakes

- **Broken `ref()` / `source()` diagnostics** — a call that doesn't resolve against the manifest (a typo, a renamed or deleted model) is flagged in the Problems panel and inline.
- **Column reconciliation** — in a schema `.yml`, warns when a documented column doesn't exist in the table, and when the same column is documented twice (the second silently overwrites the first in dbt). Quick fixes remove a stale column or add the ones the file leaves out. Reads `catalog.json`, so it stays quiet until `dbt docs generate` has run.
- **Failing tests in Problems** — a test that failed or warned lands on the line of the `.yml` that declares it, and a model that errored on the first line of its file. Read from `run_results.json`, so it costs no extra dbt run.

### See the project

- **Interactive lineage graph** — click-to-expand upstream/downstream graph (React Flow). It starts at the current model, seed or snapshot and shows sources upstream and exposures (dashboards, apps) downstream — no giant unreadable diagram dumped on you. Each node shows its materialization, its `target_lag` if it is a dynamic table (a `downstream` one also shows the shortest lag declared below it, as `≤ 10 minutes`), its column count once `catalog.json` exists, and wears the `node_color` your project declares.
- **Scope controls** — how many hops of parents and children to draw (or *All* for the whole DAG), hide tests, drop whole materializations. Resolved from the manifest, so it redraws instantly.
- **Model versions** — told apart everywhere: `dim_customers (v1)` and `dim_customers (v2)` in the lineage and the relatives panel, the version a bare `ref()` goes to marked `latest`, `ref('m', v=2)` resolved to exactly that version, and a schema `.yml`'s `versions:` read version by version against each version's own table. Build, Test and Data Preview select a versioned model by its file, so they act on one version.

### Preview

- **Compiled SQL** — a read-only, side-by-side preview of the SQL dbt actually runs.
- **Data preview** — `Ctrl+Enter` on a model runs `dbt show` and shows the rows in a **Data Preview tab in the bottom panel**. Works on models that were never materialized, and on `ephemeral` ones.
- **Per-CTE preview** — a preview button on every CTE, to inspect an intermediate step without commenting out the rest of the query. `Ctrl+Enter` with the cursor inside a CTE previews that CTE rather than the whole model.

### Run dbt

- **Build / Test shortcuts** — CodeLens and sidebar buttons for Build Upstream, Build Downstream, Test and Build Project, run through your project's own venv.
- **Environment switching** — a status bar picker over the profiles in your `profiles.yml`. Every dbt command dbt Forge runs then carries that `--profile` / `--target`, so a dev branch can point at a different Fabric workspace than `main`.
- **Compile This File** — `dbt compile --select path:<file>` on the open model only: the fast way to get a just-created model into the manifest, without a full-project compile.
- **State-aware builds** — point dbt Forge at a reference `manifest.json` (a CI artefact, or a copy of your own taken on `main`) and the lineage and the relatives panel mark what differs: `modified` (its SQL or config changed), `new`, and `impacted` (downstream of a change). **Build Modified + Downstream** runs `dbt build --select state:modified+ --defer --state …`; **Build Model, Deferring Upstream to the Reference** builds the open model on top of the reference environment. The comparison is local — nothing is run to produce the marks.
- **Last run status** — after a `dbt build`, `run` or `test`, each node shows how it went (`✓ 4.2s`, `✗ failed`, `– skipped`) in the lineage graph and in the Parents / Children / Tests panel. A model that built fine but fails a test reads as failing, with the count; hover for dbt's message and when it ran. Read from `run_results.json`.

---

## Column autocomplete: what it needs

Column suggestions come from two independent paths, which explains why they sometimes appear and sometimes don't:

| You type | Where the columns come from | Requires |
|---|---|---|
| `my_cte.` | The CTE's own `SELECT` list, parsed from the open file | Nothing — works offline, on an unbuilt model |
| `my_cte.` where the `SELECT` list has a `*` | The columns it names, plus the columns of the one table the `*` reads, from `catalog.json` | **`dbt docs generate`**, the model must have been built, and the conditions below |
| `m.` where `m` aliases a model/source | `catalog.json` | **`dbt docs generate`**, and the model must have been built |
| nothing, in a statement that reads one unaliased table | `catalog.json` for a model/source, the CTE's own `SELECT` list for a CTE | The same as the row it falls back to, plus the conditions below |

Two things trip people up:

- **`catalog.json` is only written by `dbt docs generate`.** Neither `dbt compile`, nor `dbt run`, nor `dbt build` produces or refreshes it. A model can be perfectly compiled and still have no column suggestions. Use the **Generate Docs** button, then re-run it whenever columns change.
- **The alias is mandatory as soon as the model reads more than one table.** `from {{ ref('orders') }} o` gives you `o.`; a second table with no alias gives you nothing to type before the dot, because a bare column could then have come from either.

The alias must also sit right after a single-argument `ref()`/`source()` call — `ref('package', 'model')`, `ref('model', version=2)`, and calls split across lines aren't detected yet.

If nothing is suggested, dbt Forge stays silent rather than guessing. Check those conditions in order.

<details>
<summary><strong>The exact rules</strong> — single-table statements, CTEs that select <code>*</code>, CTEs that declare columns</summary>

**The single-table exception.** A statement that reads exactly one table, with no alias and no join, suggests that table's columns with nothing typed before them — there is no other place they could have come from, so nothing is being guessed. The statement is the body of the CTE the cursor is in, or the final `SELECT`; a CTE elsewhere in the file is not a candidate for either. The table is a `ref()`/`source()` (its columns from `catalog.json`) or a CTE written earlier in the file (its own `SELECT` list, answered whole or not at all as below). Add a second table — a join, a comma, a subquery, a `UNION` — and the suggestions stop, which is the alias requirement coming back rather than a fault. Suggestions are also held back where a column isn't what you're typing: inside a `{{ … }}` tag, inside a string or a comment, and directly after `FROM`/`JOIN`.

**A CTE that selects `*`.** `my_cte.` is the way to complete a CTE you don't alias, since its name is already unique. When its `SELECT` list holds a `*` (or `alias.*`), the columns the `*` adds can only come from the catalog, so they are offered only when the `*` is unambiguous: the CTE's first `SELECT` (a `UNION` takes its column names from it) reads exactly one `ref()`/`source()`, with no join, comma, subquery, `pivot` or other CTE behind it. Anything else — a join, `* exclude (…)`, a macro such as `dbt_utils.star()`, a model never built — gives **no suggestions at all**, never just the few columns the text names, which would read as the whole list.

**A CTE that declares its columns.** `with a (x, y) as (…)` names `a`'s columns `x` and `y`, whatever its `SELECT` list calls them, and that is what `a.` completes to — in full, without the catalog, and without reading the `SELECT` list. A list holding anything but plain names (a Jinja expression, say) gives no suggestions rather than the `SELECT` list's names.

</details>

---

## Commands

Every command is in the Command Palette under **dbt Forge**; most are also on a CodeLens, a sidebar button or a right-click menu.

### Build and test

| Command | Runs |
|---|---|
| `dbtForge.buildModel` | `dbt build --select model` for the open model, without upstream or downstream |
| `dbtForge.buildUpstream` | `dbt build --select +model` |
| `dbtForge.buildDownstream` | `dbt build --select model+` |
| `dbtForge.testModel` | `dbt test --select model` |
| `dbtForge.buildProject` | `dbt build` for the whole project |
| `dbtForge.buildFolder` | `dbt build --select path:<folder>` for all models in a right-clicked folder |
| `dbtForge.buildFolderUpstream` | `dbt build --select +path:<folder>` — the folder's models + upstream parents |
| `dbtForge.buildFolderDownstream` | `dbt build --select path:<folder>+` — the folder's models + downstream children |
| `dbtForge.buildTag` | `dbt build --select tag:<tag>` — every resource carrying the tag |
| `dbtForge.buildTagUpstream` | `dbt build --select +tag:<tag>` — the tag's resources + upstream parents |
| `dbtForge.buildTagDownstream` | `dbt build --select tag:<tag>+` — the tag's resources + downstream children |
| `dbtForge.testTag` | `dbt test --select tag:<tag>` |

### Compile and refresh

| Command | Does |
|---|---|
| `dbtForge.compileFile` | `dbt compile --select path:<file>` for the open file — works even if it isn't in the manifest yet |
| `dbtForge.parseProject` | `dbt parse` — regenerates `manifest.json` without compiling SQL or hitting the warehouse |
| `dbtForge.compileProject` | `dbt compile` for the whole project |
| `dbtForge.generateDocs` | `dbt docs generate` — writes `catalog.json`, which column autocomplete reads |
| `dbtForge.refreshIndex` | Re-reads `manifest.json` / `catalog.json` from disk (does **not** run dbt) |
| `dbtForge.refreshTags` | Re-reads the tag list from the loaded manifest |

### Preview and lineage

| Command | Does |
|---|---|
| `dbtForge.previewCompiledSql` | Opens the compiled SQL for the open model, read-only |
| `dbtForge.previewData` | `dbt show` for the open model, or for the CTE the cursor is in — rows land in the Data Preview panel (`Ctrl+Enter` / `Cmd+Enter`) |
| `dbtForge.previewCte` | `dbt show` for one named CTE — invoked from the CodeLens on the CTE itself |
| `dbtForge.rerunPreview` | Re-runs the last data preview |
| `dbtForge.showLineage` | Opens the interactive lineage graph for the open model, seed or snapshot |
| `dbtForge.toggleLineageLocation` | Switches the lineage between an editor tab and the bottom panel (also a button in the Lineage view's title bar) |

### State-aware builds and environment

| Command | Does |
|---|---|
| `dbtForge.setReferenceState` | Chooses the folder holding the reference `manifest.json`, and says what differs from it |
| `dbtForge.useCurrentAsReference` | Keeps a copy of the project's own `manifest.json` as the reference — for when there is no CI artefact: compile on `main`, run this, switch branch |
| `dbtForge.clearReferenceState` | Forgets the chosen reference folder |
| `dbtForge.buildModified` | `dbt build --select state:modified+ --defer --state <reference>` |
| `dbtForge.buildDeferred` | `dbt build --select <model> --defer --state <reference>` for the open model |
| `dbtForge.selectProfile` | Switches the profile/target dbt Forge runs dbt with (also on the status bar) |

---

## Keyboard shortcuts

These apply while a dbt model is focused in the editor, and are inert everywhere else.

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` / `Cmd+Enter` | Preview Data — the CTE the cursor is in, or the whole model when it is anywhere else |
| `Ctrl+K B` | Build Model |
| `Ctrl+K U` | Build Upstream (`+model`) |
| `Ctrl+K D` | Build Downstream (`model+`) |
| `Ctrl+K T` | Test Model |
| `Ctrl+K L` | Show Lineage — also on a seed's `.csv` |

Only the shortcut (and the Command Palette) follow the cursor into a CTE. The buttons say which scope they mean: **Preview Data** in a menu or in the CodeLens row is always the whole model, and **Preview CTE** is always that CTE. Whichever ran, the panel's header names it.

The same actions are also under the **dbt Forge** icon in the editor's title bar, which — unlike the CodeLens row at the top of the file — stays put when you scroll. They sit in one menu rather than as separate icons because VS Code sorts every extension's title-bar buttons into a single shared group, so loose icons end up interleaved with whatever else you have installed. On a seed's `.csv` the menu holds only **Show Lineage**, the one action that applies.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `dbtForge.pythonPath` | `""` | Path to the Python executable inside your dbt project's venv. Empty falls back to `dbt` on PATH |
| `dbtForge.projectDir` | `""` | Path to the dbt project root. Auto-detected (including nested inside a larger workspace) if left empty |
| `dbtForge.profilesDir` | `""` | Directory holding `profiles.yml`, for the environment picker. Empty looks where dbt does: `DBT_PROFILES_DIR`, the project root, then `~/.dbt`. When set, it is also passed as `--profiles-dir` |
| `dbtForge.manifestPath` | `target/manifest.json` | Path to `manifest.json`, relative to the project root |
| `dbtForge.catalogPath` | `target/catalog.json` | Path to `catalog.json`, relative to the project root |
| `dbtForge.runResultsPath` | `target/run_results.json` | Path to `run_results.json`, relative to the project root. Read after each `dbt build`, `run` or `test` to show each node's last status and duration |
| `dbtForge.compiledDir` | `target/compiled` | Path to the compiled models directory, relative to the project root |
| `dbtForge.stateDir` | `""` | Folder holding the reference `manifest.json` that state-aware builds compare against (`dbt --state`). Relative to the project root, or absolute. Empty turns the feature off. A folder chosen with *Set Reference Manifest Folder…* is remembered for this machine and wins over it |
| `dbtForge.previewRowLimit` | `100` | Rows a data preview asks dbt for (`dbt show --limit`). `-1` fetches every row |
| `dbtForge.flagUndocumentedColumns` | `false` | Also warn when the table has columns the `.yml` doesn't document. Off by default — documenting only the columns that need explaining is a legitimate house style |
| `dbtForge.lineageLocation` | `editor` | Where the lineage graph opens: `editor` (a tab beside the model) or `panel` (its own **dbt Forge Lineage** tab in the bottom panel, beside **dbt Forge Preview** and Terminal). From the panel, **Full lineage** in the graph's toolbar opens the same graph in an editor tab, where the minimap is |
| `dbtForge.lineageFollowsEditor` | `true` | When a lineage graph is open, redraw it for whichever model, seed or snapshot you switch to in the editor. Never opens a lineage by itself, and keeps your depth and exclusion choices |

---

## Local data & privacy

dbt Forge does not collect any data and has no network calls of its own:

- Reads `manifest.json`, `catalog.json`, and compiled SQL directly from your project's `target/` folder
- Reads `profiles.yml` to list the profiles and targets you can switch between. It is only ever read, never modified, and nothing from it — credentials included — leaves your machine or is written to your settings; switching environments only changes the `--profile`/`--target` flags on the command line
- Your environment choice is stored in VS Code's workspace state, not in a committed `.vscode/settings.json`
- Runs `dbt` through your own configured Python environment, in your own integrated terminal
- **Data preview queries your warehouse** — it runs `dbt show` through your own venv and your own profile, so rows travel between your warehouse and your machine exactly as they would if you ran `dbt show` yourself. The extension stores no credentials and opens no connection of its own, but a preview is not an offline operation: it costs a query against whichever target you are pointed at
- No telemetry, no backend, no external service — everything happens on your machine

---

## Non-goals

dbt Forge stays small on purpose. One question decides what goes in:

> **Does the feature need to know your dbt project?**

If it has to read `manifest.json`, `catalog.json` or your dependency graph to be useful, it belongs here — nobody else can do it as well. If it works the same on any SQL file, it is somebody else's extension, and pulling it in would only make this one heavier at doing what it is actually for.

So these are deliberately **out of scope**, not "not yet":

| Not in scope | Use instead |
|---|---|
| Jinja / SQL syntax highlighting | [Better Jinja](https://marketplace.visualstudio.com/items?itemName=samuelcolvin.jinjahtml) — mature, and it covers `.sql`, `.yml` and `.md`. Note that *resolving* Jinja against your project — `ref()`, `source()`, `doc()`, macros — is very much in scope; it is the colouring that isn't |
| SQL formatting and linting | [sqlfmt](https://docs.sqlfmt.com/), [SQLFluff](https://sqlfluff.com/), or your editor's own formatter |
| A warehouse browser or general SQL client | A warehouse-specific extension. Data preview here goes through `dbt show` and nothing else — dbt Forge opens no connection of its own |
| dbt Cloud, remote execution, AI assistance | Not planned in any form. Everything runs locally through your own venv, and nothing leaves your machine (see [Local data & privacy](#local-data--privacy)) |

A request that falls on the wrong side of that line is not a bad idea — it is usually a good idea for a different extension. Where the underlying need *does* touch the project (say, resolving a `doc()` to the block that defines it, rather than colouring the `{% docs %}` tag), that is the version worth opening an issue for.

---

## What's next

What has shipped, version by version, is in the [CHANGELOG](CHANGELOG.md). What follows is planned in this order — an order, not a promise of dates. Every item passes the same test as the rest: it needs to know your dbt project.

1. **dbt resources it doesn't know yet.** *Done:* model versions. *Still to do:* `ref('package', 'model')` and `ref('m', v=2)` in alias detection, unit tests, and metrics / semantic models / saved queries in the lineage. Groups and `access`: warn on a `ref()` to a private model from outside its group.
2. **State-aware builds.** *Done:* a reference manifest — a folder, or a copy of the project's own taken on `main` — `modified` / `new` / `impacted` marks in the lineage, and the two deferred builds. *Still to do:* a `dbt ls` selection from the larger lineage view — the second half of [#4](https://github.com/Y0hannH/dbtforge/issues/4).
3. **Column-level lineage.** The largest item, and the one where being wrong costs the most, so it starts as a measured spike: how much of a real project's compiled SQL resolves with certainty. Same rule as completion — an edge is drawn when it is certain and left out when it is not, never approximated. Whether it ships follows from that number.

Not yet placed: renaming a model across its `ref()` call sites and `.yml`; a project-hygiene panel (models with no test, no description, no tested key); multi-project workspaces and cross-project refs.

---

## Under the hood

| Layer | Stack |
|---|---|
| Extension Host | TypeScript + VS Code Extension API |
| Lineage Webview | React + React Flow + dagre (auto-layout), bundled locally — no CDN |
| Data Source | Reads `manifest.json` / `catalog.json` / `target/compiled/*.sql` directly, with a file watcher to stay in sync. `profiles.yml` is read (never written) to list the environments you can switch between |
| dbt Execution | Runs the `dbt` executable from your configured venv (`Scripts/`/`bin/`) in the integrated terminal — except data preview, which spawns `dbt show` directly so it can read the rows back |

## Contributing

The project is under active development.

- Fork → branch → PR
- Open an issue to discuss a feature before coding
- Follow the existing naming conventions

## License

MIT © 2026 [Evolve](https://evolve-data.fr) — Yohann

---

*Built with ♥ by Evolve*
