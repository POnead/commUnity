"use strict";

import { HOTLINES_LINK } from "./content.mjs";
import { palsaraLocationVerdict } from "../../shared/community-map.mjs";
import { app, confirmAction, data, icon, idFor, localSave, setState, toast } from "../core.mjs";
import { render } from "./render.mjs";

// Report-location gate state. The device fix is authoritative; a map pin only
// marks where the incident happened and can never authorise a submission.
export let reportLocationVerdict = { state: "prompt", accuracy: null, distanceToBoundary: null };
export let reportLocationPosition = null;
export let reportLocationGeneration = 0;
export let reportLocationPreviousState = null;
export let reportLocationCheckPromise = null;

export const LOCATION_BLOCKING_STATES = new Set(["outside", "uncertain", "denied", "unavailable"]);
export const LOCATION_GATE_COPY = {
  prompt: {
    icon: "pin",
    title: "Confirm you're in Palsara",
    detail: () => "We'll ask for your location once so we can confirm you're reporting from the barangay.",
    actions: '<button class="button" type="button" data-action="location-allow">Allow location</button>',
  },
  checking: {
    icon: '<span class="location-gate-spinner" aria-hidden="true"></span>',
    title: "Checking your location…",
    detail: () => "This takes a few seconds while your device finds a clear signal.",
    actions: "",
  },
  inside: {
    icon: "check",
    title: "Location confirmed — you're in Palsara",
    detail: (verdict) =>
      Number.isFinite(verdict.accuracy) && verdict.accuracy > 0
        ? `Accurate to about ${Math.round(verdict.accuracy)} m.`
        : "Your device confirmed you're in the barangay.",
    actions: '<button class="text-button" type="button" data-action="location-recheck">Refresh</button>',
  },
  outside: {
    icon: "close",
    title: "You're outside Palsara",
    detail: () => "Concerns can only be submitted from within the barangay. You can't submit this report from here.",
    actions: `<button class="button secondary" type="button" data-action="location-recheck">Try again</button>${HOTLINES_LINK}`,
  },
  uncertain: {
    icon: "alert",
    title: "We couldn't confirm your location precisely",
    detail: () => "Move away from the boundary or try again. We need a clearer signal before you can submit.",
    actions: '<button class="button secondary" type="button" data-action="location-recheck">Try again</button>',
  },
  denied: {
    icon: "settings",
    title: "Location access is blocked",
    detail: () => "Allow location for this site in your browser settings, then reload this page.",
    actions: `<button class="button secondary" type="button" data-action="location-reload">Reload page</button>${HOTLINES_LINK}`,
  },
  unavailable: {
    icon: "alert",
    title: "Location isn't available here",
    detail: () => "Reporting needs HTTPS and a browser with location support.",
    actions: HOTLINES_LINK,
  },
};

export function unavailableLocationVerdict() {
  return { state: "unavailable", accuracy: null, distanceToBoundary: null };
}

export function locationErrorVerdict(error) {
  return error?.code === 1
    ? { state: "denied", accuracy: null, distanceToBoundary: null }
    : { ...unavailableLocationVerdict(), code: error?.code };
}

export function secureLocationContext() {
  if (window?.isSecureContext) return true;
  const host = window?.location?.hostname || "";
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export async function readLocationPermission() {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status?.state || "unknown";
  } catch {
    return "unknown";
  }
}

