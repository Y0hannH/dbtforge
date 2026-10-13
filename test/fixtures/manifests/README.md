# Manifest shape fixtures

Read by `test/suite/manifestCompat.test.ts`, which runs every pure index and the lineage walk over
each file in this folder (plus `../manifest.sample.json`) and checks they neither throw nor draw an
edge to a node that isn't drawn.

## What these are — and are not

**Hand-written, not captured.** No fixture here was produced by running dbt, so none of them
vouches for what a given dbt release really writes. Each one carries the *traits* that differ
between manifests, taken from dbt's documentation of the schema:

| File | Trait it stands for |
|---|---|
| `legacy-no-optional-sections.json` | An older manifest: no `macros`, `docs` or `exposures` keys; tags only under `config.tags` |
| `recent-unit-tests-and-semantic-layer.json` | A recent one: `unit_tests`, `semantic_models`, `metrics`, `saved_queries`, `groups`, with their ids sitting in `child_map` next to the nodes dbt Forge does draw |
| `versioned-models.json` | Model versions: two nodes sharing a `name`, with `latest_version` pointing at the older one |

The file names describe the shape on purpose, not a dbt version number.

## Adding a real capture

A manifest captured from a real project is worth more than any of these. Anonymise it before it
goes in — project, package, model and column names, descriptions, `original_file_path`, `url`s,
and `raw_code`/`compiled_code` (drop them: nothing here reads them) — then name the file after
what it adds, not who it came from.

The one capture still missing is a manifest written by the **dbt Fusion engine**. Whether dbt Forge
reads it unchanged is unverified; run `dbt parse` with Fusion on a small project and drop the
anonymised `target/manifest.json` in here.

## Known gaps, tracked as `todo` tests

Two assertions in the test file are marked `todo`: they describe the behaviour the roadmap item
should deliver and don't fail the run until it does. Remove the `todo` option when the item ships.
