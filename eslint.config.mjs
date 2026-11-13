// CommUnity is buildless vanilla JS plus native ES modules on both sides of
// the HTTP boundary, so the lint setup stays small: correctness rules, no
// stylistic opinions beyond what the codebase already does (Prettier owns
// formatting).
import js from "@eslint/js";

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  FormData: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FormDataEvent: "readonly",
  DOMParser: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  MouseEvent: "readonly",
  location: "readonly",
  navigator: "readonly",
  history: "readonly",
  alert: "readonly",
  confirm: "readonly",
  prompt: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  console: "readonly",
  Intl: "readonly",
  structuredClone: "readonly",
  L: "readonly", // Leaflet, loaded as a plain script tag
};

const nodeGlobals = {
  process: "readonly",
  Buffer: "readonly",
  console: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Intl: "readonly",
  structuredClone: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  FormData: "readonly",
  Blob: "readonly",
  AbortController: "readonly",
};

export default [
  {
    ignores: ["node_modules/**", "data/**", "ui-screenshot/**", "pdf files/**", "logo/**", ".github/**"],
  },
  js.configs.recommended,
  {
    files: ["server/**/*.mjs", "*.mjs", "test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Browser scripts run as classic scripts sharing one global scope, not as
    // modules, so cross-file globals and implicit browser globals are expected.
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-undef": "off", // classic scripts share one global scope across files
      "no-redeclare": "off",
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
