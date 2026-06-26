#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { createStore } from "@tobilu/qmd";

const INDEX_NAME = "filoscope";
const DB_FILE = `${INDEX_NAME}.sqlite`;
const TAG_FILE = `${INDEX_NAME}.release-tag.txt`;
const DEFAULT_MULTI_GET_MAX_BYTES = 64 * 1024;
const DEFAULT_INDEX_URL =
  "https://github.com/davidgasquez/filoscope/releases/latest/download/filoscope.sqlite.gz";

const USAGE = `filoscope

Usage:
  filoscope pull [--force] [--cache-dir <path>]
  filoscope status [--cache-dir <path>] [--format cli|json]
  filoscope query <query> [-n 5] [-c collection] [--no-rerank] [--min-score n] [--format cli|json|md]
  filoscope search <query> [-n 10] [-c collection] [--format cli|json|md]
  filoscope vsearch <query> [-n 10] [-c collection] [--format cli|json|md]
  filoscope get <qmd-path-or-docid[:from[:count]]> [--format cli|json|md]
  filoscope multi-get <pattern> [-l lines] [--max-bytes bytes] [--format cli|json|md]

Flags:
  --cache-dir <path>  Directory containing ${DB_FILE}
  --no-gpu           Set QMD_FORCE_CPU=1
  --format <format>  cli, json, or md
`;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  if (flags["no-gpu"]) process.env.QMD_FORCE_CPU = "1";

  if (!command || flags.help || command === "help" || flags.h) {
    console.log(USAGE.trimEnd());
    return;
  }

  switch (command) {
    case "pull":
      await pull(flags);
      return;
    case "status":
      await withStore(flags, async (store, paths) => {
        const status = await store.getStatus();
        const size = await stat(paths.dbPath);
        const releaseTag = await readOptional(paths.tagPath);
        const vectorCount = countRows(store, "content_vectors");
        outputStatus({ status, paths, size: size.size, releaseTag, vectorCount }, flags);
      });
      return;
    case "search":
      await searchLex(positionals, flags);
      return;
    case "vsearch":
      await searchVector(positionals, flags);
      return;
    case "query":
      await query(positionals, flags);
      return;
    case "get":
      await get(positionals, flags);
      return;
    case "multi-get":
      await multiGet(positionals, flags);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${USAGE.trimEnd()}`);
  }
}

async function pull(flags) {
  const paths = cachePaths(flags);
  const force = Boolean(flags.force);

  if (!force && await exists(paths.dbPath)) {
    console.log(`Already cached: ${paths.dbPath}`);
    return;
  }

  await mkdir(paths.cacheDir, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), "filoscope-"));
  const gzPath = join(tempDir, `${DB_FILE}.gz`);
  const sqlitePath = join(tempDir, DB_FILE);

  try {
    const url = String(process.env.FILOSCOPE_INDEX_URL || DEFAULT_INDEX_URL);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    await pipeline(response.body, createWriteStream(gzPath));
    await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(sqlitePath));
    await verifySqlite(sqlitePath);
    await rename(sqlitePath, paths.dbPath);
    await writeQmdConfig(paths.dbPath, flags);

    const tag = releaseTagFromUrl(response.url);
    if (tag) await writeFile(paths.tagPath, `${tag}\n`, "utf8");

    console.log(`Cached ${paths.dbPath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function searchLex(positionals, flags) {
  const queryText = requireOne(positionals, "Usage: filoscope search <query>");
  await withStore(flags, async (store) => {
    const results = await store.searchLex(queryText, {
      limit: numberFlag(flags.n, 10),
      collection: stringFlag(flags.c),
    });
    outputSearchResults(results, flags, { query: queryText });
  });
}

async function searchVector(positionals, flags) {
  const queryText = requireOne(positionals, "Usage: filoscope vsearch <query>");
  await withStore(flags, async (store) => {
    const results = await store.searchVector(queryText, {
      limit: numberFlag(flags.n, 10),
      collection: stringFlag(flags.c),
    });
    outputSearchResults(results, flags, { query: queryText });
  });
}

async function query(positionals, flags) {
  const queryText = requireOne(positionals, "Usage: filoscope query <query>");
  const parsed = parseStructuredQuery(queryText);

  await withStore(flags, async (store) => {
    const results = parsed.queries.length > 0
      ? await store.search({
        queries: parsed.queries,
        intent: parsed.intent,
        collection: stringFlag(flags.c),
        limit: numberFlag(flags.n, 5),
        minScore: optionalNumberFlag(flags["min-score"]),
        rerank: !flags["no-rerank"],
      })
      : await store.search({
        query: queryText,
        collection: stringFlag(flags.c),
        limit: numberFlag(flags.n, 5),
        minScore: optionalNumberFlag(flags["min-score"]),
        rerank: !flags["no-rerank"],
      });
    outputSearchResults(results, flags, { query: queryText });
  });
}

async function get(positionals, flags) {
  const target = requireOne(positionals, "Usage: filoscope get <qmd-path-or-docid[:from[:count]]>");
  const range = parseRangeSuffix(target);

  await withStore(flags, async (store) => {
    const doc = await store.get(range.target, { includeBody: false });
    if ("error" in doc) throw new Error(formatLookupError(doc));

    const body = await store.getDocumentBody(range.target, {
      fromLine: range.fromLine,
      maxLines: range.maxLines,
    });
    const fullDoc = { ...doc, body: body ?? "" };
    outputDocuments([{ doc: fullDoc, skipped: false }], flags, { single: true, startLine: range.fromLine ?? 1 });
  });
}

async function multiGet(positionals, flags) {
  const pattern = requireOne(positionals, "Usage: filoscope multi-get <pattern>");
  await withStore(flags, async (store) => {
    const { docs, errors } = await store.multiGet(pattern, {
      includeBody: true,
      maxBytes: numberFlag(flags["max-bytes"], DEFAULT_MULTI_GET_MAX_BYTES),
    });
    if (errors.length > 0) console.error(errors.join("\n"));
    outputDocuments(docs, flags, { maxLines: optionalNumberFlag(flags.l) });
  });
}

async function withStore(flags, callback) {
  const paths = cachePaths(flags);
  if (!await exists(paths.dbPath)) {
    throw new Error("Run filoscope pull first");
  }

  const store = await createStore({ dbPath: paths.dbPath });
  try {
    await ensureQmdConfig(store, flags);
    await callback(store, paths);
  } finally {
    await store.close();
  }
}

async function ensureQmdConfig(store, flags) {
  if (flags["cache-dir"]) return;
  const configPath = qmdConfigPath();
  if (await exists(configPath)) return;
  await writeQmdConfig(store.dbPath, flags);
}

async function writeQmdConfig(dbPath, flags) {
  if (flags["cache-dir"]) return;
  const store = await createStore({ dbPath });
  try {
    const rows = store.internal.db.prepare(`
      SELECT name, path, pattern, ignore_patterns, include_by_default, update_command, context
      FROM store_collections
      ORDER BY name
    `).all();
    if (rows.length === 0) return;

    const config = { collections: {} };
    for (const row of rows) {
      config.collections[row.name] = cleanObject({
        path: row.path,
        pattern: row.pattern,
        ignore: parseJsonField(row.ignore_patterns),
        includeByDefault: row.include_by_default === 0 ? false : undefined,
        update: row.update_command || undefined,
        context: parseJsonField(row.context),
      });
    }

    const configPath = qmdConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } finally {
    await store.close();
  }
}

async function verifySqlite(dbPath) {
  const store = await createStore({ dbPath });
  try {
    const row = store.internal.db.prepare("PRAGMA integrity_check").get();
    const result = row?.integrity_check;
    if (result !== "ok") throw new Error(`SQLite integrity_check failed: ${result}`);
  } finally {
    await store.close();
  }
}

function cachePaths(flags) {
  const cacheDir = flags["cache-dir"]
    ? resolve(String(flags["cache-dir"]))
    : resolve(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "qmd");

  return {
    cacheDir,
    dbPath: join(cacheDir, DB_FILE),
    tagPath: join(cacheDir, TAG_FILE),
  };
}

function qmdConfigPath() {
  const configDir = process.env.QMD_CONFIG_DIR
    ? resolve(process.env.QMD_CONFIG_DIR)
    : resolve(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "qmd");
  return join(configDir, `${INDEX_NAME}.yml`);
}

function parseArgs(args) {
  const flags = {};
  const positionals = [];
  let command;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!command && !arg.startsWith("-")) {
      command = arg;
      continue;
    }

    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = arg.slice(2).split("=", 2);
      if (["force", "no-gpu", "no-rerank", "help", "h"].includes(rawName)) {
        flags[rawName] = inlineValue ?? true;
      } else {
        const value = inlineValue ?? args[++index];
        if (value === undefined) throw new Error(`Missing value for --${rawName}`);
        flags[rawName] = value;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const name = arg.slice(1);
      if (["n", "c", "l"].includes(name)) {
        const value = args[++index];
        if (value === undefined) throw new Error(`Missing value for -${name}`);
        flags[name] = value;
      } else if (name === "h") {
        flags.h = true;
      } else {
        throw new Error(`Unknown flag: ${arg}`);
      }
      continue;
    }

    positionals.push(arg);
  }

  return { command, positionals, flags };
}

