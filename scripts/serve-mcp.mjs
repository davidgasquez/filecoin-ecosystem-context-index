import http from "node:http";
import { spawn } from "node:child_process";

process.env.INDEX_PATH ??= `${process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`}/qmd/filecoin.sqlite`;

const qmd = spawn("qmd", ["mcp", "--http", "--port", "8181"], {
  stdio: "inherit",
  env: process.env,
});

const shutdown = () => qmd.kill("SIGTERM");
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
qmd.on("exit", (code) => process.exit(code ?? 1));

async function waitForQmd() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://localhost:8181/health");
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("qmd MCP server did not become healthy");
}

await waitForQmd();

http
  .createServer((req, res) => {
    const upstream = http.request(
      {
        hostname: "localhost",
        port: 8181,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Bad Gateway: ${error.message}\n`);
    });

    req.pipe(upstream);
  })
  .listen(7860, "0.0.0.0", () => {
    console.error("QMD MCP proxy listening on http://0.0.0.0:7860/mcp");
  });
