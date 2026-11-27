"use strict";

import { currentUser } from "../../core.mjs";
import { page, panel, idVerificationPanel, faceCheckMarkup } from "../shared.mjs";

export function faceVerifyPage() {
  const enrolled = Boolean(currentUser.faceEnrolled);
  const needsIntegrated = !enrolled || (currentUser.idStatus || "unverified") !== "verified";
  const body = `<div class="content-stack">
    ${needsIntegrated ? idVerificationPanel(true) : ""}
    ${panel(enrolled ? "Face check" : "Enroll your face", faceCheckMarkup(enrolled), {
      icon: "shield",
      className: "face-check-panel",
      subtitle: "Official duty check",
    })}
  </div>`;
  return page("official", "verify", body);
}
