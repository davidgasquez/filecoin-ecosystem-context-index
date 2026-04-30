# filecoin-docs-qmd

Hosted QMD MCP server for Filecoin docs/code search.

## Use the MCP server

Endpoint:

```text
https://davidgasquez-filecoin-docs-qmd-mcp.hf.space/mcp
```

Claude Code:

```bash
claude mcp add --transport http filecoin-docs-qmd \
  https://davidgasquez-filecoin-docs-qmd-mcp.hf.space/mcp
```

Codex CLI:

```bash
codex mcp add filecoin-docs-qmd \
  --url https://davidgasquez-filecoin-docs-qmd-mcp.hf.space/mcp
```

Health check:

```bash
curl https://davidgasquez-filecoin-docs-qmd-mcp.hf.space/health
```

## Maintainer workflow

Build the local QMD index:

```bash
make build
```

Publish `qmd/index.sqlite` to the HuggingFace Dataset:

```bash
make publish
```

Deploy the Docker Space:

```bash
make deploy
```

Defaults:

```text
HF_DATASET_ID=davidgasquez/filecoin-docs-qmd
HF_DATASET_REVISION=main
HF_SPACE_ID=davidgasquez/filecoin-docs-qmd-mcp
```

Override them inline or in `.env`.

## Local Docker

```bash
make docker
make run
curl http://localhost:7860/health
```

Local MCP endpoint:

```text
http://localhost:7860/mcp
```

## Local QMD

```bash
QMD_CONFIG_DIR="$PWD/qmd" INDEX_PATH="$PWD/qmd/index.sqlite" qmd search "storage provider"
QMD_CONFIG_DIR="$PWD/qmd" INDEX_PATH="$PWD/qmd/index.sqlite" qmd query "how does lotus handle deal onboarding"
QMD_CONFIG_DIR="$PWD/qmd" INDEX_PATH="$PWD/qmd/index.sqlite" qmd get "qmd://fdp/AGENTS.md"
```
