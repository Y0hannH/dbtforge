# 🔨 dbt Forge

> A smoother dbt workflow, without leaving VS Code — and without your SQL ever leaving your machine.

![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85-007ACC?style=flat-square&logo=visualstudiocode)
![Version](https://img.shields.io/badge/Version-0.1.0-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-00B4D8?style=flat-square)
![Status](https://img.shields.io/badge/Status-In%20Development-orange?style=flat-square)

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
| 🧭 | **Go to Definition** | Ctrl+click a `ref()`/`source()` call to jump straight to the model's `.sql` file |
| 🔤 | **Column autocomplete** | Suggests column names after `alias.`, resolved from `catalog.json` (built models) and from same-file CTEs |
| 🌳 | **Parents / Children / Tests panel** | Sidebar view of the current model's direct dependencies and dependents, from the manifest's dependency graph |
| 🕸️ | **Interactive lineage graph** | Click-to-expand upstream/downstream graph (React Flow) — starts at the current model, no giant unreadable diagram dumped on you |
| 👁️ | **Compiled SQL preview** | Read-only, side-by-side preview of the compiled SQL dbt actually runs |
| 🚀 | **Build / Test shortcuts** | CodeLens and sidebar buttons for Build Upstream, Build Downstream, Test, and Build Project — run through your project's own venv |

---

## Getting Started

### Prerequisites

- VS Code 1.85+
- A dbt project (`dbt_project.yml`) with its own Python virtual environment (dbt-core + your adapter installed inside it)
- `manifest.json` generated at least once (`dbt compile` or `dbt build`) for autocomplete/lineage/panels to have data
- `catalog.json` generated (`dbt docs generate`) for column autocomplete on already-built models

### Installation

```bash
# From source (not yet published to the marketplace)
git clone https://github.com/Y0hannH/dbtforge
cd dbtforge
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host with dbt Forge loaded, and open your dbt project in that window.

### First Run

1. Open your dbt project folder (containing `dbt_project.yml`, or nested inside a larger workspace)
2. Set `dbtForge.pythonPath` to your project's venv Python (e.g. `C:/path/to/project/.venv/Scripts/python.exe`)
3. Run `dbt compile` (or `dbt build`) at least once so `manifest.json` exists
4. Open a model `.sql` file — autocomplete, CodeLens, and the Parents/Children/Tests panel activate automatically

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
| `dbtForge.refreshIndex` | Reload manifest.json / catalog.json |
| `dbtForge.buildUpstream` | `dbt build --select +model` for the open model |
| `dbtForge.buildDownstream` | `dbt build --select model+` for the open model |
| `dbtForge.testModel` | `dbt test --select model` for the open model |
| `dbtForge.buildProject` | `dbt build` for the whole project |
| `dbtForge.previewCompiledSql` | Open the compiled SQL for the open model, read-only |
| `dbtForge.showLineage` | Open the interactive lineage graph for the open model |

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `dbtForge.pythonPath` | `""` | Path to the Python executable inside your dbt project's venv. Empty falls back to `dbt` on PATH |
| `dbtForge.projectDir` | `""` | Path to the dbt project root. Auto-detected (including nested inside a larger workspace) if left empty |
| `dbtForge.manifestPath` | `target/manifest.json` | Path to manifest.json, relative to the project root |
| `dbtForge.catalogPath` | `target/catalog.json` | Path to catalog.json, relative to the project root |
| `dbtForge.compiledDir` | `target/compiled` | Path to the compiled models directory, relative to the project root |

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

### 🔲 Next
- Configurable lineage depth / filtering for very large projects
- Multi-project workspace polish (multiple dbt projects in one workspace)
- Marketplace publication

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
