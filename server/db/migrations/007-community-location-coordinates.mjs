export default {
  version: 7,
  name: "community_location_coordinates",
  statements: [
    `ALTER TABLE community_locations ADD COLUMN IF NOT EXISTS latitude double precision;`,
    `ALTER TABLE community_locations ADD COLUMN IF NOT EXISTS longitude double precision;`,
    `ALTER TABLE community_locations DROP CONSTRAINT IF EXISTS community_locations_coordinates_check;`,
    `ALTER TABLE community_locations ADD CONSTRAINT community_locations_coordinates_check
      CHECK (
        (latitude IS NULL) = (longitude IS NULL) AND
        (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
      );`,
  ],
};
