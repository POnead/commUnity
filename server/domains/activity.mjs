import { randomUUID } from "node:crypto";
import { HttpError, sendJson } from "../platform/http.mjs";
import { requireRole, hasPermission } from "../platform/session.mjs";
import { jsonEqual } from "../platform/validate.mjs";
import { timestamp } from "../platform/time.mjs";
import { withTransaction } from "../platform/db.mjs";

// Activities are append-only server history. The server writes the log itself
// inside the same transaction as the operation it records; the browser's copy is
// never an authority. A row the client sends that the server did not create is
// ignored, not validated and not stored. Existing rows are immutable: altering
// one is refused.
function validateActivityUnchanged(oldItems, newItems) {
  const oldById = new Map(oldItems.map((item) => [item.id, item]));
  for (const item of newItems) {
    const old = oldById.get(item?.id);
    if (old && !jsonEqual(old, item)) throw new HttpError(403, "Activity history cannot be altered.");
  }
}

export async function syncActivities(db, oldItems, newItems) {
  validateActivityUnchanged(oldItems, newItems);
}

export async function insertActivity(
  db,
  user,
  action,
  detail,
  { result = "Success", resultReason = "", affectedId = "", clientIp = "" } = {},
) {
  await db.query(
    "INSERT INTO activities (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip) VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9)",
    [randomUUID(), user.name, user.role, action, detail.slice(0, 1000), result, resultReason.slice(0, 500), affectedId, clientIp || ""],
  );
}

// The activities table accepts resident, official, administrator, and system. "system" is
// used for a security event with no authenticated actor, such as a rejected cross-site request.
export async function logSecurityEvent(
  db,
  actor,
  role,
  action,
  detail,
  result,
  { resultReason = "", affectedId = "", clientIp = "" } = {},
) {
  await insertActivity(db, { name: actor || "system", role: role || "system" }, action, detail, {
    result,
    resultReason,
    affectedId,
    clientIp,
  });
}

// The browsable log is the live table plus everything moved to the archive, so an
// administrator can search every retained record instead of the newest page of each.
const ACTIVITY_LOG_SOURCE = `
  SELECT id, actor, role, action, detail, at, result, result_reason AS "resultReason",
    affected_id AS "affectedId", client_ip AS "clientIp", NULL::timestamptz AS "archivedAt", 'current' AS source
  FROM activities
  UNION ALL
  SELECT id, actor, role, action, detail, at, result, result_reason AS "resultReason",
    affected_id AS "affectedId", client_ip AS "clientIp", archived_at AS "archivedAt", 'archived' AS source
  FROM activity_archive
`;

const ACTIVITY_EXPORT_LIMIT = 10000;

function activityLogFilters(url) {
  const text = (name, limit = 120) => (url.searchParams.get(name) || "").trim().slice(0, limit);
  const date = (name) => {
    const value = text(name, 10);
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Enter a valid date filter.");
    return value;
  };
  const source = url.searchParams.get("source");
  return {
    page: Math.min(Math.max(Number(url.searchParams.get("page")) || 1, 1), 100000),
    pageSize: Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 25, 1), 100),
    from: date("from"),
    to: date("to"),
    actor: text("actor"),
    action: text("action"),
    result: text("result", 80),
    affectedId: text("affectedId"),
    source: ["current", "archived", "all"].includes(source) ? source : "all",
  };
}

function activityLogWhere(filters) {
  const clauses = [];
  const values = [];
  const add = (value, clause) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (filters.from) add(filters.from, "at >= ?::date");
  if (filters.to) add(filters.to, "at < (?::date + interval '1 day')");
  if (filters.actor) add(filters.actor, "position(lower(?) in lower(actor)) > 0");
  if (filters.action) add(filters.action, "position(lower(?) in lower(action)) > 0");
  if (filters.result) add(filters.result, "result = ?");
  if (filters.affectedId) add(filters.affectedId, 'position(lower(?) in lower("affectedId")) > 0');
  if (filters.source !== "all") add(filters.source, "source = ?");
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

export async function archiveOldActivities(db) {
  // One transaction: a half-finished archive must never leave a row in both
  // tables, and ON CONFLICT makes a retry after a crash safe.
  await withTransaction(db, async (transaction) => {
    const moved = await transaction.query(`
      INSERT INTO activity_archive (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, archived_at)
      SELECT id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, now()
      FROM activities WHERE at < now() - interval '90 days'
      ON CONFLICT (id) DO NOTHING
    `);
    await transaction.query("DELETE FROM activities WHERE at < now() - interval '90 days'");
    // Archived records leave the live log administrators browse, so the shared
    // revision advances with the archive.
    if (moved.rowCount) await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  });
}

export async function handleActivity(request, response, db, options, user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/community/activity" && request.method === "GET") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "viewAudit")))
      throw new HttpError(403, "Reviewing activity history is not enabled for this role.");
    const filters = activityLogFilters(url);
    const { where, values } = activityLogWhere(filters);
    const summary = await db.query(
      `
      SELECT
        (count(*))::integer AS total,
        (count(*) FILTER (WHERE source='current'))::integer AS current,
        (count(*) FILTER (WHERE source='archived'))::integer AS archived,
        (count(*) FILTER (WHERE result='Failed'))::integer AS failed,
        (count(*) FILTER (WHERE action ~* '(account|role|profile)'))::integer AS accounts,
        (count(*) FILTER (WHERE (action || ' ' || detail) ~* '(report|concern)'))::integer AS reports,
        (count(*) FILTER (WHERE (action || ' ' || detail) ~* '(collection|schedule)'))::integer AS services
      FROM (${ACTIVITY_LOG_SOURCE}) AS log ${where}
    `,
      values,
    );
    const offset = (filters.page - 1) * filters.pageSize;
    const rows = await db.query(
      `SELECT * FROM (${ACTIVITY_LOG_SOURCE}) AS log ${where} ORDER BY at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.pageSize, offset],
    );
    const counts = summary.rows[0];
    const total = Number(counts.total);
    sendJson(response, 200, {
      activities: rows.rows.map((item) => ({ ...item, at: timestamp(item.at), archivedAt: timestamp(item.archivedAt) })),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
      summary: {
        total,
        current: Number(counts.current),
        archived: Number(counts.archived),
        failed: Number(counts.failed),
        accounts: Number(counts.accounts),
        reports: Number(counts.reports),
        services: Number(counts.services),
      },
    });
    return true;
  }
  if (url.pathname === "/api/community/activity/export" && request.method === "GET") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "viewAudit")))
      throw new HttpError(403, "Reviewing activity history is not enabled for this role.");
    const filters = activityLogFilters(url);
    const { where, values } = activityLogWhere(filters);
    const rows = await db.query(
      `SELECT *, count(*) OVER () AS total_count FROM (${ACTIVITY_LOG_SOURCE}) AS log ${where} ORDER BY at DESC, id DESC LIMIT $${values.length + 1}`,
      [...values, ACTIVITY_EXPORT_LIMIT],
    );
    const total = rows.rows.length ? Number(rows.rows[0].total_count) : 0;
    sendJson(response, 200, {
      activities: rows.rows.map(({ total_count, ...item }) => ({
        ...item,
        at: timestamp(item.at),
        archivedAt: timestamp(item.archivedAt),
      })),
      total,
      truncated: total > rows.rows.length,
    });
    return true;
  }
  return false;
}
