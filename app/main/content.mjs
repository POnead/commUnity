"use strict";

import {
  appDateParts,
  calendarEventFromForm,
  calendarEventFromRecord,
  confirmAction,
  currentUser,
  data,
  readOptionalCoordinate,
  routeUrl,
  setState,
  sortedSchedules,
  toast,
  todayISO,
} from "../core.mjs";
import { announcementMap, setMapState } from "../map.mjs";
import { render } from "./render.mjs";

export let lastCalendarClick = { date: "", at: 0 };
export const HOTLINES_LINK = `<a class="text-button" href="${routeUrl("resident", "hotlines")}">Barangay hotlines</a>`;

// Edits keep their original publish date; only new announcements must be dated today or later.
export function announcementDateAllowed(date, id) {
  return Boolean(id) || date >= todayISO();
}

export async function saveAnnouncement(form) {
  const id = String(form.get("id") || "");
  const isEvent = Boolean(form.get("isEvent"));
  let latitude = readOptionalCoordinate(form.get("latitude"));
  let longitude = readOptionalCoordinate(form.get("longitude"));
  if (isEvent) {
    if (
      latitude === null ||
      longitude === null ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error("Place a pin or enter valid coordinates for this event, or turn off the event option.");
    }
  } else {
    latitude = null;
    longitude = null;
  }
  const body = {
    title: String(form.get("title") || "").trim(),
    date: String(form.get("date") || ""),
    detail: String(form.get("detail") || "").trim(),
    isEvent,
    latitude,
    longitude,
  };
  if (!body.title || !body.date || !body.detail) throw new Error("Enter an announcement title, date, and message.");
  if (!announcementDateAllowed(body.date, id)) throw new Error("Announcements cannot be published before today.");
  const needsApproval = currentUser.role === "official";
  const confirmed = await confirmAction({
    title: id
      ? needsApproval
        ? "Resubmit announcement for approval?"
        : "Save announcement?"
      : needsApproval
        ? "Send announcement for approval?"
        : "Publish announcement?",
    message: id
      ? needsApproval
        ? "Save these changes and send the announcement to an administrator for approval. Residents will see it after it is approved."
        : "Save changes to this announcement?"
      : needsApproval
        ? "Send this announcement to an administrator for approval. Residents will see it after it is approved."
        : "Publish this announcement? It will be visible to residents.",
    confirmLabel: needsApproval ? "Send for approval" : id ? "Save changes" : "Publish announcement",
  });
  if (!confirmed) return;
  const response = await fetch("/api/announcements", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(id ? { ...body, id } : body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The announcement could not be saved.");
  setMapState({ announcementMapExpanded: false });
  setMapState({ announcementMapSelection: null });
  announcementMap?.remove();
  setMapState({ announcementMap: null });
  setMapState({ announcementMapElement: null });
  setMapState({ announcementMapMarker: null });
  setState({ modalState: null });
  if (result.data) {
    setState({ data: result.data });
    if (result.revision) setState({ dataRevision: result.revision });
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
  }
  render();
  toast(
    needsApproval
      ? id
        ? "Announcement updated and sent for approval."
        : "Announcement sent for approval."
      : id
        ? "Announcement updated."
        : "Announcement published.",
    "success",
  );
}

export async function decideAnnouncement(id, status, reason = "") {
  const confirmed = await confirmAction({
    title: status === "declined" ? "Decline announcement?" : "Approve announcement?",
    message:
      status === "declined"
        ? "Decline this announcement and send the reason to the official?"
        : "Approve and publish this announcement to residents?",
    confirmLabel: status === "declined" ? "Decline announcement" : "Approve & publish",
    tone: status === "declined" ? "danger" : "primary",
  });
  if (!confirmed) return;
  const response = await fetch("/api/announcements/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The announcement decision could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(status === "declined" ? "Announcement declined." : "Announcement approved and published.", "success");
}

export async function saveHotline(form, published) {
  const id = String(form.get("id") || "");
  const body = {
    name: String(form.get("name") || "").trim(),
    category: String(form.get("category") || ""),
    contactNumber: String(form.get("contactNumber") || "").trim(),
    alternativeContactNumber: String(form.get("alternativeContactNumber") || "").trim(),
    officeAddress: String(form.get("officeAddress") || "").trim(),
    description: String(form.get("description") || "").trim(),
    operatingHours: String(form.get("operatingHours") || "").trim(),
    status: String(form.get("status") || "Active"),
    published: Boolean(published),
  };
  if (id) body.id = id;
  const confirmed = await confirmAction({
    title: published ? "Publish hotline?" : "Save as draft?",
    message: published
      ? "Published hotlines are visible to residents and officials."
      : "A draft stays hidden from residents and officials until you publish it.",
    confirmLabel: published ? "Publish hotline" : "Save draft",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The hotline could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(published ? (id ? "Hotline updated and published." : "Hotline published.") : "Draft saved.", "success");
}

export async function deleteHotline(id) {
  const item = (data.hotlines || []).find((hotline) => hotline.id === id);
  if (!item) throw new Error("This hotline could not be found.");
  const confirmed = await confirmAction({
    title: "Remove hotline?",
    message: `Remove “${item.name}” from the emergency directory? Residents will no longer see it.`,
    confirmLabel: "Remove hotline",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The hotline could not be removed.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  render();
  toast("Hotline removed.", "success");
}

export async function verifyHotline(id) {
  const item = (data.hotlines || []).find((hotline) => hotline.id === id);
  if (!item) throw new Error("This hotline could not be found.");
  const confirmed = await confirmAction({
    title: "Mark as verified?",
    message: `Confirm that “${item.name}” still answers on ${item.contactNumber}. The verification date is recorded now.`,
    confirmLabel: "Mark as verified",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The hotline could not be marked as verified.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  render();
  toast("Hotline marked as verified.", "success");
}

export async function submitHotlineCorrection(form) {
  const proposed = {
    contactNumber: String(form.get("contactNumber") || "").trim(),
    alternativeContactNumber: String(form.get("alternativeContactNumber") || "").trim(),
  };
  const confirmed = await confirmAction({
    title: "Submit correction?",
    message: "An administrator will review the corrected number before the directory is updated.",
    confirmLabel: "Submit correction",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "correction",
      hotlineId: String(form.get("hotlineId") || ""),
      proposed,
      reason: String(form.get("reason") || "").trim(),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The correction could not be submitted.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast("Correction submitted for administrator review.", "success");
}

export async function submitHotlineSuggestion(form) {
  const confirmed = await confirmAction({
    title: "Submit suggestion?",
    message: "An administrator will review this contact before adding it to the directory.",
    confirmLabel: "Submit suggestion",
  });
  if (!confirmed) return;
  const proposed = {
    name: String(form.get("name") || "").trim(),
    category: String(form.get("category") || ""),
    contactNumber: String(form.get("contactNumber") || "").trim(),
    alternativeContactNumber: String(form.get("alternativeContactNumber") || "").trim(),
    officeAddress: String(form.get("officeAddress") || "").trim(),
    operatingHours: String(form.get("operatingHours") || "").trim(),
    description: String(form.get("description") || "").trim(),
  };
  const file = form.get("supportingFile");
  const hasFile = file && typeof file !== "string" && file.size > 0;
  let response;
  if (hasFile) {
    const body = new FormData();
    body.append("kind", "suggestion");
    body.append("proposed", JSON.stringify(proposed));
    body.append("supportingFile", file, file.name);
    response = await fetch("/api/hotlines/corrections", { method: "POST", body });
  } else {
    response = await fetch("/api/hotlines/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "suggestion", proposed }),
    });
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The suggestion could not be submitted.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast("Contact suggestion submitted for review.", "success");
}

export async function reviewHotlineCorrection(form) {
  const decision = String(form.get("decision") || "");
  const response = await fetch("/api/hotlines/corrections/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: String(form.get("id") || ""),
      decision,
      note: String(form.get("note") || "").trim(),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The correction decision could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(decision === "rejected" ? "Correction rejected." : "Correction approved.", "success");
}

export async function copyHotline(number) {
  try {
    await navigator.clipboard.writeText(number);
    toast("Number copied.", "success");
  } catch {
    toast("Copy failed. Select the number and copy it manually.", "error");
  }
}

export async function saveCalendarEvent(form) {
  const body = calendarEventFromForm(form);
  if (!body.title || !body.date) throw new Error("Enter an event title and date.");
  if (body.date < todayISO()) throw new Error("Events cannot be scheduled before today.");
  const isAdmin = currentUser.role === "administrator";
  const confirmed = await confirmAction({
    title: isAdmin ? "Add calendar event?" : "Submit event request?",
    message: isAdmin
      ? `Add “${body.title}” to the community calendar on ${body.date}?`
      : `Submit “${body.title}” for administrator approval?`,
    confirmLabel: isAdmin ? "Add event" : "Submit request",
  });
  if (!confirmed) return;
  const response = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The calendar event could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ currentUser: result.user || currentUser });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  setState({ calendarSelectedDate: body.date });
  render();
  toast(currentUser.role === "administrator" ? "Event added to the calendar." : "Event request sent for approval.", "success");
}

export async function decideCalendarEvent(id, status, reason = "") {
  const confirmed = await confirmAction({
    title: status === "declined" ? "Reject event request?" : "Approve event?",
    message:
      status === "declined"
        ? "Reject this event request and send the reason to the official?"
        : "Approve this event and add it to the calendar?",
    confirmLabel: status === "declined" ? "Reject event" : "Approve event",
    tone: status === "declined" ? "danger" : "primary",
  });
  if (!confirmed) return;
  const response = await fetch("/api/calendar/events/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The event decision could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ currentUser: result.user || currentUser });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(
    status === "declined" ? "Event rejected and the reason sent to the official." : "Event approved and added to the calendar.",
    "success",
  );
}

export function calendarEventsForDate(dateStr) {
  if (!dateStr || !data) return [];
  const isResident = currentUser?.role === "resident";
  const schedules = isResident
    ? sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area)
    : sortedSchedules(data.schedules);
  const calendarEvents = (data.calendarEvents || []).map(calendarEventFromRecord);
  const activeEvents = calendarEvents.filter((event) => event.status !== "declined");
  const events = [
    ...data.announcements
      .filter((item) => item.approvalStatus === "approved")
      .map((item) => ({
        id: String(item.id),
        date: item.date,
        title: item.title,
        detail: item.detail,
        kind: "Announcement",
        status: item.approvalStatus,
        isEvent: Boolean(item.isEvent),
        latitude: item.latitude ?? null,
        longitude: item.longitude ?? null,
      })),
    ...schedules.map((item) => ({
      date: item.date,
      title: `${item.wasteType} collection`,
      detail: `${item.start}–${item.end} · ${item.area} · ${item.zone}`,
      kind: "Collection",
    })),
    ...activeEvents,
  ];
  return events.filter((event) => event.date === dateStr);
}

export function nextScheduleId(date, offset = 0) {
  const text = String(date || "");
  const year = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(0, 4) : String(appDateParts(date).year);
  const largest = data.schedules.reduce((value, schedule) => {
    const match = schedule.id.match(/-(\d+)$/);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `GCS-${year}-${String(largest + 1 + offset).padStart(3, "0")}`;
}

export function setLastCalendarClick(value) {
  lastCalendarClick = value;
}
