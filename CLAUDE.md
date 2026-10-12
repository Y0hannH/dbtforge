# dbt Forge — working notes

A VS Code extension for dbt projects. Reads `manifest.json` / `catalog.json` / compiled SQL
produced by the user's own dbt, and runs dbt through the project's own venv. Nothing leaves the
machine — no backend, no telemetry, no CDN.

Part of the Pulse Suite. Build layout, tsconfig and ESLint config are shared across all four
extensions — see `HARMONISATION.md` in the parent folder before changing any of them.

## Commands

```bash
npm run compile     # esbuild: dist/extension.js + dist/webview/lineage.js
npm run watch       # esbuild in watch mode
npm run typecheck   # tsc --noEmit (tsc never emits here; esbuild does)
npm test            # unit suite (parsers + indexing, no VS Code host needed)
npm run lint
npm run vsix        # installable .vsix
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

## Issues

- Reference issues with `Refs #N`, never `Fixes #N` / `Closes #N`, in commits and PRs: those
  keywords close the issue at merge, before the reporter has tried the fix.
- When there is something to try, comment on the PR mentioning the issue and the reporter
  (`@user`), saying what changed and which build to try. For a change committed without a PR,
  comment on the issue itself. The issue stays open.
- The reporter tests the fix and closes the issue themselves, or comments if it doesn't work.
  We don't close an issue a reporter is still waiting on.
- We keep the right to close an issue ourselves (out of scope per the Non-goals, duplicate, no
  feedback), always with a comment saying why.
- A follow-up on the same topic goes on the existing issue; a distinct problem gets a new issue
  that links back.
