// CommUnity is buildless vanilla JS plus native ES modules on both sides of
// the HTTP boundary, so the lint setup stays small: correctness rules, no
// stylistic opinions beyond what the codebase already does (Prettier owns
// formatting).
import js from "@eslint/js";

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
    ignores: ["node_modules/**", "data/**", "ui-screenshot/**", "pdf files/**", "logo/**", ".github/**", ".run/**"],
  },
  js.configs.recommended,
  {
    files: ["server/**/*.mjs", "scripts/**/*.mjs", "*.mjs", "test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      // Browser globals for the expressions Playwright evaluates in page.evaluate().
      globals: { ...nodeGlobals, document: "readonly", window: "readonly" },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Browser ES modules share one global scope by default; `no-undef` enumerates
    // every name that must come in through an explicit import.
    files: ["app/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        document: "readonly",
        window: "readonly",
        location: "readonly",
        navigator: "readonly",
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
        URL: "readonly",
        URLSearchParams: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        Intl: "readonly",
        structuredClone: "readonly",
        BroadcastChannel: "readonly",
        L: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        queueMicrotask: "readonly",
        createImageBitmap: "readonly",
        Image: "readonly",
        crypto: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
