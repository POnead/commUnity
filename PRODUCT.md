# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
HTML, CSS, and JavaScript client with a Node.js HTTP server, server-side authentication, and relational PGlite or managed PostgreSQL storage.

## Users
- Residents of Balete, Batangas who need to check barangay collection services, report community concerns, and follow up on their reports.
- Barangay officials who need to review and update resident concerns and collection schedules.
- Administrators who need to manage user accounts, roles, and system activity.

## Product Purpose
CommUnity is a proposed digital platform for barangay concern management and service tracking. Its intended workflows connect resident issue reporting and follow-up with garbage collection schedules and service updates.

## Positioning
The proposal brings community-concern management and barangay collection-service tracking into one platform.

## Operating Context
Residents report concerns such as road damage, damaged streetlights, drainage issues, flooding, illegal dumping, and missed collection. A report may include a description, photos, urgency, and a selected barangay area such as a purok. Residents follow status changes from Submitted through Under Review and In Progress to Resolved. Officials review concerns and manage collection schedules and service status. Administrators manage accounts, roles, audit activity, community locations, and directory listings.

## Capabilities and Constraints
- The source documents describe resident registration, role-based portal access, concern and urgent reporting, photo attachments, area selection, report tracking and history, collection schedules and status changes, notifications, user and role management, system monitoring, audit records, and profiles.
- Residents can browse administrator-maintained community areas and verified recycling/junkshop listings, and provide barangay, purok/area, and street or landmark details with a report.
- Resident reports can optionally include a Leaflet/OpenStreetMap map pin; the existing text location remains required, and staff can open saved coordinates using the Google Maps website.
- Administrators monitor all reports and service activity, manage locations and directory listings, and export reports and report history. Officials and administrators can manage announcements.
- Administrators can reset another account's password from user management; resets close that account's existing sessions.
- Officials can claim unassigned concerns and release their own assignments for team handoff. New status-history entries record the staff member who made the update; older entries remain unattributed.
- Collection reminders and report-submission/status notices are stored in the shared database and shown in account notifications. A scheduled job creates an in-app reminder the day before an eligible collection.
- Role checks, sessions, and data writes are enforced server-side. Local PGlite is loopback-only; shared deployments use managed PostgreSQL and HTTPS.
- No email or SMS delivery, verified identity, live collection tracking, or emergency-service dispatch is included. Collection statuses are manually maintained.
- Directory records and operational information must be verified by barangay staff. No real recycling-business dataset is supplied.
- The optional map uses public OpenStreetMap tiles and needs internet access; map attribution and public tile-service usage limits apply.

## Brand Commitments
The product is named CommUnity. The supplied screen-reference PDF uses the eCommunity wordmark and a light, blue resident interface. The requested implementation keeps the resident blue identity, with separate teal official and graphite administrator themes.

## Evidence on Hand
- `CommUnity (1).pdf`: the proposed system, audience, objectives, and functional/non-functional requirements.
- `CommUnity_DFD_Reference(1).pdf`: user roles, flows, entities, and system requirements.
- `ui-figma/design.pdf`: an 18-screen reference for the resident, barangay-official, and administrator portals.
- No production database, verified barangay dataset, or live-service integration is supplied.

## Product Principles
- Keep the resident reporting and barangay service workflows together.
- Show report status and next steps clearly to residents and officials.
- Make urgency distinguishable from ordinary concern status.
- Keep each workspace and its available actions appropriate to its role.

## Accessibility & Inclusion
Use clear labels, readable contrast and type, responsive layouts, keyboard-operable controls, and understandable status language.
