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
