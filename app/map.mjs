"use strict";
// Map pickers, pin rendering and embedded event maps. Owns all map state; main.mjs and
// views.mjs can render against these bindings and the map functions route writes through
// this module. Keeping map state here removes the tight coupling between form handlers
// and Leaflet that used to pervade main.mjs.
import { PALSARA_CENTER, PALSARA_BOUNDS, AREA_COORDINATES } from "./constants.mjs";
import { toast, app } from "./core.mjs";

let reportMapExpanded = false;
let reportMapSelection = null;
let reportMap = null;
let reportMapElement = null;
let reportMapMarker = null;
let reportMapGeoLocating = false;
let areaMapListenerAttached = false;
let reportDetailMap = null;
let reportDetailMapElement = null;
let announcementMapExpanded = false;
let announcementMapSelection = null;
let announcementMap = null;
let announcementMapElement = null;
let announcementMapMarker = null;
let announcementDetailMaps = [];
let announcementDetailMapElements = [];
let calendarEventMapExpanded = false;
let calendarEventMapSelection = null;
let calendarEventMap = null;
let calendarEventMapElement = null;
let calendarEventMapMarker = null;

// Community concern locations must be within this radius of Balete, Batangas.
const BALETE_CENTER = PALSARA_CENTER; // [14.01799, 121.09465]
const BALETE_NEAR_RADIUS_M = 2000; // 2 km

function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(a));
}

// Live bindings for templates and map actions.
export { reportMapExpanded, reportMapSelection, reportMapGeoLocating };
export { announcementMapExpanded, announcementMapSelection };
export { calendarEventMapExpanded, calendarEventMapSelection };
export { announcementDetailMaps, reportMapMarker, announcementMapMarker, calendarEventMapMarker };
export { reportMap, announcementMap, calendarEventMap };

// External writes must go through the hook (ES module exports are read-only
// bindings to the importing module).
export function setMapState(next = {}) {
  const handlers = {
    reportMapExpanded: (v) => (reportMapExpanded = v),
    reportMapSelection: (v) => (reportMapSelection = v),
    reportMapGeoLocating: (v) => (reportMapGeoLocating = v),
    reportMap: (v) => (reportMap = v),
    reportMapElement: (v) => (reportMapElement = v),
    reportMapMarker: (v) => (reportMapMarker = v),
    areaMapListenerAttached: (v) => (areaMapListenerAttached = v),
    reportDetailMap: (v) => (reportDetailMap = v),
    reportDetailMapElement: (v) => (reportDetailMapElement = v),
    announcementMapExpanded: (v) => (announcementMapExpanded = v),
    announcementMapSelection: (v) => (announcementMapSelection = v),
    announcementMap: (v) => (announcementMap = v),
    announcementMapElement: (v) => (announcementMapElement = v),
    announcementMapMarker: (v) => (announcementMapMarker = v),
    announcementDetailMaps: (v) => (announcementDetailMaps = v),
    announcementDetailMapElements: (v) => (announcementDetailMapElements = v),
    calendarEventMapExpanded: (v) => (calendarEventMapExpanded = v),
    calendarEventMapSelection: (v) => (calendarEventMapSelection = v),
    calendarEventMap: (v) => (calendarEventMap = v),
    calendarEventMapElement: (v) => (calendarEventMapElement = v),
    calendarEventMapMarker: (v) => (calendarEventMapMarker = v),
  };
  for (const [key, value] of Object.entries(next)) {
    if (!handlers[key]) throw new Error(`setMapState: unknown key "${key}"`);
    handlers[key](value);
  }
}

function setReportMapPin(position) {
  const { lat: latitude, lng: longitude } = position;
  reportMapSelection = { latitude, longitude };
  const latitudeField = app.querySelector("#report-latitude");
  const longitudeField = app.querySelector("#report-longitude");
  const status = app.querySelector("#report-map-status");
  const clearButton = app.querySelector('[data-action="clear-report-map-pin"]');
  if (latitudeField) latitudeField.value = String(latitude);
  if (longitudeField) longitudeField.value = String(longitude);
  if (clearButton) clearButton.hidden = false;
  if (status) status.textContent = `Pin selected at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}. Drag the pin to adjust it.`;
  if (!reportMapMarker) {
    reportMapMarker = window.L.marker([latitude, longitude], {
      draggable: true,
      title: "Reported concern location",
    }).addTo(reportMap);
    reportMapMarker.on("dragend", (event) => setReportMapPin(event.target.getLatLng()));
  } else {
    reportMapMarker.setLatLng([latitude, longitude]);
  }
  reportMap.panTo([latitude, longitude]);
}

