# filoscope

Ask questions. Search sources. Retrieve the exact Filecoin context you need.

Tiny `npx` CLI for querying a daily prebuilt Filecoin ecosystem QMD index with semantic search, keyword search, and source retrieval. Built for humans and agents that need grounded Filecoin context without cloning every source repo.

## UX

```bash
npx filoscope pull
npx filoscope query "how does Filecoin storage power work"
npx filoscope search '"FIP-0081"' -c fips -n 10
npx filoscope get '#abc123:80:100'
npx filoscope status
npx filoscope pull --force
```

The tool should be simple and explicit: `pull` downloads or updates the index cache, QMD lazily downloads models when needed, commands open the cached SQLite index with the QMD SDK, run, and exit.

## Package

- npm package: `filoscope`
- binary: `filoscope`
- dependency: pinned `@tobilu/qmd`
- Node: `>=22`
- do not publish `.qmd/index.sqlite` to npm

```json
{
  "name": "filoscope",
  "type": "module",
  "bin": { "filoscope": "bin/filoscope.js" },
  "dependencies": { "@tobilu/qmd": "2.5.3" },
  "engines": { "node": ">=22" }
}
```

## Index source layout

This repo owns the build-time QMD config and source checkouts.

- QMD config: `.qmd/index.yml`
- local build DB: `.qmd/index.sqlite`
- source repos: git submodules under `collections/<name>`
- no `.qmd/external` source checkout layout

`qmd update` and `qmd embed --chunk-strategy auto` run from the repo root. QMD detects `.qmd/index.yml` and writes the local build DB to `.qmd/index.sqlite`.

## Remote index

Publish one compressed SQLite DB as a daily GitHub Release asset.

- release tag: `index-YYYY-MM-DD`
- asset name: `filoscope.sqlite.gz`
- stable download URL: `https://github.com/<org>/<repo>/releases/latest/download/filoscope.sqlite.gz`
- no manifest
- no checksum artifact in v1
- no SQLite DB in git or npm

Install the downloaded DB where QMD would put a named `filoscope` index. This is compatible with `qmd --index filoscope ...`.

```text
$XDG_CACHE_HOME/qmd/filoscope.sqlite
$XDG_CACHE_HOME/qmd/filoscope.release-tag.txt
```

Fallback when `XDG_CACHE_HOME` is unset:

```text
~/.cache/qmd/filoscope.sqlite
~/.cache/qmd/filoscope.release-tag.txt
```

QMD `2.5.3` and current `tobi/qmd` source resolve named indexes as `$XDG_CACHE_HOME/qmd/<name>.sqlite`, falling back to `~/.cache/qmd/<name>.sqlite`. The current source does not use `~/Library/Caches` on macOS unless the user sets `XDG_CACHE_HOME`.

For QMD CLI compatibility, also write a named QMD config generated from the DB's embedded `store_collections` metadata:

```text
$XDG_CONFIG_HOME/qmd/filoscope.yml
```

Fallback when `XDG_CONFIG_HOME` is unset:

```text
~/.config/qmd/filoscope.yml
```

QMD can open the SQLite file by path alone, but collection-filtered commands such as `qmd --index filoscope search ... -c fips` require the named config file because the QMD CLI syncs YAML config into `store_collections` before running commands.

## Cache behavior

On `pull`:

1. Resolve the latest release asset URL.
2. Download `filoscope.sqlite.gz` to a temp path.
3. Gunzip with Node `zlib`.
4. Run `PRAGMA integrity_check`.
5. Atomic rename into cache.
6. Write the named QMD config sidecar if `store_collections` metadata exists.
7. Write the release tag to `filoscope.release-tag.txt` if known.

On query/search/get commands:

1. Require a cached DB.
2. Open with QMD SDK DB-only mode.
3. Ensure the named QMD config sidecar exists when using the default QMD cache path.
4. Run the command.

If no cache exists, fail clearly: `Run filoscope pull first`.

## QMD integration

Use the SDK, not the QMD CLI:

```js
import { createStore } from '@tobilu/qmd'
const store = await createStore({ dbPath })
```

DB-only SDK mode preserves the remote DB's embedded `store_collections`. Do not wrap `qmd` CLI, because it can sync local YAML config into the DB and mutate metadata.

## Commands

### `query`

Hybrid search.

```bash
filoscope query <query> [-n 5] [-c collection] [--no-rerank] [--min-score n] [--format cli|json]
```

Support QMD structured query docs (`intent:`, `lex:`, `vec:`, `hyde:`). Implement a minimal parser and call `store.search({ query })` or `store.search({ queries, intent })`.

### `search`

BM25 keyword search.

```bash
filoscope search <query> [-n 10] [-c collection] [--format cli|json]
```

Call `store.searchLex(query, { limit, collection })`.

### `vsearch`

Vector-only search.

```bash
filoscope vsearch <query> [-n 10] [-c collection]
```

Call `store.searchVector(query, { limit, collection })`.

### `get`

Retrieve source text with line numbers by default.

```bash
filoscope get <qmd-path-or-docid[:from[:count]]>
```

Examples:

```bash
filoscope get '#abc123'
filoscope get '#abc123:80:100'
filoscope get qmd://lotus/chain/types/blockheader.go:1:80
```

### `multi-get`

```bash
filoscope multi-get '#abc123,#def456' --format md
filoscope multi-get 'fips/FIPS/*.md' -l 80
```

### `status`

Show release tag when known, DB path/size, document/vector counts, and collections.

### `pull`

Download/prewarm the index cache. `--force` redownloads even when a cached DB exists.

## Flags

- `--no-gpu`: set `QMD_FORCE_CPU=1`
- `--cache-dir <path>`: override the QMD cache directory that contains `filoscope.sqlite`; this skips writing QMD config and opts out of automatic `qmd --index filoscope` discovery unless the same DB path is also passed to QMD via `INDEX_PATH`
- `--format cli|json|md`: output format where relevant

## Keeping up with QMD

Keep compatibility simple.

- The package pins `@tobilu/qmd` exactly.
- The index DB is treated as compatible with the current package version.
- Runtime validates the DB by opening it through the QMD SDK and running explicit metadata checks where cheap.
- If compatibility breaks, publish a new npm version and daily index release built with that version.
- Older package versions may fail clearly and require users to upgrade.

Upgrade process:

1. Bump `@tobilu/qmd` in `package.json`.
2. Rebuild the index with the same QMD version.
3. Publish a new daily DB release.
4. Publish a new `filoscope` npm version.

This keeps package code, SQLite schema, vector format, embedding fingerprint, chunking behavior, and model defaults aligned without a custom manifest or migration path.

## Build/release index

Daily GitHub Actions job:

```bash
git submodule update --init --recursive
GIT_LFS_SKIP_SMUDGE=1 git submodule update --remote --recursive
qmd update
qmd embed --chunk-strategy auto
qmd cleanup
sqlite3 .qmd/index.sqlite 'PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'
mkdir -p dist
gzip -c .qmd/index.sqlite > dist/filoscope.sqlite.gz
```

Then create or replace the `index-YYYY-MM-DD` GitHub Release and upload `dist/filoscope.sqlite.gz` as `filoscope.sqlite.gz`.

Workflow requirements:

- run daily on `schedule`
- support manual `workflow_dispatch`
- use a fixed release asset name
- keep old releases for debugging and rollback
- make the latest release the default source for `pull`

## Non-goals v1

- No user-facing `update` command.
- No local source checkout required.
- No arbitrary remote indexes.
- No manifest.
- No checksum artifact.
- No QMD CLI wrapping.
- No SQLite DB in git or npm.
