import { PALSARA_POLYGON } from "./palsara-boundary.mjs";

export const PALSARA_CENTER = [14.013, 121.096];
export const PALSARA_DEFAULT_ZOOM = 15;

// Derived from the barangay outline, not a hand-written rectangle. The map
// provider can only enforce a rectangle; pins use the polygon below.
const LONGITUDES = PALSARA_POLYGON.map(([longitude]) => longitude);
const LATITUDES = PALSARA_POLYGON.map(([, latitude]) => latitude);
export const PALSARA_BOUNDS = [
  [Math.min(...LATITUDES), Math.min(...LONGITUDES)],
  [Math.max(...LATITUDES), Math.max(...LONGITUDES)],
];

export function validCoordinates(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function isWithinPalsaraBounds(latitude, longitude) {
  if (!validCoordinates(latitude, longitude)) return false;
  const [[south, west], [north, east]] = PALSARA_BOUNDS;
  if (latitude < south || latitude > north || longitude < west || longitude > east) return false;
  // Ray casting over [longitude, latitude] pairs. Points inside the rectangle
  // but outside the barangay outline are rejected by both browser and server.
  let inside = false;
  for (let i = 0, j = PALSARA_POLYGON.length - 1; i < PALSARA_POLYGON.length; j = i, i += 1) {
    const [xi, yi] = PALSARA_POLYGON[i];
    const [xj, yj] = PALSARA_POLYGON[j];
    if (yi > latitude !== yj > latitude && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const METRES_PER_DEGREE_LATITUDE = 110540;
const METRES_PER_DEGREE_LONGITUDE = 111320;

// Local equirectangular projection around Palsara. The barangay is only a few
// kilometres across, so this is accurate to well under a metre here and avoids
// pulling in a geodesy dependency just to compare a GPS error radius.
function localMetres([longitude, latitude]) {
  const [centreLatitude, centreLongitude] = PALSARA_CENTER;
  const longitudeScale = METRES_PER_DEGREE_LONGITUDE * Math.cos((centreLatitude * Math.PI) / 180);
  return [(longitude - centreLongitude) * longitudeScale, (latitude - centreLatitude) * METRES_PER_DEGREE_LATITUDE];
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPalsaraBoundaryMetres(latitude, longitude) {
  if (!validCoordinates(latitude, longitude)) return Infinity;
  const point = localMetres([longitude, latitude]);
  let nearest = Infinity;
  for (let i = 0, j = PALSARA_POLYGON.length - 1; i < PALSARA_POLYGON.length; j = i, i += 1) {
    nearest = Math.min(nearest, distanceToSegment(point, localMetres(PALSARA_POLYGON[j]), localMetres(PALSARA_POLYGON[i])));
  }
  return nearest;
}

// A device fix is only trusted as far as its reported accuracy. When the
// accuracy circle reaches the outline, the result is "uncertain" rather than
// silently blocking a resident who is actually just inside the boundary.
export function palsaraLocationVerdict(coords = {}) {
  const { latitude, longitude } = coords;
  const rawAccuracy = coords.accuracy;
  const accuracy = rawAccuracy == null ? 50 : Number(rawAccuracy);
  if (!validCoordinates(latitude, longitude) || !Number.isFinite(accuracy) || accuracy < 0) {
    return { state: "unavailable", accuracy: null, distanceToBoundary: null };
  }
  const distanceToBoundary = distanceToPalsaraBoundaryMetres(latitude, longitude);
  const state = distanceToBoundary <= accuracy ? "uncertain" : isWithinPalsaraBounds(latitude, longitude) ? "inside" : "outside";
  return { state, accuracy, distanceToBoundary };
}
