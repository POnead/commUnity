"use strict";
// Map pickers, pin rendering and embedded event maps. Owns all map state; main.mjs and
// views.mjs can render against these bindings and the map functions route writes through
// this module. Keeping map state here removes the tight coupling between form handlers
// and Leaflet that used to pervade main.mjs.
import { PALSARA_CENTER, PALSARA_DEFAULT_ZOOM, PALSARA_BOUNDS, AREA_COORDINATES } from "./constants.mjs";
import { ensureGoogleMaps, mapsReady, createMap, createMarker } from "./google-map.mjs";
import { isWithinPalsaraBounds, validCoordinates } from "../shared/community-map.mjs";
import { toast, app, data, currentUser, esc } from "./core.mjs";

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
let locationMapExpanded = false;
let locationMap = null;
let locationMapElement = null;
let locationPickerMap = null;
let locationPickerMapElement = null;
let locationPickerMarker = null;
let locationPickerSelection = null;
let locationFixProvider = null;

// main.mjs owns the verified device fix so the map picker can reuse it instead
// of triggering a second geolocation request (and a possible second prompt).
export function setLocationFixProvider(provider) {
  locationFixProvider = provider;
}

function constrainMapToPalsara(map) {
  map.setMaxBounds(PALSARA_BOUNDS);
  map.options.maxBoundsViscosity = 1;
}

function rejectOutOfAreaPin(position, status, marker, previousSelection) {
  if (isWithinPalsaraBounds(position.lat, position.lng)) return false;
  if (marker && previousSelection) marker.setLatLng([previousSelection.latitude, previousSelection.longitude]);
  if (status) status.textContent = "Choose a location within the Palsara, Balete map area. The pin was not changed.";
  toast("Choose a location within the Palsara, Balete map area.", "error");
  return true;
}

// All three pickers share the same status text, hidden-field, marker and pan
// behaviour. The only differences are which map/selection each one owns.
export function makePinSetter({ getMap, getMarker, setMarker, getSelection, setSelection, statusId, latitudeId, longitudeId, clearAction, markerTitle }) {
  const setPin = (position) => {
    const { lat: latitude, lng: longitude } = position;
    const statusSelector = `#${statusId}`;
    if (rejectOutOfAreaPin(position, app.querySelector(statusSelector), getMarker(), getSelection())) return false;
    setSelection({ latitude, longitude });
    const latitudeField = app.querySelector(`#${latitudeId}`);
    const longitudeField = app.querySelector(`#${longitudeId}`);
    const status = app.querySelector(statusSelector);
    const clearButton = app.querySelector(`[data-action="${clearAction}"]`);
    if (latitudeField) latitudeField.value = String(latitude);
    if (longitudeField) longitudeField.value = String(longitude);
    if (clearButton) clearButton.hidden = false;
    if (status) {
      status.textContent =
        currentUser?.role === "official"
          ? `Pin selected at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}. Drag to adjust it. ${palsaraContextMessage()}`
          : `Pin selected at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}. Drag the pin to adjust it.`;
    }
    const map = getMap();
    if (!map) return true;
    if (!getMarker()) {
      const marker = createMarker([latitude, longitude], { draggable: true, title: markerTitle }).addTo(map);
      marker.on("dragend", (event) => setPin(event.target.getLatLng()));
      setMarker(marker);
    } else {
      getMarker().setLatLng([latitude, longitude]);
    }
    map.panTo([latitude, longitude]);
    return true;
  };
  return setPin;
}

const setReportMapPin = makePinSetter({
  getMap: () => reportMap,
  getMarker: () => reportMapMarker,
  setMarker: (marker) => (reportMapMarker = marker),
  getSelection: () => reportMapSelection,
  setSelection: (selection) => (reportMapSelection = selection),
  statusId: "report-map-status",
  latitudeId: "report-latitude",
  longitudeId: "report-longitude",
  clearAction: "clear-report-map-pin",
  markerTitle: "Reported concern location",
});

