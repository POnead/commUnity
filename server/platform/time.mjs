// CommUnity serves one barangay, so every calendar decision uses its local day
// rather than the host's or the viewer's. Override only for a different municipality.
export const DEFAULT_TIME_ZONE = "Asia/Manila";
let appTimeZone = DEFAULT_TIME_ZONE;

export function getAppTimeZone() {
  return appTimeZone;
}

export function resolveTimeZone(value) {
  const zone = String(value || "").trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
  } catch {
    throw new Error(`APP_TIME_ZONE must be a valid IANA time zone such as ${DEFAULT_TIME_ZONE}.`);
  }
  return zone;
}

export function configureAppTimeZone(value) {
  appTimeZone = resolveTimeZone(value);
  return appTimeZone;
}

export function appDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

// The calendar day in the barangay's time zone. This is what a "today" check means.
export function appDateISO(value = new Date()) {
  const parts = appDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function isDateOnly(value) {
  return typeof value === "string" && DATE_ONLY.test(value);
}

// Date-only values carry a literal calendar day: anchor them at UTC midday and
// format them in UTC, so zones at UTC+12 or beyond cannot roll them to the next
// day. Timestamps are shown in the barangay's zone so the displayed day never
// follows the viewer.
export function parseAppDate(value) {
  if (value instanceof Date) return value;
  const text = String(value || "");
  if (isDateOnly(text)) return new Date(`${text}T12:00:00Z`);
  return new Date(text);
}

export function appDateLabel(value, options = {}) {
  const date = parseAppDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  const zone = isDateOnly(value) ? "UTC" : appTimeZone;
  return new Intl.DateTimeFormat("en-PH", { timeZone: zone, ...options }).format(date);
}

export function appTimeLabel(value = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: appTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value instanceof Date ? value : new Date(value));
}

export function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}
