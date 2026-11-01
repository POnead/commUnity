# CommUnity

CommUnity is a community-services portal for residents, barangay officials, and administrators. It provides resident reports, collection schedules, notifications, profile management, role-based workspaces, and an activity view.

## Run locally

Install Node.js, then install dependencies:

```powershell
npm install
```

Set the first administrator credentials in the same PowerShell window, then start the server. Choose a unique password of at least 12 characters:

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

Map tiles are loaded from the public OpenStreetMap tile service and require an internet connection. Keep the visible OpenStreetMap attribution on the map and follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/); the public tile service is not intended for offline caching or bulk/high-volume use. The coordinates and text location remain part of the CommUnity report if tiles are temporarily unavailable.

## Included workflows

- Residents can submit concerns with a barangay, managed purok/area, and street or landmark, optionally add a Google Maps pin, follow report status, and export report coordinates with their reports/history as CSV.
- Officials can review and update concerns, maintain collection schedules, and publish announcements. Administrators can browse all reports, view system monitoring, manage accounts and role permissions, and maintain community locations and recycling/junkshop listings.
- Upcoming collections generate an in-app notification for active residents in the scheduled area on the day before pickup. Report submitters receive an in-app confirmation; assigned staff receive an in-app notice.
- Residents can view active recycling/junkshop listings after staff add verified details. The directory starts empty; no real business locations are supplied.
- Long report, account, schedule, location, and announcement tables are paginated.

## Deploy with managed PostgreSQL

Deploy this Node.js project on a host that supports Node.js and connect a managed PostgreSQL database. Configure these values using the host's **secret/environment-variable settings**, not source code:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Supplied by the host |
| `DATABASE_URL` | PostgreSQL connection string with TLS enabled |
| `APP_ORIGIN` | Exact public HTTPS origin, for example `https://community.example.com` (no trailing slash) |
| `INITIAL_ADMIN_EMAIL` | Email for the first administrator |
| `INITIAL_ADMIN_PASSWORD` | Unique password of at least 12 characters |
| `PG_POOL_MAX` | Optional PostgreSQL pool size per instance (default `10`, maximum `100`) |
| `PG_CONNECTION_TIMEOUT_MS` | Optional PostgreSQL connection timeout in milliseconds (default `5000`) |
| `TRUSTED_PROXY_IPS` | Optional comma-separated proxy IPs; only configure proxies that overwrite `X-Forwarded-For` |

Use `npm install` as the build/install command and `npm start` as the start command. The first startup creates a clean database schema and the initial administrator. After verifying that account can sign in, remove the initial administrator secrets from the deployment environment. The bootstrap credentials are only used when the database has no active administrator.
The `/healthz` endpoint checks database readiness. Configure the hosting provider's health check against this path. Set `PG_POOL_MAX` to fit the database connection budget across all app instances. Only set `TRUSTED_PROXY_IPS` when the service is reachable exclusively through those trusted proxies and they replace client-supplied forwarding headers.

Schema setup is applied at startup. The database uses separate tables for accounts and password hashes, reports and status history, report photos, schedules and reminder deduplication, notifications, role permissions, activity, announcements, community locations, and recycling listings, with foreign keys, checks, and indexes. Sessions are stored as hashes in PostgreSQL. Configure the provider's automated backups and test restore procedures before using real information.

**The old local demonstration data is not imported into the new relational schema.** The existing `data/pglite/` directory is left untouched, but the new app will not read its legacy JSON state. Back it up before switching versions. The remote database starts clean as requested.

## Security notes

- Passwords are hashed on the server with scrypt; browser storage does not contain passwords or session identifiers.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` for shared HTTPS deployments. API writes require the exact configured website origin.
- The server checks roles and ownership, validates request data, rate-limits sign-in and registration attempts, and only returns data needed by the signed-in role.
- Sign-in limits are shared through the database across server instances, and expired sign-in limits and sessions are periodically pruned.
- Login limits include both a per-account failure bucket and a per-client request bucket. Forwarded client addresses are used only when the immediate proxy is explicitly trusted.
- PostgreSQL is accessed only by the server; row-level security is not currently enabled. Add database policies before allowing browser or other untrusted clients to connect directly.
- Collection reminders and report notices are in-app only. Email/SMS delivery, verified identities, live route tracking, and emergency dispatch are not configured.
- The monitoring page summarizes the latest loaded database records; it is not external uptime monitoring or a security audit. Use `/healthz` for provider readiness checks and forward the server's structured error logs to an operational logging service.
- Security headers include a restrictive Content Security Policy. The local server refuses non-loopback binds unless it is configured with a managed database and HTTPS origin.
- The report map uses OpenStreetMap's public tile service without an API key; follow its attribution and usage policy.
- Resident sign-up is not email-verified, and password recovery is not configured. Do not treat an email address as a verified identity. Set up an email verification/recovery provider before relying on those workflows.
- Report photos are stored in the database; a large public service should move them to private object storage with access controls and retention rules.
- This is not a security certification. Before using real resident records, review privacy/legal obligations, account recovery, access retention, backup/restore, monitoring, and the hosting provider's TLS, database-network, and at-rest encryption settings.

Run the API, authentication, role-access, and persistence checks with:

```powershell
npm test
```
