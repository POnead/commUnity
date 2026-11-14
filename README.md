# CommUnity

CommUnity is a community-services portal for residents, barangay officials, and administrators. It provides resident reports, collection schedules, notifications, profile management, role-based workspaces, and an activity view. The Node.js server uses Express for its HTTP middleware and domain API routing.

## Project structure

```text
server/
  index.mjs                Composition root: createCommunityServer(), env wiring, CLI start
  handle-api.mjs           /api dispatcher: origin check, session gate, audit policy, 404
  platform/                Low-level helpers with no domain logic
    http.mjs               HttpError, sendJson, requireJsonBody, multipart parsing
    http-app.mjs           Express wiring: static files, security headers, error handler
    api-router.mjs         Bridges Express to the dispatcher
    db.mjs                 Pool/PGlite connection, withTransaction()
    session.mjs            Sessions, cookies-as-auth, origin checks, trusted proxies
    crypto.mjs             scrypt password hashes, AES-GCM settings encryption
    email.mjs              SMTP mailer, queue, saved-settings loading
    time.mjs               Asia/Manila calendar helpers
    validate.mjs           Shared validators, account helpers
    roles.mjs              ROLES and role_permissions defaults
    uploads.mjs            Photo signature checks, orphan sweep
    ratelimit.mjs          Shared attempt buckets, auth-state pruning
    constants.mjs          MAX_STATE_BYTES, content types
  domains/                 One module per domain; each owns its routes and queries
    auth.mjs               Sign-in, registration, password reset, recovery
    users.mjs              Accounts, profile, profile photos, working hours
    state.mjs              The /api/state sync engine (read/role-scoped save)
    reports.mjs            Concerns: validation, priority/SLA endpoints, photos
    service-targets.mjs    Response vs. resolution targets, service cycles, overdue flags
    schedules.mjs          Collection schedules and reminders
    announcements.mjs      Announcements and calendar events (approval workflow)
    notifications.mjs      Notification insertion and read-state sync
    activity.mjs           Audit log (live + archive), admin browsing/export
    locations.mjs          Community and recycling-list locations
    settings.mjs           Admin SMTP settings
  db/
    migrate.mjs            Migration runner and administrator bootstrap
    migrations/            Numbered, append-only schema migrations
app/
  main.mjs                 Composition root: boots the app, routes, event listeners
  core.mjs                 State, data loading, saving, live updates, shared helpers
  views.mjs                Page renderers and markup builders
  map.mjs                  Leaflet map pickers, pin rendering, event maps, and map state
  constants.mjs            Pure constants (roles, statuses, permissions, defaults)
```

The frontend is buildless vanilla JS as native ES modules under `app/` (`app/main.mjs` imports `app/core.mjs`, `app/views.mjs`, `app/map.mjs`, `app/constants.mjs`) with a strict CSP. Tests live in `test/` — shared fixtures in `test/helpers.mjs`, `test/frontend-stubs.mjs` provides a minimal DOM for importing the real modules, one file per area (`reports`, `users`, `security`, `schedules`, `announcements`, `activity`, `maintenance`, `state`, `platform`, `frontend`, `service-targets`), plus `postgres-migration.test.mjs` (migrations against embedded PostgreSQL). `npm test` runs everything; `npm run test:e2e` runs the Playwright browser suite in `test/e2e/`.

## Run locally

Install Node.js, then install dependencies:

```powershell
npm install
```

Set the first administrator credentials in the same PowerShell window, then start the server. Choose a unique password of at least 8 characters:

```powershell
$env:INITIAL_ADMIN_EMAIL = "admin@gmail.com"
$securePassword = Read-Host "Initial administrator password" -AsSecureString
$env:INITIAL_ADMIN_PASSWORD = [Net.NetworkCredential]::new("", $securePassword).Password
npm start
```

