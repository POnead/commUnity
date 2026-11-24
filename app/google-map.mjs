"use strict";
// Small Leaflet-shaped shim over the Google Maps JavaScript API. Keeping the
// handful of calls map.mjs already uses behind here avoids rewriting every map
// surface. Every map is hard-bounded to Palsara; the server still validates
// coordinates, so this is a UX constraint rather than a security boundary.
import { PALSARA_BOUNDS } from "./constants.mjs";

let loadPromise = null;

export function mapsReady() {
  return Boolean(window.google?.maps);
}

export function ensureGoogleMaps() {
  loadPromise ??= new Promise((resolve) => {
    const finish = (ok) => {
      // A transient failure must not poison every later render in this page session.
      if (!ok) loadPromise = null;
      resolve(ok);
    };
    fetch("/api/map-config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        const key = String(config?.googleMapsApiKey || "");
        if (!key) return finish(false);
        if (mapsReady()) return finish(true);
        const callback = "__communityMapsReady";
        window[callback] = () => finish(true);
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${callback}`;
        script.onerror = () => finish(false);
        document.head.append(script);
      })
      .catch(() => finish(false));
  });
  return loadPromise;
}

function point(value) {
  if (Array.isArray(value)) return { lat: Number(value[0]), lng: Number(value[1]) };
  if (value && typeof value.lat === "number" && typeof value.lng === "number") return { lat: value.lat, lng: value.lng };
  return { lat: Number(value?.latitude), lng: Number(value?.longitude) };
}

function wrapMap(googleMap) {
  return {
    options: {},
    __googleMap: googleMap,
    setView(position, zoom) {
      const center = point(position);
      googleMap.setCenter(center);
      if (Number.isFinite(zoom)) googleMap.setZoom(zoom);
      return this;
    },
    panTo(position) {
      googleMap.panTo(point(position));
      return this;
    },
    fitBounds(bounds, options) {
      const [[south, west], [north, east]] = bounds;
      googleMap.fitBounds({ south, west, north, east }, options);
      return this;
    },
    setMaxBounds() {
      return this; // applied at creation via restriction.strictBounds
    },
    removeLayer(layer) {
      layer?.remove?.();
      return this;
    },
    remove() {
      if (typeof googleMap.setDiv === "function") googleMap.setDiv(null);
    },
    invalidateSize() {
      window.google.maps.event.trigger(googleMap, "resize");
    },
    on(event, handler) {
      if (event === "click")
        window.google.maps.event.addListener(googleMap, "click", (click) =>
          handler({ latlng: { lat: click.latLng.lat(), lng: click.latLng.lng() } }),
        );
      return this;
    },
  };
}

export function createMap(element, options = {}) {
  const [[south, west], [north, east]] = PALSARA_BOUNDS;
  const readOnly = options.dragging === false;
  const holder = {
    setView(position, zoom) {
      const googleMap = new window.google.maps.Map(element, {
        center: point(position),
        zoom: Number.isFinite(zoom) ? zoom : 15,
        restriction: { latLngBounds: { south, west, north, east }, strictBounds: true },
        draggable: !readOnly,
        scrollwheel: options.scrollWheelZoom !== false,
        zoomControl: options.zoomControl !== false,
        disableDoubleClickZoom: options.doubleClickZoom === false,
        keyboardShortcuts: options.keyboard !== false,
        gestureHandling: options.touchZoom === false ? "none" : "auto",
        clickableIcons: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      Object.assign(holder, wrapMap(googleMap));
      return holder;
    },
  };
  return holder;
}

export function createMarker(position, options = {}) {
  const marker = new window.google.maps.Marker({
    position: point(position),
    draggable: options.draggable === true,
    title: options.title || "",
  });
  const wrapper = {
    addTo(map) {
      marker.setMap(map.__googleMap || null);
      wrapper.map = map;
      return wrapper;
    },
    on(event, handler) {
      if (event === "dragend") window.google.maps.event.addListener(marker, "dragend", () => handler({ target: wrapper }));
      return wrapper;
    },
    setLatLng(value) {
      marker.setPosition(point(value));
      return wrapper;
    },
    getLatLng() {
      const current = marker.getPosition();
      return { lat: current.lat(), lng: current.lng() };
    },
    remove() {
      marker.setMap(null);
    },
    bindPopup(content) {
      const info = new window.google.maps.InfoWindow({ content });
      window.google.maps.event.addListener(marker, "click", () => info.open(wrapper.map?.__googleMap, marker));
      return wrapper;
    },
  };
  return wrapper;
}
