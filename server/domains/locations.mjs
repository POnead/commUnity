import { HttpError, sendJson } from "../platform/http.mjs";
import { jsonEqual, validId } from "../platform/validate.mjs";

function validateLocations(locations) {
  const areas = new Set();
  const ids = new Set();
  for (const location of locations) {
    if (
      !location ||
      !validId(location.id) ||
      typeof location.area !== "string" ||
      !location.area.trim() ||
      location.area.length > 120 ||
      typeof location.barangay !== "string" ||
      !location.barangay.trim() ||
      location.barangay.length > 100 ||
      typeof location.street !== "string" ||
      location.street.length > 160 ||
      typeof location.purok !== "string" ||
      !location.purok.trim() ||
      location.purok.length > 100 ||
      typeof location.landmark !== "string" ||
      location.landmark.length > 160 ||
      areas.has(location.area.trim().toLowerCase()) ||
      ids.has(location.id)
    ) {
      throw new HttpError(400, "A community location is invalid or duplicates another area.");
    }
    areas.add(location.area.trim().toLowerCase());
    ids.add(location.id);
  }
}

export async function syncLocations(db, oldLocations, newLocations) {
  validateLocations(newLocations);
  const oldById = new Map(oldLocations.map((item) => [item.id, item]));
  const newById = new Map(newLocations.map((item) => [item.id, item]));
  for (const item of newLocations) {
    const old = oldById.get(item.id);
    if (old && old.area !== item.area) {
      const references = await db.query(
        "SELECT EXISTS(SELECT 1 FROM users WHERE area=$1) OR EXISTS(SELECT 1 FROM reports WHERE area=$1) OR EXISTS(SELECT 1 FROM schedules WHERE area=$1) AS used",
        [old.area],
      );
      if (references.rows[0].used)
        throw new HttpError(409, "This location is already used by an account, report, or schedule. Keep its area label unchanged.");
    }
    await db.query(
      `
      INSERT INTO community_locations (id,area,barangay,street,purok,landmark)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET area=excluded.area,barangay=excluded.barangay,
        street=excluded.street,purok=excluded.purok,landmark=excluded.landmark
    `,
      [item.id, item.area.trim(), item.barangay.trim(), item.street.trim(), item.purok.trim(), item.landmark.trim()],
    );
  }
  for (const old of oldLocations) {
    if (newById.has(old.id)) continue;
    const references = await db.query(
      "SELECT EXISTS(SELECT 1 FROM users WHERE area=$1) OR EXISTS(SELECT 1 FROM reports WHERE area=$1) OR EXISTS(SELECT 1 FROM schedules WHERE area=$1) AS used",
      [old.area],
    );
    if (references.rows[0].used)
      throw new HttpError(409, "This location is already used by an account, report, or schedule and cannot be removed.");
    await db.query("DELETE FROM community_locations WHERE id=$1", [old.id]);
  }
}

function validateRecyclingLocations(locations) {
  const ids = new Set();
  for (const item of locations) {
    if (
      !item ||
      !validId(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 120 ||
      typeof item.barangay !== "string" ||
      !item.barangay.trim() ||
      item.barangay.length > 100 ||
      typeof item.street !== "string" ||
      !item.street.trim() ||
      item.street.length > 160 ||
      typeof item.purok !== "string" ||
      item.purok.length > 100 ||
      typeof item.landmark !== "string" ||
      item.landmark.length > 160 ||
      typeof item.materials !== "string" ||
      !item.materials.trim() ||
      item.materials.length > 500 ||
      typeof item.phone !== "string" ||
      item.phone.length > 40 ||
      typeof item.hours !== "string" ||
      item.hours.length > 120 ||
      typeof item.active !== "boolean" ||
      ids.has(item.id)
    ) {
      throw new HttpError(400, "A recycling or junkshop listing contains invalid data.");
    }
    ids.add(item.id);
  }
}

export async function syncRecyclingLocations(db, oldLocations, newLocations) {
  validateRecyclingLocations(newLocations);
  const oldById = new Map(oldLocations.map((item) => [item.id, item]));
  const newById = new Map(newLocations.map((item) => [item.id, item]));
  for (const item of newLocations) {
    const old = oldById.get(item.id);
    if (!old || !jsonEqual(old, item)) {
      await db.query(
        `
        INSERT INTO recycling_locations (id,name,barangay,street,purok,landmark,materials,phone,hours,active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET name=excluded.name,barangay=excluded.barangay,
          street=excluded.street,purok=excluded.purok,landmark=excluded.landmark,
          materials=excluded.materials,phone=excluded.phone,hours=excluded.hours,active=excluded.active
      `,
        [
          item.id,
          item.name.trim(),
          item.barangay.trim(),
          item.street.trim(),
          item.purok.trim(),
          item.landmark.trim(),
          item.materials.trim(),
          item.phone.trim(),
          item.hours.trim(),
          item.active,
        ],
      );
    }
  }
  for (const old of oldLocations) {
    if (!newById.has(old.id)) await db.query("DELETE FROM recycling_locations WHERE id=$1", [old.id]);
  }
}

export async function handleLocations(request, response, db, _options, _user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/locations" && request.method === "GET") {
    const locations = await db.query(
      "SELECT id,area,barangay,street,purok,landmark FROM community_locations ORDER BY barangay,purok,street,id",
    );
    sendJson(response, 200, { locations: locations.rows });
    return true;
  }
  return false;
}
