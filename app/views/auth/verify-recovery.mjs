"use strict";

import { esc } from "../../core.mjs";
import { authStory } from "./story.mjs";

export function verifyRecoveryMarkup(token) {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="verify-title"><div class="login-box">
        <h1 id="verify-title">Verify recovery email</h1>
        <p class="field-help">Confirm this email address so CommUnity can send password reset links to it.</p>
        <form class="login-form" id="verify-recovery-form">
          <input type="hidden" name="token" value="${esc(token)}">
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Verify email</button></div>
        </form>
      </div></section>
    </main>`;
}
