"use strict";

import { icon, sortedSchedules, data, todayISO, actionButton } from "../../core.mjs";
import { page, panel, scheduleRows, stat, statsStrip } from "../shared.mjs";

export function collectionOfficial() {
  const schedules = sortedSchedules(data.schedules);
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat(
          "Upcoming collections",
          schedules.filter((item) => item.date >= todayISO() && !["Cancelled", "Completed"].includes(item.status)).length,
          "",
          "",
          "calendar",
        ),
        stat("Completed", schedules.filter((item) => item.status === "Completed").length, "", "success", "check"),
        stat("Cancelled", schedules.filter((item) => item.status === "Cancelled").length, "", "danger", "close"),
        stat("Collection areas", new Set(schedules.map((item) => item.area)).size, "", "", "pin"),
      ])}
      ${panel("Collection schedules", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search schedules</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search schedules..."></label></div>${scheduleRows(schedules, true)}`, { action: actionButton(`${icon("plus")} Add schedule`, "add-schedule", "small") })}
    </div>`;
  return page("official", "collection", body);
}
