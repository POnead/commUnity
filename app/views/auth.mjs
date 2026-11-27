"use strict";

import { residentAreaOptions, icon, brandMark, esc, inputField, selectField, currentUser } from "../core.mjs";
import { faceCheckMarkup } from "./shared.mjs";

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

function authStory() {
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
