import { appTimeLabel } from "./time.mjs";

export function logError(message, error, context = {}) {
  const time = appTimeLabel();
  const detail = error?.message || String(error || "");
  const code = error?.code ? ` [${error.code}]` : "";
  const where = context.path ? ` (${context.method || "request"} ${context.path})` : "";
  console.error(`[${time}] ✗ ERROR: ${message}${where} — ${detail}${code}`);
}
