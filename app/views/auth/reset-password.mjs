"use strict";

import { esc, inputField } from "../../core.mjs";
import { authStory } from "./story.mjs";

export function resetPasswordMarkup(token) {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="reset-title"><div class="login-box">
        <h1 id="reset-title">Reset password</h1>
        <p class="field-help">Enter your new password.</p>
        <form class="login-form" id="reset-password-form">
          <input type="hidden" name="token" value="${esc(token)}">
          ${inputField("New password", "newPassword", "", { required: true, type: "password", minLength: 8, autocomplete: "new-password" })}
          ${inputField("Confirm new password", "confirmPassword", "", { required: true, type: "password", minLength: 8, autocomplete: "new-password" })}
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Reset password</button></div>
        </form>
      </div></section>
    </main>`;
}
