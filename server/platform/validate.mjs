import { HttpError } from "./http.mjs";

export function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const MAX_PASSWORD_LENGTH = 200;

export function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value);
}

export function validISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateAccount({ email, name, area, phone = "" }) {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100)
    throw new HttpError(400, "Enter a name between 2 and 100 characters.");
  if (typeof area !== "string" || area.trim().length < 2 || area.length > 120) throw new HttpError(400, "Enter a valid area.");
  if (typeof phone !== "string" || phone.length > 40) throw new HttpError(400, "Contact number is too long.");
}

const OFFICIAL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_OFFICIAL_DAYS = OFFICIAL_DAYS.slice(0, 5);

export function validateWorkingHours(value) {
  const dayList = `(?:${OFFICIAL_DAYS.join("|")})(?:,\\s*(?:${OFFICIAL_DAYS.join("|")}))*`;
  const match =
    typeof value === "string" &&
    value.match(new RegExp(`^(?:(?:Monday-Friday|${dayList}),\\s*)?(\\d{1,2}:\\d{2}\\s[AP]M)-(\\d{1,2}:\\d{2}\\s[AP]M)$`, "i"));
  if (!match) throw new HttpError(400, "Choose valid working-hours start and end times.");
  const minutesAfterMidnight = (time) => {
    const [clock, period] = time.split(" ");
    const [hour, minute] = clock.split(":").map(Number);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return -1;
    return ((hour % 12) + (period.toUpperCase() === "PM" ? 12 : 0)) * 60 + minute;
  };
  const start = minutesAfterMidnight(match[1]);
  const end = minutesAfterMidnight(match[2]);
  if (value.length > 120 || start < 0 || end < 0 || end <= start) {
    throw new HttpError(400, "Working-hours end time must be after its start time.");
  }
}

export function validateAvailableDays(value = DEFAULT_OFFICIAL_DAYS) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > OFFICIAL_DAYS.length ||
    value.some((day) => typeof day !== "string" || !OFFICIAL_DAYS.includes(day)) ||
    new Set(value).size !== value.length
  ) {
    throw new HttpError(400, "Select at least one valid day the official is available.");
  }
  return OFFICIAL_DAYS.filter((day) => value.includes(day));
}

export { OFFICIAL_DAYS, DEFAULT_OFFICIAL_DAYS };

export async function assertKnownArea(db, area, barangay = "") {
  const result = await db.query("SELECT 1 FROM community_locations WHERE area=$1 AND ($2='' OR barangay=$2)", [
    area.trim(),
    barangay.trim(),
  ]);
  if (!result.rows.length) throw new HttpError(400, "Choose an area managed in the community location settings.");
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Use a password between 8 and ${MAX_PASSWORD_LENGTH} characters.`);
  }
}
