import { HttpError, requireJsonBody, sendJson } from "../platform/http.mjs";
import { requireRole, hasPermission } from "../platform/session.mjs";
import { withTransaction } from "../platform/db.mjs";
import { appDateISO } from "../platform/time.mjs";
import { insertNotification } from "./notifications.mjs";
import { insertActivity } from "./activity.mjs";
import { queueEmail } from "../platform/email.mjs";
import { readFullState, stateForRole } from "./state.mjs";
import { publicUser } from "../platform/session.mjs";

// Announcements and calendar events are one feature area: officials propose,
// administrators approve, residents see what is approved. They share the same
// approval workflow and the same notification fan-out.

function validateAnnouncement(body) {
  const date = typeof body.date === "string" ? new Date(`${body.date}T00:00:00Z`) : new Date(Number.NaN);
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > 120 ||
    typeof body.detail !== "string" ||
    !body.detail.trim() ||
    body.detail.length > 1000 ||
    typeof body.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== body.date
  ) {
    throw new HttpError(400, "Enter a title, message, and valid announcement date.");
  }
  const isEvent = body.isEvent === true;
  if (!isEvent) return { isEvent: false, latitude: null, longitude: null };
  const { latitude, longitude } = body;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new HttpError(400, "Choose a map location for this event announcement, or turn off the event option.");
  }
  return { isEvent: true, latitude, longitude };
}

function validateCalendarEvent(body) {
  const date = typeof body.date === "string" ? new Date(`${body.date}T00:00:00Z`) : new Date(Number.NaN);
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > 120 ||
    typeof body.detail !== "string" ||
    body.detail.length > 1000 ||
    typeof body.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== body.date
  ) {
    throw new HttpError(400, "Enter a title, details, and a valid event date.");
  }
  if (body.date < appDateISO()) throw new HttpError(400, "Events cannot be scheduled before today.");
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (
    (body.latitude !== undefined && body.latitude !== null && body.latitude !== "") ||
    (body.longitude !== undefined && body.longitude !== null && body.longitude !== "")
  ) {
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new HttpError(400, "Enter valid event location coordinates.");
    }
  }
}

