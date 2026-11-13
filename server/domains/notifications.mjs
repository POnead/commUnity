import { randomUUID } from "node:crypto";
import { HttpError, requireJsonBody, sendJson } from "../platform/http.mjs";
import { requireRole } from "../platform/session.mjs";
import { jsonEqual, validId } from "../platform/validate.mjs";
import { ROLES } from "../platform/roles.mjs";

export async function insertNotification(db, userEmail, title, body, reportId = "") {
  await db.query(
    `
    INSERT INTO notifications (id, target_email, report_id, title, body, created_at, read)
    VALUES ($1,$2,$3,$4,$5,now(),false)
  `,
    [randomUUID(), userEmail, reportId || null, title.slice(0, 200), body.slice(0, 1000)],
  );
}

export function validateNotificationsReadOnly(oldItems, newItems, user) {
  // The server writes notifications outside any browser save — collection
  // reminders, password-reset notices — and the maintenance job prunes rows
  // older than 90 days. None of that is part of the browser's intent, so the
  // browser's list may be shorter (rows the server created) or longer (rows the
  // server pruned) than the server's. Match by id instead of by length and only
  // refuse items the browser may not touch.
  const oldById = new Map(oldItems.map((item) => [item.id, item]));
  for (const item of newItems) {
    if (!item || !validId(item.id) || item.targetEmail !== user.email) {
      throw new HttpError(403, "You can only mark your own notifications as read.");
    }
    const old = oldById.get(item.id);
    if (!old) continue; // created or pruned by the server after the browser's read
    if (old.targetEmail !== user.email || !jsonEqual({ ...old, read: false }, { ...item, read: false }) || (old.read && !item.read)) {
      throw new HttpError(403, "You can only mark your own notifications as read.");
    }
  }
}

export async function syncNotifications(db, oldItems, newItems, user) {
  validateNotificationsReadOnly(oldItems, newItems, user);
  const changed = newItems.filter((item) => oldItems.find((old) => old.id === item.id)?.read !== item.read);
  for (const item of changed) await db.query("UPDATE notifications SET read=true WHERE id=$1 AND target_email=$2", [item.id, user.email]);
}

// Notifications older than 90 days leave the shared state, so the shared
// revision advances with the prune and open browsers resync on their next save.
export async function pruneOldNotifications(db) {
  const removed = await db.query("DELETE FROM notifications WHERE created_at < now() - interval '90 days'");
  if (removed.rowCount) await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  return removed.rowCount;
}

export async function handleNotifications(request, response, db, options, user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/community/unread-count" && request.method === "GET") {
    requireRole(user, ROLES);
    const result = await db.query("SELECT count(*)::integer AS count FROM notifications WHERE target_email=$1 AND read=false", [
      user.email,
    ]);
    sendJson(response, 200, { count: Number(result.rows[0].count) });
    return true;
  }
  if (url.pathname === "/api/community/mark-notifications-read" && request.method === "POST") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    const ids = Array.isArray(request.body.ids) ? request.body.ids.filter((id) => typeof id === "string" && id.length > 0) : [];
    if (ids.length) {
      await db.query("UPDATE notifications SET read=true WHERE target_email=$1 AND id=ANY($2::text[])", [user.email, ids]);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    }
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}
