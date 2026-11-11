import { readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createApiRouter } from "./api-router.mjs";

const PUBLIC_FILES = new Set([
  "index.html", "styles.css", "app-core.js", "app-views.js", "app.js",
  "logo/palsara-transparent.png",
  "favicon.png",
  "node_modules/leaflet/dist/leaflet.js", "node_modules/leaflet/dist/leaflet.css",
  "node_modules/leaflet/dist/images/layers.png", "node_modules/leaflet/dist/images/layers-2x.png",
  "node_modules/leaflet/dist/images/marker-icon.png", "node_modules/leaflet/dist/images/marker-icon-2x.png",
  "node_modules/leaflet/dist/images/marker-shadow.png",
]);

export const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function addSecurityHeaders(response, secure) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; font-src 'self'; frame-src 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=()");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  if (secure) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

export function createExpressApp({
  db,
  secure,
  projectDir,
  appOrigin,
  trustedProxyAddresses,
  uploadsDir,
  mailerState,
  smtpSettingsKey,
  handleApi,
  HttpError,
  logError,
  createRequestId,
}) {
  const app = express();
  app.disable("x-powered-by");
  const apiRouter = createApiRouter({
    handleApi,
    context: {
      db,
      appOrigin,
      secureCookies: secure,
      trustedProxyAddresses,
      uploadsDir,
      mailerState,
      smtpSettingsKey,
    },
  });
  app.use(async (request, response, next) => {
    addSecurityHeaders(response, secure);
    request.requestId = createRequestId();
    response.setHeader("X-Request-Id", request.requestId);
    try {
      if (request.url?.startsWith("/api/")) {
        next();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const pathname = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`).pathname;
      const filename = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
      if (!PUBLIC_FILES.has(filename)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(path.join(projectDir, filename));
      response.writeHead(200, {
        "Content-Length": body.length,
        "Content-Type": CONTENT_TYPES[path.extname(filename)],
        "Cache-Control": filename === "index.html" ? "no-cache" : "public, max-age=300",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      next(error);
    }
  });
  const STATUS_TEXT = {
    200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 413: "Too Large",
    429: "Too Many Requests", 500: "Server Error", 503: "Unavailable",
  };
  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const duration = durationMs < 1 ? "<1ms" : `${Math.round(durationMs)}ms`;
      const time = new Date().toTimeString().slice(0, 8);
      const method = request.method.padEnd(6, " ");
      const path = request.url?.split("?")[0] || "/";
      const status = response.statusCode;
      const label = STATUS_TEXT[status] || "Request";
      const mark = status >= 400 ? "✗" : "✓";
      console.log(`[${time}] ${mark} ${method} ${path} → ${status} ${label} (${duration})`);
    });
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.use((request, response, next) => {
    if (["POST", "PUT", "DELETE"].includes(request.method) && Array.isArray(request.body)) {
      next(new HttpError(400, "Request body must be valid JSON."));
      return;
    }
    next();
  });
  app.use(apiRouter);
  app.use((error, request, response, next) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error instanceof URIError) {
      sendJson(response, 400, { error: "Invalid URL encoding." });
      return;
    }
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    if (error.type === "entity.too.large") {
      sendJson(response, 413, { error: "Request body is too large." });
      return;
    }
    if (error.type === "entity.parse.failed") {
      sendJson(response, 400, { error: "Request body must be valid JSON." });
      return;
    }
    if (error.code === "23505") {
      sendJson(response, 409, { error: "A record with that identifier or email already exists." });
      return;
    }
    logError("CommUnity server request failed.", error, {
      requestId: request.requestId,
      method: request.method,
      path: request.url?.split("?")[0] || "/",
    });
    sendJson(response, 500, { error: "The server could not complete this request." });
  });
  return app;
}
