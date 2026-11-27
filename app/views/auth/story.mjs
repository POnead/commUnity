"use strict";

import { brandMark } from "../../core.mjs";

export function authStory() {
  return `
      <section class="auth-story" aria-label="About CommUnity">
        <div class="auth-story-inner">
          ${brandMark()}
          <div class="auth-wordmark"><strong>CommUnity</strong><span class="auth-brand-rule" aria-hidden="true"></span><span>Palsara community desk</span></div>
          <p class="auth-copy">Community announcements, concern tracking and barangay services — all in one place.</p>
        </div>
        <p class="auth-place"><span class="auth-place-dot" aria-hidden="true"></span>Barangay Palsara · Balete, Batangas</p>
      </section>`;
}
