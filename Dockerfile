FROM node:22-bookworm-slim

ARG FILECOIN_DOCS_QMD_DATASET=davidgasquez/filecoin-docs-qmd
ARG FILECOIN_DOCS_QMD_REVISION=main

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

USER node

ENV HOME=/home/node \
    XDG_CACHE_HOME=/home/node/.cache \
    QMD_CONFIG_DIR=/home/node/.config/qmd \
    PATH=/home/node/.npm-global/bin:$PATH

RUN npm config set prefix /home/node/.npm-global \
  && npm install -g @tobilu/qmd@2.1.0 \
  && mkdir -p /home/node/.cache/qmd /home/node/.config/qmd

RUN curl -fsSL \
  "https://huggingface.co/datasets/${FILECOIN_DOCS_QMD_DATASET}/resolve/${FILECOIN_DOCS_QMD_REVISION}/index.sqlite" \
  -o /home/node/.cache/qmd/filecoin.sqlite

COPY --chown=node:node qmd/index.yml /home/node/.config/qmd/index.yml
COPY --chown=node:node scripts/serve-mcp.mjs /home/node/app/scripts/serve-mcp.mjs

WORKDIR /home/node/app
EXPOSE 7860

CMD ["node", "./scripts/serve-mcp.mjs"]
