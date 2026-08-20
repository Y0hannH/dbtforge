# dbt Forge — working notes

A VS Code extension for dbt projects. Reads `manifest.json` / `catalog.json` / compiled SQL
produced by the user's own dbt, and runs dbt through the project's own venv. Nothing leaves the
machine — no backend, no telemetry, no CDN.

## Commands

```bash
npm run compile     # esbuild: dist/extension.js + dist/webview/lineage.js
npm test            # unit suite (parsers + indexing, no VS Code host needed)
npm run lint
npx vsce package    # installable .vsix
```

`F5` in VS Code launches an Extension Development Host with the extension loaded.

## Scope test

Before adding a feature, apply the README's Non-goals test: **does it need to know the user's dbt
project?** If it behaves identically on any SQL file, it belongs in someone else's extension.
Declining a request on this basis is expected, not a failure.

## Conventions

- Comments explain *why* a boundary is where it is, not what the code does. Match that density.
- Providers never guess: when something can't be resolved, return nothing rather than a plausible
  answer. This is a product decision, stated in the README, not an implementation gap.
- These notes are in English, like the rest of the repo (README, code comments, commit messages).
