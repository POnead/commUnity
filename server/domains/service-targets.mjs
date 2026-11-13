// Service-target logic for concerns, isolated so it can be unit-tested without
// a database. Two separate targets, both measured from the start of the current
// service cycle (submission, or the latest reopen): the first staff response,
// and resolution of the concern itself.

export const REPORT_PRIORITIES = ["High", "Medium", "Low"];

export const FOLLOW_UP_LIMITS = { High: null, Medium: 5, Low: 3 };
export const RESPONSE_DEADLINE_DAYS = { High: 1, Medium: 3, Low: 7 };
export const RESOLUTION_DEADLINE_DAYS = { High: 7, Medium: 14, Low: 30 };

export function normalizeReportPriority(report) {
  if (!report || typeof report !== "object") return;
  if (report.priority === undefined) report.priority = report.urgent ? "High" : "Medium";
  report.urgent = report.priority === "High";
}

export function serviceDeadline(anchor, days) {
  return new Date(anchor.getTime() + days * 86400000).toISOString();
}

// The service clock runs on an anchor of its own, not on the submission date. It
// starts when the concern is submitted and restarts when a resident reopens it,
// so a later priority change measures against the current cycle instead of
// pulling the deadlines back to the original submission.
export function serviceCycleAnchor(source) {
  if (!source) return new Date();
  const started = source.serviceCycleStartedAt || source.submittedAt;
  const anchor = started ? new Date(started) : new Date();
  return Number.isNaN(anchor.getTime()) ? new Date() : anchor;
}

// Each service target is set once, from the moment the current service cycle began.
export function computeServiceDeadlines(report) {
  if (!report) return report;
  const anchor = serviceCycleAnchor(report);
  if (!report.responseDeadline) {
    report.responseDeadline = serviceDeadline(anchor, RESPONSE_DEADLINE_DAYS[report.priority] ?? RESPONSE_DEADLINE_DAYS.Medium);
  }
  if (!report.resolutionDeadline) {
    report.resolutionDeadline = serviceDeadline(anchor, RESOLUTION_DEADLINE_DAYS[report.priority] ?? RESOLUTION_DEADLINE_DAYS.Medium);
  }
  return report;
}

// The server owns the service-target fields and recalculates the overdue flags on
// read, so a client copy of them is neither trusted nor compared. A deadline that
// crosses between two reads must not look like a client edit.
export function comparableReport(report, core = false) {
  const {
    respondedAt,
    responseDeadline,
    resolvedAt,
    resolutionDeadline,
    overdue,
    responseOverdue,
    resolutionOverdue,
    status,
    updatedAt,
    history,
    assignedTo,
    ...rest
  } = report;
  return core ? rest : { status, updatedAt, history, assignedTo, ...rest };
}
