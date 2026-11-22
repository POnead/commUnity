import Busboy from "busboy";
import path from "node:path";
import { CONTENT_TYPES } from "./constants.mjs";
import { MAX_PHOTO_BYTES } from "./uploads.mjs";

// Errors that carry an HTTP status straight to the client. Everything thrown
// without a status is treated as a 500 by the outer error handler.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

export function sendJson(response, status, value) {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export function sendImage(response, filename, image) {
  response.writeHead(200, {
    "Cache-Control": "private, no-store",
    "Content-Type": CONTENT_TYPES[path.extname(filename)] || "application/octet-stream",
    "Content-Length": image.length,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(image);
}

export function requireJsonBody(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
}

// withFields keeps the parsed text fields as well; the default preserves the
// historical behaviour of resolving with just the files array.
export async function readMultipart(request, { maxFiles = 3, withFields = false, fileField = "photos" } = {}) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new HttpError(415, "Content-Type must be multipart/form-data.");
  }
  return new Promise((resolve, reject) => {
    const parser = Busboy({
      headers: request.headers,
      limits: { files: maxFiles, fileSize: MAX_PHOTO_BYTES, fields: 50, parts: maxFiles + 50, fieldSize: 16 * 1024 },
    });
    const files = [];
    const fields = {};
    let failed = false;
    parser.on("field", (name, value, info, nameTruncated, valueTruncated) => {
      // Busboy 1.x reports truncation in `info`; older versions pass booleans.
      const truncated =
        info && typeof info === "object"
          ? Boolean(info.valueTruncated || info.nameTruncated)
          : Boolean(info === true || nameTruncated === true || valueTruncated === true);
      if (truncated) {
        failed = true;
        reject(new HttpError(413, "A form field is too large."));
        return;
      }
      fields[name] = String(value);
    });
    parser.on("file", (fieldName, stream, info) => {
      if (fieldName !== fileField) {
        stream.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });
      stream.on("limit", () => {
        failed = true;
        reject(new HttpError(413, `${info.filename}: photo files must be 5 MB or smaller.`));
      });
      stream.on("end", () => {
        if (!failed) files.push({ name: info.filename, type: info.mimeType, data: Buffer.concat(chunks), size });
      });
    });
    parser.on("filesLimit", () => {
      failed = true;
      reject(new HttpError(400, `Attach up to ${maxFiles} photo${maxFiles === 1 ? "" : "s"}.`));
    });
    parser.on("fieldsLimit", () => {
      failed = true;
      reject(new HttpError(413, "The form has too many fields."));
    });
    parser.on("partsLimit", () => {
      failed = true;
      reject(new HttpError(413, "The form is too large."));
    });
    parser.on("error", reject);
    parser.on("finish", () => {
      if (failed) return;
      if (withFields) resolve({ files, fields });
      else resolve(files);
    });
    request.pipe(parser);
  });
}
