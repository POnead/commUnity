import "./frontend-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const capture = await import("../app/face-capture.mjs");

test("camera errors map to actionable copy", () => {
  assert.match(capture.cameraErrorCopy({ name: "NotAllowedError" }).detail, /browser settings/);
  assert.match(capture.cameraErrorCopy({ name: "NotFoundError" }).title, /No camera/);
  assert.match(capture.cameraErrorCopy({ name: "NotReadableError" }).title, /busy/);
  assert.match(capture.cameraErrorCopy({ name: "SecurityError" }).detail, /HTTPS/);
  assert.match(capture.cameraErrorCopy({ name: "TimeoutError" }).detail, /good, even light/);
  assert.match(capture.cameraErrorCopy({ name: "AbortError" }).title, /cancelled/);
  const network = capture.cameraErrorCopy(new TypeError("Failed to fetch"));
  assert.match(network.title, /could not load/);
  assert.match(network.detail, /Reload the page/);
});

test("framing and turn helpers drive the live HUD", () => {
  assert.equal(capture.isFaceFramed({ x: 320, y: 120, width: 160, height: 200 }, 640, 480), true);
  assert.equal(capture.isFaceFramed({ x: 0, y: 0, width: 80, height: 100 }, 640, 480), false);
  assert.equal(capture.isFaceFramed(null, 640, 480), false);
  assert.equal(capture.turnPrompt(false, false), "Turn your head left now.");
  assert.equal(capture.turnPrompt(true, false), "Now turn right.");
  assert.equal(capture.turnPrompt(false, true), "Now turn left.");
  assert.equal(capture.turnPrompt(true, true), "Both turns counted. Look back at the camera.");
  const averaged = capture.internals.averageDescriptors([[3, 4], [6, 8]]);
  assert.deepEqual(averaged, [0.6, 0.8]);
});

test("distance and lighting helpers give the PDF capture prompts", () => {
  assert.match(capture.distanceFeedback(0.1), /Move closer/i);
  assert.match(capture.distanceFeedback(0.7), /farther away/i);
  assert.equal(capture.distanceFeedback(0.3), "");
  assert.match(capture.lightFeedback(20), /proper lighting/i);
  assert.match(capture.lightFeedback(245), /glare/i);
  assert.equal(capture.lightFeedback(120), "");
});

test("turn progress latches each direction instead of looping", () => {
  const step = (state, yaw) => capture.updateTurnProgress(state, yaw, 3);
  let state = { leftHeld: 0, rightHeld: 0, turnedLeft: false, turnedRight: false };

  // A single frame each way never completes a turn.
  state = step(state, 0.3);
  state = step(state, -0.3);
  assert.equal(state.turnedLeft, false);
  assert.equal(state.turnedRight, false);

  // Hold left long enough, then return to centre before turning right.
  for (let i = 0; i < 3; i += 1) state = step(state, 0.3);
  assert.equal(state.turnedLeft, true, "left turn latched");
  state = step(state, 0);
  assert.equal(state.turnedLeft, true, "centring does not clear a completed turn");
  for (let i = 0; i < 3; i += 1) state = step(state, -0.3);
  assert.equal(state.turnedRight, true, "right turn latched");
  assert.equal(state.turnedLeft, true, "turning right does not clear the left latch");

  // A lost face clears the current hold but keeps both completed turns.
  state = { ...state, leftHeld: 0, rightHeld: 0 };
  assert.equal(state.turnedLeft && state.turnedRight, true);
  assert.equal(capture.turnPrompt(state.turnedLeft, state.turnedRight), "Both turns counted. Look back at the camera.");
});

test("an already-aborted signal skips camera startup", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => capture.runLiveness({}, () => {}, { signal: controller.signal }),
    (error) => error.name === "AbortError",
  );
});
