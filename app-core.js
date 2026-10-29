"use strict";

const DATA_KEY = "community-demo-data-v1";
const SESSION_KEY = "community-demo-session-v1";
const DEMO_PASSWORD = "BaleteDemo26!";
const ROLES = {
  resident: "Resident",
  official: "Barangay official",
  administrator: "Administrator",
};
const ROLE_THEME = { resident: "resident", official: "official", administrator: "admin" };
const STATUSES = ["Submitted", "Under Review", "In Progress", "Resolved"];
const COLLECTION_STATUSES = [
  "Scheduled",
  "On the way",
  "Collecting",
  "Completed",
  "Delayed",
  "Cancelled",
  "Rescheduled",
];
const CATEGORIES = [
  "Road damage",
  "Broken streetlight",
  "Drainage problem",
  "Flooding",
  "Illegal dumping",
  "Missed garbage collection",
  "Other community concern",
];
const AREAS = ["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5", "Main Road"];
const DEMO_USERS = [
  { email: "juan.delacruz@community.demo", role: "resident", name: "Juan Dela Cruz", area: "Purok 3" },
  { email: "maria.santos@community.demo", role: "official", name: "Maria Santos", area: "Balete, Batangas" },
  { email: "admin@community.demo", role: "administrator", name: "Community administrator", area: "Balete, Batangas" },
];
const PERMISSION_DEFS = [
  { id: "submitReports", label: "Submit and track concerns", group: "Community services", description: "Create concerns and view their updates." },
  { id: "viewSchedules", label: "View collection schedules", group: "Community services", description: "See posted collection dates and service updates." },
  { id: "manageReports", label: "Review and update reports", group: "Community services", description: "Review resident concerns and record status updates." },
  { id: "manageSchedules", label: "Manage collection schedules", group: "Community services", description: "Create, update, and remove service schedules." },
  { id: "manageUsers", label: "Manage user accounts", group: "Portal administration", description: "Review accounts and adjust access in this prototype." },
  { id: "manageRoles", label: "Change role permissions", group: "Portal administration", description: "Choose which prototype functions each role can access." },
  { id: "viewAudit", label: "Review activity history", group: "Portal administration", description: "View the local record of demonstration changes." },
];
const EMERGENCY_GUIDANCE = "This prototype does not send reports to barangay staff or contact emergency services. If anyone is in immediate danger, contact local emergency services directly. Do not wait for a response through this demo.";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
let data;
let currentUser;
let currentRoute;
let lastKnownHash = window.location.hash;
let selectedReportId = null;
let pendingReportRoute = "";
let reportFilter = "all";
let notificationFilter = "all";
let uploadPhotos = [];
let reportDraft = null;
let modalState = null;
let selectedPermissionRole = "resident";
let permissionDrafts = {};
let permissionOpenGroups = {};
let toastTimer;
let lastPersistedSnapshot = "";

const icons = {
  home: '<path d="m3.5 10 8.5-7 8.5 7"></path><path d="M5.5 9v11h13V9"></path><path d="M9 20v-6h6v6"></path>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"></rect><path d="M7.5 3v4M16.5 3v4M3.5 9h17"></path><path d="M7.5 13h3M7.5 16h6"></path>',
  flag: '<path d="M5 21V4"></path><path d="M5 5c5-3 9 3 14 0v10c-5 3-9-3-14 0"></path>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2"></rect><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7M8.5 18h4"></path>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.5 2"></path>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>',
  user: '<circle cx="12" cy="8" r="3.5"></circle><path d="M5 20a7 7 0 0 1 14 0"></path>',
  users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"></path><circle cx="9.5" cy="7" r="3.5"></circle><path d="M17 11a3.5 3.5 0 1 0-1.2-6.8M17 14.5h1a4 4 0 0 1 4 4V20"></path>',
  shield: '<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"></path><path d="m9 12 2 2 4-4"></path>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.9 1.1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.9-1.1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2.2l-1.4-1.1L6.9 9.3l1.7.7a8 8 0 0 1 1.9-1.1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.9 1.1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 2.2Z"></path>',
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
  image: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m21 15-5-5L5 20"></path>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"></path>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"></path>',
  leaf: '<path d="M20 4c-9 0-15 4-15 11a5 5 0 0 0 5 5c7 0 11-6 10-16Z"></path><path d="M4 21c3-5 6-8 12-11"></path>',
  alert: '<path d="m12 3 9 17H3z"></path><path d="M12 9v4m0 3h.01"></path>',
};