export async function handleAnnouncements(request, response, db, options, user) {
  const { mailerState, appOrigin } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/announcements/approval" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "manageAnnouncements")))
      throw new HttpError(403, "Announcement management is not enabled for this role.");
    requireJsonBody(request);
    const status = String(request.body.status || "");
    const reason = status === "declined" ? String(request.body.reason || "").trim() : "";
    if (!["approved", "declined"].includes(status) || !/^\d+$/.test(String(request.body.id || ""))) {
      throw new HttpError(400, "Choose a valid announcement decision.");
    }
    if (status === "declined" && (!reason || reason.length > 500)) throw new HttpError(400, "A rejection reason is required.");
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const found = await db.query(
        `
        SELECT a.id, a.title, to_char(a.date, 'YYYY-MM-DD') AS date, a.created_by AS "createdBy",
          a.approval_status AS "approvalStatus", u.email AS "creatorEmail"
        FROM announcements a LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id=$1 FOR UPDATE OF a
      `,
        [Number(request.body.id)],
      );
      if (!found.rows.length) throw new HttpError(404, "This announcement could not be found.");
      const item = found.rows[0];
      if (item.approvalStatus !== "pending") throw new HttpError(409, "This announcement has already been decided.");
      await db.query("UPDATE announcements SET approval_status=$1, decline_reason=$2 WHERE id=$3", [status, reason, item.id]);
      await insertActivity(
        db,
        user,
        `${status === "approved" ? "Approved" : "Declined"} an announcement`,
        `${item.title}${status === "declined" ? ` · ${reason}` : ""}`,
      );
      if (item.creatorEmail && item.createdBy !== user.id) {
        const title = status === "declined" ? "Announcement declined" : "Announcement approved";
        const text =
          status === "declined"
            ? `Your announcement "${item.title}" was declined. Reason: ${reason}`
            : `Your announcement "${item.title}" was approved and published.`;
        await insertNotification(db, item.creatorEmail, title, text);
        queueEmail(mailerState?.mailer, {
          from: mailerState?.settings?.from,
          to: item.creatorEmail,
          subject: title,
          text: `${text}\n\nView it in CommUnity: ${appOrigin || ""}/#/official/announcements`,
        });
      }
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 200, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return true;
  }
  if (url.pathname === "/api/announcements" && ["POST", "PUT", "DELETE"].includes(request.method)) {
    requireRole(user, ["official", "administrator"]);
    if (!(await hasPermission(db, user, "manageAnnouncements")))
      throw new HttpError(403, "Announcement management is not enabled for this role.");
    requireJsonBody(request);
    const body = request.body;
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      if (request.method === "DELETE") {
        if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) throw new HttpError(400, "Choose a valid announcement.");
        const deleted = await db.query("DELETE FROM announcements WHERE id=$1", [Number(body.id)]);
        if (!deleted.rowCount) throw new HttpError(404, "This announcement could not be found.");
        await insertActivity(db, user, "Removed an announcement", `Announcement ${body.id}`);
      } else {
        const location = validateAnnouncement(body);
        if (request.method === "POST") {
          const approvalStatus = user.role === "official" ? "pending" : "approved";
          await db.query(
            "INSERT INTO announcements (title,detail,date,approval_status,created_by,is_event,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              body.title.trim(),
              body.detail.trim(),
              body.date,
              approvalStatus,
              user.id,
              location.isEvent,
              location.latitude,
              location.longitude,
            ],
          );
          await insertActivity(
            db,
            user,
            approvalStatus === "pending" ? "Submitted an announcement" : "Published an announcement",
            body.title.trim(),
          );
          if (approvalStatus === "pending") {
            const admins = await db.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
            for (const account of admins.rows) {
              await insertNotification(
                db,
                account.email,
                "Announcement needs approval",
                `${user.name} submitted “${body.title.trim()}” for ${body.date}.`,
              );
              queueEmail(mailerState?.mailer, {
                from: mailerState?.settings?.from,
                to: account.email,
                subject: "Announcement needs approval",
                text: `${user.name} submitted "${body.title.trim()}" for ${body.date}.\n\nReview it in CommUnity: ${appOrigin || ""}/#/administrator/approvals`,
              });
            }
          }
        } else {
          if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) throw new HttpError(400, "Choose a valid announcement.");
          const repending = user.role === "official" ? ",approval_status='pending',decline_reason=''" : "";
          const updated = await db.query(
            `UPDATE announcements SET title=$1,detail=$2,date=$3,is_event=$4,latitude=$5,longitude=$6${repending} WHERE id=$7`,
            [body.title.trim(), body.detail.trim(), body.date, location.isEvent, location.latitude, location.longitude, Number(body.id)],
          );
          if (!updated.rowCount) throw new HttpError(404, "This announcement could not be found.");
          await insertActivity(db, user, "Updated an announcement", body.title.trim());
        }
      }
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 200, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return true;
  }
  if (url.pathname === "/api/calendar/events" && request.method === "POST") {
    requireRole(user, ["official", "administrator"]);
    if (!(await hasPermission(db, user, "manageSchedules")))
      throw new HttpError(403, "Calendar event management is not enabled for this role.");
    requireJsonBody(request);
    validateCalendarEvent(request.body);
    const approvalStatus = user.role === "official" ? "pending" : "approved";
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const title = request.body.title.trim();
      const detail = String(request.body.detail || "").trim();
      const latitude = request.body.latitude == null || request.body.latitude === "" ? null : Number(request.body.latitude);
      const longitude = request.body.longitude == null || request.body.longitude === "" ? null : Number(request.body.longitude);
      await db.query(
        "INSERT INTO calendar_events (title,detail,date,approval_status,created_by,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [title, detail, request.body.date, approvalStatus, user.id, latitude, longitude],
      );
      await insertActivity(
        db,
        user,
        approvalStatus === "pending" ? "Requested a calendar event" : "Created a calendar event",
        `${title} · ${request.body.date}`,
      );
      if (approvalStatus === "pending") {
        const admins = await db.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
        for (const account of admins.rows) {
          await insertNotification(
            db,
            account.email,
            "Calendar event needs approval",
            `${user.name} requested “${title}” on ${request.body.date}.`,
          );
          queueEmail(mailerState?.mailer, {
            from: mailerState?.settings?.from,
            to: account.email,
            subject: "Calendar event needs approval",
            text: `${user.name} requested "${title}" on ${request.body.date}.\n\nReview it in CommUnity: ${appOrigin || ""}/#/administrator/calendar`,
          });
        }
      }
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 200, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return true;
  }
  if (url.pathname === "/api/calendar/events/approval" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "manageSchedules")))
      throw new HttpError(403, "Calendar event management is not enabled for this role.");
    requireJsonBody(request);
    const id = Number(request.body.id);
    const status = String(request.body.status || "");
    const reason = status === "declined" ? String(request.body.reason || "").trim() : "";
    if (!Number.isInteger(id) || id < 1 || !["approved", "declined"].includes(status)) {
      throw new HttpError(400, "Choose a valid event decision.");
    }
    if (status === "declined" && (!reason || reason.length > 500)) throw new HttpError(400, "A rejection reason is required.");
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const found = await db.query(
        `
        SELECT e.id, e.title, to_char(e.date, 'YYYY-MM-DD') AS date, e.created_by AS "createdBy",
          e.approval_status AS "approvalStatus", u.email AS "creatorEmail", u.name AS "creatorName"
        FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.id=$1 FOR UPDATE OF e
      `,
        [id],
      );
      if (!found.rows.length) throw new HttpError(404, "This event request could not be found.");
      const item = found.rows[0];
      if (item.approvalStatus !== "pending") throw new HttpError(409, "This event request has already been decided.");
      await db.query("UPDATE calendar_events SET approval_status=$1, decline_reason=$2 WHERE id=$3", [status, reason, id]);
      await insertActivity(
        db,
        user,
        `${status === "approved" ? "Approved" : "Declined"} a calendar event`,
        `${item.title} · ${item.date}${status === "declined" ? ` · ${reason}` : ""}`,
      );
      if (item.creatorEmail && item.createdBy !== user.id) {
        const title = status === "declined" ? "Calendar event declined" : "Calendar event approved";
        const body =
          status === "declined"
            ? `Your event “${item.title}” on ${item.date} was declined. Reason: ${reason}`
            : `Your event “${item.title}” on ${item.date} was approved.`;
        await insertNotification(db, item.creatorEmail, title, body);
        queueEmail(mailerState?.mailer, {
          from: mailerState?.settings?.from,
          to: item.creatorEmail,
          subject: title,
          text: `${body}\n\nView the calendar in CommUnity: ${appOrigin || ""}/#/official/calendar`,
        });
      }
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 200, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return true;
  }
  return false;
}
