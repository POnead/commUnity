// One shared design for every CommUnity email. Each builder supplies content;
// this file owns the look, so adding an email never means a new template.
// Tone only marks urgency or a failed decision, never a different layout.
const BRAND = "#064e3b";
const ACCENT = "#047857";
const ACCENT_SOFT = "#e8f5ee";
const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const LINE = "#e2e8f0";

const TONES = {
  green: { accent: ACCENT, soft: ACCENT_SOFT, border: "#c7e6d4" },
  amber: { accent: "#b45309", soft: "#fffbeb", border: "#fde68a" },
  red: { accent: "#b91c1c", soft: "#fef2f2", border: "#fecaca" },
};

function tone(name) {
  return TONES[name] || TONES.green;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function roleLabel(role) {
  if (role === "official") return "Barangay official";
  if (role === "administrator") return "Administrator";
  return "Resident";
}

// A row value is plain text unless a builder passes { pill, tone }.
function rowValue(value) {
  if (value && typeof value === "object" && value.pill) {
    const c = tone(value.tone);
    return `<span style="display:inline-block;background:${c.soft};border:1px solid ${c.border};color:${c.accent};font-size:12px;font-weight:bold;padding:2px 9px;border-radius:999px;">${escapeHtml(value.pill)}</span>`;
  }
  return escapeHtml(value);
}

function layout({
  eyebrow = "",
  badge = "",
  title,
  intro = "",
  extraHtml = "",
  rows = [],
  note = "",
  cta,
  footnote = "",
  tone: toneName = "green",
}) {
  const c = tone(toneName);
  const eyebrowHtml = eyebrow
    ? `<div style="font-size:11px;letter-spacing:0.09em;text-transform:uppercase;color:${c.accent};font-weight:bold;margin:0 0 10px;">${escapeHtml(eyebrow)}${
        badge
          ? `&nbsp;<span style="display:inline-block;background:${c.accent};color:#ffffff;font-size:10px;letter-spacing:0.05em;padding:2px 7px;border-radius:999px;vertical-align:1px;">${escapeHtml(badge)}</span>`
          : ""
      }</div>`
    : "";
  const rowsHtml = rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([label, value]) =>
        `<tr><td style="font-size:13px;color:${MUTED};padding:6px 0;vertical-align:top;">${escapeHtml(label)}</td><td style="font-size:13px;color:${INK};padding:6px 0;text-align:right;vertical-align:top;">${rowValue(value)}</td></tr>`,
    )
    .join("");
  const rowsBlock = rowsHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};margin:0 0 22px;">${rowsHtml}</table>`
    : "";
  const noteHtml = note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="background:${c.soft};border-left:3px solid ${c.accent};border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;color:${BODY};line-height:1.55;">${escapeHtml(note)}</td></tr></table>`
    : "";
  const ctaHtml =
    cta && cta.url
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr><td style="border-radius:8px;background:${c.accent};"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(cta.label)}</a></td></tr></table>`
      : "";
  const footnoteHtml = footnote
    ? `<p style="margin:22px 0 0;font-size:12px;color:${MUTED};line-height:1.5;">${escapeHtml(footnote)}</p>`
    : "";
  const preheader = [title, intro].filter(Boolean).join(" — ");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f4;font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 18px rgba(6,78,59,0.08);">
        <tr><td style="background:${BRAND};padding:22px 28px;">
          <div style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.2px;">CommUnity</div>
          <div style="color:#bfe3cf;font-size:12px;margin-top:3px;">Palsara community desk</div>
        </td></tr>
        <tr><td style="padding:28px;">
          ${eyebrowHtml}
          <h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:${INK};font-weight:bold;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 18px;font-size:15px;color:${BODY};line-height:1.55;">${escapeHtml(intro)}</p>
          ${extraHtml}
          ${rowsBlock}
          ${noteHtml}
          ${ctaHtml}
          ${footnoteHtml}
        </td></tr>
        <tr><td style="background:#f0f7f4;padding:14px 28px;text-align:center;font-size:11px;color:${MUTED};">
          CommUnity &middot; Palsara barangay services
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildNewConcernEmail({
  name,
  category,
  title,
  barangay,
  area,
  locationDetail,
  priority,
  reportId,
  description,
  urgent,
  appOrigin = "",
}) {
  return {
    subject: urgent ? `Urgent concern: ${title}` : `New concern: ${title}`,
    text: `${name} submitted a report for ${barangay}, ${area}, near ${locationDetail}.\n\nReview it in CommUnity: ${appOrigin}/#/official/concerns`,
    html: layout({
      eyebrow: category,
      badge: urgent ? "Urgent" : "",
      title,
      intro: `${name} submitted a report for ${barangay}, ${area}, near ${locationDetail}.`,
      rows: [
        ["Category", category],
        ["Location", `${area}, ${barangay}`],
        ["Reported by", name],
        ["Priority", priority],
        ["Reference", reportId],
      ],
      note: description,
      cta: { label: "Review in concern queue", url: `${appOrigin}/#/official/concerns` },
      footnote: "You received this because you are an active barangay official or administrator.",
      tone: urgent ? "amber" : "green",
    }),
  };
}

