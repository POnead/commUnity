import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REPORT_PRIORITIES,
  FOLLOW_UP_LIMITS,
  RESPONSE_DEADLINE_DAYS,
  RESOLUTION_DEADLINE_DAYS,
  normalizeReportPriority,
  serviceDeadline,
  serviceCycleAnchor,
  computeServiceDeadlines,
  comparableReport,
} from "../server/domains/service-targets.mjs";

// The service-target logic decides whether the barangay met its own commitments,
// so it is unit-tested directly here rather than only through the HTTP suite.

test("normalizeReportPriority backfills priority from the legacy urgent flag", () => {
  const legacy = { urgent: true };
  normalizeReportPriority(legacy);
  assert.equal(legacy.priority, "High");
  assert.equal(legacy.urgent, true);

  const notUrgent = { urgent: false };
  normalizeReportPriority(notUrgent);
  assert.equal(notUrgent.priority, "Medium");
  assert.equal(notUrgent.urgent, false);

  // An explicit priority always wins over the boolean flag.
  const explicit = { urgent: false, priority: "Low" };
  normalizeReportPriority(explicit);
  assert.equal(explicit.priority, "Low");
  assert.equal(explicit.urgent, false);
});

test("normalizeReportPriority flags High as urgent and everything else as not", () => {
  const high = { priority: "High" };
  normalizeReportPriority(high);
  assert.equal(high.urgent, true);
  const low = { priority: "Low" };
  normalizeReportPriority(low);
  assert.equal(low.urgent, false);
});

test("serviceCycleAnchor prefers the explicit service-cycle start over submittedAt", () => {
  const now = serviceCycleAnchor({ serviceCycleStartedAt: "2026-01-10T00:00:00.000Z", submittedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(now.toISOString(), "2026-01-10T00:00:00.000Z");
});

test("serviceCycleAnchor falls back to submittedAt, then to now", () => {
  const fromSubmission = serviceCycleAnchor({ submittedAt: "2026-02-01T00:00:00.000Z" });
  assert.equal(fromSubmission.toISOString(), "2026-02-01T00:00:00.000Z");
  const fromNothing = serviceCycleAnchor({});
  assert.ok(Math.abs(Date.now() - fromNothing.getTime()) < 5000);
  // A garbage anchor must not produce an Invalid Date.
  const garbage = serviceCycleAnchor({ serviceCycleStartedAt: "not a date", submittedAt: "also not a date" });
  assert.ok(!Number.isNaN(garbage.getTime()));
});

test("computeServiceDeadlines only fills missing targets, anchored on the service cycle", () => {
  const report = { priority: "High", serviceCycleStartedAt: "2026-03-01T00:00:00.000Z" };
  computeServiceDeadlines(report);
  assert.equal(new Date(report.responseDeadline).toISOString(), "2026-03-02T00:00:00.000Z"); // High: 1 day
  assert.equal(new Date(report.resolutionDeadline).toISOString(), "2026-03-08T00:00:00.000Z"); // High: 7 days

  // Existing values are never recomputed.
  const custom = { priority: "Low", serviceCycleStartedAt: "2026-03-01T00:00:00.000Z", responseDeadline: "2026-04-04T00:00:00.000Z" };
  computeServiceDeadlines(custom);
  assert.equal(custom.responseDeadline, "2026-04-04T00:00:00.000Z");
  assert.equal(new Date(custom.resolutionDeadline).toISOString(), "2026-03-31T00:00:00.000Z"); // Low: 30 days
});

test("computeServiceDeadlines unknown priorities fall back to the Medium targets", () => {
  const report = { priority: "Bogus", serviceCycleStartedAt: "2026-03-01T00:00:00.000Z" };
  computeServiceDeadlines(report);
  assert.equal(new Date(report.responseDeadline).toISOString(), "2026-03-04T00:00:00.000Z"); // Medium: 3 days
  assert.equal(new Date(report.resolutionDeadline).toISOString(), "2026-03-15T00:00:00.000Z"); // Medium: 14 days
});

test("serviceDeadline adds whole days to the anchor", () => {
  assert.equal(serviceDeadline(new Date("2026-03-01T00:00:00.000Z"), 7), "2026-03-08T00:00:00.000Z");
});

test("comparableReport strips server-owned service fields", () => {
  const report = {
    id: "R1",
    title: "t",
    status: "Submitted",
    updatedAt: "2026-03-01T00:00:00.000Z",
    history: [],
    assignedTo: null,
    respondedAt: "x",
    responseDeadline: "y",
    resolvedAt: "z",
    resolutionDeadline: "w",
    overdue: true,
    responseOverdue: true,
    resolutionOverdue: true,
  };
  const comparable = comparableReport(report);
  assert.ok(!("respondedAt" in comparable));
  assert.ok(!("responseDeadline" in comparable));
  assert.ok(!("resolvedAt" in comparable));
  assert.ok(!("resolutionDeadline" in comparable));
  assert.ok(!("overdue" in comparable));
  assert.ok(!("responseOverdue" in comparable));
  assert.ok(!("resolutionOverdue" in comparable));
  assert.equal(comparable.status, "Submitted");
  assert.ok("history" in comparable, "history is kept outside core mode");

  const core = comparableReport(report, true);
  assert.ok(!("status" in core));
  assert.ok(!("history" in core));
  assert.ok(!("assignedTo" in core));
  assert.equal(core.id, "R1");
});

test("the priority tables stay in sync with each other", () => {
  for (const priority of REPORT_PRIORITIES) {
    assert.ok(priority in RESPONSE_DEADLINE_DAYS && priority in RESOLUTION_DEADLINE_DAYS && priority in FOLLOW_UP_LIMITS);
    assert.ok(RESPONSE_DEADLINE_DAYS[priority] < RESOLUTION_DEADLINE_DAYS[priority], `${priority} responds before it resolves`);
  }
  assert.equal(FOLLOW_UP_LIMITS.High, null, "urgent concerns are never follow-up limited");
});
