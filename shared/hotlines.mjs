// Emergency hotline categories and availability are shared by the server's
// validation and the browser dropdowns so the two lists can never drift.
export const HOTLINE_CATEGORIES = ["Barangay Office", "Police", "Fire Department", "Medical"];

export const HOTLINE_STATUSES = ["Active", "Inactive"];

// "Inactive" is the stored value; residents read it as a temporary outage rather
// than a deletion, so the public label is spelled out for them.
export const HOTLINE_STATUS_LABELS = { Active: "Active", Inactive: "Temporarily unavailable" };

// The only fields an official may propose in a correction or suggestion. The
// server reads nothing else from the request, so this list is the allowlist.
export const HOTLINE_CORRECTION_FIELDS = [
  "name",
  "category",
  "contactNumber",
  "alternativeContactNumber",
  "officeAddress",
  "description",
  "operatingHours",
];
