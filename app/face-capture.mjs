// Face capture for enrollment and the shift duty check. Liveness landmarks come
// from MediaPipe (478 points + blink blendshapes); the local 128-float identity
// descriptor still comes from face-api, and the server may use Face++ instead.
// Both model sets are vendored under app/vendor so the page works offline.
//
// Liveness is a sequence, not a trick on a still photo: front -> blink ->
// left -> right -> front again. Every stage needs sustained evidence so a
// single noisy frame cannot skip it.

let faceApiPromise = null;
let landmarkerPromise = null;

const eyeAspectRatio = (eye) => {
  const vertical = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y) + Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y);
  const horizontal = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y);
  return vertical / 2 / (horizontal || 1);
};

const yawFrom = (points) => {
  const nose = points[30];
  const leftEyeOuter = points[36];
  const rightEyeOuter = points[45];
  const eyeMid = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const eyeSpan = rightEyeOuter.x - leftEyeOuter.x;
  return eyeSpan === 0 ? 0 : (nose.x - eyeMid) / eyeSpan;
};

export function loadFaceApi() {
  if (window.faceapi) return Promise.resolve(window.faceapi);
  faceApiPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/app/vendor/face-api/face-api.js";
    script.onload = () => resolve(window.faceapi);
    script.onerror = () => reject(new Error("Could not load the face library. Check that /app/vendor/face-api is present."));
    document.head.append(script);
  });
  return faceApiPromise;
}

export async function loadFaceModels() {
  const faceapi = await loadFaceApi();
  const base = "/app/vendor/face-models";
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(base),
      faceapi.nets.faceLandmark68Net.loadFromUri(base),
      faceapi.nets.faceRecognitionNet.loadFromUri(base),
    ]);
  } catch {
    // A failed model download surfaces as a bare "Failed to fetch" otherwise.
    throw new Error("The face models could not be loaded. Reload the page and try again.");
  }
  return faceapi;
}

// MediaPipe gives far better blink and pose signals than the small face-api
// landmark net. If it cannot load (old browser, blocked wasm), the caller falls
// back to face-api so a check can still run.
export async function loadLandmarker() {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    const mod = await import("/app/vendor/mediapipe/vision_bundle.mjs");
    const vision = await mod.FilesetResolver.forVisionTasks("/app/vendor/mediapipe");
    const options = {
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    };
    try {
      return await mod.FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: "/app/vendor/mediapipe/face_landmarker.task", delegate: "GPU" },
      });
    } catch {
      return mod.FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: "/app/vendor/mediapipe/face_landmarker.task", delegate: "CPU" },
      });
    }
  })().catch((error) => {
    landmarkerPromise = null;
    throw error;
  });
  return landmarkerPromise;
}

// A descriptor, or null when no usable face is visible.
export async function descriptorFrom(source) {
  const faceapi = window.faceapi;
  const result = await faceapi
    .detectSingleFace(source, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return result?.descriptor ? Array.from(result.descriptor) : null;
}

// Camera failures should say what the resident can actually do about them.
export function cameraErrorCopy(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return { title: "Camera is blocked", detail: "Allow camera access for this site in your browser settings, then try again." };
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return { title: "No camera found", detail: "Connect a camera or use a device with one, then try again." };
  if (name === "NotReadableError" || name === "TrackStartError")
    return { title: "Camera is busy", detail: "Another app is using the camera. Close it, then try again." };
  if (name === "SecurityError" || name === "InsecureContext")
    return { title: "Camera needs HTTPS", detail: "Open the portal over HTTPS or on localhost, then try again." };
  if (name === "AbortError") return { title: "Check cancelled", detail: "Your camera is off. Start the check again when you are ready." };
  if (name === "TimeoutError") return { title: "Time ran out", detail: "Try again in good, even light and follow each prompt." };
  if (/failed to fetch|network|load.*model/i.test(error?.message || ""))
    return { title: "Face check could not load", detail: "Reload the page and try again. If it keeps happening, check your connection to this site." };
  return { title: "Camera is off", detail: error?.message || "The face check could not run. Try again." };
}

// Small pure helpers so the HUD feedback can be tested without a camera.
export function isFaceFramed(box, width, height) {
  if (!box || !width || !height) return false;
  const centreX = (box.x + box.width / 2) / width;
  const centreY = (box.y + box.height / 2) / height;
  const faceWidth = box.width / width;
  return centreX > 0.21 && centreX < 0.79 && centreY > 0.11 && centreY < 0.89 && faceWidth > 0.15 && faceWidth < 0.55;
}

export function turnPrompt(turnedLeft, turnedRight) {
  if (turnedLeft && turnedRight) return "Both turns counted. Look back at the camera.";
  if (turnedLeft) return "Now turn right.";
  if (turnedRight) return "Now turn left.";
  return "Turn your head left now.";
}

// HUD guidance from the PDF: distance, full-face visibility and lighting.
// Lighting is advisory so a dim room prompts instead of locking the capture.
export function distanceFeedback(faceWidth) {
  if (!Number.isFinite(faceWidth)) return "Position your face inside the camera view.";
  if (faceWidth < 0.15) return "Move closer to the camera.";
  if (faceWidth > 0.55) return "Move slightly farther away.";
  return "";
}

export function lightFeedback(luminance) {
  if (!Number.isFinite(luminance)) return "";
  if (luminance < 45) return "Maintain proper lighting during capture.";
  if (luminance > 225) return "Reduce glare and keep the light even.";
  return "";
}

let lightCanvas = null;
function sampleLuminance(video) {
  if (typeof document === "undefined") return null;
  try {
    lightCanvas ??= document.createElement("canvas");
    lightCanvas.width = 16;
    lightCanvas.height = 12;
    const context = lightCanvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, 16, 12);
    const { data } = context.getImageData(0, 0, 16, 12);
    let total = 0;
    for (let index = 0; index < data.length; index += 4) {
      total += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    }
    return total / (data.length / 4);
  } catch {
    return null;
  }
}

