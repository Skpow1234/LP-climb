import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "0.0.0.0";
const API_BASE = (process.env.API_BASE ?? "http://localhost:3000").replace(/\/+$/, "");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

function send(res: any, status: number, headers: Record<string, string>, body: string | Buffer) {
  res.writeHead(status, headers);
  res.end(body);
}

function contentType(p: string) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) return send(res, 400, { "Content-Type": "text/plain" }, "bad request");
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    // Proxy to API to avoid CORS (demo runs on different port).
    // We target the versioned `/v1/*` routes; the unversioned legacy paths
    // (`/render.svg`, `/meta.json`) carry a `Sunset: 2026-12-31` header and
    // will disappear — pointing the demo at them would break the page on
    // sunset day.
    if (url.pathname === "/api/render.svg") {
      const upstream = new URL(`${API_BASE}/v1/render.svg`);
      url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
      const r = await fetch(upstream.toString());
      const body = await r.text();
      return send(
        res,
        r.status,
        {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "no-store"
        },
        body
      );
    }

    if (url.pathname === "/api/meta.json") {
      const upstream = new URL(`${API_BASE}/v1/meta.json`);
      url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
      const r = await fetch(upstream.toString());
      const body = await r.text();
      return send(
        res,
        r.status,
        {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        },
        body
      );
    }

    // Static files
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(publicDir, rel);
    if (!filePath.startsWith(publicDir)) {
      return send(res, 403, { "Content-Type": "text/plain" }, "forbidden");
    }

    if (!existsSync(filePath)) {
      return send(res, 404, { "Content-Type": "text/plain" }, "not found");
    }

    const st = statSync(filePath);
    if (st.isDirectory()) {
      return send(res, 404, { "Content-Type": "text/plain" }, "not found");
    }

    const buf = readFileSync(filePath);
    return send(res, 200, { "Content-Type": contentType(filePath) }, buf);
  } catch (e: any) {
    return send(res, 500, { "Content-Type": "text/plain" }, e?.message ?? "server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`demo: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`proxying API_BASE=${API_BASE}`);
});