// Keep the best (smallest accuracy) fix for up to 15s. A cold GPS fix can take
// much longer than the old 8s timeout, and a noisy point near the boundary
// would otherwise flip a resident from inside to outside unfairly.
export function requestDeviceLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ ...unavailableLocationVerdict(), position: null });
  }
  if (typeof navigator.geolocation.watchPosition !== "function") {
    return new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const coords = position?.coords || {};
            const fix = {
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracy: coords.accuracy,
              timestamp: position?.timestamp,
            };
            resolve({ ...palsaraLocationVerdict(fix), position: fix });
          },
          (error) => resolve({ ...locationErrorVerdict(error), position: null }),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
        );
      } catch (error) {
        resolve({ ...locationErrorVerdict(error), position: null });
      }
    });
  }
  return new Promise((resolve) => {
    let best = null;
    let watchId = null;
    let timer = null;
    let settled = false;
    let lastState = "";
    let steadyVerdictFrames = 0;
    const finish = (verdict, position) => {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      if (watchId != null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* watcher already gone */
        }
      }
      resolve({ ...verdict, position });
    };
    const evaluate = (position) => {
      const coords = position?.coords || {};
      const fix = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        timestamp: position?.timestamp,
      };
      if (!best || (Number.isFinite(fix.accuracy) && fix.accuracy < best.accuracy)) best = fix;
      const verdict = palsaraLocationVerdict(best);
      // One noisy fix near the boundary must not decide the gate. Wait for a few
      // consistent readings, or finish early on a clearly accurate inside fix.
      steadyVerdictFrames = verdict.state === lastState ? steadyVerdictFrames + 1 : 1;
      lastState = verdict.state;
      // A borderline fix is "uncertain" and needs more frames; a clear inside
      // or outside fix can decide at once.
      if (verdict.state !== "uncertain" || steadyVerdictFrames >= 4) finish(verdict, best);
    };
    try {
      watchId = navigator.geolocation.watchPosition(evaluate, (error) => finish(locationErrorVerdict(error), null), {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      });
    } catch (error) {
      finish(locationErrorVerdict(error), null);
      return;
    }
    timer = setTimeout(() => {
      if (best) finish(palsaraLocationVerdict(best), best);
      else finish(unavailableLocationVerdict(), null);
    }, 15000);
  });
}

export function renderLocationGate() {
  const card = app.querySelector("#report-location-gate");
  if (!card) return;
  const config = LOCATION_GATE_COPY[reportLocationVerdict.state] || LOCATION_GATE_COPY.prompt;
  card.dataset.state = reportLocationVerdict.state;
  card.setAttribute("aria-busy", String(reportLocationVerdict.state === "checking"));
  const chip = card.querySelector(".location-gate-chip");
  if (chip) chip.innerHTML = config.icon.includes("<") ? config.icon : icon(config.icon, "location-gate-icon");
  const title = card.querySelector("#report-location-title");
  if (title) title.textContent = config.title;
  const detail = card.querySelector("#report-location-detail");
  if (detail) detail.textContent = config.detail(reportLocationVerdict);
  const actions = card.querySelector("#report-location-actions");
  if (actions) actions.innerHTML = config.actions;
  const locked = reportLocationVerdict.state !== "inside";
  const submit = app.querySelector('[data-action="submit-report"]');
  if (submit) {
    submit.disabled = locked;
    if (locked) submit.setAttribute("aria-describedby", "report-location-detail");
    else submit.removeAttribute("aria-describedby");
  }
  const hint = app.querySelector("#report-location-submit-hint");
  if (hint) {
    hint.hidden = !locked;
    hint.dataset.state = reportLocationVerdict.state;
  }
}

export function applyLocationVerdict(verdict, position = null, options = {}) {
  const previous = reportLocationPreviousState;
  reportLocationVerdict = verdict;
  if (position) reportLocationPosition = position;
  reportLocationPreviousState = verdict.state;
  renderLocationGate();
  if (options.announce && LOCATION_BLOCKING_STATES.has(verdict.state) && verdict.state !== previous) {
    const alert = app.querySelector("#report-location-alert");
    if (alert) alert.textContent = LOCATION_GATE_COPY[verdict.state].detail(verdict);
    app.querySelector("#report-location-title")?.focus?.();
  }
}

