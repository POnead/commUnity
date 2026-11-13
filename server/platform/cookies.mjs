export const SESSION_COOKIE = "community_session";
export const SESSION_HOURS = 12;
export const REMEMBER_DAYS = 30;

export function cookieValue(request, name) {
  for (const part of (request.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

export function cookieHeader(token, { secure, remember = false } = {}) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    ...(remember ? [`Max-Age=${REMEMBER_DAYS * 86400}`] : []),
  ].join("; ");
}

export function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
