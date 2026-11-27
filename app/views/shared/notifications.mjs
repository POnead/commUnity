"use strict";

import {
  actionButton,
  currentUser,
  data,
  dateTimeLabel,
  displayReferenceText,
  displayReportId,
  esc,
  getReport,
  icon,
  notificationFilter,
  sortedNotifications,
} from "../../core.mjs";
import { page, panel } from "./shell.mjs";

export function notificationsPage(role) {
  const notifications = sortedNotifications(data.notifications.filter((item) => item.targetEmail === currentUser.email));
  const reportUpdates = notifications.filter((item) => item.reportId);
  // Shortcut: account notices are recognised by title. A notification kind
  // column would be cleaner but needs a schema migration across all producers.
  const accountUpdates = notifications.filter((item) =>
    /ID verification|ID submitted|Password reset|Account deactivat|Account reactivat|email (?:verified|changed)/i.test(item.title),
  );
  const serviceUpdates = notifications.filter((item) => !item.reportId && !accountUpdates.includes(item));
  const visible =
    notificationFilter === "unread"
      ? notifications.filter((item) => !item.read)
      : notificationFilter === "read"
        ? notifications.filter((item) => item.read)
        : notificationFilter === "reports"
          ? reportUpdates
          : notificationFilter === "account"
            ? accountUpdates
            : notificationFilter === "service"
              ? serviceUpdates
              : notifications;
  const unread = notifications.filter((item) => !item.read).length;
  const emptyLabel =
    notificationFilter === "read"
      ? "No read notifications"
      : notificationFilter === "unread"
        ? "All caught up"
        : notificationFilter === "reports"
          ? "No report updates"
          : notificationFilter === "account"
            ? "No account updates"
            : notificationFilter === "service"
              ? "No service updates"
              : "No notifications yet";
  const emptyDetail =
    notificationFilter === "reports"
      ? "There are no updates for your concerns yet."
      : notificationFilter === "account"
        ? "Verifications, password changes and account decisions will appear here."
        : notificationFilter === "service"
          ? "There are no collection or barangay service updates yet."
          : `There are no ${notificationFilter === "unread" ? "unread " : notificationFilter === "read" ? "read " : ""}updates for this account.`;
  const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const notificationSearch = (item) => {
    const report = item.reportId ? getReport(item.reportId) : null;
    return `${item.title} ${item.body} ${report ? displayReportId(report) : ""}`.toLowerCase();
  };
  const reportIdRefs = new Map((data.reports || []).filter((report) => report?.id).map((report) => [report.id, displayReportId(report)]));
  const body = `
    <div class="content-stack ${role === "resident" ? "resident-notifications-page" : ""}">
      ${panel(
        "Notification inbox",
        `<div class="notification-toolbar"><div class="filter-row" role="group" aria-label="Filter notifications">${[
          ["all", "All", notifications.length],
          ["unread", "Unread", unread],
          ["read", "Read", notifications.length - unread],
          ["reports", "Report updates", reportUpdates.length],
          ["account", "Account", accountUpdates.length],
          ["service", "Service updates", serviceUpdates.length],
        ]
          .map(
            ([value, label, count]) =>
              `<button type="button" class="filter-button ${notificationFilter === value ? "selected" : ""}" data-action="filter-notifications" data-value="${value}" aria-pressed="${notificationFilter === value}">${label} <span class="filter-count">${count}</span></button>`,
          )
          .join(
            "",
          )}</div>${unread ? actionButton("Mark all as read", "mark-all-read", "secondary", "small") : ""}</div><div class="notification-breakdown"><span>${countLabel(reportUpdates.length, "report update", "report updates")}</span><span>${countLabel(accountUpdates.length, "account update", "account updates")}</span><span>${countLabel(serviceUpdates.length, "service update", "service updates")}</span></div>
        <div class="notification-list records" data-page-size="5" role="list" aria-label="Notifications">${visible.length ? visible.map((item) => `<article class="notification-item filter-item ${item.read ? "" : "notification-unread"}" role="listitem" data-search="${esc(notificationSearch(item))}"><span class="notification-icon">${icon(item.reportId ? "clipboard" : accountUpdates.includes(item) ? "shield" : /event|calendar/i.test(item.title) ? "calendar" : "bell")}</span><div class="notification-content"><div class="notification-title"><strong>${esc(item.title)}</strong></div><p>${esc(displayReferenceText(item.body, reportIdRefs))}</p><div class="notification-meta"><span>${esc(dateTimeLabel(item.createdAt))}</span>${item.reportId ? `<button type="button" class="text-button" data-action="view-notification-report" data-id="${esc(item.reportId)}">View report</button>` : ""}</div></div><span class="notification-state" data-read="${item.read}">${item.read ? "Read" : "Unread"}</span>${item.read ? "" : `<button class="button secondary small notification-read-button" type="button" data-action="mark-read" data-id="${esc(item.id)}">Mark as read</button>`}</article>`).join("") : `<div class="empty-state"><strong>${emptyLabel}</strong>${emptyDetail}</div>`}</div>`,
        {
          icon: "bell",
          className: role === "resident" ? "resident-account-panel" : "",
          subtitle: `${unread} unread · ${notifications.length} total`,
        },
      )}
    </div>`;
  return page(role, "notifications", body);
}
