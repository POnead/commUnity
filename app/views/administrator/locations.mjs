"use strict";

import { icon, esc, data, actionButton } from "../../core.mjs";
import { page, panel } from "../shared.mjs";
import { locationMapExpanded } from "../../map.mjs";

export function locationsPage() {
  const locationRows = data.locations
    .map(
      (
        location,
      ) => `<div class="record-row filter-item" role="row" data-search="${esc(`${location.area} ${location.barangay} ${location.street} ${location.purok} ${location.landmark}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(location.purok || location.area)}</strong></div>
    <div class="record-meta" role="cell" data-label="Landmark">${esc(location.landmark || "—")}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-location" data-id="${esc(location.id)}">Edit</button></div>
  </div>`,
    )
    .join("");
  const body = `<div class="content-stack">
    ${panel(
      "Managed Locations",
      `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search purok or landmark</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search purok or landmark"></label></div>
      <div class="records mt-16" data-page-size="10" data-pagination-target="locations-pagination" role="table" aria-label="Community locations"><div class="record-row record-head location-record-head" role="row"><span role="columnheader">Purok</span><span role="columnheader">Landmark</span><span role="columnheader">Action</span></div>${locationRows || `<div class="empty-state"><strong>No locations configured</strong>Add an area before residents register or file reports.</div>`}</div>
      <div class="locations-footer"><div class="locations-footer-copy"><span><strong>${data.locations.length}</strong> ${data.locations.length === 1 ? "location" : "locations"}</span><button class="button secondary small" type="button" data-action="toggle-location-map" aria-expanded="${locationMapExpanded}">${icon("pin")} ${locationMapExpanded ? "Hide Barangay Map" : "View Barangay Map"} ${icon("arrow")}</button></div><div id="locations-pagination"></div></div>
      <section class="location-map-region" ${locationMapExpanded ? "" : "hidden"} aria-label="Barangay map"><div id="location-map" role="application" aria-label="Map of managed community locations"></div><p id="location-map-status" class="field-help">Administrator-selected pins mark saved locations. Unpinned legacy areas use approximate markers; no boundaries are inferred.</p></section>`,
      {
        subtitle: "Manage community areas and verified landmarks.",
        action: actionButton(`${icon("plus")} Add area`, "add-location", "small"),
      },
    )}
  </div>`;
  return page("administrator", "locations", body);
}