After startup, open the website link printed in the terminal (by default, [http://127.0.0.1:8768](http://127.0.0.1:8768)). The local server binds to loopback only and stores data in `data/pglite/`. Press **Ctrl+C** to stop it. After the first administrator is created, the two `INITIAL_ADMIN_*` variables can be cleared; they will not overwrite an existing administrator.

Resident accounts can register in the portal. Administrators can create official and other accounts. There are no shared demonstration passwords.

### Optional keyless map pin picker

Resident concern reports can include an optional interactive map pin in addition to the required barangay, area, and street or landmark. The map uses Leaflet and OpenStreetMap tiles, so it does not need a Google Maps API key. Residents can click the map or drag the pin; they can still submit without coordinates. Residents see their saved pin in their report details. Officials see a saved pin in the concern detail. Both can optionally open directions in Google Maps; administrators can open saved pins using Google Maps. No device location permission or address-search service is used.

Announcements can be marked as events. When the event option is on, officials and administrators must place a map pin for the event location before publishing; turning the option off removes the pin and saves the announcement as a normal notice. Residents see an event badge and can open the saved pin on an inline map, with a Google Maps link as a fallback.

Map tiles are loaded from the public OpenStreetMap tile service and require an internet connection. Keep the visible OpenStreetMap attribution on the map and follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/); the public tile service is not intended for offline caching or bulk/high-volume use. The coordinates and text location remain part of the CommUnity report if tiles are temporarily unavailable.

### Confirmation prompts

Signing out and every action that saves, updates, approves, declines, deactivates, resets, or removes data asks for confirmation first. Canceling leaves the data and any open form unchanged. Read-only actions such as navigation, filtering, and viewing details do not prompt.

### Concern priority and follow-up limits

Residents choose a concern priority when submitting a report: **High** (immediate danger to health or safety), **Medium** (service disruption affecting daily activity), or **Low** (routine, cosmetic, or nuisance concern). The default is Medium. Officials and administrators can adjust a report's priority later from the concern detail page; the change is logged in the report history, activity feed, and a notification to the resident.

Follow-up limits apply per report, counting all time:

- **High** — unlimited follow-ups
- **Medium** — 5 follow-ups
- **Low** — 3 follow-ups

Existing follow-ups count retroactively. When a resident reaches the limit, the follow-up form is hidden and the server rejects further follow-ups. Resolved concerns no longer accept follow-ups; the follow-up form is hidden and the server returns a conflict if one is attempted. The report detail shows the remaining follow-ups so residents know how many are left.

### Service targets

Every concern carries two independent service targets, both measured from the start of its current service cycle — the moment it was submitted, or the moment it was reopened:

| Priority | First response | Resolution |
| -------- | -------------- | ---------- |
| High     | 1 day          | 7 days     |
| Medium   | 3 days         | 14 days    |
| Low      | 7 days         | 30 days    |

The two targets are judged separately. A concern that has been answered but is still unresolved is no longer flagged as awaiting a response; it is flagged only when it passes its resolution target. The concern list marks either kind as **Overdue**, and the concern detail shows both deadlines, the recorded first response, and the recorded resolution.

Changing the priority recomputes the targets. The first-response target only moves while no response has been recorded, so an answered concern keeps the target it was measured against; the resolution target always follows the current priority. Reopening a resolved concern clears the recorded first response and the recorded resolution, and restarts both targets from the reopen, giving staff a fresh window.

The service cycle is tracked with its own timestamp rather than the submission date, so a concern that was reopened months after it was submitted does not fall back to its original date. A priority change after a reopen still measures from the reopen, and the reopened concern cannot become overdue the moment an official adjusts its priority.

The server owns the timestamps that describe the service lifecycle. When an official records a status update, the server stamps the update, the status history entry, the recorded first response, and the recorded resolution with its own clock; a browser may ask for a status change, but it cannot say when it happened, so a backdated request cannot manufacture a missed or a met target. A newly filed concern is unanswered and unresolved, and the server records when it took the record in, so a resident cannot submit a concern that already claims a first response.

### Dates and time zone

CommUnity serves one barangay, so calendar days are the barangay's days. The application uses **Asia/Manila** for every date decision, independent of the host and the browser:

- PostgreSQL sessions are pinned to the same zone, so `CURRENT_DATE`, new-account join dates, and collection reminders resolve to the barangay's day even when a managed database runs in UTC.
- Collection reminders compare schedules against the barangay's tomorrow, and the reminder text names that date.
- Calendar events and announcements are validated against the barangay's today, not the server's or the viewer's.
- The interface formats dates and timestamps in the barangay's zone, so a resident or official browsing from another time zone still sees the correct day.
- Report deadlines, follow-up limits, and the analytics month buckets use the same zone.

Set `APP_TIME_ZONE` to another IANA zone only if the deployment serves a different municipality.

## Included workflows

- Residents can submit concerns with a barangay, managed purok/area, and street or landmark, optionally add a Google Maps pin, follow report status, and export report coordinates with their reports/history as CSV.
- Officials can review and update concerns, maintain collection schedules, and publish announcements. Administrators can browse all reports, view system monitoring, manage accounts and role permissions, and maintain community locations and recycling/junkshop listings.
- Officials and administrators can mark an announcement as an event and place a map pin for its location. The event toggle can be turned off for notices that do not need a location.
- Signing out and every data-changing action ask for confirmation before applying the change; canceling leaves the current data and open form untouched.
- Administrators have a separate Settings page that organizes links to existing user, role, location, announcement, monitoring, audit, and profile areas without duplicating their forms.
- Upcoming collections generate an in-app notification and, when SMTP is configured, an email for active residents in the scheduled area on the day before pickup. Report submitters and status updates work the same way.
- Residents can view active recycling/junkshop listings after staff add verified details. The directory starts empty; no real business locations are supplied.
- Long report, account, schedule, location, and announcement tables are paginated.
- Administrators browse the activity log from the server, not from a fixed page of loaded rows. The log covers the live table and the archive together and can be filtered by date range, actor, action, result, affected record, and whether the record is current or archived. Each event has a detail view showing its reason, affected record, and client address, and the CSV export includes archived records and those security fields.

## Deploy with managed PostgreSQL

Deploy this Node.js project on a host that supports Node.js and connect a managed PostgreSQL database. Configure these values using the host's **secret/environment-variable settings**, not source code:

| Variable                   | Value                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `production`                                                                                                                                                                                                                                                                                                               |
| `PORT`                     | Supplied by the host                                                                                                                                                                                                                                                                                                       |
| `DATABASE_URL`             | PostgreSQL connection string with TLS enabled. The server always verifies the database certificate                                                                                                                                                                                                                         |
| `DATABASE_CA`              | Optional; PEM CA bundle for a managed database that issues its own private certificate (for example Amazon RDS). Trusts only that CA for the database connection                                                                                                                                                           |
| `APP_ORIGIN`               | Exact public HTTPS origin, for example `https://community.example.com` (no trailing slash)                                                                                                                                                                                                                                 |
| `APP_TIME_ZONE`            | Optional IANA time zone for calendar days, deadlines, reminders and log timestamps (default `Asia/Manila`)                                                                                                                                                                                                                 |
| `INITIAL_ADMIN_EMAIL`      | Email for the first administrator                                                                                                                                                                                                                                                                                          |
| `INITIAL_ADMIN_PASSWORD`   | Unique password of at least 8 characters                                                                                                                                                                                                                                                                                   |
| `PG_POOL_MAX`              | Optional PostgreSQL pool size per instance (default `10`, maximum `100`)                                                                                                                                                                                                                                                   |
| `PG_CONNECTION_TIMEOUT_MS` | Optional PostgreSQL connection timeout in milliseconds (default `5000`)                                                                                                                                                                                                                                                    |
| `TRUSTED_PROXY_IPS`        | Optional comma-separated proxy IPs; only configure proxies that overwrite `X-Forwarded-For`                                                                                                                                                                                                                                |
| `UPLOADS_DIR`              | Photo upload directory (default `data/uploads`); use persistent storage in deployments                                                                                                                                                                                                                                     |
| `SMTP_HOST`                | Optional SMTP server hostname                                                                                                                                                                                                                                                                                              |
| `SMTP_PORT`                | Optional SMTP port, usually `587` or `465`                                                                                                                                                                                                                                                                                 |
| `SMTP_USER`                | Optional SMTP username                                                                                                                                                                                                                                                                                                     |
| `SMTP_PASS`                | Optional SMTP password                                                                                                                                                                                                                                                                                                     |
| `SMTP_FROM`                | Optional sender address, for example `CommUnity <no-reply@example.com>`                                                                                                                                                                                                                                                    |
| `SMTP_SETTINGS_KEY`        | Optional; manages the key used to encrypt saved SMTP credentials. If unset, the server generates a random key file next to the data directory (`data/smtp-settings.key`) on first boot so email works with no setup. Set this to manage the key yourself — and keep it stable so saved credentials can always be decrypted |

Use `npm install` as the build/install command and `npm start` as the start command. The first startup creates a clean database schema and the initial administrator. After verifying that account can sign in, remove the initial administrator secrets from the deployment environment. The bootstrap credentials are only used when the database has no active administrator.
The `/api/healthz` endpoint checks database readiness. Configure the hosting provider's health check against this path. Set `PG_POOL_MAX` to fit the database connection budget across all app instances. Only set `TRUSTED_PROXY_IPS` when the service is reachable exclusively through those trusted proxies and they replace client-supplied forwarding headers.

A managed database is verified only with a public CA by default. Providers that issue their own private certificate will not be trusted until `DATABASE_CA` (or the process-wide `NODE_EXTRA_CA_CERTS`) is set.

### Persistent photo storage

Concern photos and profile photos are files, not database rows. Point `UPLOADS_DIR` at a **persistent disk or volume**, not the ephemeral application filesystem, and mount it at the same path on every instance:

| Host type                 | What to do                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Render / Railway / Fly.io | Attach a persistent disk/volume and set `UPLOADS_DIR` to its mount path (for example `/var/data/community/uploads`) |
| Docker / Kubernetes       | Mount a named volume or persistent volume claim at `UPLOADS_DIR`; do not store uploads in the image layer           |
| Single VPS                | Use a directory outside the deploy/release folder so a redeploy does not delete it                                  |

If the disk is lost, the database rows survive but every photo returns 404; restore the photo backup alongside the database. Photos are served only through authenticated routes (`/api/reports/:id/photos/...` and `/api/profile-photo/:id`), and resident access is limited to their own concern photos. Do not put `UPLOADS_DIR` behind the static file server or make it publicly listable.

### External uptime monitoring

Use a monitor outside the hosting provider to detect an outage that also takes down the provider's own checks. Point it at `https://<your-domain>/api/healthz` and alert when:

- the request fails, times out, or returns anything other than `200`, and
- the JSON body no longer contains `"status":"ok"` and `"database":"available"` (the endpoint returns `503` with `"database":"unavailable"` when PostgreSQL cannot be reached).

Send an alert to a channel someone actually watches, and test the alert path once. Forward the server's structured error logs to an operational logging service; the in-app monitoring page is a summary of loaded records, not an independent uptime check.

Schema setup is applied at startup. The database uses separate tables for accounts and password hashes, reports and status history, report photos, schedules and reminder deduplication, notifications, role permissions, activity, announcements, community locations, and recycling listings, with foreign keys, checks, and indexes. Sessions are stored as hashes in PostgreSQL. Configure the provider's automated backups and test restore procedures before using real information.

Upgrading an existing deployment applies the schema changes at startup and recovers what the new columns need from the records that are already there. A concern that was resolved or answered before the service-target columns existed keeps its moments: the resolution is recovered from the last status-history entry a staff member recorded as **Resolved**, and the first response from the first entry after the concern's current service cycle began. Concerns that were never answered or resolved stay empty, and a moment that is already recorded is left as it is.

**The old local demonstration data is not imported into the new relational schema.** The existing `data/pglite/` directory is left untouched, but the new app will not read its legacy JSON state. Back it up before switching versions. The remote database starts clean as requested.

## Backups

Rehearse a restore before real resident records live in this database.

- **Managed PostgreSQL:** take a logical dump with `pg_dump` (for example `pg_dump --format=custom --file=backup.dump "$DATABASE_URL"`) and restore with `pg_restore` into a fresh database before going live and after every meaningful schema change. A restore into a migrated database is safe as long as the migration-owned seed rows (`schema_migrations`, `app_meta`, `role_permissions`, `community_locations`) are matched on conflict rather than duplicated. The rehearsed restore procedure recovers a logical dump into a freshly migrated database and verifies the row count of every public table.
- **Local PGlite:** the database lives entirely in `data/pglite/`. Stop the server, copy the directory to backup storage, and restore by stopping the server and replacing the directory with the backup copy. Do not copy the directory while the server is running.
- **Uploaded photos:** are stored in `data/uploads/` (or `UPLOADS_DIR`), not in either database, and need their own backup. Photo backups must be restored alongside the matching database.

The same round trip — dump, restore into a fresh database, then verify every table — is automated against a throwaway PostgreSQL 18 cluster:

```powershell
# pg_dump/pg_restore must be on PATH, or point PG_BIN at the PostgreSQL bin directory.
$env:PG_BIN = "C:\Program Files\PostgreSQL\18\bin"
npm run rehearse:restore
```

It seeds a representative row set, takes a custom-format dump, restores it into an empty database, reruns the startup migration, and fails if any table's row count or content checksum differs. Run it after a schema change and before the first real deployment.

## Security notes

- Passwords are hashed on the server with scrypt; browser storage does not contain passwords or session identifiers.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` for shared HTTPS deployments. API writes require the exact configured website origin.
- The server checks roles and ownership, validates request data, rate-limits sign-in, registration, password-change, and photo-upload attempts, and only returns data needed by the signed-in role.
- Sign-in limits are shared through the database across server instances, and expired sign-in limits and sessions are periodically pruned.
- Login limits include both a per-account failure bucket and a per-client request bucket. Forwarded client addresses are used only when the immediate proxy is explicitly trusted.
- The activity log records the actor, action, affected record, outcome, reason, and client address. A refused request is recorded as a security event: a signed-in refusal names that account, and a rejected cross-site request is recorded against the `system` actor, which the audit table accepts. Refusals are recorded once per client address per five-minute window so anonymous traffic cannot bury real events or grow the log without limit. A missing session on a protected endpoint is refused with 401 and is deliberately not recorded; failed sign-ins are recorded separately with their own limit buckets.
- PostgreSQL is accessed only by the server; row-level security is not currently enabled. Add database policies before allowing browser or other untrusted clients to connect directly.
- Email is optional for in-app workflows such as collection reminders and status notices: if SMTP is missing or unavailable, those notices still appear in the app and the server logs the delivery error. Password recovery is the exception: it is refused with a clear error when SMTP is unavailable, so an account is never reset without a way to deliver the new credentials.
- Password recovery uses 15-minute single-use reset tokens. A recovery email only authorizes a reset once the account owner has confirmed it through the emailed verification link; an unconfirmed address is never used to authorize recovery. Reset requests are limited per client address and per recovery address, held back by a short resend cooldown, and a repeat request never cancels a link that was already sent.
- The monitoring page summarizes the latest loaded database records; it is not external uptime monitoring or a security audit. Use `/api/healthz` for provider readiness checks and forward the server's structured error logs to an operational logging service.
- Security headers include a restrictive Content Security Policy. The local server refuses non-loopback binds unless it is configured with a managed database and HTTPS origin.
- The report map uses OpenStreetMap's public tile service without an API key; follow its attribution and usage policy.
- Resident sign-up is not email-verified. Do not treat an account email address as a verified identity. A recovery email becomes usable for password recovery only after the owner confirms it, and administrators can still issue a reset directly when a resident cannot receive mail.
- Report photos are stored as files under `UPLOADS_DIR`; the database stores only authenticated photo URLs. Only JPEG and PNG files are accepted, checked by their file signature rather than the browser's declared type, and abandoned uploads older than a day are removed by the maintenance job. Back up the directory and use a persistent volume in deployment. A large public service should later move files to private object storage.
- This is not a security certification. Before using real resident records, review privacy/legal obligations, account recovery, access retention, backup/restore, monitoring, and the hosting provider's TLS, database-network, and at-rest encryption settings.

Run the API, authentication, role-access, and persistence checks with:

```powershell
npm test
```

The suite runs one file at a time. Every file starts its own database and HTTP server, and running them in parallel makes Windows contend for the embedded PostgreSQL and WASM database resources, which produces false failures and occasional cleanup hangs.

Browser end-to-end tests live in `test/e2e/` and drive a real Chromium through the critical paths (register, sign in, report submission with a map pin and photos, official review, notifications, reopening, announcement approval, collection schedules, and form preservation during the automatic refresh). They use a throwaway embedded database seeded by the test server, so nothing is shared between runs.

```powershell
npm install        # one-time: installs @playwright/test
npx playwright install chromium   # one-time: downloads the browser
npm run test:e2e
```

The e2e suite runs serially against one shared server instance on port 8799.
