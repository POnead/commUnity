import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnnouncementDecisionEmail, buildNewConcernEmail, buildReportStatusEmail } from "../server/platform/email-template.mjs";

const report = {
  name: 'Ana <script>alert("x")</script>',
  category: "Road damage",
  title: "Pothole <b>on</b> Main Road",
  barangay: "Palsara",
  area: "Main Road",
  locationDetail: "near the court",
  priority: "High",
  reportId: "RPT-1",
  description: 'A "wide" pothole & debris',
  appOrigin: "https://example.test",
};

test("new concern email escapes user text in HTML and keeps the plain-text twin", () => {
  const mail = buildNewConcernEmail({ ...report, urgent: true });
  assert.match(mail.text, /Ana <script>alert\("x"\)<\/script> submitted a report/);
  assert.match(mail.html, /Ana &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /#b45309/, "urgent mail uses the amber tone");
  assert.match(mail.html, /https:\/\/example\.test\/#\/official\/concerns/);
});

test("report status email shows the status as a green pill when resolved", () => {
  const mail = buildReportStatusEmail({
    reportId: "RPT-2",
    status: "Resolved",
    category: "Broken streetlight",
    barangay: "Palsara",
    area: "Main Road",
    locationDetail: "near the court",
    note: "Fixed the light.",
    appOrigin: "",
  });
  assert.equal(mail.subject, "Your report RPT-2 is resolved");
  assert.match(mail.text, /Fixed the light\./);
  assert.match(mail.html, /Resolved/);
  assert.match(mail.html, /#c7e6d4/, "green pill border for a resolved report");
});

test("a declined announcement uses the red tone and shows the reason", () => {
  const mail = buildAnnouncementDecisionEmail({
    title: "Clean-up drive",
    approved: false,
    reason: "Date clashes with the fiesta.",
    appOrigin: "",
  });
  assert.equal(mail.subject, "Announcement declined");
  assert.match(mail.html, /#b91c1c/);
  assert.match(mail.html, /Date clashes with the fiesta\./);
});
