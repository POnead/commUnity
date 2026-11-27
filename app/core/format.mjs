"use strict";

import { ROLES, getAppTimeZone } from "../constants.mjs";

export const icons = {
  home: '<path d="m3.5 10 8.5-7 8.5 7"></path><path d="M5.5 9v11h13V9"></path><path d="M9 20v-6h6v6"></path>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="16" rx="2"></rect><path d="M7.5 3v4M16.5 3v4M3.5 9h17"></path><path d="M7.5 13h3M7.5 16h6"></path>',
  flag: '<path d="M5 21V4"></path><path d="M5 5c5-3 9 3 14 0v10c-5 3-9-3-14 0"></path>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2"></rect><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7M8.5 18h4"></path>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.5 2"></path>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>',
  phone: '<path d="M5 3h3l2 5-2.5 1.5a13 13 0 0 0 6 6L15 13l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z"></path>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  user: '<circle cx="12" cy="8" r="3.5"></circle><path d="M5 20a7 7 0 0 1 14 0"></path>',
  users:
    '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"></path><circle cx="9.5" cy="7" r="3.5"></circle><path d="M17 11a3.5 3.5 0 1 0-1.2-6.8M17 14.5h1a4 4 0 0 1 4 4V20"></path>',
  shield: '<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"></path><path d="m9 12 2 2 4-4"></path>',
  settings:
    '<circle cx="12" cy="12" r="3"></circle><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.9 1.1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.9-1.1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2.2l-1.4-1.1L6.9 9.3l1.7.7a8 8 0 0 1 1.9-1.1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.9 1.1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 2.2Z"></path>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4 4"></path>',
  chevron: '<path d="m8 10 4 4 4-4"></path>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"></path><circle cx="12" cy="10" r="2"></circle>',
  check: '<path d="m5 12 4 4L19 6"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"></path>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"></path>',
  eye: '<path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m21 15-5-5L5 20"></path>',
  camera:
    '<rect x="3" y="7" width="18" height="13" rx="2"></rect><circle cx="12" cy="13.5" r="3.5"></circle><path d="M8.5 7 10 4.5h4L15.5 7"></path>',
  cameraOff:
    '<path d="M3 3l18 18"></path><path d="M8.5 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1"></path><path d="M8.5 7 10 4.5h4L15.5 7"></path><circle cx="12" cy="13.5" r="3"></circle>',
  upload:
    '<path d="M7 18h10.5a3.5 3.5 0 0 0 .2-7A6 6 0 0 0 6.2 9.8 4.2 4.2 0 0 0 7 18Z"></path><path d="M12 14V7M9.5 9.5 12 7l2.5 2.5"></path>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"></path>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"></path>',
  leaf: '<path d="M20 4c-9 0-15 4-15 11a5 5 0 0 0 5 5c7 0 11-6 10-16Z"></path><path d="M4 21c3-5 6-8 12-11"></path>',
  alert: '<path d="m12 3 9 17H3z"></path><path d="M12 9v4m0 3h.01"></path>',
  chart: '<path d="M4 21h16"></path><path d="M7 17V9M12 17V5M17 17v-4"></path>',
  folder: '<path d="M3.5 7.5h6l2 2h9v9.5h-17z"></path><path d="M3.5 7.5V5h6l2 2h4"></path>',
  more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
};

export function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${extra}">${icons[name] || icons.home}</svg>`;
}
export function brandMark() {
  return '<span class="brand-mark"><img src="/logo/palsara-transparent.webp" alt="Palsara barangay logo"></span>';
}

export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function isDateOnly(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function asDate(value) {
  // Date-only strings name a calendar day, not midnight UTC. Anchor them at
  // midday and format them in UTC so no zone rolls them to the next day.
  const parsed = new Date(isDateOnly(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) throw new Error("A saved CommUnity date is invalid.");
  return parsed;
}

export function appDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A saved CommUnity date is invalid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: getAppTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function dateLabel(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const zone = isDateOnly(value) ? "UTC" : getAppTimeZone();
  return new Intl.DateTimeFormat("en-PH", { timeZone: zone, ...options }).format(asDate(value));
}

export function dateTimeLabel(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: isDateOnly(value) ? "UTC" : getAppTimeZone(),
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(asDate(value));
}

export function dateInputValue(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const { year, month, day } = appDateParts(value);
  return `${year}-${month}-${day}`;
}

export function todayISO() {
  return dateInputValue(new Date());
}

// A month bucket key in the barangay's time zone, matching the report trend table.
export function monthKey(value = new Date()) {
  const { year, month } = appDateParts(value);
  return `${year}-${month}`;
}

export function monthKeyOffset(offset, from = new Date()) {
  const { year, month } = appDateParts(from);
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function normalizeStatus(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(" ", "-");
}

export function statusPill(value, label = value) {
  return `<span class="status" data-status="${esc(normalizeStatus(value))}">${esc(label)}</span>`;
}

// "system" is an audit role, not an account role, so it is not part of ROLES.
export function roleLabel(role) {
  return role === "system" ? "System" : ROLES[role] || role;
}

export function initials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "C"
  );
}

export function idFor(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
