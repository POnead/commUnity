# CommUnity

An HTML/CSS/JavaScript prototype for the resident, barangay-official, and administrator flows in the supplied project documents. The browser code is separated into `app-core.js` (shared data and helpers), `app-views.js` (screens and markup), and `app.js` (routing, actions, and startup). No build step, backend, or database is required: open `index.html` in a current browser.

## Try a workspace

The sign-in screen offers one-click sample accounts for each workspace. To sign in through the form, use the displayed sample addresses and shared demo password. Public registration creates a resident account.

## Prototype data

Accounts, sample reports, collection schedules, and in-app notification changes are kept in this browser's local storage. Use **Reset demonstration data** in administrator settings to restore the starter dataset, or clear this page's site data in your browser.

This front-end-only demonstration does not securely authenticate users or enforce permissions against a server. Do not enter real resident details, passwords used elsewhere, or other sensitive information. Sample contact information and service details are not verified; confirm them before any live deployment.

Reports are stored only in this browser. The prototype does not notify barangay staff or contact emergency services, so do not wait for a response here if someone is in immediate danger.