export function buildReportStatusEmail({ reportId, status, category, barangay, area, locationDetail, note, appOrigin = "" }) {
  const body = note || `Your concern is now ${status.toLowerCase()}.`;
  return {
    subject: `Your report ${reportId} is ${status.toLowerCase()}`,
    text: `${body}\n\nView your reports in CommUnity: ${appOrigin}/#/resident/reports`,
    html: layout({
      eyebrow: `Report ${reportId}`,
      badge: status,
      title: `Your report is now ${status.toLowerCase()}`,
      intro: "The barangay team posted an update on your concern.",
      rows: [
        ["Reference", reportId],
        ["Status", { pill: status, tone: status === "Resolved" ? "green" : "amber" }],
        ["Category", category],
        ["Location", `${area}, ${barangay}`],
        ["Spot", locationDetail],
      ],
      note: body,
      cta: { label: "View your reports", url: `${appOrigin}/#/resident/reports` },
      footnote: "You received this because you submitted this concern.",
    }),
  };
}

export function buildRecoveryVerificationEmail({ recoveryEmail, verifyLink, minutes }) {
  return {
    subject: "Verify your CommUnity recovery email",
    text: `Confirm this email address for CommUnity password recovery (valid for ${minutes} minutes): ${verifyLink}\n\nPassword reset links are only sent to a recovery email you have confirmed. If you did not request this, ignore this message.`,
    html: layout({
      eyebrow: "Account security",
      title: "Verify your recovery email",
      intro: `Confirm ${recoveryEmail} so CommUnity can send you password reset links there.`,
      rows: [
        ["Recovery email", recoveryEmail],
        ["Valid for", `${minutes} minutes`],
      ],
      cta: { label: "Verify email address", url: verifyLink },
      footnote: "If you did not request this, ignore this message. Password reset links are only sent to a confirmed address.",
    }),
  };
}

export function buildEmailChangeEmail({ newEmail, verifyLink, minutes }) {
  return {
    subject: "Confirm your CommUnity email address",
    text: `Confirm this email address for your CommUnity account (valid for ${minutes} minutes): ${verifyLink}\n\nIf you did not request this change, ignore this message.`,
    html: layout({
      eyebrow: "Account security",
      title: "Confirm your new email address",
      intro: `Confirm ${newEmail} to use it for signing in to CommUnity. Your current address keeps working until you do.`,
      rows: [
        ["New email", newEmail],
        ["Valid for", `${minutes} minutes`],
      ],
      cta: { label: "Confirm email address", url: verifyLink },
      footnote: "If you did not request this change, ignore this message.",
    }),
  };
}

export function buildPasswordResetEmail({ resetLink, minutes }) {
  return {
    subject: "CommUnity password reset",
    text: `Reset your CommUnity password using this link (valid for ${minutes} minutes): ${resetLink}`,
    html: layout({
      eyebrow: "Account security",
      title: "Reset your password",
      intro: "Use the button below to choose a new CommUnity password.",
      rows: [["Valid for", `${minutes} minutes`]],
      cta: { label: "Choose a new password", url: resetLink },
      footnote: "If you did not request this, ignore this message. Your password will not change.",
    }),
  };
}

export function buildTemporaryPasswordEmail({ name, role, area, temporaryPassword, signInUrl = "" }) {
  const displayName = String(name || "there").trim() || "there";
  const passwordCard = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${ACCENT_SOFT};border:1px solid #c7e6d4;border-radius:10px;margin:0 0 22px;"><tr><td style="padding:16px 18px;"><div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT};font-weight:bold;">Temporary password</div><div style="font-family:'Courier New',Courier,monospace;font-size:18px;color:${INK};margin-top:8px;word-break:break-all;">${escapeHtml(temporaryPassword)}</div></td></tr></table>`;

  return {
    subject: "CommUnity temporary password",
    text: `Your temporary CommUnity password is: ${temporaryPassword}\n\nSign in and change it immediately. The password expires on first use.`,
    html: layout({
      eyebrow: "Account access",
      title: "Your temporary password",
      intro: `Hello ${displayName}, an administrator generated a temporary sign-in password for your CommUnity account. Use it to sign in, then choose a new password right away.`,
      extraHtml: passwordCard,
      rows: [
        ["Account", displayName],
        ["Role", roleLabel(role)],
        ["Area", area ? String(area) : "Palsara"],
      ],
      note: "This password expires on first use. Sign in and change it immediately.",
      cta: signInUrl ? { label: "Sign in to CommUnity", url: signInUrl } : null,
      footnote: "If you did not request this password reset, contact your barangay administrator. Never share this password with anyone.",
    }),
  };
}

