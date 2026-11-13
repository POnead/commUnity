// Minimal browser environment for the ES-module frontend tests. Node provides
// fetch/FormData/Response/structuredClone/Intl natively, so only DOM and
// window-shaped stubs are needed. Import this module first — ESM evaluates
// imports in order — before any app module is loaded.

const stubElement = () => ({
  textContent: "",
  innerHTML: "",
  value: "",
  checked: false,
  hidden: false,
  disabled: false,
  dataset: {},
  style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  append() {},
  focus() {},
  remove() {},
  click() {},
  reset() {},
  getContext: () => null,
});

globalThis.document = {
  getElementById: () => stubElement(),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => stubElement(),
  documentElement: { dataset: {}, style: {} },
  addEventListener() {},
  removeEventListener() {},
  body: { append() {}, style: {} },
};

globalThis.window = {
  location: { hash: "" },
  addEventListener() {},
  removeEventListener() {},
  history: { replaceState() {} },
  confirm: () => true,
};
globalThis.confirm = () => true;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// Node 24 provides a native BroadcastChannel global; the app only creates one
// when the constructor type check passes, and an open channel pins the event
// loop open. Hide it so the ES-module app boots without one.
globalThis.BroadcastChannel = undefined;

try {
  Object.defineProperty(globalThis, "navigator", {
    value: { geolocation: undefined, userAgent: "node" },
    configurable: true,
  });
} catch {
  // Node already defines navigator; leave it.
}

// Consistent empty workspace / resident account for tests that do not care about state.
export function freshWorkspace() {
  return {
    version: 1,
    users: [],
    reports: [],
    schedules: [],
    notifications: [],
    activities: [],
    announcements: [],
    calendarEvents: [],
    locations: [],
    recyclingLocations: [],
    permissions: {},
    accountOverrides: {},
  };
}

export function freshUser(overrides = {}) {
  return {
    id: "test-user",
    name: "Resident Example",
    email: "resident@example.test",
    role: "resident",
    status: "Active",
    area: "Purok 1",
    ...overrides,
  };
}