function parseStructuredQuery(input) {
  const queries = [];
  let intent;

  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^\s*(intent|lex|vec|hyde):\s*(.+?)\s*$/);
    if (!match) continue;
    const [, type, query] = match;
    if (type === "intent") {
      intent = query;
    } else {
      queries.push({ type, query });
    }
  }

  return { intent, queries };
}

function parseRangeSuffix(input) {
  const match = input.match(/^(.*):(\d+)(?::(\d+))$/) ?? input.match(/^(.*):(\d+)$/);
  if (!match || match[1].endsWith("qmd")) return { target: input };
  return {
    target: match[1],
    fromLine: Number(match[2]),
    maxLines: match[3] ? Number(match[3]) : undefined,
  };
}

function outputStatus({ status, paths, size, releaseTag, vectorCount }, flags) {
  if (format(flags) === "json") {
    console.log(JSON.stringify({
      releaseTag: releaseTag?.trim() || null,
      dbPath: paths.dbPath,
      size,
      totalDocuments: status.totalDocuments,
      vectorCount,
      needsEmbedding: status.needsEmbedding,
      hasVectorIndex: status.hasVectorIndex,
      collections: status.collections,
    }, null, 2));
    return;
  }

  console.log(`Release: ${releaseTag?.trim() || "unknown"}`);
  console.log(`DB: ${paths.dbPath}`);
  console.log(`Size: ${formatBytes(size)}`);
  console.log(`Documents: ${status.totalDocuments}`);
  console.log(`Vectors: ${vectorCount}`);
  console.log(`Needs embedding: ${status.needsEmbedding}`);
  console.log("Collections:");
  for (const collection of status.collections) {
    console.log(`  ${collection.name}: ${collection.documents}`);
  }
}

