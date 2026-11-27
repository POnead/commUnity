"use strict";

import { handleSettingsRoutes } from "./settings.mjs";
import { handleFaceRoutes } from "./face.mjs";
import { handleIdRoutes } from "./id.mjs";

export async function handleVerification(request, response, db, options, user) {
  const { uploadsDir, trustedProxyAddresses, ocrClient, faceppClient } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const ctx = { request, response, db, user, url, uploadsDir, trustedProxyAddresses, ocrClient, faceppClient };
  if (await handleSettingsRoutes(ctx)) return true;
  if (await handleFaceRoutes(ctx)) return true;
  if (await handleIdRoutes(ctx)) return true;
  return false;
}
