# 🔨 dbt Forge

> A smoother dbt workflow, without leaving VS Code — and without your SQL ever leaving your machine.

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/evolve-data.dbtforge?style=flat-square&label=Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=evolve-data.dbtforge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/evolve-data.dbtforge?style=flat-square&color=00B4D8)](https://marketplace.visualstudio.com/items?itemName=evolve-data.dbtforge)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85-007ACC?style=flat-square&logo=visualstudiocode)
![License](https://img.shields.io/badge/License-MIT-00B4D8?style=flat-square)

---

## What is dbt Forge?

dbt Forge is a VS Code extension for data engineers working on dbt projects (built and tested against `dbt-fabric` / Microsoft Fabric, but not tied to it). It fills the gaps left by existing dbt tooling — column-level autocomplete, an interactive lineage graph, and one-click build shortcuts — while keeping everything **100% local**.

Nothing is sent anywhere. No account, no API key, no third-party backend. dbt Forge only reads the files your own `dbt` already produces (`manifest.json`, `catalog.json`, compiled SQL) and runs `dbt` through your own project's Python environment.

---

## Features

| | Feature | Description |
|---|---|---|
| 🔗 | **ref()/source() autocomplete** | Suggests model and source names as you type inside `{{ ref('...` / `{{ source('...', '...` |
| ⚡ | **Snippet expansion** | Type `ref` or `source` in plain SQL to expand into the full `{{ ref("") }}` tag, cursor ready to autocomplete |
| 🧭 | **Go to Definition** | Ctrl+click a `ref()`/`source()`/macro call to jump straight to the model/macro's `.sql` file |
| 🔍 | **Find All References** | Shift+F12 (or right-click) on a model, source, or macro to list every call site across the project |
| 💬 | **Hover documentation** | Hover a `ref()`/`source()`/macro call to see its description (and a macro's argument signature) straight from the manifest |
| ⚠️ | **Broken ref()/source() diagnostics** | Warns in the Problems panel (and inline) when a `ref()`/`source()` call doesn't resolve against the manifest — e.g. a typo or a renamed/deleted model |
| 🔤 | **Column autocomplete** | Suggests column names after `alias.`, resolved from `catalog.json` (**requires `dbt docs generate`** — see below) and from same-file CTEs |
| 🌳 | **Parents / Children / Tests panel** | Sidebar view of the current model's direct dependencies and dependents, from the manifest's dependency graph |
| 🕸️ | **Interactive lineage graph** | Click-to-expand upstream/downstream graph (React Flow) — starts at the current model, no giant unreadable diagram dumped on you |
| 👁️ | **Compiled SQL preview** | Read-only, side-by-side preview of the compiled SQL dbt actually runs |
| 🚀 | **Build / Test shortcuts** | CodeLens and sidebar buttons for Build Upstream, Build Downstream, Test, and Build Project — run through your project's own venv |
| 🔀 | **Environment switching** | Status bar picker over the profiles in your `profiles.yml` — every dbt command dbt Forge runs then carries that `--profile`/`--target`, so a dev branch can point at a different Fabric workspace than main |
| ⚡ | **Compile This File** | Compiles only the open model (`dbt compile --select path:<file>`) — the fast way to get a just-created model into the manifest, without a full-project compile |
| 🏷️ | **Tags panel** | Every tag declared in the project, expandable to its resources, with one-click Build / Build Upstream / Build Downstream / Test per tag |

---

## Getting Started

### Prerequisites

- VS Code 1.85+
- A dbt project (`dbt_project.yml`) with its own Python virtual environment (dbt-core + your adapter installed inside it)
- `manifest.json` generated at least once (`dbt compile` or `dbt build`) for autocomplete/lineage/panels to have data
- `catalog.json` generated (`dbt docs generate`, or the **Generate Docs** button) for column autocomplete on already-built models

### Installation

**From the VS Code Marketplace** — open the Extensions view (`Ctrl+Shift+X`), search for **dbt Forge**, and click Install. Or, from a terminal:

```bash
code --install-extension evolve-data.dbtforge
```

The extension is also on the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=evolve-data.dbtforge), and activates on its own as soon as the folder you open contains a `dbt_project.yml`.

<details>
<summary><strong>From a .vsix</strong> (a release download, or your own build)</summary>

```bash
code --install-extension dbtforge-0.5.0.vsix
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

### First Run

1. Open your dbt project folder (containing `dbt_project.yml`, or nested inside a larger workspace)
2. Set `dbtForge.pythonPath` to your project's venv Python (e.g. `C:/path/to/project/.venv/Scripts/python.exe`)
3. Run `dbt compile` (or `dbt build`) at least once so `manifest.json` exists
4. Run **dbt Forge: Generate Docs** (the 📖 button in the panel's title bar) so `catalog.json` exists — column autocomplete needs it
5. Open a model `.sql` file — autocomplete, CodeLens, and the Parents/Children/Tests panel activate automatically

---

## Column autocomplete: what it needs

Column suggestions come from two independent paths, which explains why they sometimes appear and sometimes don't:

| You type | Where the columns come from | Requires |
|---|---|---|
| `my_cte.` | The CTE's own `SELECT` list, parsed from the open file | Nothing — works offline, on an unbuilt model |
| `m.` where `m` aliases a model/source | `catalog.json` | **`dbt docs generate`**, and the model must have been built |

Two things trip people up:

- **`catalog.json` is only written by `dbt docs generate`.** Neither `dbt compile`, nor `dbt run`, nor `dbt build` produces or refreshes it. A model can be perfectly compiled and still have no column suggestions. Use the **Generate Docs** button, then re-run it whenever columns change.
- **The alias is mandatory.** `from {{ ref('orders') }} o` gives you `o.`; `from {{ ref('orders') }}` with no alias gives you nothing to type before the dot.

Also note that the alias must sit right after a single-argument `ref()`/`source()` call — `ref('package', 'model')`, `ref('model', version=2)`, and calls split across lines aren't detected yet.

If nothing is suggested, dbt Forge stays silent rather than guessing. Check those conditions in order.

---

## Architecture

| Layer | Stack |
|---|---|
| Extension Host | TypeScript + VS Code Extension API |
| Lineage Webview | React + React Flow + dagre (auto-layout), bundled locally — no CDN |
| Data Source | Reads `manifest.json` / `catalog.json` / `target/compiled/*.sql` directly, with a file watcher to stay in sync |
| dbt Execution | Runs the `dbt` executable from your configured venv (`Scripts/`/`bin/`) in the integrated terminal |

---

## Commands

| Command | Description |
|---|---|
| `dbtForge.generateDocs` | `dbt docs generate` — writes `catalog.json`, which column autocomplete reads |
| `dbtForge.refreshIndex` | Re-read `manifest.json` / `catalog.json` from disk (does **not** run dbt) |
| `dbtForge.compileFile` | `dbt compile --select path:<file>` for the open file — works even if it isn't in the manifest yet |
| `dbtForge.parseProject` | `dbt parse` — regenerates manifest.json without compiling SQL or hitting the warehouse |
| `dbtForge.buildUpstream` | `dbt build --select +model` for the open model |
| `dbtForge.buildDownstream` | `dbt build --select model+` for the open model |
| `dbtForge.testModel` | `dbt test --select model` for the open model |
| `dbtForge.buildProject` | `dbt build` for the whole project |
| `dbtForge.buildFolder` | `dbt build --select path:<folder>` for all models in a right-clicked folder |
| `dbtForge.buildFolderUpstream` | `dbt build --select +path:<folder>` — folder's models + upstream parents |
| `dbtForge.buildFolderDownstream` | `dbt build --select path:<folder>+` — folder's models + downstream children |
| `dbtForge.buildTag` | `dbt build --select tag:<tag>` — every resource carrying the tag |
| `dbtForge.buildTagUpstream` | `dbt build --select +tag:<tag>` — the tag's resources + upstream parents |
| `dbtForge.buildTagDownstream` | `dbt build --select tag:<tag>+` — the tag's resources + downstream children |
| `dbtForge.testTag` | `dbt test --select tag:<tag>` |
| `dbtForge.previewCompiledSql` | Open the compiled SQL for the open model, read-only |
| `dbtForge.showLineage` | Open the interactive lineage graph for the open model |
| `dbtForge.selectProfile` | Switch the profile/target dbt Forge runs dbt with (also on the status bar) |

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `dbtForge.pythonPath` | `""` | Path to the Python executable inside your dbt project's venv. Empty falls back to `dbt` on PATH |
| `dbtForge.projectDir` | `""` | Path to the dbt project root. Auto-detected (including nested inside a larger workspace) if left empty |
| `dbtForge.manifestPath` | `target/manifest.json` | Path to manifest.json, relative to the project root |
| `dbtForge.catalogPath` | `target/catalog.json` | Path to catalog.json, relative to the project root |
| `dbtForge.compiledDir` | `target/compiled` | Path to the compiled models directory, relative to the project root |
| `dbtForge.profilesDir` | `""` | Directory holding `profiles.yml`, for the environment picker. Empty looks where dbt does: `DBT_PROFILES_DIR`, the project root, then `~/.dbt`. When set, it is also passed as `--profiles-dir` |

---

## Local Data & Privacy

dbt Forge does not collect any data and has no network calls of its own:

- Reads `manifest.json`, `catalog.json`, and compiled SQL directly from your project's `target/` folder
- Runs `dbt` through your own configured Python environment, in your own integrated terminal
- No telemetry, no backend, no external service — everything happens on your machine

---

## Roadmap

### ✅ Core (v1)
ref()/source() autocomplete, Go to Definition, column autocomplete (aliases + CTEs), Parents/Children/Tests panel, build/test shortcuts, compiled SQL preview, interactive lineage graph.

### ✅ v0.4
Find All References and Go to Definition for macros, in addition to models/sources.

### ✅ v0.5
Environment switching: pick a profile/target from the status bar, and every dbt command runs against it.

### ✅ v0.6
Generate Docs command, so the `catalog.json` column autocomplete depends on can be produced from the editor.

### ✅ v0.7
Hover documentation for models/sources/macros, and Problems-panel diagnostics for broken ref()/source() calls.

### ✅ v0.8
Single-file compile (`dbt compile --select path:<file>`) and `dbt parse` so a just-created model gets indexed without a full-project run, an actionable welcome view on the relatives panel, and immediate panel/CodeLens refresh on manifest reload.

### ✅ v0.9
Tags panel: build or test every resource carrying a tag, straight from the sidebar.

### 🔲 Next
- Configurable lineage depth / filtering for very large projects
- Multi-project workspace polish (multiple dbt projects in one workspace)

---

## Contributing

The project is under active development.

- Fork → branch → PR
- Open an issue to discuss a feature before coding
- Follow the existing naming conventions

---

## License

MIT © 2026 [Evolve](https://evolve-data.fr) — Yohann

---

*Built with ♥ by Evolve*