// A turn must be held for several consecutive frames, but completing one side
// must never be erased by turning the other way. Both sides latch separately.
export function updateTurnProgress(state = {}, yaw = 0, required = 3) {
  const leftHeld = yaw > 0.12 ? (state.leftHeld || 0) + 1 : 0;
  const rightHeld = yaw < -0.12 ? (state.rightHeld || 0) + 1 : 0;
  return {
    leftHeld,
    rightHeld,
    turnedLeft: Boolean(state.turnedLeft) || leftHeld >= required,
    turnedRight: Boolean(state.turnedRight) || rightHeld >= required,
  };
}

const FRAMES_REQUIRED = { front: 4, blink: 2, turn: 3, final: 4 };

function averageDescriptors(descriptors) {
  if (!descriptors.length) return null;
  const sum = descriptors[0].map((_, index) => descriptors.reduce((total, item) => total + item[index], 0));
  const magnitude = Math.hypot(...sum) || 1;
  return sum.map((value) => value / magnitude);
}

async function readFrame(video, landmarker, faceapi) {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (landmarker) {
    const result = landmarker.detectForVideo(video, performance.now());
    const face = result?.faceLandmarks?.[0];
    if (!face) return { detected: false };
    const xs = face.map((point) => point.x);
    const ys = face.map((point) => point.y);
    const left = Math.min(...xs) * width;
    const right = Math.max(...xs) * width;
    const top = Math.min(...ys) * height;
    const bottom = Math.max(...ys) * height;
    const box = { x: left, y: top, width: right - left, height: bottom - top };
    const categories = result.faceBlendshapes?.[0]?.categories || [];
    const blinkScore = (name) => Number(categories.find((item) => item.categoryName === name)?.score) || 0;
    const nose = face[1]?.x ?? 0.5;
    const cheekLeft = face[234]?.x ?? 0.4;
    const cheekRight = face[454]?.x ?? 0.6;
    const yaw = (nose - (cheekLeft + cheekRight) / 2) / (Math.abs(cheekRight - cheekLeft) || 1);
    return {
      detected: true,
      framed: isFaceFramed(box, width, height),
      faceWidth: box.width / width,
      luminance: sampleLuminance(video),
      blink: Math.max(blinkScore("eyeBlinkLeft"), blinkScore("eyeBlinkRight")),
      yaw,
    };
  }
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return { detected: false };
  const points = detection.landmarks.positions;
  const ear = (eyeAspectRatio(points.slice(36, 42)) + eyeAspectRatio(points.slice(42, 48))) / 2;
  return {
    detected: true,
    framed: isFaceFramed(detection.box, width, height),
    faceWidth: detection.box.width / width,
    luminance: sampleLuminance(video),
    blink: ear < 0.21 ? 0.8 : 0.1,
    yaw: yawFrom(points),
  };
}