export function resolveReportLocation(options = {}) {
  if (reportLocationCheckPromise && !options.force) return reportLocationCheckPromise;
  const generation = ++reportLocationGeneration;
  const promise = (async () => {
    const permission = await readLocationPermission();
    if (permission === "denied") {
      applyLocationVerdict({ state: "denied", accuracy: null, distanceToBoundary: null }, null, options);
      return;
    }
    if (!secureLocationContext() || typeof navigator === "undefined" || !navigator.geolocation) {
      applyLocationVerdict(unavailableLocationVerdict(), null, options);
      return;
    }
    if (permission === "prompt" && !options.userInitiated) {
      applyLocationVerdict({ state: "prompt", accuracy: null, distanceToBoundary: null }, null, options);
      return;
    }
    applyLocationVerdict({ state: "checking", accuracy: null, distanceToBoundary: null }, null, options);
    const result = await requestDeviceLocation();
    if (generation !== reportLocationGeneration) return;
    applyLocationVerdict(result, result.position, options);
  })().finally(() => {
    if (reportLocationCheckPromise === promise) reportLocationCheckPromise = null;
  });
  reportLocationCheckPromise = promise;
  return promise;
}

export async function saveLocation(form) {
  const id = String(form.get("id") || idFor("LOC"));
  const latitudeText = String(form.get("latitude") || "").trim();
  const longitudeText = String(form.get("longitude") || "").trim();
  const latitude = latitudeText ? Number(latitudeText) : NaN;
  const longitude = longitudeText ? Number(longitudeText) : NaN;
  if (
    !latitudeText ||
    !longitudeText ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Place a pin or enter valid latitude and longitude for this community location before saving.");
  }
  const record = {
    id,
    barangay: String(form.get("barangay") || "").trim(),
    purok: String(form.get("purok") || "").trim(),
    landmark: String(form.get("landmark") || "").trim(),
    latitude,
    longitude,
  };
  // A location's area label is its purok. Editing a purok keeps the stored area
  // label so accounts, reports, and schedules that point at it stay valid.
  const existing = data.locations.find((item) => item.id === id);
  record.area = existing ? existing.area : record.purok;
  record.street = existing?.street || "";
  if (!record.area || !record.barangay || !record.purok) throw new Error("Enter a barangay and purok.");
  if (data.locations.some((item) => item.area.toLowerCase() === record.area.toLowerCase() && item.id !== id)) {
    throw new Error("Another location already uses this purok.");
  }
  const confirmed = await confirmAction({
    title: existing ? "Save location?" : "Add location?",
    message: existing
      ? `Save changes to ${record.area}, including its map pin?`
      : `Add ${record.area} as a community location with the selected map pin?`,
    confirmLabel: existing ? "Save location" : "Add location",
  });
  if (!confirmed) return;
  if (existing) Object.assign(existing, record);
  else data.locations.push(record);
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast("Community location saved.", "success");
}

export async function saveRecyclingLocation(form) {
  const id = String(form.get("id") || idFor("REC"));
  const record = {
    id,
    name: String(form.get("name") || "").trim(),
    barangay: String(form.get("barangay") || "").trim(),
    street: String(form.get("street") || "").trim(),
    purok: String(form.get("purok") || "").trim(),
    landmark: String(form.get("landmark") || "").trim(),
    materials: String(form.get("materials") || "").trim(),
    phone: String(form.get("phone") || "").trim(),
    hours: String(form.get("hours") || "").trim(),
    active: Boolean(form.get("active")),
  };
  if (!record.name || !record.barangay || !record.street || !record.materials) {
    throw new Error("Enter the business name, barangay, street address, and accepted materials.");
  }
  const existing = data.recyclingLocations.find((item) => item.id === id);
  const confirmed = await confirmAction({
    title: existing ? "Save listing?" : "Add listing?",
    message: existing ? `Save changes to ${record.name}?` : `Add ${record.name} to the recycling directory?`,
    confirmLabel: existing ? "Save listing" : "Add listing",
  });
  if (!confirmed) return;
  if (existing) Object.assign(existing, record);
  else data.recyclingLocations.push(record);
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast("Recycling directory listing saved.", "success");
}
