# filecoin-docs-qmd

Prebuilt `qmd` index with an assortment of Filecoin related resources.

## Install

Download the published SQLite DB into QMD's default cache path:

```bash
curl -fsSL https://raw.githubusercontent.com/davidgasquez/filecoin-docs-qmd/main/install.sh | bash
```

That installs the index as:

```bash
~/.cache/qmd/filecoin.sqlite
```

Then use plain `qmd`:

```bash
qmd --index filecoin search "storage provider"
qmd --index filecoin query "how does lotus handle deal onboarding"
qmd --index filecoin get "qmd://fdp/AGENTS.md"
qmd --index filecoin search "batch onboarding" --collection builtin-actors
```

`--index filecoin` selects the published DB. `--collection ...` filters within that DB.

## Maintainer workflow

Rebuild the artifact:

```bash
./scripts/build-index
```

That will:

1. clone or pull the configured source repos into `qmd/external/`
2. run `qmd update`
3. run `qmd embed --chunk-strategy auto`
4. checkpoint + vacuum the SQLite DB
5. refresh `qmd/index.sqlite.zst`
6. upload the `.zst` artifact to your chosen URL

## Notes

- The distributed DB is self-contained for search and retrieval.
- `qmd query` and `qmd vsearch` still need QMD's local models on user machines.
- `FILECOIN_DOCS_QMD_INDEX_URL` can override the default published URL if needed.
