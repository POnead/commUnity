// Buildless shared constants for the HTTP layer. http-app.mjs (Express wiring)
// and the domain handlers both read from here so the 32 MB state ceiling and
// the served content types have exactly one definition.
export const MAX_STATE_BYTES = 32 * 1024 * 1024;

export const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
