import { HttpError, requireJsonBody, sendJson } from "../platform/http.mjs";
import { requireRole } from "../platform/session.mjs";
import { encryptSettings } from "../platform/crypto.mjs";
import { createMailer, publicSmtpSettings } from "../platform/email.mjs";

export async function handleSettings(request, response, db, options, user) {
  const { mailerState, smtpSettingsKey } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/settings/smtp" && request.method === "GET") {
    requireRole(user, ["administrator"]);
    sendJson(response, 200, { settings: publicSmtpSettings(mailerState.settings), encryptionReady: Boolean(smtpSettingsKey) });
    return true;
  }
  if (url.pathname === "/api/settings/smtp" && request.method === "PUT") {
    requireRole(user, ["administrator"]);
    if (!smtpSettingsKey)
      throw new HttpError(
        503,
        "The server could not prepare the encryption key for saved email settings. Set SMTP_SETTINGS_KEY to a long random secret, or make the data directory writable so a local key file can be generated, then restart the server.",
      );
    requireJsonBody(request);
    const body = request.body;
    const settings = {
      host: String(body.host || "").trim(),
      port: Number(body.port),
      user: String(body.user || "").trim(),
      pass: String(body.pass || ""),
      from: String(body.from || "").trim(),
    };
    if (
      !settings.host ||
      !Number.isInteger(settings.port) ||
      settings.port < 1 ||
      settings.port > 65535 ||
      !settings.user ||
      !settings.from ||
      (!settings.pass && !mailerState.settings.pass)
    ) {
      throw new HttpError(400, "Enter a host, valid port, username, sender, and password.");
    }
    if (!settings.pass) settings.pass = mailerState.settings.pass;
    await db.query(
      "INSERT INTO app_settings(key,encrypted_value,updated_at) VALUES('smtp',$1,now()) ON CONFLICT(key) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=now()",
      [encryptSettings(settings, smtpSettingsKey)],
    );
    mailerState.settings = settings;
    mailerState.mailer = createMailer({
      smtpHost: settings.host,
      smtpPort: settings.port,
      smtpUser: settings.user,
      smtpPass: settings.pass,
      smtpFrom: settings.from,
    });
    sendJson(response, 200, { settings: publicSmtpSettings(settings) });
    return true;
  }
  if (url.pathname === "/api/settings/smtp" && request.method === "DELETE") {
    requireRole(user, ["administrator"]);
    // Only the owning administrator can clear saved SMTP settings, so a stranger
    // cannot clear themselves into an undeliverable-mail state.
    await db.query("DELETE FROM app_settings WHERE key='smtp'");
    mailerState.settings = { host: "", port: "", user: "", pass: "", from: "" };
    mailerState.mailer = null;
    sendJson(response, 200, { settings: publicSmtpSettings(null) });
    return true;
  }
  if (url.pathname === "/api/settings/smtp/test" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!mailerState.mailer) throw new HttpError(400, "Save complete SMTP settings before sending a test email.");
    try {
      await mailerState.mailer.sendMail({
        from: mailerState.settings.from,
        to: user.email,
        subject: "CommUnity SMTP test",
        text: "CommUnity successfully sent this test email.",
      });
    } catch (error) {
      const detail = String(error?.message || "The mail server rejected the message.").slice(0, 200);
      throw new HttpError(502, `The test email could not be sent: ${detail}`);
    }
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}