const setAnnouncementMapPin = makePinSetter({
  getMap: () => announcementMap,
  getMarker: () => announcementMapMarker,
  setMarker: (marker) => (announcementMapMarker = marker),
  getSelection: () => announcementMapSelection,
  setSelection: (selection) => (announcementMapSelection = selection),
  statusId: "announcement-map-status",
  latitudeId: "announcement-latitude",
  longitudeId: "announcement-longitude",
  clearAction: "clear-announcement-map-pin",
  markerTitle: "Event location",
});

const setCalendarEventMapPin = makePinSetter({
  getMap: () => calendarEventMap,
  getMarker: () => calendarEventMapMarker,
  setMarker: (marker) => (calendarEventMapMarker = marker),
  getSelection: () => calendarEventMapSelection,
  setSelection: (selection) => (calendarEventMapSelection = selection),
  statusId: "calendar-event-map-status",
  latitudeId: "calendar-event-latitude",
  longitudeId: "calendar-event-longitude",
  clearAction: "clear-calendar-event-map-pin",
  markerTitle: "Event location",
});

// Live bindings for templates and map actions.
export { reportMapExpanded, reportMapSelection, reportMapGeoLocating };
export { announcementMapExpanded, announcementMapSelection };
export { calendarEventMapExpanded, calendarEventMapSelection };
export { locationMapExpanded, locationMap, locationPickerMap };
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
    locationMapExpanded: (v) => (locationMapExpanded = v),
    locationMap: (v) => (locationMap = v),
    locationMapElement: (v) => (locationMapElement = v),
    locationPickerMap: (v) => (locationPickerMap = v),
    locationPickerMapElement: (v) => (locationPickerMapElement = v),
    locationPickerMarker: (v) => (locationPickerMarker = v),
    locationPickerSelection: (v) => (locationPickerSelection = v),
  };
  for (const [key, value] of Object.entries(next)) {
    if (!handlers[key]) throw new Error(`setMapState: unknown key "${key}"`);
    handlers[key](value);
  }
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
    const fix = locationFixProvider?.();
    const position = fix
      ? { coords: fix }
      : await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });
    const { latitude, longitude } = position.coords;
    if (!validCoordinates(latitude, longitude)) throw new Error("Invalid location received.");
    if (!isWithinPalsaraBounds(latitude, longitude)) {
      if (status)
        status.textContent = "Your current location is outside the Palsara, Balete map area. Choose a location within the map instead.";
      toast("Your current location is outside the Palsara, Balete map area.", "error");
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
  const managedLocation = (data.locations || []).find(
    (location) =>
      (location.purok || location.area) === area &&
      String(location.barangay || "").toLowerCase() === "palsara" &&
      hasPalsaraCoordinates(location),
  );
  const coords = managedLocation ? [Number(managedLocation.latitude), Number(managedLocation.longitude)] : AREA_COORDINATES[area];
  if (!coords || !reportMap || !isWithinPalsaraBounds(coords[0], coords[1])) return;
  reportMap.setView(coords, 15);
  if (reportMapSelection && !reportMapMarker) {
    setReportMapPin({ lat: coords[0], lng: coords[1] });
    return;
  }
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

function initializeReportMap() {
  const mapElement = app.querySelector("#report-map");
  if (!reportMapExpanded || !mapElement?.isConnected || !mapsReady()) return;
  if (reportMapElement !== mapElement) {
    reportMap?.remove();
    reportMapElement = mapElement;
    reportMapMarker = null;
    reportMap = createMap(mapElement).setView(
      reportMapSelection ? [reportMapSelection.latitude, reportMapSelection.longitude] : PALSARA_CENTER,
      reportMapSelection ? 17 : PALSARA_DEFAULT_ZOOM,
    );
    constrainMapToPalsara(reportMap);
    if (currentUser?.role === "official") addPalsaraContext(reportMap);
    else addManagedLocationMarkers(reportMap);
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
    if (
      selectedArea &&
      (AREA_COORDINATES[selectedArea] ||
        (data.locations || []).some(
          (location) =>
            (location.purok || location.area) === selectedArea &&
            String(location.barangay || "").toLowerCase() === "palsara" &&
            hasPalsaraCoordinates(location),
        ))
    ) {
      centerMapOnArea(selectedArea);
    } else {
      reportMap.fitBounds(PALSARA_BOUNDS, { padding: 24 });
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
  if (!mapElement || !mapsReady()) {
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
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !isWithinPalsaraBounds(latitude, longitude)
  ) {
    const status = app.querySelector("#report-detail-map-status");
    if (status) status.textContent = "This report's saved map coordinates are invalid.";
    reportDetailMapElement = null;
    return;
  }

  const readOnly = mapElement.dataset.readonly === "true";
  reportDetailMap = createMap(mapElement, {
    dragging: !readOnly,
    scrollWheelZoom: !readOnly,
    zoomControl: !readOnly,
    doubleClickZoom: !readOnly,
    boxZoom: !readOnly,
    keyboard: !readOnly,
    touchZoom: !readOnly,
  }).setView([latitude, longitude], 17);
  constrainMapToPalsara(reportDetailMap);
  if (currentUser?.role === "official") addPalsaraContext(reportDetailMap);
  else addManagedLocationMarkers(reportDetailMap);
  const statusElement = app.querySelector("#report-detail-map-status");
  createMarker([latitude, longitude], {
    title: "Exact concern location",
    alt: "Exact concern location",
  }).addTo(reportDetailMap);
  if (statusElement && currentUser?.role === "official") {
    statusElement.textContent = palsaraContextMessage();
  }
}

// When the map script cannot load, the hidden coordinate inputs become the
// usable fallback so the save handlers still receive a valid pin.
function showManualCoordinates(latitudeId, longitudeId, statusId) {
  for (const id of [latitudeId, longitudeId]) {
    const input = app.querySelector(`#${id}`);
    if (!input || input.type !== "hidden") continue;
    const isLatitude = id.includes("latitude");
    input.type = "number";
    input.step = "any";
    input.min = isLatitude ? "-90" : "-180";
    input.max = isLatitude ? "90" : "180";
    input.required = true;
    input.setAttribute("aria-label", isLatitude ? "Latitude" : "Longitude");
    input.insertAdjacentText("beforebegin", `${isLatitude ? "Latitude" : "Longitude"}: `);
  }
  const status = app.querySelector(`#${statusId}`);
  if (status) {
    status.classList.remove("visually-hidden");
    status.textContent = "Map unavailable — enter the latitude and longitude manually.";
  }
}

function initializeAnnouncementMap() {
  const mapElement = app.querySelector("#announcement-map");
  if (!announcementMapExpanded || !mapElement?.isConnected) return;
  if (!mapsReady()) {
    showManualCoordinates("announcement-latitude", "announcement-longitude", "announcement-map-status");
    return;
  }
  if (announcementMapElement !== mapElement) {
    announcementMap?.remove();
    announcementMapElement = mapElement;
    announcementMapMarker = null;
    announcementMap = createMap(mapElement).setView(
      announcementMapSelection ? [announcementMapSelection.latitude, announcementMapSelection.longitude] : PALSARA_CENTER,
      announcementMapSelection ? 17 : PALSARA_DEFAULT_ZOOM,
    );
    constrainMapToPalsara(announcementMap);
    if (!announcementMapSelection) announcementMap.fitBounds(PALSARA_BOUNDS, { padding: 24 });
    if (currentUser?.role === "official") addPalsaraContext(announcementMap);
    else addManagedLocationMarkers(announcementMap);
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

function initializeCalendarEventMap() {
  const mapElement = app.querySelector("#calendar-event-map");
  if (!calendarEventMapExpanded || !mapElement?.isConnected) return;
  if (!mapsReady()) {
    showManualCoordinates("calendar-event-latitude", "calendar-event-longitude", "calendar-event-map-status");
    return;
  }
  if (calendarEventMapElement !== mapElement) {
    calendarEventMap?.remove();
    calendarEventMapElement = mapElement;
    calendarEventMapMarker = null;
    calendarEventMap = createMap(mapElement).setView(
      calendarEventMapSelection ? [calendarEventMapSelection.latitude, calendarEventMapSelection.longitude] : PALSARA_CENTER,
      calendarEventMapSelection ? 17 : PALSARA_DEFAULT_ZOOM,
    );
    constrainMapToPalsara(calendarEventMap);
    if (!calendarEventMapSelection) calendarEventMap.fitBounds(PALSARA_BOUNDS, { padding: 24 });
    if (currentUser?.role === "official") addPalsaraContext(calendarEventMap);
    else addManagedLocationMarkers(calendarEventMap);
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

function initializeLocationMap() {
  const mapElement = app.querySelector("#location-map");
  if (!locationMapExpanded || !mapElement?.isConnected || !mapsReady()) return;
  if (locationMapElement !== mapElement) {
    locationMap?.remove();
    locationMapElement = mapElement;
    locationMap = createMap(mapElement).setView(PALSARA_CENTER, PALSARA_DEFAULT_ZOOM);
    constrainMapToPalsara(locationMap);
    locationMap.fitBounds(PALSARA_BOUNDS, { padding: 24 });
    const markerCount = addManagedLocationMarkers(locationMap, { approximateUnpinned: true });
    const status = app.querySelector("#location-map-status");
    if (status && !markerCount) {
      const outsidePin = (data.locations || []).some(
        (location) =>
          String(location.barangay || "").toLowerCase() === "palsara" && hasValidCoordinates(location) && !hasPalsaraCoordinates(location),
      );
      status.textContent = outsidePin
        ? "Pins outside the Palsara, Balete map area are omitted. Update those locations with an in-area pin."
        : "No configured area coordinates are available to show on the map.";
    }
  } else {
    locationMap.invalidateSize();
  }
}

function hasValidCoordinates(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return (
    location?.latitude !== null &&
    location?.latitude !== "" &&
    location?.longitude !== null &&
    location?.longitude !== "" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function hasPalsaraCoordinates(location) {
  return hasValidCoordinates(location) && isWithinPalsaraBounds(Number(location.latitude), Number(location.longitude));
}

function addManagedLocationMarkers(map, { approximateUnpinned = false, excludeId = "", barangay = "" } = {}) {
  let markerCount = 0;
  const approximateAreas = new Set();
  for (const location of data.locations || []) {
    if (location.id === excludeId) continue;
    if (barangay && String(location.barangay || "").toLowerCase() !== barangay.toLowerCase()) continue;
    const area = location.purok || location.area;
    let coordinates;
    let approximate = false;
    if (hasValidCoordinates(location)) {
      if (!hasPalsaraCoordinates(location)) continue;
      coordinates = [Number(location.latitude), Number(location.longitude)];
    } else if (approximateUnpinned && String(location.barangay || "").toLowerCase() === "palsara" && !approximateAreas.has(area)) {
      coordinates = AREA_COORDINATES[area] || AREA_COORDINATES[location.area];
      approximate = Boolean(coordinates);
      if (approximate) approximateAreas.add(area);
    }
    if (!coordinates) continue;
    const label = esc(area);
    const address = [location.street, location.landmark].filter(Boolean).map(esc);
    const details = address.length ? `<br>${address.join(" · ")}` : "";
    const accuracy = approximate ? "Approximate area location; no pin has been selected" : "Administrator-selected location pin";
    createMarker(coordinates, {
      title: `${area}${approximate ? " (approximate)" : ""}`,
      alt: `${area}${approximate ? ", approximate area location" : ", managed location pin"}`,
    })
      .addTo(map)
      .bindPopup(`<strong>${label}</strong>${details}<br>${accuracy}`);
    markerCount += 1;
  }
  return markerCount;
}

function setLocationPickerPin(position) {
  if (
    position &&
    rejectOutOfAreaPin(position, app.querySelector("#location-map-picker-status"), locationPickerMarker, locationPickerSelection)
  )
    return false;
  locationPickerSelection = position ? { latitude: position.lat, longitude: position.lng } : null;
  const latitudeField = app.querySelector("#location-latitude");
  const longitudeField = app.querySelector("#location-longitude");
  const status = app.querySelector("#location-map-picker-status");
  const clearButton = app.querySelector('[data-action="clear-location-map-pin"]');
  if (latitudeField) latitudeField.value = locationPickerSelection ? String(locationPickerSelection.latitude) : "";
  if (longitudeField) longitudeField.value = locationPickerSelection ? String(locationPickerSelection.longitude) : "";
  if (clearButton) clearButton.hidden = !locationPickerSelection;
  if (status) {
    status.textContent = locationPickerSelection
      ? `Pin selected at ${locationPickerSelection.latitude.toFixed(6)}, ${locationPickerSelection.longitude.toFixed(6)}. Drag to adjust it.`
      : "No pin selected. Click the map to place one before saving.";
  }
  if (!locationPickerMap) return true;
  if (!locationPickerSelection) {
    locationPickerMarker?.remove();
    locationPickerMarker = null;
    return true;
  }
  const { latitude, longitude } = locationPickerSelection;
  if (!locationPickerMarker) {
    locationPickerMarker = createMarker([latitude, longitude], {
      draggable: true,
      title: "Community location",
      alt: "Draggable community location pin",
    }).addTo(locationPickerMap);
    locationPickerMarker.on("dragend", (event) => setLocationPickerPin(event.target.getLatLng()));
  } else {
    locationPickerMarker.setLatLng([latitude, longitude]);
  }
  locationPickerMap.panTo([latitude, longitude]);
  return true;
}

function initializeLocationPickerMap() {
  const mapElement = app.querySelector("#location-map-picker");
  if (!mapElement?.isConnected) return;
  if (!mapsReady()) {
    showManualCoordinates("location-latitude", "location-longitude", "location-map-picker-status");
    return;
  }
  const form = app.querySelector("#location-form");
  const locationId = String(form?.querySelector('[name="id"]')?.value || "");
  const location = (data.locations || []).find((item) => item.id === locationId);
  if (locationPickerMapElement !== mapElement) {
    locationPickerMap?.remove();
    locationPickerMapElement = mapElement;
    locationPickerSelection = hasPalsaraCoordinates(location)
      ? { latitude: Number(location.latitude), longitude: Number(location.longitude) }
      : null;
    locationPickerMarker = null;
    locationPickerMap = createMap(mapElement).setView(
      locationPickerSelection ? [locationPickerSelection.latitude, locationPickerSelection.longitude] : PALSARA_CENTER,
      locationPickerSelection ? 17 : PALSARA_DEFAULT_ZOOM,
    );
    constrainMapToPalsara(locationPickerMap);
    if (!locationPickerSelection) locationPickerMap.fitBounds(PALSARA_BOUNDS, { padding: 24 });
    addManagedLocationMarkers(locationPickerMap, { approximateUnpinned: true, excludeId: locationId });
    locationPickerMap.on("click", (event) => setLocationPickerPin(event.latlng));
  } else {
    locationPickerMap.invalidateSize();
  }
  if (locationPickerSelection) {
    setLocationPickerPin({ lat: locationPickerSelection.latitude, lng: locationPickerSelection.longitude });
  } else if (hasValidCoordinates(location) && !hasPalsaraCoordinates(location)) {
    setLocationPickerPin(null);
    const status = app.querySelector("#location-map-picker-status");
    if (status) status.textContent = "The saved pin is outside the Palsara, Balete map area. Choose a new pin before saving.";
  } else {
    const status = app.querySelector("#location-map-picker-status");
    if (status) status.textContent = "No pin selected. Click the map to place one before saving.";
  }
}

function addPalsaraContext(map) {
  constrainMapToPalsara(map);
  addManagedLocationMarkers(map, { approximateUnpinned: true, barangay: "Palsara" });
}

export function palsaraContextMessage() {
  const locations = (data.locations || []).filter((location) => String(location.barangay || "").toLowerCase() === "palsara");
  const pinnedCount = locations.filter(hasPalsaraCoordinates).length;
  const outsideAreas = [
    ...new Set(
      locations
        .filter((location) => hasValidCoordinates(location) && !hasPalsaraCoordinates(location))
        .map((location) => location.purok || location.area),
    ),
  ];
  const unmappedAreas = [
    ...new Set(
      locations
        .filter((location) => !hasPalsaraCoordinates(location) && !AREA_COORDINATES[location.purok || location.area])
        .map((location) => location.purok || location.area),
    ),
  ];
  const markerNote = pinnedCount
    ? `${pinnedCount} administrator-selected location ${pinnedCount === 1 ? "pin is" : "pins are"} shown; unpinned legacy areas may use approximate markers.`
    : "No managed Palsara locations have administrator-selected pins; any area markers are approximate.";
  const outsideNote = outsideAreas.length
    ? ` Pins outside the configured service area are omitted until an administrator corrects them: ${outsideAreas.join(", ")}.`
    : "";
  return `Palsara map context. ${markerNote}${outsideNote}${unmappedAreas.length ? ` Approximate coordinates are unavailable for ${unmappedAreas.join(", ")}.` : ""}`;
}

function initializeAnnouncementDetailMap() {
  const mapElements = app.querySelectorAll('.report-detail-map[id^="announcement-detail-map"]');
  if (!mapElements.length || !mapsReady()) {
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
    if (!validCoordinates(latitude, longitude) || !isWithinPalsaraBounds(latitude, longitude)) {
      const status = el.parentElement?.querySelector('[id^="announcement-detail-map-status"]');
      if (status) status.textContent = "This event's saved map coordinates are invalid.";
      return;
    }
    const map = createMap(el).setView([latitude, longitude], 17);
    constrainMapToPalsara(map);
    if (currentUser?.role === "official") addPalsaraContext(map);
    else addManagedLocationMarkers(map);
    const status = el.parentElement?.querySelector('[id^="announcement-detail-map-status"]');
    createMarker([latitude, longitude], {
      title: "Event location",
      alt: "Event location",
    }).addTo(map);
    if (status && currentUser?.role === "official") {
      status.textContent = palsaraContextMessage();
    }
    announcementDetailMaps.push(map);
    announcementDetailMapElements.push(el);
  });
}

export {
  constrainMapToPalsara,
  setReportMapPin,
  useCurrentLocation,
  centerMapOnArea,
  initializeReportMap,
  initializeReportDetailMap,
  setAnnouncementMapPin,
  initializeAnnouncementMap,
  setCalendarEventMapPin,
  initializeCalendarEventMap,
  initializeAnnouncementDetailMap,
  initializeLocationMap,
  setLocationPickerPin,
  initializeLocationPickerMap,
  refreshGoogleMaps,
};

function refreshGoogleMaps() {
  return ensureGoogleMaps().then((ready) => {
    if (!ready) {
      const status = app.querySelector("#report-map-status");
      if (status) status.textContent = "Map unavailable. You can still submit with the text location only.";
      return;
    }
    if (reportMapExpanded) initializeReportMap();
    if (locationMapExpanded) initializeLocationMap();
    if (announcementMapExpanded) initializeAnnouncementMap();
    if (calendarEventMapExpanded) initializeCalendarEventMap();
    if (app.querySelector("#location-map-picker")) initializeLocationPickerMap();
    initializeReportDetailMap();
    initializeAnnouncementDetailMap();
  });
}

// Map loading is deferred to initialize() (and to login()) so an unauthenticated
// page never calls /api/map-config and gets a 401 in the console.