async function useCurrentLocation() {
  if (!navigator.geolocation) {
    toast("Your browser does not support location services. Click the map to choose a location instead.", "error");
    return;
  }
  if (reportMapGeoLocating) return;
  reportMapGeoLocating = true;
  const toggle = app.querySelector('[data-action="use-current-location"]');
  const status = app.querySelector("#report-map-status");
  if (toggle) toggle.disabled = true;
  if (toggle) toggle.textContent = "Locating…";
  if (status) status.textContent = "Locating your current position…";
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });
    });
    const { latitude, longitude } = position.coords;
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error("Invalid location received.");
    }
    const distanceM = haversineDistanceM(latitude, longitude, BALETE_CENTER[0], BALETE_CENTER[1]);
    if (distanceM > BALETE_NEAR_RADIUS_M) {
      const km = Math.round(distanceM / 1000);
      const limitKm = Math.round(BALETE_NEAR_RADIUS_M / 1000);
      if (status) status.textContent = `Your location is ${km} km from Balete, Batangas — concern locations must be within ${limitKm} km.`;
      toast(`Location must be near Balete, Batangas. Yours is ${km} km away.`, "error");
      return;
    }
    setReportMapPin({ lat: latitude, lng: longitude });
    if (status) status.textContent = `Your location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}.`;
    toast("Your location was added to the map.", "success");
  } catch (error) {
    let message = "Could not determine your location.";
    if (error.code === 1) message = "Location access was denied. Click the map to choose a location instead.";
    else if (error.code === 2) message = "Location information is unavailable.";
    else if (error.code === 3) message = "Location request timed out. Click the map to choose a location instead.";
    toast(message, "error");
    if (status) status.textContent = message;
  } finally {
    reportMapGeoLocating = false;
    if (toggle) toggle.disabled = false;
    if (toggle) toggle.textContent = "Choose my current location";
  }
}

function centerMapOnArea(area) {
  const coords = AREA_COORDINATES[area];
  if (!coords || !reportMap) return;
  reportMap.setView(coords, 15);
  if (reportMapSelection) {
    reportMapMarker.setLatLng(coords);
    reportMapSelection = { latitude: coords[0], longitude: coords[1] };
    const latitudeField = app.querySelector("#report-latitude");
    const longitudeField = app.querySelector("#report-longitude");
    const status = app.querySelector("#report-map-status");
    if (latitudeField) latitudeField.value = String(coords[0]);
    if (longitudeField) longitudeField.value = String(coords[1]);
    const clearButton = clearMapButton();
    if (clearButton) clearButton.hidden = false;
    if (status) status.textContent = `Map centered on ${area}. Pin placed at ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}.`;
  } else {
    reportMap.panTo(coords);
  }
}

function clearMapButton() {
  return app.querySelector('[data-action="clear-report-map-pin"]');
}

function createTileLayer(map) {
  return window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  }).addTo(map);
}

function initializeReportMap() {
  const mapElement = app.querySelector("#report-map");
  if (!reportMapExpanded || !mapElement?.isConnected || !window.L) return;
  if (reportMapElement !== mapElement) {
    reportMap?.remove();
    reportMapElement = mapElement;
    reportMapMarker = null;
    reportMap = window.L.map(mapElement).setView(
      reportMapSelection ? [reportMapSelection.latitude, reportMapSelection.longitude] : PALSARA_CENTER,
      reportMapSelection ? 17 : 13,
    );
    reportMap.setMaxBounds(PALSARA_BOUNDS);
    reportMap.options.maxBoundsViscosity = 1.0;
    const tileLayer = createTileLayer(reportMap);
    tileLayer.on("tileerror", () => {
      const status = app.querySelector("#report-map-status");
      if (status) status.textContent = "Map tiles could not be loaded. Check your internet connection; you can still submit without a pin.";
    });
    reportMap.on("click", (event) => setReportMapPin(event.latlng));
    const areaSelect = app.querySelector("#area");
    if (areaSelect && areaMapListenerAttached !== areaSelect) {
      areaSelect.addEventListener("change", (event) => {
        if (reportMapExpanded) centerMapOnArea(event.target.value);
      });
      areaMapListenerAttached = areaSelect;
    }
  } else {
    reportMap.invalidateSize();
  }
  if (!reportMapSelection) {
    const areaSelect = app.querySelector("#area");
    const selectedArea = areaSelect ? areaSelect.value : null;
    if (selectedArea && AREA_COORDINATES[selectedArea]) {
      centerMapOnArea(selectedArea);
    } else {
      reportMap.setView(PALSARA_CENTER, 13);
    }
  } else {
    setReportMapPin({
      lat: reportMapSelection.latitude,
      lng: reportMapSelection.longitude,
    });
  }
}

