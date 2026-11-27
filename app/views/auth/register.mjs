"use strict";

import { residentAreaOptions, inputField, selectField } from "../../core.mjs";
import { authStory } from "./story.mjs";

export function registerMarkup() {
  const areaOptions = residentAreaOptions();
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="register-title"><div class="register-box">
        <h1 id="register-title">Create a resident account</h1>
        <form class="form-stack" id="register-form">
          <div class="form-grid">${inputField("Full name", "name", "", { required: true, autocomplete: "name" })}${inputField("Email address", "email", "", { required: true, type: "email", autocomplete: "email" })}${inputField("Contact number", "phone", "", { type: "tel", autocomplete: "tel" })}${selectField("Purok or area", "area", areaOptions, "", { required: true, placeholder: "Choose your purok or area" })}${inputField("Password", "password", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}${inputField("Confirm password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}</div>
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Create account</button></div>
        </form>
      </div></section>
    </main>`;
}
