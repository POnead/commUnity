# CommUnity design system

## Source and surface
This application surface is an operational portal, not a marketing page. The visual reference is `ui-figma/design.pdf`, which shows resident, official, and administrator views in a restrained civic interface. Keep its useful structure: a labeled left navigation, modest page titles, clear report tables, and an open light canvas.

## Direction
**The barangay noticeboard, translated into a working civic service portal.** Prioritize clear service information, current concern status, and practical actions over decorative dashboard chrome.

The app-style draw is Accent ladder (seed 1293282914): one role hue carries small actions and data; pale tints carry active navigation and restrained grouping. Keep that move while preserving the reference's lighter, welcoming blue resident identity.

Use a pinned noticeboard mark and a Balete locality caption to ground the identity in the service itself. Let verified place and service information carry the character rather than invented local symbols.

## Role palettes
Role comes from the signed-in account; never present the resident theme before sign-in or let a user choose privileged roles during public registration.

| Workspace | Main hue | Surface treatment |
|---|---|---|
| Resident | Civic blue | Cool blue navigation and focus tints on a white/off-white canvas |
| Barangay Official | Calm teal | Pale teal navigation and restrained service-status marks |
| Administrator | Graphite | Neutral graphite navigation, borders, and controls; status colors retain their own meanings |

Use text-only status labels with restrained semantic text colors for success, warning, and urgent states. Keep these status colors consistent across all themes; role theme changes do not recolor historical report statuses.

## Type and layout
- Use a single readable system sans-serif family and tabular numerals for comparable data.
- Keep page titles around 24px, section headings around 16px, and body text at 14–16px.
- Use a labeled 232px desktop sidebar, a single fluid content column/grid, and one consistent 16–24px gutter.
- Use compact, deliberate panels with light edges or a tonal fill; do not combine resting borders with shadows.
- On narrow screens, fold navigation into an accessible menu and stack workspace content without horizontal page overflow.

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