// Roll through the camera and return a descriptor once the sequence completes.
// onStep receives (message, { step, detected, framed, secondsLeft }) and
// onState receives "live" / "capturing" / "idle" / "done".
export async function runLiveness(video, onStep, options = {}) {
  const { signal, onState } = options;
  const cancelled = () => new DOMException("The face check was cancelled.", "AbortError");
  if (signal?.aborted) throw cancelled();

  const faceapi = await loadFaceModels();
  if (signal?.aborted) throw cancelled();
  let landmarker = null;
  try {
    landmarker = await loadLandmarker();
  } catch {
    // MediaPipe is an enhancement; the face-api fallback still works.
  }
  if (signal?.aborted) throw cancelled();

  const frame = video.closest(".face-video-frame");
  let resolveCapture;
  let rejectCapture;
  const capture = new Promise((resolve, reject) => {
    resolveCapture = resolve;
    rejectCapture = reject;
  });
  let stream = null;
  let timer = null;
  let settled = false;
  const cleanup = () => {
    if (timer) clearInterval(timer);
    signal?.removeEventListener("abort", onAbort);
    stream?.getTracks().forEach((track) => track.stop());
    // The landmarker is cached for the session; closing it here would break
    // the next check, which reuses the same instance.
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    cleanup();
    frame?.setAttribute("data-capturing", "false");
    frame?.setAttribute("data-camera-state", "idle");
    onState?.("idle");
    rejectCapture(cancelled());
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
  } catch (error) {
    settled = true;
    cleanup();
    throw error;
  }
  if (signal?.aborted) {
    // onAbort has already rejected the capture promise.
    settled = true;
    cleanup();
    return capture;
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    settled = true;
    cleanup();
    throw error;
  }
  frame?.setAttribute("data-streaming", "true");
  frame?.setAttribute("data-camera-state", "live");
  onState?.("live");

  const deadline = Date.now() + 90000;
  let stage = "front";
  let centredFrames = 0;
  let closedFrames = 0;
  let blinkCount = 0;
  let turnProgress = { leftHeld: 0, rightHeld: 0, turnedLeft: false, turnedRight: false };
  let steadyFrames = 0;
  const descriptors = [];
  let lastTimestamp = -1;

  timer = setInterval(async () => {
    if (settled) return;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const meta = (detected, framed, extra = {}) => {
      const value = { step: stage, detected, framed, ...extra };
      if (remaining <= 15) value.secondsLeft = remaining;
      return value;
    };
    if (remaining <= 0) {
      settled = true;
      cleanup();
      frame?.setAttribute("data-capturing", "false");
      frame?.setAttribute("data-camera-state", "idle");
      onState?.("idle");
      rejectCapture(new DOMException("Time ran out. Try again in good, even light.", "TimeoutError"));
      return;
    }
    // VIDEO mode wants strictly increasing timestamps and skips duplicate frames.
    const timestamp = performance.now();
    if (timestamp <= lastTimestamp && landmarker) return;
    lastTimestamp = timestamp;

    let sample;
    try {
      sample = await readFrame(video, landmarker, faceapi);
    } catch {
      return; // one dropped frame must not fail the whole check
    }
    if (settled) return;
    if (!sample.detected) {
      centredFrames = 0;
      turnProgress = { ...turnProgress, leftHeld: 0, rightHeld: 0 };
      steadyFrames = 0;
      onStep?.("Position your face inside the camera view.", meta(false, false));
      return;
    }

    if (sample.blink > 0.6) {
      closedFrames += 1;
    } else if (sample.blink < 0.3) {
      if (closedFrames >= FRAMES_REQUIRED.blink) blinkCount += 1;
      closedFrames = 0;
    }

    const centredNow = Math.abs(sample.yaw) < 0.08;
    centredFrames = centredNow ? centredFrames + 1 : 0;
    turnProgress = updateTurnProgress(turnProgress, sample.yaw, FRAMES_REQUIRED.turn);

    if (stage === "front") {
      // Distance and full-face visibility gate progress; lighting only prompts.
      const blocking = distanceFeedback(sample.faceWidth) || (!sample.framed ? "Ensure that the entire face is visible." : "");
      const advisory = lightFeedback(sample.luminance);
      const message = blocking || advisory || (centredNow ? "Look straight at the camera." : "Turn back to face the camera.");
      onStep?.(message, meta(true, sample.framed, { faceWidth: sample.faceWidth, luminance: sample.luminance }));
      if (!blocking && centredFrames >= FRAMES_REQUIRED.front && sample.framed) stage = "blink";
      return;
    }
    if (stage === "blink") {
      onStep?.(blinkCount ? "Blink counted." : "Blink once.", meta(true, sample.framed));
      if (blinkCount >= 1) stage = "turn";
      return;
    }
    if (stage === "turn") {
      onStep?.(turnPrompt(turnProgress.turnedLeft, turnProgress.turnedRight), meta(true, sample.framed));
      if (turnProgress.turnedLeft && turnProgress.turnedRight && centredFrames >= FRAMES_REQUIRED.front) stage = "final";
      return;
    }

    onStep?.("Hold still…", meta(true, sample.framed));
    if (!sample.framed || !centredNow) {
      steadyFrames = 0;
      descriptors.length = 0;
      return;
    }
    frame?.setAttribute("data-capturing", "true");
    onState?.("capturing");
    const descriptor = await descriptorFrom(video).catch(() => null);
    if (descriptor) descriptors.push(descriptor);
    steadyFrames += 1;
    if (steadyFrames < FRAMES_REQUIRED.final) return;

    const canvas = document.createElement("canvas");
    canvas.width = width(video);
    canvas.height = height(video);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.7);
    const averaged = averageDescriptors(descriptors) || descriptor;
    settled = true;
    cleanup();
    frame?.setAttribute("data-streaming", "false");
    frame?.setAttribute("data-camera-state", "done");
    onState?.("done");
    resolveCapture({ descriptor: averaged, liveness: true, image });
  }, 300);

  return capture;
}

const width = (video) => video.videoWidth || 640;
const height = (video) => video.videoHeight || 480;

// Exposed for the geometry helpers only in tests; keeps thresholds honest.
export const internals = { eyeAspectRatio, yawFrom, averageDescriptors, distanceFeedback, lightFeedback };
