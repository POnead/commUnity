import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError, readMultipart, requireJsonBody, sendImage } from "../platform/http.mjs";
import { photoExtension } from "../platform/uploads.mjs";
import { requireRole } from "../platform/session.mjs";
import { withTransaction } from "../platform/db.mjs";
import { insertNotification } from "./notifications.mjs";
import { insertActivity } from "./activity.mjs";
import { sendStateResponse } from "./state.mjs";
import { HOTLINE_CATEGORIES, HOTLINE_CORRECTION_FIELDS, HOTLINE_STATUSES } from "../../shared/hotlines.mjs";

// Emergency hotlines are administrator-owned reference data. Officials can only
// propose a correction or a new contact; approving one is an administrator
// decision, and a suggestion lands as a draft the administrator must publish.

const PHONE_PATTERN = /^[0-9+()\-\s.]{5,40}$/;
const MAX_SUPPORTING_BYTES = 2 * 1024 * 1024;

// File signature decides the stored type; the browser-declared MIME is easy to spoof.
function supportingExtension(file) {
  const image = photoExtension(file?.data);
  if (image) return image;
  if (Buffer.isBuffer(file?.data) && file.data.subarray(0, 5).toString("latin1") === "%PDF-") return ".pdf";
  return "";
}

const CORRECTION_COLUMNS = {
  name: "name",
  category: "category",
  contactNumber: "contact_number",
  alternativeContactNumber: "alternative_contact_number",
  officeAddress: "office_address",
  description: "description",
  operatingHours: "operating_hours",
};

