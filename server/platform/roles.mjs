export const ROLES = ["resident", "official", "administrator"];

// Compatibility re-export: state.mjs and migrate.mjs still import PERMISSIONS.
export { DEFAULT_PERMISSIONS as PERMISSIONS } from "../../shared/domain-rules.mjs";
