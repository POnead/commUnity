"use strict";

import { inputField } from "../../core.mjs";
import { authStory } from "./story.mjs";

export function forgotPasswordMarkup() {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="forgot-title"><div class="login-box">
        <h1 id="forgot-title">Forgot password</h1>
        <p class="field-help">Enter the recovery email tied to your account. If an account uses that recovery email and has confirmed it, a password reset link will be sent to it.</p>
        <form class="login-form" id="forgot-password-form">
          ${inputField("Recovery email", "recoveryEmail", "", { required: true, type: "email", autocomplete: "email" })}
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Send reset request</button></div>
        </form>
      </div></section>
    </main>`;
}