function initializeReportDetailMap() {
  const mapElement = app.querySelector("#report-detail-map");
  if (!mapElement || !window.L) {
    reportDetailMap?.remove();
    reportDetailMap = null;
    reportDetailMapElement = null;
    if (mapElement) {
      const status = app.querySelector("#report-detail-map-status");
      if (status) status.textContent = "The interactive map is unavailable. Use the directions link to open this location.";
    }
    return;
  }
  if (reportDetailMapElement === mapElement) {
    reportDetailMap.invalidateSize();
    return;
  }

  reportDetailMap?.remove();
  reportDetailMap = null;
  reportDetailMapElement = mapElement;
  const latitude = Number(mapElement.dataset.latitude);
  const longitude = Number(mapElement.dataset.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    const status = app.querySelector("#report-detail-map-status");
    if (status) status.textContent = "This report's saved map coordinates are invalid.";
    reportDetailMapElement = null;
    return;
  }

  reportDetailMap = window.L.map(mapElement).setView([latitude, longitude], 17);
  const tileLayer = createTileLayer(reportDetailMap);
  const statusElement = app.querySelector("#report-detail-map-status");
  window.L.marker([latitude, longitude], {
    title: "Exact concern location",
    alt: "Exact concern location",
  }).addTo(reportDetailMap);
  tileLayer.on("tileerror", () => {
    if (statusElement)
      statusElement.textContent =
        "Map tiles could not be loaded. Check your internet connection; the saved pin and directions link are still available.";
  });
}

function setAnnouncementMapPin(position) {
  const { lat: latitude, lng: longitude } = position;
  announcementMapSelection = { latitude, longitude };
  const latitudeField = app.querySelector("#announcement-latitude");
  const longitudeField = app.querySelector("#announcement-longitude");
  const status = app.querySelector("#announcement-map-status");
  const clearButton = app.querySelector('[data-action="clear-announcement-map-pin"]');
  if (latitudeField) latitudeField.value = String(latitude);
  if (longitudeField) longitudeField.value = String(longitude);
  if (clearButton) clearButton.hidden = false;
  if (status) status.textContent = `Pin selected at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}. Drag the pin to adjust it.`;
  if (!announcementMap) return;
  if (!announcementMapMarker) {
    announcementMapMarker = window.L.marker([latitude, longitude], {
      draggable: true,
      title: "Event location",
    }).addTo(announcementMap);
    announcementMapMarker.on("dragend", (event) => setAnnouncementMapPin(event.target.getLatLng()));
  } else {
    announcementMapMarker.setLatLng([latitude, longitude]);
  }
  announcementMap.panTo([latitude, longitude]);
}

function initializeAnnouncementMap() {
  const mapElement = app.querySelector("#announcement-map");
  if (!announcementMapExpanded || !mapElement?.isConnected || !window.L) return;
  if (announcementMapElement !== mapElement) {
    announcementMap?.remove();
    announcementMapElement = mapElement;
    announcementMapMarker = null;
    announcementMap = window.L.map(mapElement).setView(
      announcementMapSelection ? [announcementMapSelection.latitude, announcementMapSelection.longitude] : [14.01799, 121.09465],
      announcementMapSelection ? 17 : 13,
    );
    const tileLayer = createTileLayer(announcementMap);
    tileLayer.on("tileerror", () => {
      const status = app.querySelector("#announcement-map-status");
      if (status)
        status.textContent = "Map tiles could not be loaded. Check your internet connection; you can still place the pin on the map.";
    });
    announcementMap.on("click", (event) => setAnnouncementMapPin(event.latlng));
  } else {
    announcementMap.invalidateSize();
  }
  if (announcementMapSelection) {
    setAnnouncementMapPin({
      lat: announcementMapSelection.latitude,
      lng: announcementMapSelection.longitude,
    });
  }
}

