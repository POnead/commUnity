// Face++ 1:1 face comparison for the staff duty check, added alongside the
// existing on-device matcher. An admin toggle decides which one runs.
// Shortcut: Face++ face tokens live provider-side and may expire; upgrade path =
// re-enroll the official, which the face-check page already offers.
import { HttpError } from "./http.mjs";

const TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 3;
const RETRYABLE = /CONCURRENCY_LIMIT|RATE_LIMIT|TOO_MANY|THROTTLE/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Free-tier Face++ accounts often allow only one in-flight request. Serialize
// calls so retries and concurrent checks in this process never collide.
// shortcut: one queue per process, upgrade to a database advisory lock around post() when Face++ runs on several instances.
let queue = Promise.resolve();
function serialized(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function createFacePpClient({ apiKey = "", apiSecret = "", apiBase = "https://api.faceplusplus.com", fetchImpl = fetch } = {}) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  const configured = Boolean(apiKey && apiSecret);

  async function post(path, fields) {
    if (!configured) throw new HttpError(503, "Face++ verification is not configured on this server.");
    return serialized(async () => {
      let lastDetail = "";
      let lastWasRetryable = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (attempt) await sleep(400 * 2 ** (attempt - 1));
        const form = new FormData();
        form.set("api_key", apiKey);
        form.set("api_secret", apiSecret);
        for (const [name, value] of Object.entries(fields)) form.set(name, value);
        try {
          const response = await fetchImpl(`${base}${path}`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const detail = String(payload?.error_message || `HTTP ${response.status}`);
            lastDetail = detail;
            lastWasRetryable = RETRYABLE.test(detail) || response.status === 429 || response.status >= 500;
            if (lastWasRetryable && attempt < MAX_ATTEMPTS - 1) continue;
            if (lastWasRetryable) throw new HttpError(503, "The face service is busy. Try again in a moment.");
            const credentials = /AUTHENTICATION|INVALID_API|API_KEY|SECRET/i.test(detail);
            throw new HttpError(
              502,
              credentials
                ? `The face service rejected the request: ${detail}. Check FACEPP_API_BASE and the account keys.`
                : `The face service rejected the request: ${detail}.`,
            );
          }
          const payload = await response.json().catch(() => null);
          if (!payload) throw new HttpError(502, "The face service returned an unreadable response.");
          if (payload.error_message) {
            const detail = String(payload.error_message);
            lastDetail = detail;
            lastWasRetryable = RETRYABLE.test(detail);
            if (lastWasRetryable && attempt < MAX_ATTEMPTS - 1) continue;
            throw new HttpError(502, `The face service could not process that image: ${detail}`);
          }
          return payload;
        } catch (error) {
          if (error instanceof HttpError && !(lastWasRetryable && attempt < MAX_ATTEMPTS - 1)) throw error;
          if (error instanceof HttpError) continue;
          lastDetail = `${error?.name || "Error"} ${error?.message || ""}`;
          lastWasRetryable = true;
          if (attempt < MAX_ATTEMPTS - 1) continue;
          console.error(`[Face++] ${path} could not be reached: ${lastDetail}`);
          throw new HttpError(502, "The face service is unavailable. Try again later.");
        }
      }
      throw new HttpError(502, `The face service is unavailable: ${lastDetail}`);
    });
  }

  return {
    configured,
    async detectFace(buffer, mime = "image/jpeg") {
      const payload = await post("/facepp/v3/detect", { image_file: new Blob([buffer], { type: mime }) });
      const token = payload?.faces?.[0]?.face_token;
      if (!token) throw new HttpError(400, "No face was found in that image. Use a clear, straight-on photo.");
      return String(token);
    },
    async compareFaces(first, second) {
      const payload = await post("/facepp/v3/compare", { face_token1: first, face_token2: second });
      const confidence = Number(payload?.confidence);
      if (!Number.isFinite(confidence)) throw new HttpError(502, "The face service returned an incomplete result.");
      return confidence;
    },
    async compareImages(idPhoto, selfie, mime1 = "image/jpeg", mime2 = "image/jpeg") {
      const payload = await post("/facepp/v3/compare", {
        image_file1: new Blob([idPhoto], { type: mime1 }),
        image_file2: new Blob([selfie], { type: mime2 }),
      });
      const confidence = Number(payload?.confidence);
      if (!Number.isFinite(confidence)) throw new HttpError(502, "The face service returned an incomplete result.");
      return confidence;
    },
  };
}
