"use strict";

import { data } from "../../core.mjs";
import { page, panel, hotlineCard, hotlineDirectoryToolbar } from "../shared.mjs";

export function residentHotlinesPage() {
  const hotlines = (data.hotlines || []).filter((item) => item.published);
  const body = `<div class="content-stack resident-hotlines-page">
    ${panel(
      "Emergency contacts",
      `${hotlineDirectoryToolbar()}<div class="hotline-grid mt-16" data-hotline-results>${hotlines.length ? hotlines.map((item) => hotlineCard(item, "resident")).join("") : `<div class="empty-state"><strong>No hotlines published yet</strong>Barangay staff will publish emergency contacts here.</div>`}</div><div class="empty-state hotline-no-results" hidden><strong>No matching hotlines</strong>Try a different name, number, or category.</div>`,
      {
        icon: "phone",
        subtitle: "Call the right office during an emergency. Numbers are checked by barangay staff.",
        className: "resident-hotlines-panel",
      },
    )}
  </div>`;
  return page("resident", "hotlines", body);
}