export function buildAnnouncementApprovalEmail({ authorName, title, date, appOrigin = "" }) {
  return {
    subject: "Announcement needs approval",
    text: `${authorName} submitted "${title}" for ${date}.\n\nReview it in CommUnity: ${appOrigin}/#/administrator/approvals`,
    html: layout({
      eyebrow: "Approval needed",
      title: "Announcement needs approval",
      intro: `${authorName} submitted “${title}” for ${date}.`,
      rows: [
        ["Announcement", title],
        ["Submitted by", authorName],
        ["Date", date],
      ],
      cta: { label: "Review approval queue", url: `${appOrigin}/#/administrator/approvals` },
      footnote: "You received this because you can approve announcements for Palsara.",
      tone: "amber",
    }),
  };
}

export function buildAnnouncementDecisionEmail({ title, approved, reason, appOrigin = "" }) {
  const subject = approved ? "Announcement approved" : "Announcement declined";
  const text = approved
    ? `Your announcement "${title}" was approved and published.\n\nView it in CommUnity: ${appOrigin}/#/official/announcements`
    : `Your announcement "${title}" was declined. Reason: ${reason}\n\nView it in CommUnity: ${appOrigin}/#/official/announcements`;

  return {
    subject,
    text,
    html: layout({
      eyebrow: "Announcement",
      title: subject,
      intro: approved ? "Your announcement was approved and is now published to the community." : "Your announcement was not approved.",
      rows: [
        ["Announcement", title],
        ["Decision", { pill: approved ? "Approved" : "Declined", tone: approved ? "green" : "red" }],
        ...(approved ? [] : [["Reason", reason]]),
      ],
      cta: { label: "View announcements", url: `${appOrigin}/#/official/announcements` },
      tone: approved ? "green" : "red",
    }),
  };
}

export function buildEventApprovalEmail({ authorName, title, date, appOrigin = "" }) {
  return {
    subject: "Calendar event needs approval",
    text: `${authorName} requested "${title}" on ${date}.\n\nReview it in CommUnity: ${appOrigin}/#/administrator/calendar`,
    html: layout({
      eyebrow: "Approval needed",
      title: "Calendar event needs approval",
      intro: `${authorName} requested “${title}” on ${date}.`,
      rows: [
        ["Event", title],
        ["Requested by", authorName],
        ["Date", date],
      ],
      cta: { label: "Review calendar request", url: `${appOrigin}/#/administrator/calendar` },
      footnote: "You received this because you can approve calendar events for Palsara.",
      tone: "amber",
    }),
  };
}

export function buildEventDecisionEmail({ title, date, approved, reason, appOrigin = "" }) {
  const subject = approved ? "Calendar event approved" : "Calendar event declined";
  const text = approved
    ? `Your event “${title}” on ${date} was approved.\n\nView the calendar in CommUnity: ${appOrigin}/#/official/calendar`
    : `Your event “${title}” on ${date} was declined. Reason: ${reason}\n\nView the calendar in CommUnity: ${appOrigin}/#/official/calendar`;

  return {
    subject,
    text,
    html: layout({
      eyebrow: "Calendar event",
      title: subject,
      intro: approved ? "Your calendar event was approved and is now on the community calendar." : "Your calendar event was not approved.",
      rows: [
        ["Event", title],
        ["Date", date],
        ["Decision", { pill: approved ? "Approved" : "Declined", tone: approved ? "green" : "red" }],
        ...(approved ? [] : [["Reason", reason]]),
      ],
      cta: { label: "View calendar", url: `${appOrigin}/#/official/calendar` },
      tone: approved ? "green" : "red",
    }),
  };
}

export function buildCollectionReminderEmail({ wasteType, area, dateLabel, startTime, appOrigin = "" }) {
  const body = `${wasteType} collection for ${area} is scheduled tomorrow, ${dateLabel} at ${startTime}.`;
  return {
    subject: `Collection reminder for ${area}`,
    text: `${body}\n\nView your collection schedule in CommUnity: ${appOrigin}/#/resident/collection`,
    html: layout({
      eyebrow: "Collection reminder",
      title: "Collection is tomorrow",
      intro: body,
      rows: [
        ["Waste type", wasteType],
        ["Area", area],
        ["Date", dateLabel],
        ["Time", startTime],
      ],
      cta: { label: "View collection schedule", url: `${appOrigin}/#/resident/collection` },
      footnote: "You received this because your area has a collection tomorrow.",
    }),
  };
}

export function buildSmtpTestEmail({ from, host, port }) {
  return {
    subject: "CommUnity SMTP test",
    text: "CommUnity successfully sent this test email.",
    html: layout({
      eyebrow: "System",
      title: "SMTP is working",
      intro: "CommUnity successfully sent this test email through your saved mail server.",
      rows: [
        ["Sender", from],
        ["Host", host],
        ["Port", port],
      ],
      footnote: "This message was sent from the CommUnity email settings page.",
    }),
  };
}
