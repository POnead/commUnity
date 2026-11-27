"use strict";

import { icon, esc, dateLabel, statusPill, sortedSchedules, data, currentUser } from "../../core.mjs";
import { page, panel, upcomingSchedule, scheduleRows, scheduleDescription } from "../shared.mjs";

export function collectionResident() {
  const schedules = sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area);
  const next = upcomingSchedule(currentUser.area);
  const nextNote = next && ["Delayed", "Cancelled"].includes(next.status) ? (next.history || []).at(-1)?.note : "";
  const body = `
    <div class="content-stack resident-collection-page">
      ${panel("Your next collection", next ? `<div class="resident-next-collection"><div class="resident-collection-date"><span class="resident-collection-icon">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.start)} – ${esc(next.end)}</span><p class="resident-collection-description">${esc(scheduleDescription(next))}</p></div></div><div class="resident-collection-meta"><span>${icon("activity")}<strong>${esc(next.wasteType)}</strong></span><span>${icon("pin")}<strong>${esc(next.area)}${next.zone ? ` · ${esc(next.zone)}` : ""}</strong></span><span>${icon("users")}<strong>${esc(next.team || "Team not listed")}</strong></span></div><div class="resident-collection-status">${statusPill(next.status)}${nextNote ? `<span>${esc(nextNote)}</span>` : ""}</div></div>` : `<div class="empty-state"><strong>No upcoming collection posted</strong>Your barangay will appear here when a schedule is available.</div>`, { icon: "calendar", className: "resident-collection-feature" })}
      ${panel("Collection schedule", scheduleRows(schedules), { icon: "calendar", subtitle: "Collections scheduled for your selected area", className: "resident-collection-table-panel" })}
    </div>`;
  return page("resident", "collection", body);
}