function text(value, label, max, { required = false } = {}) {
  const clean = typeof value === "string" ? value.trim() : "";
  if (required && !clean) throw new HttpError(400, `${label} is required.`);
  if (clean.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return clean;
}

function phone(value, label, { required = false } = {}) {
  const clean = text(value, label, 40, { required });
  if (clean && !PHONE_PATTERN.test(clean)) {
    throw new HttpError(400, `${label} must contain only digits, spaces, +, -, or parentheses.`);
  }
  return clean;
}

function category(value, { required = true } = {}) {
  const clean = text(value, "Category", 40, { required });
  if (clean && !HOTLINE_CATEGORIES.includes(clean)) throw new HttpError(400, "Choose a valid hotline category.");
  return clean;
}

function validateHotline(body) {
  const status = text(body.status, "Status", 20) || "Active";
  if (!HOTLINE_STATUSES.includes(status)) throw new HttpError(400, "Choose Active or Inactive for the hotline status.");
  if (typeof body.published !== "boolean") throw new HttpError(400, "Choose whether to save this hotline as a draft or publish it.");
  return {
    name: text(body.name, "Hotline name", 120, { required: true }),
    category: category(body.category),
    contactNumber: phone(body.contactNumber, "Contact number", { required: true }),
    alternativeContactNumber: phone(body.alternativeContactNumber, "Alternative contact number"),
    officeAddress: text(body.officeAddress, "Office address", 200),
    description: text(body.description, "Description", 300),
    operatingHours: text(body.operatingHours, "Operating hours", 120),
    status,
    published: body.published,
  };
}

// A correction carries only the fields the official is changing. Anything else
// in the request is ignored, so a hand-built body cannot rewrite a hotline.
function proposedFields(proposed, { suggestion = false } = {}) {
  if (!proposed || typeof proposed !== "object" || Array.isArray(proposed)) {
    throw new HttpError(400, "Enter the corrected hotline details.");
  }
  const entries = [];
  for (const field of HOTLINE_CORRECTION_FIELDS) {
    if (proposed[field] === undefined) continue;
    const label = field === "contactNumber" || field === "alternativeContactNumber" ? "Contact number" : field;
    // Both suggestions and corrections must keep every published core field
    // non-empty. Optional fields may still be cleared by a correction.
    const required = ["name", "category", "contactNumber"].includes(field);
    const value =
      field === "category"
        ? category(proposed[field], { required })
        : field === "contactNumber" || field === "alternativeContactNumber"
          ? phone(proposed[field], label, { required })
          : text(proposed[field], label, field === "name" ? 120 : field === "officeAddress" ? 200 : field === "description" ? 300 : 120, {
              required,
            });
    entries.push([field, value]);
  }
  if (!entries.length) throw new HttpError(400, "Enter the detail that should be corrected.");
  if (suggestion) {
    const missing = ["name", "category", "contactNumber"].filter((field) => !entries.some(([key]) => key === field));
    if (missing.length) throw new HttpError(400, "A suggested contact needs a name, category, and contact number.");
  }
  return Object.fromEntries(entries);
}

async function notifyRole(db, role, title, body) {
  const accounts = await db.query("SELECT email FROM users WHERE role=$1 AND status='Active'", [role]);
  for (const account of accounts.rows) await insertNotification(db, account.email, title, body);
}

export async function handleHotlines(request, response, db, options, user) {
  const { uploadsDir } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);

  const supportingMatch = url.pathname.match(/^\/api\/hotline-corrections\/([^/]+)\/supporting$/);
  if (supportingMatch && request.method === "GET") {
    requireRole(user, ["official", "administrator"]);
    const id = decodeURIComponent(supportingMatch[1]);
    if (!/^\d+$/.test(id)) throw new HttpError(404, "The supporting file could not be found.");
    const found = await db.query('SELECT submitted_by AS "submittedById", proposed FROM hotline_corrections WHERE id=$1', [id]);
    const item = found.rows[0];
    if (!item) throw new HttpError(404, "The supporting file could not be found.");
    if (user.role === "official" && item.submittedById !== user.id) throw new HttpError(403, "You cannot access this file.");
    const proposed = typeof item.proposed === "string" ? JSON.parse(item.proposed) : item.proposed || {};
    const meta = proposed.supportingFile;
    if (!meta?.filename || !/^[A-Za-z0-9-]+\.(jpg|png|pdf)$/.test(meta.filename)) throw new HttpError(404, "The supporting file could not be found.");
    // Rows created before directories were introduced stored the file under the numeric correction id with no directory key.
    const directoryName = String(meta.directory || id);
    if (!/^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(directoryName))
      throw new HttpError(404, "The supporting file could not be found.");
    const root = path.resolve(uploadsDir, "hotline-corrections");
    const directory = path.resolve(root, directoryName);
    if (path.dirname(directory) !== root) throw new HttpError(404, "The supporting file could not be found.");
    const filename = path.basename(meta.filename);
    const file = path.resolve(directory, filename);
    if (path.dirname(file) !== directory) throw new HttpError(404, "The supporting file could not be found.");
    const data = await readFile(file).catch(() => {
      throw new HttpError(404, "The supporting file could not be found.");
    });
    if (path.extname(filename) === ".pdf") {
      response.writeHead(200, {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/pdf",
        "Content-Length": data.length,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(data);
    } else {
      sendImage(response, filename, data);
    }
    return true;
  }

  if (url.pathname === "/api/hotlines/corrections/review" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const id = Number(request.body.id);
    const decision = String(request.body.decision || "");
    const note = String(request.body.note || "").trim().slice(0, 500);
    if (!Number.isInteger(id) || id < 1 || !["approved", "rejected"].includes(decision)) {
      throw new HttpError(400, "Choose a valid correction decision.");
    }
    await withTransaction(db, async (transaction) => {
      const tx = transaction;
      const found = await tx.query(
        `SELECT id, hotline_id AS "hotlineId", kind, proposed, reason, status, submitted_by AS "submittedById"
         FROM hotline_corrections WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!found.rows.length) throw new HttpError(404, "This correction request could not be found.");
      const item = found.rows[0];
      if (item.status !== "pending") throw new HttpError(409, "This correction request has already been decided.");

      if (decision === "approved") {
        const proposed = item.proposed || {};
        if (item.kind === "correction" && !item.hotlineId) {
          throw new HttpError(409, "The hotline this correction targeted no longer exists.");
        }
        if (item.kind === "correction") {
          const entries = Object.entries(proposed).filter(([field]) => Object.hasOwn(CORRECTION_COLUMNS, field));
          if (entries.length) {
            const assignments = entries.map(([field], index) => `${CORRECTION_COLUMNS[field]}=$${index + 1}`);
            if (proposed.contactNumber !== undefined || proposed.alternativeContactNumber !== undefined) {
              assignments.push("verified_at=NULL");
            }
            assignments.push("updated_at=now()");
            await tx.query(`UPDATE emergency_hotlines SET ${assignments.join(", ")} WHERE id=$${entries.length + 1}`, [
              ...entries.map(([, value]) => value),
              item.hotlineId,
            ]);
          }
        } else if (item.kind === "suggestion") {
          const record = validateHotline({ ...proposed, status: "Active", published: true });
          const created = await tx.query(
            `INSERT INTO emergency_hotlines
              (name,category,contact_number,alternative_contact_number,office_address,description,operating_hours,status,published)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
            [
              record.name,
              record.category,
              record.contactNumber,
              record.alternativeContactNumber,
              record.officeAddress,
              record.description,
              record.operatingHours,
              record.status,
            ],
          );
          await tx.query("UPDATE hotline_corrections SET hotline_id=$1 WHERE id=$2", [created.rows[0].id, id]);
        }
      }

      await tx.query(
        "UPDATE hotline_corrections SET status=$1, reviewed_by=$2, reviewed_at=now(), review_note=$3 WHERE id=$4",
        [decision, user.id, note, id],
      );
      await insertActivity(
        tx,
        user,
        `${decision === "approved" ? "Approved" : "Rejected"} a hotline ${item.kind === "suggestion" ? "suggestion" : "correction"}`,
        `${item.kind === "suggestion" ? "New contact" : `Hotline ${item.hotlineId}`}${note ? ` · ${note}` : ""}`,
      );
      const submitter = await tx.query("SELECT email FROM users WHERE id=$1", [item.submittedById]);
      if (submitter.rows.length) {
        await insertNotification(
          tx,
          submitter.rows[0].email,
          decision === "approved"
            ? item.kind === "suggestion"
              ? "Hotline suggestion approved"
              : "Hotline correction approved"
            : item.kind === "suggestion"
              ? "Hotline suggestion rejected"
              : "Hotline correction rejected",
          decision === "approved"
            ? item.kind === "suggestion"
              ? "Your suggested hotline was approved and is now published in the directory."
              : "Your hotline correction was approved and applied to the directory."
            : `Your hotline ${item.kind === "suggestion" ? "suggestion" : "correction"} was rejected.${note ? ` Reason: ${note}` : ""}`,
        );
      }
      await tx.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    await sendStateResponse(response, db, user);
    return true;
  }

  if (url.pathname === "/api/hotlines/corrections" && request.method === "POST") {
    requireRole(user, ["official"]);
    const isMultipart = (request.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data;");
    let body;
    let supportingFile = null;
    if (isMultipart) {
      const { fields, files } = await readMultipart(request, { maxFiles: 1, withFields: true, fileField: "supportingFile" });
      body = { ...fields };
      try {
        body.proposed = JSON.parse(String(fields.proposed || "{}"));
      } catch {
        throw new HttpError(400, "The suggestion details are invalid.");
      }
      supportingFile = files[0] || null;
    } else {
      requireJsonBody(request);
      body = request.body;
    }
    const kind = String(body.kind || "");
    if (!["correction", "suggestion"].includes(kind)) throw new HttpError(400, "Choose a correction or a new contact suggestion.");
    const reason = text(body.reason, "Reason", 500);
    const proposed = proposedFields(body.proposed, { suggestion: kind === "suggestion" });
    const hotlineId = kind === "correction" ? Number(body.hotlineId) : null;
    if (kind === "correction" && (!Number.isInteger(hotlineId) || hotlineId < 1)) {
      throw new HttpError(400, "Choose the hotline this correction applies to.");
    }
    const extension = supportingFile ? supportingExtension(supportingFile) : "";
    if (supportingFile && (!extension || supportingFile.size > MAX_SUPPORTING_BYTES))
      throw new HttpError(400, "Supporting information must be a JPG, PNG, or PDF file of 2 MB or less.");
    // PGlite serializes the whole transaction callback on one session, so the
    // disk write happens up front, under a pre-generated directory name.
    let supportingMeta = null;
    if (supportingFile) {
      const root = path.resolve(uploadsDir, "hotline-corrections");
      const directory = path.resolve(root, randomUUID());
      if (path.dirname(directory) !== root) throw new HttpError(400, "The supporting file could not be saved.");
      await mkdir(directory, { recursive: true });
      const filename = `${randomUUID()}${extension}`;
      await writeFile(path.join(directory, filename), supportingFile.data, { flag: "wx" });
      supportingMeta = {
        name: String(supportingFile.name || filename).slice(0, 120),
        filename,
        directory: path.basename(directory),
      };
    }
    await withTransaction(db, async (transaction) => {
      const tx = transaction;
      if (kind === "correction") {
        const hotline = await tx.query("SELECT id, name, published FROM emergency_hotlines WHERE id=$1", [hotlineId]);
        if (!hotline.rows.length || !hotline.rows[0].published) throw new HttpError(404, "This hotline is not in the published directory.");
      }
      const inserted = await tx.query(
        "INSERT INTO hotline_corrections (hotline_id,kind,submitted_by,proposed,reason) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id",
        [hotlineId, kind, user.id, JSON.stringify(proposed), reason],
      );
      const correctionId = String(inserted.rows[0].id);
      if (supportingMeta) {
        proposed.supportingFile = {
          name: supportingMeta.name,
          filename: supportingMeta.filename,
          directory: supportingMeta.directory,
          url: `/api/hotline-corrections/${encodeURIComponent(correctionId)}/supporting`,
        };
        await tx.query("UPDATE hotline_corrections SET proposed=$2::jsonb WHERE id=$1", [correctionId, JSON.stringify(proposed)]);
      }
      await insertActivity(
        tx,
        user,
        kind === "suggestion" ? "Suggested an emergency hotline" : "Requested a hotline correction",
        proposed.name || `Hotline ${hotlineId}`,
      );
      await notifyRole(
        tx,
        "administrator",
        kind === "suggestion" ? "Hotline contact suggested" : "Hotline correction requested",
        `${user.name}: ${reason || proposed.name || "New contact suggestion"}`,
      );
      await tx.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    await sendStateResponse(response, db, user);
    return true;
  }

  if (url.pathname === "/api/hotlines/verify" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const id = Number(request.body.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Choose a valid hotline.");
    await withTransaction(db, async (transaction) => {
      const tx = transaction;
      const updated = await tx.query(
        "UPDATE emergency_hotlines SET verified_at=now(), updated_at=now() WHERE id=$1 RETURNING name",
        [id],
      );
      if (!updated.rowCount) throw new HttpError(404, "This hotline could not be found.");
      await insertActivity(tx, user, "Marked a hotline as verified", updated.rows[0].name);
      await tx.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    await sendStateResponse(response, db, user);
    return true;
  }

  if (url.pathname === "/api/hotlines" && ["POST", "PUT", "DELETE"].includes(request.method)) {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const body = request.body;
    await withTransaction(db, async (transaction) => {
      const tx = transaction;
      if (request.method === "DELETE") {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Choose a valid hotline.");
        const deleted = await tx.query("DELETE FROM emergency_hotlines WHERE id=$1 RETURNING name", [id]);
        if (!deleted.rowCount) throw new HttpError(404, "This hotline could not be found.");
        await insertActivity(tx, user, "Removed an emergency hotline", deleted.rows[0].name);
      } else {
        const record = validateHotline(body);
        if (request.method === "POST") {
          await tx.query(
            `INSERT INTO emergency_hotlines
              (name,category,contact_number,alternative_contact_number,office_address,description,operating_hours,status,published)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              record.name,
              record.category,
              record.contactNumber,
              record.alternativeContactNumber,
              record.officeAddress,
              record.description,
              record.operatingHours,
              record.status,
              record.published,
            ],
          );
          await insertActivity(
            tx,
            user,
            record.published ? "Published an emergency hotline" : "Saved an emergency hotline draft",
            record.name,
          );
        } else {
          const id = Number(body.id);
          if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Choose a valid hotline.");
          // A changed number is no longer the number somebody verified, so the
          // verification stamp is cleared rather than left behind as a false claim.
          const updated = await tx.query(
            `UPDATE emergency_hotlines SET name=$1,category=$2,contact_number=$3,alternative_contact_number=$4,
              office_address=$5,description=$6,operating_hours=$7,status=$8,published=$9,
              verified_at=CASE WHEN contact_number IS DISTINCT FROM $3 OR alternative_contact_number IS DISTINCT FROM $4
                THEN NULL ELSE verified_at END,
              updated_at=now()
             WHERE id=$10 RETURNING name`,
            [
              record.name,
              record.category,
              record.contactNumber,
              record.alternativeContactNumber,
              record.officeAddress,
              record.description,
              record.operatingHours,
              record.status,
              record.published,
              id,
            ],
          );
          if (!updated.rowCount) throw new HttpError(404, "This hotline could not be found.");
          await insertActivity(tx, user, "Updated an emergency hotline", record.name);
        }
      }
      await tx.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    await sendStateResponse(response, db, user);
    return true;
  }

  return false;
}
