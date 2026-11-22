// Approved hotline suggestions must appear in the directory. Earlier builds
// created them as unpublished drafts, leaving approved requests showing "Draft"
// in the hotline list. Publish any hotline created from an approved suggestion.
export default {
  version: 9,
  statements: [
    `UPDATE emergency_hotlines AS h
        SET published = TRUE, updated_at = now()
       FROM hotline_corrections AS c
      WHERE c.hotline_id = h.id
        AND c.kind = 'suggestion'
        AND c.status = 'approved'
        AND h.published = FALSE`,
  ],
};
