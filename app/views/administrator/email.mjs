"use strict";

import { inputField, smtpSettings } from "../../core.mjs";
import { page } from "../shared.mjs";

export function emailDeliverySection() {
  if (smtpSettings.encryptionReady === false) {
    // Encryption is a server concern, so say so plainly instead of offering a form
    // that can only fail with a 503 at save time.
    return `<section class="settings-section"><h2>Email</h2><div class="empty-state" role="status"><strong>Email is not set up on this server yet</strong><p>Set the <code>SMTP_SETTINGS_KEY</code> environment variable to a long random secret, then restart the server. The SMTP password is stored AES-GCM encrypted in the database, and the encryption key never comes from the database. See the environment variable table in the README (<code>SMTP_SETTINGS_KEY</code>).</p></div></section>`;
  }
  return `<section class="settings-section smtp-settings-section"><h2>Email Configuration</h2><details class="smtp-config" open><summary><span class="smtp-config-title"><strong>SMTP email</strong><small>Report and collection notifications</small></span><span class="smtp-status" data-enabled="${Boolean(smtpSettings.configured)}"><span aria-hidden="true"></span>SMTP email: ${smtpSettings.configured ? "enabled" : "disabled"}</span><span class="smtp-config-chevron" aria-hidden="true">⌄</span></summary><form id="smtp-settings-form" class="settings-email"><div class="smtp-guide"><strong>Start with your email provider</strong><span>Choose a provider to fill the server details. Use an app password or service API key when your provider offers one; do not use your normal email password.</span><div class="smtp-provider-list"><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="gmail">Gmail</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="outlook">Outlook</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="sendgrid">SendGrid</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="custom">Other provider</button></div><p class="field-help" id="smtp-provider-help">Select a provider to see where its SMTP password or API key comes from.</p></div><div class="form-grid mt-16">${inputField("SMTP host", "host", smtpSettings.host, { required: true })}${inputField("SMTP port", "port", smtpSettings.port || "587", { type: "number", required: true, min: 1, max: 65535 })}${inputField("SMTP username", "user", smtpSettings.user, { required: true })}${inputField("Sender address", "from", smtpSettings.from, { required: true })}${inputField("SMTP password", "pass", "", { type: "password", autocomplete: "new-password", placeholder: smtpSettings.configured ? "Leave blank to keep current password" : "" })}</div><div class="form-actions"><button class="button" type="submit">Save SMTP settings</button><button class="button secondary" type="button" data-action="test-smtp">Send test email</button></div><p class="field-help">The password is encrypted on the server and never returned to this browser.</p></form></details></section>`;
}

export function emailPage() {
  const body = `<div class="content-stack">${emailDeliverySection()}</div>`;
  return page("administrator", "email", body);
}
