# Filecoin Ecosystem Context Index

Use this repo to search Filecoin docs and code with QMD. Lets you search a curated set of public Filecoin resources!

## Setup

Clone this repo to a cache folder that stays on the machine. Use `XDG_CACHE_HOME` when it is set. On Linux, the usual path is `~/.cache/filecoin-ecosystem-context-index`. On macOS, the usual path is `~/Library/Caches/filecoin-ecosystem-context-index`.

Install QMD if needed.

```bash
npm install -g @tobilu/qmd
```

If an agent will use the index, have it read the QMD instructions and help first.

```bash
qmd skill show
qmd --help
```

Clone or pull this repo in that cache folder. Then run these commands from the repo root.

```bash
mkdir -p .qmd/external/filecoin-data-portal
qmd update
qmd embed --chunk-strategy auto
qmd status
```

During first setup, QMD clones public repos and downloads local models. To refresh later, pull this repo first. Then run `qmd update` and `qmd embed --chunk-strategy auto` again.

## Search

Run QMD from this repo root so it uses this index.

Use `qmd query` when you are searching for an idea.

```bash
qmd query $'intent: Find Filecoin protocol, data pipeline, or portal implementation details.\nlex: lotus lily FIP actor deal sector provider market payment PDP Synapse\nvec: how Filecoin data, storage deals, actors, clients, and portal datasets are implemented' -n 10
```

Use `qmd search` when you know an exact name.

```bash
qmd search '"daily_network_activity_by_method"' -c fdp -n 10
qmd search '"FIP-0081" FIP0081' -c fips -n 10
```

Add `-c` when you know which source to search.

```bash
qmd query -c fdp $'intent: Find how an FDP dataset is built.\nlex: raw model main materialize asset schema test\nvec: where the portal defines and validates this dataset'
```

Fetch the source text before making claims.

```bash
qmd get '#abc123:80:100'
qmd get qmd://fdp/assets/main/daily/network_metrics.sql:1:120
qmd multi-get '#abc123,#def456' --format md
```

Use QMD ranges like `:80:100`. Do not pipe `qmd get` through `sed`, `head`, or `tail`. Use `--full-path` when you need a file path.

## Use from another project

You can keep another project unchanged and run QMD through this repo.

```bash
(cd /path/to/filecoin-ecosystem-context-index && qmd query -c fdp 'how is network_metrics built')
```

You can also make another project use this index with plain `qmd`. Link that project's `.qmd` folder to this repo's `.qmd` folder. Back up any existing `.qmd` folder first if you need it.

```bash
cd /path/to/filecoin-data-portal
ln -sfn /path/to/filecoin-ecosystem-context-index/.qmd .qmd
qmd query -c fdp 'how is network_metrics built'
```

After you link it, you can refresh from either folder. Both commands use the same QMD index.

## Workflow

1. Run and read `qmd skill show` if you have not used QMD before.
2. Search with `qmd query` or `qmd search`.
3. Retrieve full sources with `qmd get` or `qmd multi-get`.
4. Answer from retrieved text and cite source documents, linking when possible.
