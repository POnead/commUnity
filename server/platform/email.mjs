import nodemailer from "nodemailer";
import { decryptSettings } from "./crypto.mjs";
import { logError } from "./log.mjs";

export function createMailer({ smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom }) {
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom) return null;
  return nodemailer.createTransport({
    host: smtpHost,
    port: Number(smtpPort),
    secure: Number(smtpPort) === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

// HTTPS email transport (Resend). Used when SMTP ports are blocked but HTTPS (443)
// works, e.g. on restricted Wi-Fi. The returned object matches nodemailer's
// sendMail(message) signature so callers stay provider-agnostic.
export function createResendMailer({ apiKey, from }) {
  if (!apiKey) return null;
  const defaultFrom = String(from || "").trim();
  return {
    async sendMail({ from: messageFrom, to, subject, text, html }) {
      const sender = String(messageFrom || defaultFrom).trim();
      if (!sender) throw new Error("Resend sender address is not configured (set RESEND_FROM).");
      const recipients = Array.isArray(to) ? to : [to];
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: sender, to: recipients, subject, text, html }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let detail = body;
        try {
          detail = JSON.parse(body)?.message || body;
        } catch {
          // keep raw body
        }
        throw new Error(`Resend ${response.status}: ${String(detail).slice(0, 200)}`);
      }
      return response.json().catch(() => ({}));
    },
  };
}

export function queueEmail(mailer, message) {
  if (!mailer) return;
  mailer.sendMail(message).catch((error) => logError("CommUnity could not send an email.", error, { subject: message.subject }));
}

export function publicSmtpSettings(settings) {
  return {
    host: settings?.host || "",
    port: settings?.port || "",
    user: settings?.user || "",
    from: settings?.from || "",
    configured: Boolean(settings?.host && settings?.port && settings?.user && settings?.pass && settings?.from),
  };
}

export async function loadSmtpSettings(db, encryptionKey, fallback) {
  if (!encryptionKey) return fallback;
  const result = await db.query("SELECT encrypted_value FROM app_settings WHERE key='smtp'");
  if (!result.rows[0]) return fallback;
  try {
    return decryptSettings(result.rows[0].encrypted_value, encryptionKey);
  } catch (error) {
    logError("CommUnity could not decrypt saved SMTP settings.", error);
    return fallback;
  }
}