function setCalendarEventMapPin(position) {
  const { lat: latitude, lng: longitude } = position;
  calendarEventMapSelection = { latitude, longitude };
  const latitudeField = app.querySelector("#calendar-event-latitude");
  const longitudeField = app.querySelector("#calendar-event-longitude");
  const status = app.querySelector("#calendar-event-map-status");
  const clearButton = app.querySelector('[data-action="clear-calendar-event-map-pin"]');
  if (latitudeField) latitudeField.value = String(latitude);
  if (longitudeField) longitudeField.value = String(longitude);
  if (clearButton) clearButton.hidden = false;
  if (status) status.textContent = `Pin selected at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}. Drag the pin to adjust it.`;
  if (!calendarEventMap) return;
  if (!calendarEventMapMarker) {
    calendarEventMapMarker = window.L.marker([latitude, longitude], {
      draggable: true,
      title: "Event location",
    }).addTo(calendarEventMap);
    calendarEventMapMarker.on("dragend", (event) => setCalendarEventMapPin(event.target.getLatLng()));
  } else {
    calendarEventMapMarker.setLatLng([latitude, longitude]);
  }
  calendarEventMap.panTo([latitude, longitude]);
}

function initializeCalendarEventMap() {
  const mapElement = app.querySelector("#calendar-event-map");
  if (!calendarEventMapExpanded || !mapElement?.isConnected || !window.L) return;
  if (calendarEventMapElement !== mapElement) {
    calendarEventMap?.remove();
    calendarEventMapElement = mapElement;
    calendarEventMapMarker = null;
    calendarEventMap = window.L.map(mapElement).setView(
      calendarEventMapSelection ? [calendarEventMapSelection.latitude, calendarEventMapSelection.longitude] : [14.01799, 121.09465],
      calendarEventMapSelection ? 17 : 13,
    );
    const tileLayer = createTileLayer(calendarEventMap);
    tileLayer.on("tileerror", () => {
      const status = app.querySelector("#calendar-event-map-status");
      if (status)
        status.textContent = "Map tiles could not be loaded. Check your internet connection; you can still place the pin on the map.";
    });
    calendarEventMap.on("click", (event) => setCalendarEventMapPin(event.latlng));
  } else {
    calendarEventMap.invalidateSize();
  }
  if (calendarEventMapSelection) {
    setCalendarEventMapPin({
      lat: calendarEventMapSelection.latitude,
      lng: calendarEventMapSelection.longitude,
    });
  }
}

function initializeAnnouncementDetailMap() {
  const mapElements = app.querySelectorAll('.report-detail-map[id^="announcement-detail-map"]');
  if (!mapElements.length || !window.L) {
    announcementDetailMaps.forEach((map) => map?.remove());
    announcementDetailMaps = [];
    announcementDetailMapElements = [];
    const statuses = app.querySelectorAll('[id^="announcement-detail-map-status"]');
    statuses.forEach((status) => {
      status.textContent = "The interactive map is unavailable. Use the Google Maps link to open this location.";
    });
    return;
  }

  // Drop maps whose elements are no longer in the DOM
  announcementDetailMaps = announcementDetailMaps.filter((map, i) => {
    const el = announcementDetailMapElements[i];
    if (!el || !el.isConnected) {
      map?.remove();
      return false;
    }
    return true;
  });
  announcementDetailMapElements = announcementDetailMapElements.filter((_, i) => announcementDetailMaps[i] !== undefined);

  mapElements.forEach((el) => {
    const already = announcementDetailMapElements.indexOf(el);
    if (already !== -1) {
      announcementDetailMaps[already]?.invalidateSize();
      return;
    }
    const latitude = Number(el.dataset.latitude);
    const longitude = Number(el.dataset.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      const status = el.parentElement?.querySelector('[id^="announcement-detail-map-status"]');
      if (status) status.textContent = "This event's saved map coordinates are invalid.";
      return;
    }
    const map = window.L.map(el).setView([latitude, longitude], 17);
    const tileLayer = createTileLayer(map);
    const status = el.parentElement?.querySelector('[id^="announcement-detail-map-status"]');
    window.L.marker([latitude, longitude], {
      title: "Event location",
      alt: "Event location",
    }).addTo(map);
    tileLayer.on("tileerror", () => {
      if (status)
        status.textContent =
          "Map tiles could not be loaded. Check your internet connection; the saved pin and Google Maps link are still available.";
    });
    announcementDetailMaps.push(map);
    announcementDetailMapElements.push(el);
  });
}

export {
  haversineDistanceM,
  setReportMapPin,
  useCurrentLocation,
  centerMapOnArea,
  createTileLayer,
  initializeReportMap,
  initializeReportDetailMap,
  setAnnouncementMapPin,
  initializeAnnouncementMap,
  setCalendarEventMapPin,
  initializeCalendarEventMap,
  initializeAnnouncementDetailMap,
};
