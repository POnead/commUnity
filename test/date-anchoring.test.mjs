import "./frontend-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getAppTimeZone, setAppTimeZone } from "../app/constants.mjs";

const core = await import("../app/core.mjs");

test("date-only values keep their calendar day east of UTC while timestamps stay in the app zone", () => {
  const originalZone = getAppTimeZone();
  setAppTimeZone("Pacific/Auckland");
  try {
    // Noon UTC used to land on the next local day in UTC+12/+13 zones.
    assert.equal(core.asDate("2026-11-22").toISOString(), "2026-11-22T12:00:00.000Z");
    assert.match(core.dateLabel("2026-11-22"), /Nov 22,? 2026/);
    assert.match(core.dateLabel("2026-11-22", { weekday: "long" }), /Sunday/);
    // A real timestamp still follows the app zone: 23:30Z on the 21st is already the 22nd in Auckland.
    assert.match(core.dateLabel("2026-11-21T23:30:00.000Z"), /Nov 22,? 2026/);
  } finally {
    setAppTimeZone(originalZone);
  }
});
