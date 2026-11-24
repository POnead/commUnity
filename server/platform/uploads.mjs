import { readdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { validId } from "./validate.mjs";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_EXTENSIONS = [".jpg", ".png"];
export const ORPHAN_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

// The browser-declared MIME type is easy to spoof, so the file signature decides
// what is stored and what Content-Type is later served. Only complete JPEG and
// PNG files pass: the first bytes identify the format, the last bytes end it.
export function photoExtension(data) {
  if (!Buffer.isBuffer(data)) return "";
  // Some cameras append harmless padding after the real end marker. Accept the
  // marker anywhere in the last 64 bytes, not only as the final bytes.
  const hasTrailer = (marker) => data.length >= marker.length && data.lastIndexOf(marker) >= data.length - 64;
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && hasTrailer(Buffer.from([0xff, 0xd9]))) return ".jpg";
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    hasTrailer(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]))
  )
    return ".png";
  return "";
}

// Photos are files, not database rows. Remove files no row references any more:
// a photo dropped from a report, an older profile image after a concurrent save.
// Recent files are left alone so an in-flight upload is never swept mid-write.
export async function sweepOrphanUploads(db, uploadsDir) {
  let entries;
  try {
    entries = await readdir(uploadsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const referenced = new Set();
  for (const row of (await db.query("SELECT photo_url FROM report_photos")).rows) referenced.add(path.basename(row.photo_url));
  for (const row of (await db.query("SELECT photo_url FROM users WHERE photo_url <> ''")).rows) {
    const name = path.basename(row.photo_url);
    referenced.add(name);
    // Historic profile photos are named after the user id, without the url's filename.
    for (const ext of PHOTO_EXTENSIONS) referenced.add(`${name}${ext}`);
  }
  for (const row of (
    await db.query(
      "SELECT id_image_filename, id_back_image_filename FROM users WHERE id_image_filename <> '' OR id_back_image_filename <> ''",
    )
  ).rows) {
    referenced.add(row.id_image_filename);
    referenced.add(row.id_back_image_filename);
  }
  for (const row of (await db.query("SELECT proposed FROM hotline_corrections")).rows) {
    let proposed = row.proposed;
    if (typeof proposed === "string") {
      try {
        proposed = JSON.parse(proposed);
      } catch {
        proposed = {};
      }
    }
    const name = proposed?.supportingFile?.filename;
    if (typeof name === "string") referenced.add(path.basename(name));
  }
  let removed = 0;
  const sweepFile = async (filePath, file) => {
    if (referenced.has(file)) return;
    const info = await stat(filePath).catch(() => null);
    if (!info || Date.now() - info.mtimeMs <= ORPHAN_UPLOAD_AGE_MS) return;
    await unlink(filePath).catch(() => {});
    removed += 1;
  };
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      (entry.name !== "profiles" && entry.name !== "verification" && entry.name !== "hotline-corrections" && !validId(entry.name))
    )
      continue;
    if (entry.name !== "profiles" && entry.name !== "verification" && entry.name !== "hotline-corrections") {
      const report = await db.query("SELECT 1 FROM reports WHERE id=$1", [entry.name]);
      const photos = await db.query("SELECT 1 FROM report_photos WHERE report_id=$1 LIMIT 1", [entry.name]);
      // An old upload directory with no photo metadata still belongs to its report.
      if (report.rows.length && !photos.rows.length) continue;
    }
    const directory = path.join(uploadsDir, entry.name);
    // ID photos are stored one level deeper, under the account id they belong to.
    if (entry.name === "verification") {
      const userDirs = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const userDir of userDirs) {
        if (!userDir.isDirectory()) continue;
        const inner = path.join(directory, userDir.name);
        const innerFiles = await readdir(inner).catch(() => []);
        for (const file of innerFiles) await sweepFile(path.join(inner, file), file);
        if (!innerFiles.length) await rm(inner, { recursive: true, force: true }).catch(() => {});
      }
      continue;
    }
    // Supporting files live one level deeper, under the correction id they belong to.
    if (entry.name === "hotline-corrections") {
      const correctionDirs = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const correctionDir of correctionDirs) {
        if (!correctionDir.isDirectory()) continue;
        const inner = path.join(directory, correctionDir.name);
        const innerFiles = await readdir(inner).catch(() => []);
        for (const file of innerFiles) await sweepFile(path.join(inner, file), file);
        if (!innerFiles.length) await rm(inner, { recursive: true, force: true }).catch(() => {});
      }
      continue;
    }
    const files = await readdir(directory).catch(() => []);
    for (const file of files) {
      await sweepFile(path.join(directory, file), file);
    }
    // These roots keep their named subdirectories; only report roots vanish.
    if (entry.name !== "profiles" && !files.length) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
  return removed;
}
