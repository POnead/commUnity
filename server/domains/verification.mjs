"use strict";

// Identity verification: resident-submitted IDs reviewed by administrators,
// staff face duty checks. The browser does the face ML; the server stores
// embeddings and does the math. See the modules under ./verification/.

export { defaultVerificationSettings } from "./verification/settings.mjs";
export { readVerificationSettings } from "./verification/settings.mjs";
export { suggestIdFields } from "./verification/match.mjs";
export { idMatchCheck } from "./verification/match.mjs";
export { buildIdSignals } from "./verification/match.mjs";
export { handleVerification } from "./verification/route.mjs";