function outputSearchResults(results, flags, options = {}) {
  const selectedFormat = format(flags);

  if (selectedFormat === "json") {
    console.log(JSON.stringify(results.map(searchJson), null, 2));
    return;
  }

  if (selectedFormat === "md") {
    console.log(results.map((result) => searchMarkdown(result, options.query)).join("\n\n"));
    return;
  }

  for (const result of results) {
    console.log(`#${result.docid} ${score(result.score)} ${result.displayPath}`);
    if (result.title) console.log(`title: ${result.title}`);
    if (result.context) console.log(`context: ${result.context}`);
    const snippet = snippetFor(result.body || "", options.query || "", result.chunkPos);
    if (snippet) console.log(snippet);
    console.log("");
  }
}

function outputDocuments(results, flags, options = {}) {
  const selectedFormat = format(flags);
  const docs = results.map((result) => materializeDocument(result, options));

  if (selectedFormat === "json") {
    console.log(JSON.stringify(docs, null, 2));
    return;
  }

  if (selectedFormat === "md") {
    console.log(docs.map(documentMarkdown).join("\n\n"));
    return;
  }

  for (const doc of docs) {
    console.log(`${doc.file} #${doc.docid || ""}`.trim());
    if (doc.title) console.log(`title: ${doc.title}`);
    if (doc.context) console.log(`context: ${doc.context}`);
    if (doc.skipped) {
      console.log(`skipped: ${doc.reason}`);
    } else {
      console.log("");
      console.log(doc.body);
    }
  }
}