function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${extra}">${icons[name] || icons.home}</svg>`;
}
function brandMark() {
  return '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="15" rx="1.5"></rect><circle cx="12" cy="3.5" r="1.5"></circle><path d="M8 11h8M8 14.5h8M8 18h5"></path></svg></span>';
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function asDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("A date in the local demonstration data is invalid.");
  return parsed;
}

function dateLabel(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", options).format(asDate(value));
}

function dateTimeLabel(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(asDate(value));
}

function dateInputValue(value = new Date()) {
  const date = asDate(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function todayISO() {
  return dateInputValue(new Date());
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase().replaceAll(" ", "-");
}

function statusPill(value, label = value) {
  return `<span class="status" data-status="${esc(normalizeStatus(value))}">${esc(label)}</span>`;
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "C";
}

function idFor(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function seedData() {
  const residents = [
    { email: DEMO_USERS[0].email, name: DEMO_USERS[0].name, area: "Purok 3", phone: "0917 000 0042", role: "resident", status: "Active", joinedAt: "2026-10-01" },
    { email: "ana.reyes@community.demo", name: "Ana Reyes", area: "Purok 5", phone: "0917 000 0043", role: "resident", status: "Active", joinedAt: "2026-10-03" },
    { email: "pedro.ramos@community.demo", name: "Pedro Ramos", area: "Purok 2", phone: "0917 000 0044", role: "resident", status: "Active", joinedAt: "2026-10-05" },
    { email: "carla.mendoza@community.demo", name: "Carla Mendoza", area: "Purok 2", phone: "0917 000 0045", role: "resident", status: "Active", joinedAt: "2026-10-06" },
    { email: "rosa.villanueva@community.demo", name: "Rosa Villanueva", area: "Purok 4", phone: "0917 000 0046", role: "resident", status: "Active", joinedAt: "2026-10-08" },
    { email: "jose.garcia@community.demo", name: "Jose Garcia", area: "Purok 1", phone: "0917 000 0047", role: "resident", status: "Active", joinedAt: "2026-10-11" },
    { email: DEMO_USERS[1].email, name: DEMO_USERS[1].name, area: "Balete, Batangas", phone: "0917 000 0010", role: "official", status: "Active", joinedAt: "2026-09-12" },
    { email: "liza.cruz@community.demo", name: "Liza Cruz", area: "Balete, Batangas", phone: "0917 000 0011", role: "official", status: "Active", joinedAt: "2026-09-19" },
    { email: DEMO_USERS[2].email, name: DEMO_USERS[2].name, area: "Balete, Batangas", phone: "", role: "administrator", status: "Active", joinedAt: "2026-09-01" },
  ];

  const reports = [
    {
      id: "RPT-2026-048", userEmail: DEMO_USERS[0].email, name: "Juan Dela Cruz",
      category: "Flooding", title: "Flooding on Mabini Street", area: "Purok 3",
      description: "Rainwater is pooling near the pedestrian crossing on Mabini Street. The road remains passable, but the drain appears blocked.",
      urgent: true, status: "Submitted", submittedAt: "2026-10-30T08:42:00",
      updatedAt: "2026-10-30T08:42:00", photos: [],
      history: [{ status: "Submitted", at: "2026-10-30T08:42:00", note: "Report received." }],
    },
    {
      id: "RPT-2026-047", userEmail: "ana.reyes@community.demo", name: "Ana Reyes",
      category: "Illegal dumping", title: "Illegal waste disposal", area: "Purok 5",
      description: "Household waste was left beside the community road this morning.",
      urgent: false, status: "Submitted", submittedAt: "2026-10-30T08:10:00",
      updatedAt: "2026-10-30T08:10:00", photos: [],
      history: [{ status: "Submitted", at: "2026-10-30T08:10:00", note: "Report received." }],
    },
    {
      id: "RPT-2026-046", userEmail: "pedro.ramos@community.demo", name: "Pedro Ramos",
      category: "Road damage", title: "Road obstruction on Rizal Street", area: "Purok 2",
      description: "A fallen branch is narrowing the road. Please check access for passing vehicles.",
      urgent: true, status: "Under Review", submittedAt: "2026-10-29T13:22:00",
      updatedAt: "2026-10-30T07:30:00", photos: [],
      history: [
        { status: "Submitted", at: "2026-10-29T13:22:00", note: "Report received." },
        { status: "Under Review", at: "2026-10-30T07:30:00", note: "A barangay official is reviewing the reported hazard." },
      ],
    },
    {
      id: "RPT-2026-045", userEmail: DEMO_USERS[0].email, name: "Juan Dela Cruz",
      category: "Broken streetlight", title: "Streetlight out near Purok 3", area: "Purok 3",
      description: "The streetlight beside the basketball court has not turned on for two evenings.",
      urgent: false, status: "In Progress", submittedAt: "2026-10-27T16:08:00",
      updatedAt: "2026-10-29T10:15:00", photos: [],
      history: [
        { status: "Submitted", at: "2026-10-27T16:08:00", note: "Report received." },
        { status: "Under Review", at: "2026-10-28T08:40:00", note: "The location and report details are being checked." },
        { status: "In Progress", at: "2026-10-29T10:15:00", note: "The maintenance team is checking the streetlight." },
      ],
    },
    {
      id: "RPT-2026-044", userEmail: "carla.mendoza@community.demo", name: "Carla Mendoza",
      category: "Other community concern", title: "Noise complaint", area: "Purok 2",
      description: "A resident reported recurring late-evening noise near the main road.",
      urgent: false, status: "Resolved", submittedAt: "2026-10-24T11:40:00",
      updatedAt: "2026-10-28T15:20:00", photos: [],
      history: [
        { status: "Submitted", at: "2026-10-24T11:40:00", note: "Report received." },
        { status: "Under Review", at: "2026-10-25T09:10:00", note: "The concern is being reviewed." },
        { status: "In Progress", at: "2026-10-26T14:30:00", note: "An official followed up with the parties involved." },
        { status: "Resolved", at: "2026-10-28T15:20:00", note: "The concern was addressed." },
      ],
    },
    {
      id: "RPT-2026-043", userEmail: "rosa.villanueva@community.demo", name: "Rosa Villanueva",
      category: "Drainage problem", title: "Blocked drainage canal", area: "Purok 4",
      description: "Leaves and debris are blocking part of the canal along the residential lane.",
      urgent: false, status: "Under Review", submittedAt: "2026-10-26T09:05:00",
      updatedAt: "2026-10-29T11:00:00", photos: [],
      history: [
        { status: "Submitted", at: "2026-10-26T09:05:00", note: "Report received." },
        { status: "Under Review", at: "2026-10-29T11:00:00", note: "The reported location is being checked." },
      ],
    },
    {
      id: "RPT-2026-042", userEmail: "jose.garcia@community.demo", name: "Jose Garcia",
      category: "Other community concern", title: "Stray animals near the school", area: "Purok 1",
      description: "Several stray animals were seen near the school entrance during dismissal time.",
      urgent: false, status: "Resolved", submittedAt: "2026-10-25T07:55:00",
      updatedAt: "2026-10-28T14:10:00", photos: [],
      history: [
        { status: "Submitted", at: "2026-10-25T07:55:00", note: "Report received." },
        { status: "Under Review", at: "2026-10-26T08:30:00", note: "The location is being checked." },
        { status: "Resolved", at: "2026-10-28T14:10:00", note: "The concern was referred to the appropriate local service." },
      ],
    },
    {
      id: "RPT-2026-041", userEmail: DEMO_USERS[0].email, name: "Juan Dela Cruz",
      category: "Missed garbage collection", title: "Missed recyclable collection", area: "Purok 3",
      description: "The scheduled recyclable collection did not pass through our lane on the posted date.",
      urgent: false, status: "In Progress", submittedAt: "2026-10-23T09:18:00",
      updatedAt: "2026-10-28T07:45:00", photos: [],
      history: [
        { status: "Submitted", at: "2026-10-23T09:18:00", note: "Report received." },
        { status: "Under Review", at: "2026-10-24T08:20:00", note: "The route schedule is being checked." },
        { status: "In Progress", at: "2026-10-28T07:45:00", note: "The collection team is reviewing the missed stop." },
      ],
    },
    {
      id: "RPT-2026-019", userEmail: DEMO_USERS[0].email, name: "Juan Dela Cruz",
      category: "Road damage", title: "Road repair follow-up", area: "Purok 3",
      description: "A small damaged section of the residential road was reported and repaired.",
      urgent: false, status: "Resolved", submittedAt: "2026-09-24T08:00:00",
      updatedAt: "2026-10-03T13:10:00", photos: [],
      history: [
        { status: "Submitted", at: "2026-09-24T08:00:00", note: "Report received." },
        { status: "Under Review", at: "2026-09-26T10:00:00", note: "The road condition was checked." },
        { status: "In Progress", at: "2026-09-29T09:30:00", note: "The repair was scheduled." },
        { status: "Resolved", at: "2026-10-03T13:10:00", note: "The reported road section was repaired." },
      ],
    },
  ];

  const schedules = [
    { id: "GCS-2026-014", area: "Purok 3", zone: "Zone A", date: "2026-10-30", wasteType: "Recyclables", start: "6:00 AM", end: "9:00 AM", frequency: "Weekly", team: "Team A · Truck 01", status: "On the way" },
    { id: "GCS-2026-013", area: "Purok 2", zone: "Zone B", date: "2026-10-31", wasteType: "Special waste", start: "8:00 AM", end: "12:00 PM", frequency: "Monthly", team: "Team B · Truck 02", status: "Scheduled" },
    { id: "GCS-2026-012", area: "Purok 1", zone: "Zone C", date: "2026-11-02", wasteType: "Biodegradable", start: "6:00 AM", end: "9:00 AM", frequency: "Weekly", team: "Team C · Truck 03", status: "Scheduled" },
    { id: "GCS-2026-011", area: "Purok 4", zone: "Zone D", date: "2026-11-04", wasteType: "Non-biodegradable", start: "6:00 AM", end: "9:00 AM", frequency: "Weekly", team: "Team D · Truck 04", status: "Scheduled" },
    { id: "GCS-2026-010", area: "Purok 5", zone: "Zone E", date: "2026-11-06", wasteType: "Recyclables", start: "7:00 AM", end: "10:00 AM", frequency: "Bi-weekly", team: "Team A · Truck 05", status: "Scheduled" },
    { id: "GCS-2026-009", area: "Main Road", zone: "Zone F", date: "2026-11-07", wasteType: "Special waste", start: "8:00 AM", end: "12:00 PM", frequency: "Monthly", team: "Team B · Truck 06", status: "Scheduled" },
  ];

  const notifications = [
    { id: idFor("N"), targetEmail: DEMO_USERS[0].email, title: "Collection is on the way", body: "The collection team has started the Zone A route for Purok 3.", createdAt: "2026-10-30T08:30:00", read: false },
    { id: idFor("N"), targetEmail: DEMO_USERS[0].email, reportId: "RPT-2026-048", title: "Concern received", body: "Your report about flooding on Mabini Street is now on file.", createdAt: "2026-10-30T08:42:00", read: false },
    { id: idFor("N"), targetEmail: DEMO_USERS[0].email, reportId: "RPT-2026-045", title: "Report in progress", body: "The maintenance team is checking the streetlight near Purok 3.", createdAt: "2026-10-29T10:15:00", read: true },
    { id: idFor("N"), targetEmail: DEMO_USERS[1].email, title: "Urgent concern: Flooding on Mabini Street", body: "A resident submitted an urgent hazard report for Purok 3.", createdAt: "2026-10-30T08:42:00", read: false, reportId: "RPT-2026-048" },
    { id: idFor("N"), targetEmail: DEMO_USERS[1].email, title: "New concern reported", body: "Illegal waste disposal was reported in Purok 5.", createdAt: "2026-10-30T08:10:00", read: false, reportId: "RPT-2026-047" },
    { id: idFor("N"), targetEmail: DEMO_USERS[2].email, title: "Resident account registered", body: "Six resident and two official sample accounts are available in this workspace.", createdAt: "2026-10-30T07:00:00", read: false },
  ];

  const activities = [
    { id: idFor("A"), actor: "Maria Santos", role: "official", action: "Reviewed urgent concern", detail: "RPT-2026-046 · Road obstruction on Rizal Street", at: "2026-10-30T07:30:00", result: "Success" },
    { id: idFor("A"), actor: "Maria Santos", role: "official", action: "Updated collection status", detail: "GCS-2026-014 · Purok 3", at: "2026-10-30T06:35:00", result: "Success" },
    { id: idFor("A"), actor: "Community administrator", role: "administrator", action: "Signed in", detail: "Administrator workspace", at: "2026-10-30T06:10:00", result: "Success" },
    { id: idFor("A"), actor: "Ana Reyes", role: "resident", action: "Submitted a concern", detail: "RPT-2026-047 · Illegal waste disposal", at: "2026-10-30T08:10:00", result: "Success" },
  ];

  const permissions = {
    resident: { submitReports: true, viewSchedules: true, manageReports: false, manageSchedules: false, manageUsers: false, manageRoles: false, viewAudit: false },
    official: { submitReports: false, viewSchedules: true, manageReports: true, manageSchedules: true, manageUsers: false, manageRoles: false, viewAudit: false },
    administrator: { submitReports: false, viewSchedules: true, manageReports: true, manageSchedules: true, manageUsers: true, manageRoles: true, viewAudit: true },
  };

  return {
    version: 1,
    users: residents,
    reports,
    schedules,
    notifications,
    activities,
    permissions,
    announcements: [
      { title: "Barangay clean-up drive", detail: "Saturday, October 31 · 7:00 AM · Barangay covered court", date: "2026-10-31" },
      { title: "Free medical consultation", detail: "November 3 · 8:00 AM–12:00 PM · Health center", date: "2026-11-03" },
    ],
  };
}

function localSave() {
  try {
    const snapshot = JSON.stringify(data);
    localStorage.setItem(DATA_KEY, snapshot);
    lastPersistedSnapshot = snapshot;
    return true;
  } catch (error) {
    console.error("CommUnity could not save demonstration data.", error);
    if (lastPersistedSnapshot) {
      data = JSON.parse(lastPersistedSnapshot);
      currentUser = userFromSession();
    }
    toast("This change could not be saved in this browser. Free up local storage and try again.", "error");
    return false;
  }
}

function loadLocalData() {
  const saved = localStorage.getItem(DATA_KEY);
  if (!saved) {
    data = seedData();
    return true;
  }
  try {
    const parsed = JSON.parse(saved);
    if (parsed.version !== 1 || !Array.isArray(parsed.users) || !Array.isArray(parsed.reports) || !Array.isArray(parsed.schedules)) {
      throw new Error("The saved data does not match this prototype version.");
    }
    data = parsed;
    data.notifications ||= [];
    data.activities ||= [];
    data.permissions ||= seedData().permissions;
    data.announcements ||= [];
    lastPersistedSnapshot = saved;
    return true;
  } catch (error) {
    console.error("CommUnity could not read its saved demonstration data.", error);
    app.innerHTML = `<main class="fatal-screen">${brandMark()}<h1>Saved data could not be opened</h1><p>${esc(error.message)} Reset the local demonstration data to continue.</p><button class="button" type="button" data-action="reset-corrupt">Reset demonstration data</button></main>`;
    return false;
  }
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newSalt() {
  if (!globalThis.crypto?.subtle) throw new Error("Secure browser password tools are unavailable. Open this site in a current browser over localhost.");
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function passwordDigest(password, saltHex) {
  if (!globalThis.crypto?.subtle) throw new Error("Secure browser password tools are unavailable. Open this site in a current browser over localhost.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], (part) => Number.parseInt(part, 16));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  return bytesToHex(bits);
}

async function setPassword(account, password) {
  account.passwordSalt = newSalt();
  account.passwordDigest = await passwordDigest(password, account.passwordSalt);
}

async function verifyPassword(account, password) {
  if (!account?.passwordSalt || !account?.passwordDigest) return false;
  const digest = await passwordDigest(password, account.passwordSalt);
  return digest === account.passwordDigest;
}

function toast(message, kind = "") {
  toastEl.textContent = message;
  toastEl.dataset.kind = kind;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 3400);
}

function currentPath() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
}

function userFromSession() {
  const remembered = localStorage.getItem(SESSION_KEY);
  const tabSession = sessionStorage.getItem(SESSION_KEY);
  const email = remembered || tabSession;
  return data.users.find((user) => user.email === email && user.status === "Active") || null;
}

function setSession(user, remember) {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  const store = remember ? localStorage : sessionStorage;
  store.setItem(SESSION_KEY, user.email);
  currentUser = user;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  currentUser = null;
  selectedReportId = null;
  reportDraft = null;
  uploadPhotos = [];
  document.documentElement.dataset.theme = "auth";
}

function unreadCount(user = currentUser) {
  if (!user || !data.notifications) return 0;
  return data.notifications.filter((item) => item.targetEmail === user.email && !item.read).length;
}

function addActivity(action, detail, result = "Success") {
  data.activities.unshift({
    id: idFor("A"),
    actor: currentUser?.name || "Resident",
    role: currentUser?.role || "resident",
    action,
    detail,
    at: new Date().toISOString(),
    result,
  });
  data.activities = data.activities.slice(0, 200);
}

function addNotification(targetEmail, title, body, reportId = "") {
  data.notifications.unshift({
    id: idFor("N"),
    targetEmail,
    title,
    body,
    reportId,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

function addRoleNotification(role, title, body, reportId = "") {
  data.users.filter((user) => user.role === role && user.status === "Active")
    .forEach((user) => addNotification(user.email, title, body, reportId));
}

function getUser(email) {
  return data.users.find((user) => user.email === email);
}

function getReport(id) {
  return data.reports.find((report) => report.id === id);
}

function userReports(user = currentUser) {
  return data.reports.filter((report) => report.userEmail === user?.email);
}

function sortedReports(reports = data.reports) {
  return [...reports].sort((a, b) => asDate(b.submittedAt) - asDate(a.submittedAt));
}

function sortedSchedules(schedules = data.schedules) {
  return [...schedules].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

function sortedNotifications(items = data.notifications || []) {
  return [...items].sort((a, b) => asDate(b.createdAt) - asDate(a.createdAt));
}

function selectedAreaFor(user = currentUser) {
  return user?.area || "Balete, Batangas";
}

function routeUrl(role, page) {
  return `#/${role}/${page}`;
}

function linkButton(label, href, variant = "secondary", extra = "") {
  return `<a class="button ${variant} ${extra}" href="${esc(href)}">${label}</a>`;
}

function actionButton(label, action, variant = "secondary", extra = "", attrs = "") {
  return `<button class="button ${variant} ${extra}" type="button" data-action="${esc(action)}" ${attrs}>${label}</button>`;
}

function selectOptions(items, selected, labels = {}) {
  return items.map((item) => `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(labels[item] || item)}</option>`).join("");
}

function inputField(label, name, value = "", options = {}) {
  const id = options.id || name;
  const type = options.type || "text";
  const required = options.required ? "required" : "";
  const placeholder = options.placeholder ? `placeholder="${esc(options.placeholder)}"` : "";
  const help = options.help ? `<span class="field-help" id="${esc(id)}-help">${esc(options.help)}</span>` : "";
  const describedBy = options.help ? `aria-describedby="${esc(id)}-help"` : "";
  const readonly = options.readonly ? "readonly" : "";
  return `<div class="form-field"><label for="${esc(id)}">${esc(label)}${options.required ? " *" : ""}</label><input class="input" id="${esc(id)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${placeholder} ${required} ${describedBy} ${readonly} ${options.minLength ? `minlength="${options.minLength}"` : ""} ${options.autocomplete ? `autocomplete="${esc(options.autocomplete)}"` : ""}></div>`;
}

function selectField(label, name, items, selected, options = {}) {
  const labelMap = options.labels || {};
  const required = options.required ? "required" : "";
  const help = options.help ? `<span class="field-help" id="${esc(name)}-help">${esc(options.help)}</span>` : "";
  return `<div class="form-field"><label for="${esc(name)}">${esc(label)}${options.required ? " *" : ""}</label><select class="select" id="${esc(name)}" name="${esc(name)}" ${required} ${options.help ? `aria-describedby="${esc(name)}-help"` : ""}>${options.placeholder ? `<option value="">${esc(options.placeholder)}</option>` : ""}${items.map((item) => `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(labelMap[item] || item)}</option>`).join("")}</select>${help}</div>`;
}
