"use strict";

import { esc } from "../../core.mjs";
import { authStory } from "./story.mjs";

export function verifyEmailChangeMarkup(token) {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="verify-email-title"><div class="login-box">
        <h1 id="verify-email-title">Confirm new email</h1>
        <p class="field-help">Confirm that you own this address to change the email used to sign in to CommUnity.</p>
        <form class="login-form" id="verify-email-form">
          <input type="hidden" name="token" value="${esc(token)}">
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Confirm email</button></div>
        </form>
      </div></section>
    </main>`;
}
