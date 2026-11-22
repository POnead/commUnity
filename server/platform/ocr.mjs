// OCR.space text extraction for resident ID photos. Called only when an admin
// turns on OCR prefill; the key comes from the environment, never the browser.
// Shortcut: the free OCR.space tier allows 25 requests/day and 1 MB per image;
// upgrade path = a paid key or a local engine behind this same readIdText call.
import { HttpError } from "./http.mjs";

const ENDPOINT = "https://api.ocr.space/parse/image";
const TIMEOUT_MS = 15000;

export function createOcrClient({ apiKey = "", fetchImpl = fetch } = {}) {
  const configured = Boolean(apiKey);

  return {
    configured,
    async readIdText(buffer, mime = "image/jpeg") {
      if (!configured) throw new HttpError(503, "ID scanning is not configured on this server.");
      const form = new FormData();
      form.set("apikey", apiKey);
      form.set("language", "eng");
      form.set("isOverlayRequired", "false");
      form.set("file", new Blob([buffer], { type: mime }), mime === "image/png" ? "id.png" : "id.jpg");
      let response;
      try {
        response = await fetchImpl(ENDPOINT, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new HttpError(502, "The ID scanning service is unavailable. Enter the details yourself.");
      }
      if (!response.ok) throw new HttpError(502, "The ID scanning service is unavailable. Enter the details yourself.");
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new HttpError(502, "The ID scanning service returned an unreadable response.");
      }
      if (payload?.IsErroredOnProcessing) throw new HttpError(502, "That ID image could not be read. Enter the details yourself.");
      return (payload?.ParsedResults || [])
        .map((result) => String(result?.ParsedText || ""))
        .join("\n")
        .trim();
    },
  };
}
