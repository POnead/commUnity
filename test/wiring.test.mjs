import "./frontend-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const core = await import("../app/core.mjs");
const views = await import("../app/views.mjs");

function baseState(role) {
  return {
    currentUser: { id: "u1", name: "Example User", email: `${role}@example.test`, role, status: "Active", idStatus: "unverified" },
    data: {
      version: 1,
      users: [],
      reports: [],
      schedules: [],
      notifications: [],
      activities: [],
      permissions: {
        resident: { submitReports: true, viewSchedules: true },
        official: { manageReports: true, manageSchedules: true, manageAnnouncements: true },
        administrator: { manageReports: true, manageSchedules: true, manageAnnouncements: true, manageUsers: true, manageRoles: true, viewAudit: true },
      },
      accountOverrides: {},
      announcements: [],
      calendarEvents: [],
      locations: [],
      recyclingLocations: [],
      hotlines: [
        { id: 1, name: "Palsara Fire Department", category: "Fire Department", contactNumber: "0917 111 2233", status: "Active", published: true, verifiedAt: null },
      ],
      hotlineCorrections: [],
      verificationQueue: [{ userId: "r1", name: "Resident Example", email: "r@example.test", idType: "philsys", idNumber: "1234-5678-9012", idStatus: "pending" }],
    },
    verification: { status: {}, scanned: {}, signals: [], checks: {} },
    verificationSettings: { faceVerificationEnabled: false, requireFaceOnLogin: false, dutyHours: 9, matchThreshold: 0.033, faceppEnabled: false, faceppThreshold: 80, ocrEnabled: false },
    hotlineFilter: "all",
  };
}

test("verification page is reachable for every role and renders its controls", () => {
  for (const role of ["resident", "official", "administrator"]) {
    core.__setTestState(baseState(role));
    const html = views.verificationPage(role);
    assert.match(html, /Identity verification|ID review queue/, role);
    assert.match(html, /data-action="delete-own-id"|id-submit-form|id-review|verification-settings-form/, role);
  }
});

test("face check page exists for officials and exposes the duty check", () => {
  core.__setTestState(baseState("official"));
  const html = views.faceCheckPage();
  assert.match(html, /Face check/);
  assert.match(html, /data-action="start-face-check"/);
});

test("hotlines page renders the directory and role-specific controls", () => {
  for (const role of ["resident", "official", "administrator"]) {
    core.__setTestState(baseState(role));
    const html = views.hotlinesPage(role);
    assert.match(html, /Palsara Fire Department/, role);
    assert.match(html, /data-action="filter-hotlines"/, role);
  }
  core.__setTestState(baseState("official"));
  assert.match(views.hotlinesPage("official"), /data-action="suggest-hotline"/);
  core.__setTestState(baseState("administrator"));
  assert.match(views.hotlinesPage("administrator"), /data-action="add-hotline"/);
});

test("navigation links expose the new pages to each role", () => {
  for (const role of ["resident", "official", "administrator"]) {
    core.__setTestState(baseState(role));
    const groups = views.navGroups(role);
    const keys = groups.flatMap((group) => group.links.map(([key]) => key));
    assert.ok(keys.includes("verification"), `${role} verification link`);
    assert.ok(keys.includes("hotlines"), `${role} hotlines link`);
    if (role === "official") assert.ok(keys.includes("face-check"));
  }
});

test("face capture markup exposes the capture control used by the wiring", () => {
  const html = views.faceCaptureMarkup("Face capture", "Follow the prompts");
  assert.match(html, /data-action="capture-face"/);
  assert.match(html, /face-video-frame/);
});
