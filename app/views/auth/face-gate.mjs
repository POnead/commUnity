"use strict";

import { currentUser } from "../../core.mjs";
import { faceCheckMarkup } from "../shared.mjs";
import { authStory } from "./story.mjs";

export function faceGateMarkup(enrolled, mode = "verify") {
  const enrolling = mode === "enroll" || !enrolled;
  const needsIntegrated = (currentUser?.idStatus || "unverified") !== "verified";
  return `
    <main class="login-page face-gate-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="face-gate-title">
        <div class="login-box face-gate-box">
          <p class="face-gate-eyebrow">Official security check</p>
          <h1 id="face-gate-title" tabindex="-1">Face verification</h1>
          <p class="face-gate-intro">${enrolling ? "New officials must add their face before they can use the workspace. Do not sign out until it is saved." : "One quick face check is required to open your official workspace."}</p>
          ${faceCheckMarkup(!enrolling, false, false)}
          ${needsIntegrated ? `<div class="face-gate-integrated"><p class="field-help">Officials confirm their identity with a valid ID and a live face match.</p><button class="button secondary" type="button" data-action="verify-id">Verify ID and face</button></div>` : ""}
          <div class="face-gate-links"><button class="text-button" type="button" data-action="face-gate-signout">Sign out</button><span aria-hidden="true">·</span><button class="text-button" type="button" data-action="face-gate-signout">Use a different account</button></div>
          <p class="face-gate-support">Camera not working? Contact your barangay administrator.</p>
        </div>
      </section>
    </main>`;
}
