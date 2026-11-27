"use strict";

import { icon, inputField } from "../../core.mjs";
import { authStory } from "./story.mjs";

export function loginMarkup() {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="login-title">
        <div class="login-box">
          <h1 id="login-title">Sign in to CommUnity</h1>
          <p class="field-help">Use your CommUnity account to continue to the barangay services portal.</p>
          <form class="login-form" id="login-form">
            ${inputField("Email address", "email", "", { required: true, type: "email", autocomplete: "username" })}
            <div class="form-field"><label for="password">Password</label><div class="password-field"><input class="input" id="password" name="password" type="password" required autocomplete="current-password"><button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password">${icon("eye")}</button></div></div>
            <div class="remember-line"><label><input type="checkbox" name="remember"> Keep me signed in on this device</label><button class="text-button" type="button" data-action="forgot-password">Forgot password?</button></div>
            <button class="button" type="submit">Sign in</button>
          </form>
          <p class="login-register">New to CommUnity? <a href="#/register">Create a resident account</a></p>
        </div>
      </section>
    </main>`;
}
