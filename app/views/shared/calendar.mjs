"use strict";

import {
  asDate,
  calendarEventFromRecord,
  calendarMonth,
  calendarSelectedDate,
  calendarYear,
  currentUser,
  data,
  dateLabel,
  dateTimeLabel,
  esc,
  icon,
  sortedSchedules,
  statusPill,
  todayISO,
} from "../../core.mjs";
import { page, panel } from "./shell.mjs";

export function upcomingSchedule(area = currentUser.area) {
  return sortedSchedules(data.schedules).find(
    (schedule) =>
      (!area || schedule.area === area || currentUser.role !== "resident") &&
      schedule.date >= todayISO() &&
      !["Cancelled", "Completed"].includes(schedule.status),
  );
}

export function scheduleHistoryMarkup(history = []) {
  if (!history.length)
    return `<div class="empty-state"><strong>No status changes recorded</strong>Updates will appear here as the barangay works through this pickup.</div>`;
  return `<ol class="timeline">${[...history]
    .reverse()
    .map((item, index) => {
      const transition = item.previousStatus ? `${item.previousStatus} → ${item.status}` : item.status;
      const replacement =
        item.status === "Rescheduled" && item.replacementDate
          ? `<span>Replacement pickup: ${esc(dateLabel(item.replacementDate, { weekday: "long", month: "long", day: "numeric" }))}, ${esc(item.replacementStart || "")}–${esc(item.replacementEnd || "")}</span>`
          : "";
      return `<li class="timeline-item ${index === 0 ? "" : "future"}"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-copy"><strong>${esc(transition)}</strong>${replacement}<span>${esc(item.note || "Status updated.")}${item.actorName ? ` · By ${esc(item.actorName)}` : ""} · ${esc(dateTimeLabel(item.at))}</span></div></li>`;
    })
    .join("")}</ol>`;
}

export function scheduleRows(schedules, canEdit = false) {
  if (!schedules.length)
    return `<div class="empty-state"><strong>No collection schedules</strong>Schedules for this area will appear here when the barangay posts them.</div>`;
  if (!canEdit) {
    const residentRows = schedules
      .map(
        (
          schedule,
        ) => `<div class="record-row resident-collection-row filter-item" role="row" data-search="${esc(`${schedule.area} ${schedule.wasteType} ${schedule.date} ${schedule.status} ${schedule.frequency}`.toLowerCase())}">
          <div class="record-meta" role="cell" data-label="Area">${esc(schedule.area)}</div>
          <div class="record-meta" role="cell" data-label="Service"><strong class="record-primary">${esc(schedule.wasteType)}</strong></div>
          <div class="record-date" role="cell" data-label="Collection date">${esc(dateLabel(schedule.date))}<span class="record-secondary">${esc(dateLabel(schedule.date, { weekday: "long" }))}</span></div>
          <div class="record-meta" role="cell" data-label="Collection window">${esc(schedule.start)} – ${esc(schedule.end)}</div>
          <div role="cell" data-label="Status">${statusPill(schedule.status)}</div>
          <div class="record-meta" role="cell" data-label="Frequency">${esc(schedule.frequency || "Not specified")}</div>
        </div>`,
      )
      .join("");
    return `<div class="records resident-collection-records" data-page-size="10" role="table" aria-label="Collection schedule"><div class="record-row record-head" role="row">${["Area", "Service", "Collection Date", "Collection Window", "Status", "Frequency"].map((header) => `<span role="columnheader">${header}</span>`).join("")}</div>${residentRows}</div>`;
  }
  return `<div class="records ${canEdit ? "official-schedule-records" : ""}" data-page-size="10" role="table" aria-label="Collection schedule">
    <div class="record-row record-head schedule-record-head" role="row"><span role="columnheader">Area</span><span role="columnheader">Service</span><span role="columnheader">Collection date</span><span role="columnheader">Collection window</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>
    ${schedules
      .map((schedule) => {
        const latest = (schedule.history || []).at(-1);
        const statusDetail =
          schedule.status === "Rescheduled" && latest?.replacementDate
            ? `<span class="record-secondary">Moved from ${esc(dateLabel(latest.previousDate || schedule.date))} to ${esc(dateLabel(latest.replacementDate))}</span>`
            : ["Delayed", "Cancelled"].includes(schedule.status) && latest?.note
              ? `<span class="record-secondary">${esc(latest.note)}</span>`
              : "";
        return `<div class="record-row schedule-record filter-item" role="row" data-search="${esc(`${schedule.id} ${schedule.area} ${schedule.zone} ${schedule.wasteType} ${schedule.status}`.toLowerCase())}">
      <div role="cell"><strong class="record-primary">${esc(schedule.area)}</strong><span class="record-secondary">${esc(schedule.zone)}</span></div>
      <div role="cell">${canEdit ? `<button class="text-button record-primary" type="button" data-action="view-schedule" data-id="${esc(schedule.id)}">${esc(schedule.wasteType)}</button>` : `<strong class="record-primary">${esc(schedule.wasteType)}</strong>`}<span class="record-secondary">${esc(schedule.frequency || "Not specified")}</span></div>
      <div class="record-date" role="cell" data-label="Collection date">${esc(dateLabel(schedule.date))}<span class="record-secondary">${esc(dateLabel(schedule.date, { weekday: "long" }))}</span></div>
      <div class="record-meta" role="cell" data-label="Collection window">${esc(schedule.start)} – ${esc(schedule.end)}<span class="record-secondary">${esc(schedule.team)}</span></div>
      <div role="cell" data-label="Status">${statusPill(schedule.status)}${statusDetail}</div>
      <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-schedule" data-id="${esc(schedule.id)}">Details</button>${canEdit ? `<button class="button secondary small" type="button" data-action="edit-schedule" data-id="${esc(schedule.id)}">Edit</button>` : `<span class="record-meta">${esc(schedule.frequency)}</span>`}</div>
    </div>`;
      })
      .join("")}</div>`;
}

export function calendarStatusLabel(status) {
  if (status === "pending") return "Pending approval";
  if (status === "declined") return "Declined";
  return "Approved";
}

export function calendarPage() {
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
  const byDate = new Map();
  for (const event of events) {
    if (!event.date) continue;
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const firstDay = new Date(calendarYear, calendarMonth, 1);
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const startWeekday = firstDay.getDay();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, date: dateStr, events: byDate.get(dateStr) || [] });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayISO();
  const grid = cells
    .map((cell) => {
      if (!cell) return `<div class="calendar-cell calendar-cell--blank" aria-hidden="true"></div>`;
      const hasEvents = cell.events.length > 0;
      const pending = cell.events.some((event) => event.status === "pending");
      const classes = [
        "calendar-cell",
        hasEvents ? "calendar-cell--has-events" : "",
        pending ? "calendar-cell--pending" : "",
        cell.date === today ? "calendar-cell--today" : "",
        cell.date === calendarSelectedDate ? "calendar-cell--selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const cellEvents = cell.events
        .slice(0, 2)
        .map(
          (event) =>
            `<span class="calendar-cell-event${event.status === "pending" ? " calendar-cell-event--pending" : ""}">${esc(event.title)}</span>`,
        )
        .join("");
      const more = cell.events.length > 2 ? `<span class="calendar-cell-more">+${cell.events.length - 2} more</span>` : "";
      const eventTitles = cell.events
        .slice(0, 2)
        .map((event) => event.title)
        .join(" ");
      const detailsHint = hasEvents
        ? `, ${cell.events.length} event${cell.events.length === 1 ? "" : "s"}; double-click to view details`
        : "";
      const viewHint = hasEvents
        ? `<span class="calendar-cell-view" aria-hidden="true" title="Double-click to view event details">${icon("arrow", "calendar-cell-view-icon")}</span>`
        : "";
      return `<button type="button" class="${classes}" data-action="calendar-day" data-date="${esc(cell.date)}" aria-label="${esc(hasEvents ? `${cell.day} ${eventTitles} - ${dateLabel(cell.date, { weekday: "long", month: "long", day: "numeric" })}${detailsHint}` : dateLabel(cell.date, { weekday: "long", month: "long", day: "numeric" }))}"><span class="calendar-day-number" aria-hidden="true">${cell.day}</span>${hasEvents ? ` <span class="calendar-cell-events" aria-hidden="true">${cellEvents}${more}</span>` : ""}${viewHint}</button>`;
    })
    .join("");

  const eventMeta = (event) =>
    event.kind === "Event"
      ? `<div class="calendar-event-meta">${statusPill(calendarStatusLabel(event.status))}${event.createdByName ? `<span>Requested by ${esc(event.createdByName)}</span>` : ""}</div>`
      : event.kind === "Announcement" && event.isEvent
        ? `<div class="calendar-event-meta">${announcementEventMarkup(event)}</div>`
        : "";

  const selectedEvents = calendarSelectedDate ? byDate.get(calendarSelectedDate) || [] : [];
  const details = calendarSelectedDate
    ? `<div class="calendar-details"><div class="calendar-details-head"><h3>${esc(dateLabel(calendarSelectedDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</h3></div>${selectedEvents.length ? selectedEvents.map((event) => `<div class="calendar-event"><div class="calendar-date"><strong>${esc(event.kind)}</strong></div><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p>${eventMeta(event)}</div></div>`).join("") : `<div class="empty-state"><strong>No events</strong>Nothing is scheduled on this date.</div>`}</div>`
    : `<div class="calendar-details"><p class="muted small">Select a date to see event details.</p></div>`;

  const upcoming = activeEvents
    .concat(
      data.announcements
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
      schedules.map((item) => ({
        date: item.date,
        title: `${item.wasteType} collection`,
        detail: `${item.start}–${item.end} · ${item.area}`,
        kind: "Collection",
        status: "approved",
      })),
    )
    .filter((event) => event.date && event.date >= today)
    .sort((a, b) => asDate(a.date) - asDate(b.date))
    .slice(0, 10);
  const upcomingList = upcoming.length
    ? upcoming
        .map(
          (event) =>
            `<article class="calendar-event"><div class="calendar-date"><strong>${esc(dateLabel(event.date, { day: "numeric", month: "short" }))}</strong><span>${esc(event.kind)}</span></div><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p>${eventMeta(event)}</div></article>`,
        )
        .join("")
    : `<div class="empty-state"><strong>No upcoming events</strong>Announcements and collection schedules will appear here.</div>`;

  const myRequests = calendarEvents.filter((event) => event.status !== "approved" && event.createdBy === currentUser?.id);
  const requestRow = (event) =>
    `<article class="calendar-request"><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p><span class="record-secondary">${esc(dateLabel(event.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}${event.createdByName ? ` · Requested by ${esc(event.createdByName)}` : ""}</span>${event.status === "declined" && event.declineReason ? `<span class="calendar-event-reason">Reason: ${esc(event.declineReason)}</span>` : ""}</div>${statusPill(calendarStatusLabel(event.status))}</article>`;
  const requestsPanel =
    currentUser?.role === "official"
      ? panel(
          "Your event requests",
          myRequests.length
            ? `<div class="calendar-requests">${myRequests.map(requestRow).join("")}</div>`
            : `<div class="empty-state"><strong>No requests yet</strong>Events you request appear here until the administrator reviews them.</div>`,
        )
      : "";

  const body = `
    <div class="content-stack ${isResident ? "resident-calendar-page" : ""}">
      <div class="calendar-toolbar">
        <button type="button" class="button secondary small" data-action="calendar-prev" aria-label="Previous month"><span aria-hidden="true">‹</span></button>
        <h2 class="calendar-month-title">${esc(monthNames[calendarMonth])} ${calendarYear}</h2>
        <button type="button" class="button secondary small" data-action="calendar-next" aria-label="Next month"><span aria-hidden="true">›</span></button>
      </div>
      <div class="calendar-grid" aria-label="Calendar">
        <div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-weekday">${day}</div>`).join("")}</div>
        <div class="calendar-days">${grid}</div>
      </div>
      ${details}
      ${requestsPanel}
      <section class="calendar-upcoming">
        <h3>Upcoming events</h3>
        <div class="calendar-list">${upcomingList}</div>
      </section>
    </div>`;
  return page(currentUser?.role || "resident", "calendar", body);
}

export function announcementEventMarkup(item) {
  if (!item?.isEvent) return "";
  const hasPin = Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
  if (!hasPin) return `<span class="approval-tag">Event</span>`;
  return `<span class="approval-tag">Event</span><button class="text-button" type="button" data-action="view-announcement-location" data-id="${esc(item.id)}">View event location</button>`;
}

export function scheduleDescription(schedule) {
  const service = String(schedule?.wasteType || "Waste").trim();
  const where = [schedule?.area, schedule?.zone].filter(Boolean).join(", ");
  const team = String(schedule?.team || "").trim();
  const parts = [`${service} collection`];
  if (where) parts.push(`in ${where}`);
  if (team) parts.push(`by ${team}`);
  return `${parts.join(" ")}.`;
}
