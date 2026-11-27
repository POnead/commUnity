"use strict";

import { getSessionUser, requireRole } from "../../platform/session.mjs";
import { ROLES } from "../../platform/roles.mjs";
import { requireJsonBody, sendJson } from "../../platform/http.mjs";
import { sendStateResponse } from "./read.mjs";
import { updateState } from "./write/index.mjs";
import { queueEmail } from "../../platform/email.mjs";

export async function handleState(request, response, db, options, user) {
  // The application provides the configured transport as `mailerState`; the
  // sender is the one saved with the SMTP settings. Deriving both here is what
  // actually delivers report submission and status-change emails.
  const { mailerState, appOrigin } = options;
  const mailer = mailerState?.mailer;
  const smtpFrom = mailerState?.settings?.from;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/state/revision" && request.method === "GET") {
    // Cheap live-update check: browsers poll this instead of the full state and
    // only fetch /api/state when the revision actually moved.
    requireRole(user, ROLES);
    const revision = await db.query("SELECT revision FROM app_meta WHERE id=1");
    sendJson(response, 200, { revision: Number(revision.rows[0].revision) });
    return true;
  }
  if (url.pathname === "/api/state" && request.method === "GET") {
    requireRole(user, ROLES);
    await sendStateResponse(response, db, user);
    return true;
  }
  if (url.pathname === "/api/state" && request.method === "PUT") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    const body = request.body;
    // Deliver mail only after the state save has committed successfully.
    const { pendingEmails } = await updateState(db, user, body, { smtpFrom, appOrigin });
    for (const message of pendingEmails) queueEmail(mailer, message);
    const currentUser = await getSessionUser(request, db);
    await sendStateResponse(response, db, currentUser);
    return true;
  }
  return false;
}
