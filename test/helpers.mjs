// Shared fixtures for the split test files. Everything here mirrors what the
// old monolithic server.test.mjs kept at the top — no behavior changes.
import assert from "node:assert/strict";
import path from "node:path";
import net from "node:net";
import { createCommunityServer } from "../server/index.mjs";

export const ADMIN_EMAIL = "admin@example.test";
export const ADMIN_PASSWORD = "LocalTestPassword-2026!";
// A 1x1 JPEG, enough for the upload endpoints to recognise the file signature.
export const TEST_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

export async function startServer(dataDir, smtp = {}, options = {}) {
  const instance = await createCommunityServer({
    dataDir,
    uploadsDir: options.uploadsDir || path.join(path.dirname(dataDir), "uploads"),
    port: 0,
    initialAdminEmail: ADMIN_EMAIL,
    initialAdminPassword: ADMIN_PASSWORD,
    ...smtp,
  });
  await new Promise((resolve, reject) => {
    instance.server.once("error", reject);
    instance.server.listen(0, "127.0.0.1", resolve);
  });
  const address = instance.server.address();
  return { ...instance, origin: `http://127.0.0.1:${address.port}` };
}

// Minimal SMTP sink that accepts any mail and replies OK, so tests can confirm
// delivery without a real SMTP provider. Captured messages land in server.messages.
export async function startSmtpSink() {
  return new Promise((resolve, reject) => {
    const messages = [];
    const server = net.createServer((socket) => {
      let expectingData = false;
      let buffer = "";
      socket.write("220 smtp.local ESMTP ready\r\n");
      socket.on("data", (data) => {
        const chunk = data.toString();
        if (expectingData) {
          buffer += chunk;
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          messages.push(buffer.slice(0, end));
          buffer = "";
          expectingData = false;
          socket.write("250 OK\r\n");
          return;
        }
        const line = chunk.trim();
        if (line.startsWith("DATA")) {
          expectingData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (line === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      });
      socket.on("error", () => {});
    });
    server.messages = messages;
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Undo quoted-printable soft line breaks and escaped "=" so links can be read back.
export function mailText(message) {
  return String(message || "")
    .replace(/=\r\n/g, "")
    .replace(/=3[Dd]/g, "=");
}

export async function api(app, endpoint, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Origin", options.origin || app.origin);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.cookie) headers.set("Cookie", options.cookie);
  return fetch(`${app.origin}${endpoint}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export async function uploadPhoto(app, endpoint, cookie, data, name = "photo.jpg", type = "image/jpeg") {
  const form = new FormData();
  form.append("photos", new Blob([data], { type }), name);
  return fetch(`${app.origin}${endpoint}`, {
    method: "POST",
    headers: { Origin: app.origin, Cookie: cookie },
    body: form,
  });
}

export async function signIn(app, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  const response = await api(app, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const result = await response.json();
  return { response, result, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}

export async function registerResident(app, email, name) {
  const registered = await api(app, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email,
      area: "Purok 2",
      phone: "",
      password: "A-unique-resident-password!",
      confirmPassword: "A-unique-resident-password!",
    },
  });
  assert.equal(registered.status, 201);
  return { cookie: registered.headers.get("set-cookie").split(";")[0], email, name };
}

export async function createOfficial(app, adminCookie, email = "official@example.test", name = "Official One", extra = {}) {
  const created = await api(app, "/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name,
      email,
      area: "Palsara",
      phone: "",
      role: "official",
      status: "Active",
      availableDays: ["Monday"],
      password: "A-unique-official-password!",
      ...extra,
    },
  });
  assert.equal(created.status, 201, `createOfficial failed: ${await created.text()}`);
  const signedIn = await signIn(app, email, "A-unique-official-password!");
  assert.equal(signedIn.response.status, 200);
  return signedIn.cookie;
}

export async function seedReport(app, { cookie, email, name }, overrides = {}) {
  const state = await api(app, "/api/state", { cookie }).then((r) => r.json());
  const now = new Date().toISOString();
  const report = {
    id: `RPT-limit-${overrides.idSuffix || "x"}`,
    userEmail: email,
    name: overrides.name || name,
    category: "Flooding",
    title: "Limit test drainage",
    area: "Purok 2",
    barangay: "Palsara",
    locationDetail: "Near the school",
    latitude: 14.01799,
    longitude: 121.09465,
    description: "Water pools near the school entrance after rain.",
    urgent: overrides.priority === "High",
    priority: overrides.priority || "Medium",
    status: overrides.status || "Submitted",
    submittedAt: now,
    updatedAt: now,
    photos: [],
    history: [{ status: overrides.status || "Submitted", at: now, note: "Report received." }],
  };
  const data = structuredClone(state.data);
  data.reports.push(report);
  data.activities.push({
    id: `A-limit-${overrides.idSuffix || "x"}`,
    actor: report.name,
    role: "resident",
    action: "Submitted a concern",
    detail: `${report.id} · ${report.title}`,
    at: now,
    result: "Success",
  });
  const created = await api(app, "/api/state", {
    method: "PUT",
    cookie,
    body: { revision: state.revision, data },
  });
  assert.equal(created.status, 200, `seedReport failed: ${await created.text()}`);
  return report.id;
}

export async function postFollowUp(app, cookie, reportId, message = "Checking in on this concern.") {
  const response = await api(app, "/api/community/follow-up", {
    method: "POST",
    cookie,
    body: { reportId, message },
  });
  return { status: response.status, json: await response.json() };
}

export function manilaDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
