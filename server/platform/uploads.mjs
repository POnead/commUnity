import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { validId } from "./validate.mjs";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_EXTENSIONS = [".jpg", ".png"];
export const ORPHAN_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

// The browser-declared MIME type is easy to spoof, so the file signature decides
// what is stored and what Content-Type is later served. Only JPEG and PNG pass.
export function photoExtension(data) {
  if (!Buffer.isBuffer(data)) return "";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  return "";
}

// Photo uploads happen before the report is saved, so an abandoned draft leaves a
// directory behind. Remove only directories with no report row and no recent write.
export async function sweepOrphanUploads(db, uploadsDir) {
  let entries;
  try {
    entries = await readdir(uploadsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "profiles" || !validId(entry.name)) continue;
    const existing = await db.query("SELECT 1 FROM reports WHERE id=$1", [entry.name]);
    if (existing.rows.length) continue;
    const directory = path.join(uploadsDir, entry.name);
    const files = await readdir(directory).catch(() => []);
    let newest = 0;
    for (const file of files) {
      const info = await stat(path.join(directory, file)).catch(() => null);
      if (info) newest = Math.max(newest, info.mtimeMs);
    }
    if (files.length && Date.now() - newest <= ORPHAN_UPLOAD_AGE_MS) continue;
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    removed += 1;
  }
  return removed;
}