function materializeDocument(result, options) {
  if (result.skipped) {
    return {
      file: result.doc.displayPath,
      skipped: true,
      reason: result.skipReason,
    };
  }

  const rawBody = options.maxLines
    ? result.doc.body.split("\n").slice(0, options.maxLines).join("\n")
    : result.doc.body;

  return {
    docid: result.doc.docid,
    file: result.doc.displayPath,
    title: result.doc.title,
    context: result.doc.context,
    body: addLineNumbers(rawBody, options.startLine ?? 1),
  };
}

function searchJson(result) {
  return {
    docid: `#${result.docid}`,
    score: Math.round(result.score * 10000) / 10000,
    file: result.displayPath,
    title: result.title,
    ...(result.context ? { context: result.context } : {}),
  };
}

function searchMarkdown(result, query) {
  const parts = [
    `### ${result.title || result.displayPath}`,
    "",
    `- docid: \`#${result.docid}\``,
    `- score: \`${score(result.score)}\``,
    `- file: \`${result.displayPath}\``,
  ];
  if (result.context) parts.push(`- context: ${result.context}`);
  const snippet = snippetFor(result.body || "", query || "", result.chunkPos);
  if (snippet) parts.push("", "```text", snippet, "```");
  return parts.join("\n");
}

function documentMarkdown(doc) {
  if (doc.skipped) return `### ${doc.file}\n\nSkipped: ${doc.reason}`;
  const parts = [`### ${doc.title || doc.file}`, "", `- file: \`${doc.file}\``];
  if (doc.docid) parts.push(`- docid: \`#${doc.docid}\``);
  if (doc.context) parts.push(`- context: ${doc.context}`);
  parts.push("", "```text", doc.body, "```");
  return parts.join("\n");
}

function snippetFor(body, query, chunkPos) {
  if (!body) return "";
  const lines = body.split("\n");
  const offset = typeof chunkPos === "number" ? lineForOffset(body, chunkPos) : bestLine(lines, query);
  const start = Math.max(0, offset - 2);
  const selected = lines.slice(start, start + 6).join("\n");
  return addLineNumbers(selected, start + 1);
}

function bestLine(lines, query) {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const index = lines.findIndex((line) => terms.some((term) => line.toLowerCase().includes(term)));
  return Math.max(0, index);
}

function lineForOffset(body, offset) {
  return body.slice(0, Math.max(0, offset)).split("\n").length - 1;
}

function addLineNumbers(text, startLine = 1) {
  return text.split("\n").map((line, index) => `${startLine + index}: ${line}`).join("\n");
}

function formatLookupError(error) {
  if (error.error === "excluded_by_ignore") {
    return `${error.query} is excluded by ${error.rule}`;
  }
  const suggestions = error.similarFiles?.length ? `\nSimilar files:\n${error.similarFiles.join("\n")}` : "";
  return `Document not found: ${error.query}${suggestions}`;
}

function format(flags) {
  const value = flags.format ? String(flags.format) : "cli";
  if (!["cli", "json", "md"].includes(value)) throw new Error(`Unsupported format: ${value}`);
  return value;
}

function requireOne(positionals, usage) {
  if (positionals.length !== 1) throw new Error(usage);
  return positionals[0];
}

function numberFlag(value, fallback) {
  return optionalNumberFlag(value) ?? fallback;
}

function optionalNumberFlag(value) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid number: ${value}`);
  return number;
}

function stringFlag(value) {
  return value === undefined ? undefined : String(value);
}

function cleanObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function parseJsonField(value) {
  if (!value) return undefined;
  return JSON.parse(value);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function countRows(store, table) {
  try {
    return store.internal.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } catch {
    return 0;
  }
}

function releaseTagFromUrl(url) {
  const match = url.match(/\/releases\/download\/([^/]+)\//);
  return match?.[1];
}

function score(value) {
  return Number(value || 0).toFixed(4);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
