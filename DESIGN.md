# CommUnity design system

## Source and surface

This application surface is an operational portal, not a marketing page. The visual reference is `pdf files/design.pdf`, which shows resident, official, and administrator views in a restrained civic interface. Keep its useful structure: a labeled left navigation, modest page titles, clear report tables, and an open light canvas.

## Direction

**The barangay noticeboard, translated into a working civic service portal.** Prioritize clear service information, current concern status, and practical actions over decorative dashboard chrome.

Warmth comes from material choices, not decoration: warm ink text on a light warm canvas, the actual Palsara photograph as locality mark with caption, and civic-blue navigation that feels like a neighborhood service desk rather than an institution. Let verified place and service information carry the character rather than invented local symbols.

## Role palettes

Role comes from the signed-in account; never present the resident theme before sign-in or let a user choose privileged roles during public registration.

| Workspace         | Main hue   | Surface treatment                                                                           |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------- |
| Resident          | Civic blue | Cool blue navigation and focus tints on a white/off-white canvas                            |
| Barangay Official | Calm teal  | Pale teal navigation and restrained service-status marks                                    |
| Administrator     | Graphite   | Neutral graphite navigation, borders, and controls; status colors retain their own meanings |

Use text-only status labels with restrained semantic text colors for success, warning, and urgent states. Keep these status colors consistent across all themes; role theme changes do not recolor historical report statuses.

## Type and layout

- Use a single readable sans-serif family and tabular numerals for comparable data. A distinctive display face may be used for page titles and the locality mark — font selection is pending verification offline.
- Keep page titles around 24px, section headings around 16px, and body text at 14–16px.
- Use a labeled 232px desktop sidebar, a single fluid content column/grid, and one consistent 16–24px gutter.
- Use compact, deliberate panels with light edges or a tonal fill; do not combine resting borders with shadows.
- On narrow screens, fold navigation into an accessible menu and stack workspace content without horizontal page overflow.
- Layout is hybrid: a grid-disciplined work surface for tables, forms, and role grids, with a bounded editorial noticeboard zone (locality photo + caption, pinned announcements) confined to the header area. The two zones share one 8px spatial scale and one type system.

## Components and states

- Use sentence-case navigation and table headings, visible focus, clear button labels, and status text as well as color.
- Use flat role-colored actions sparingly, restrained semantic status text, light row separators, and consistently right-aligned tabular numbers.
- Preserve visible empty, error, disabled, confirmation, selected, and urgent states.
- Show one role's grouped permissions at a time, with explicit save and discard actions.
- Warn before navigation, sign-out, or reload would discard unsaved role changes; permission updates remain explicit.
- Urgent-report guidance must disclose that the prototype sends no report or response; never invent local contact details or response times.
- Reports and other administrative data in this prototype are local sample data and never constitute live barangay records.

## Motion

Keep app navigation and data transitions immediate. Use motion only as brief, reduced-motion-aware feedback on controls and the mobile navigation.
