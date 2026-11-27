"use strict";

import { locationAreas, esc, asDate, normalizeStatus, statusPill, data, monthKey, monthKeyOffset, analyticsRange } from "../../core.mjs";
import { page, panel, stat, statsStrip } from "../shared.mjs";

export function analyticsPage() {
  const reports = data.reports;
  const totalReports = reports.length;
  const openReports = reports.filter((report) => report.status !== "Resolved").length;
  const resolvedReports = reports.filter((report) => report.status === "Resolved").length;
  const areaNames = [...new Set([...locationAreas(), ...reports.map((report) => report.area).filter(Boolean)])];
  const priorityRank = { High: 3, Medium: 2, Low: 1 };
  const issueGroups = new Map();
  for (const report of reports) {
    if (report.status === "Resolved" || !report.area) continue;
    const issue = report.category || report.title || "—";
    const key = `${report.area}\u0000${issue}`;
    if (!issueGroups.has(key)) issueGroups.set(key, { area: report.area, issue, reports: [], people: new Set() });
    const group = issueGroups.get(key);
    group.reports.push(report);
    group.people.add(report.userEmail || report.name || report.id);
  }
  const attentionByArea = new Map();
  for (const group of issueGroups.values()) {
    const priority = group.reports.reduce(
      (highest, report) => (priorityRank[report.priority || "Medium"] > priorityRank[highest] ? report.priority || "Medium" : highest),
      "Low",
    );
    const highPriority = priorityRank[priority] === priorityRank.High;
    // A high-priority concern is surfaced on its own; repeated issues still
    // need two different residents reporting them.
    if (group.people.size < 2 && !highPriority) continue;
    const oldest = [...group.reports].sort((left, right) => asDate(left.submittedAt) - asDate(right.submittedAt))[0];
    const daysPending = Math.max(0, Math.floor((Date.now() - asDate(oldest.submittedAt).getTime()) / 86400000));
    const item = {
      area: group.area,
      reports: group.reports.length,
      people: group.people.size,
      commonIssue: group.issue,
      daysPending,
      priority,
      highPriority,
    };
    const current = attentionByArea.get(group.area);
    const stronger =
      !current ||
      Number(item.highPriority) > Number(current.highPriority) ||
      (item.highPriority === current.highPriority &&
        (item.people > current.people ||
          (item.people === current.people &&
            (item.daysPending > current.daysPending || (item.daysPending === current.daysPending && item.reports > current.reports)))));
    if (stronger) attentionByArea.set(group.area, item);
  }
  const attention = [...attentionByArea.values()].sort(
    (left, right) =>
      Number(right.highPriority) - Number(left.highPriority) || right.people - left.people || right.daysPending - left.daysPending,
  );
  const byCategory = new Map();
  for (const report of reports) byCategory.set(report.category, (byCategory.get(report.category) || 0) + 1);
  const categoryData = [...byCategory.entries()].sort((left, right) => right[1] - left[1]);
  const chartColors = ["#1e5aa8", "#3486d1", "#57a4e7", "#83bce9", "#f0a343", "#34a879", "#d96f74", "#8068c8"];
  const chartMarkup = ({ id, type, labels, fullLabels = labels, values, colors = [], height, centerValue = "", tableDetails = null }) => {
    const chartNames = {
      category: "Reports by category",
      area: "Reports by area",
      monthly: "Monthly report submissions",
    };
    const chartData = { labels, fullLabels, values, colors };
    const chartName = chartNames[id];
    const tableRows = labels
      .map(
        (_, index) =>
          `<tr><th scope="row">${esc(fullLabels[index])}</th><td>${values[index]}</td>${tableDetails ? `<td>${esc(tableDetails[index])}</td>` : ""}</tr>`,
      )
      .join("");
    const canvas = `<div class="analytics-chart-canvas"${height ? ` style="height:${height}px"` : ""}><canvas data-analytics-chart="${id}" data-chart-type="${type}" data-chart-data="${esc(JSON.stringify(chartData))}" aria-label="${esc(`${chartName}. Focus the chart and use the arrow keys to inspect values.`)}" aria-describedby="${id}-chart-summary ${id}-chart-status" aria-keyshortcuts="ArrowLeft ArrowRight" role="group" tabindex="0"></canvas>${centerValue ? `<div class="analytics-donut-center" aria-hidden="true"><strong>${centerValue}</strong><span>reports</span></div>` : ""}</div>`;
    return `<div class="analytics-chart-shell">${canvas}<p class="analytics-chart-selection" id="${id}-chart-status" role="status" aria-live="polite" aria-atomic="true">Use the arrow keys or point at a chart value to inspect it.</p><p class="visually-hidden" id="${id}-chart-summary">Interactive chart. A data table follows.</p></div><table class="visually-hidden" id="${id}-chart-data"><caption>${esc(chartName)}</caption><thead><tr><th scope="col">${id === "category" ? "Category" : id === "area" ? "Area" : "Month"}</th><th scope="col">Reports</th>${tableDetails ? '<th scope="col">Share</th>' : ""}</tr></thead><tbody>${tableRows}</tbody></table>`;
  };
  const categoryChart = totalReports
    ? `<div class="analytics-donut-layout"><div class="analytics-donut-visual">${chartMarkup({
        id: "category",
        type: "doughnut",
        labels: categoryData.map(([category]) => category),
        values: categoryData.map(([, count]) => count),
        colors: categoryData.map((_, index) => chartColors[index % chartColors.length]),
        centerValue: totalReports,
        tableDetails: categoryData.map(([, count]) => `${Math.round((count / totalReports) * 100)}%`),
      })}</div><ul class="analytics-legend">${categoryData
        .map(
          ([category, count], index) =>
            `<li><span class="analytics-legend-dot" style="--chart-color:${chartColors[index % chartColors.length]}"></span><span>${esc(category)}</span><strong>${count}</strong><small>${Math.round((count / totalReports) * 100)}%</small></li>`,
        )
        .join("")}</ul></div>`
    : `<div class="empty-state"><strong>No reports to chart</strong>Category data will appear when residents submit concerns.</div>`;
  const areaData = areaNames
    .map((area) => [area, reports.filter((report) => report.area === area).length])
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const areaChart = areaData.length
    ? chartMarkup({
        id: "area",
        type: "bar",
        labels: areaData.map(([area]) => area),
        values: areaData.map(([, count]) => count),
        height: Math.max(230, Math.min(420, areaData.length * 38)),
      })
    : `<div class="empty-state"><strong>No areas configured</strong>Area data will appear here when locations are added.</div>`;
  const months = [];
  const range = [3, 6, 12].includes(Number(analyticsRange)) ? Number(analyticsRange) : 6;
  for (let index = range - 1; index >= 0; index -= 1) months.push(monthKeyOffset(-index, new Date()));
  const monthlyData = months.map((month) => reports.filter((report) => monthKey(report.submittedAt) === month).length);
  const monthLabels = months.map((month) =>
    new Intl.DateTimeFormat("en-PH", { month: "short", year: "2-digit" }).format(new Date(`${month}-01T00:00:00`)),
  );
  const monthNames = months.map((month) =>
    new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`)),
  );
  const monthlyChart = chartMarkup({
    id: "monthly",
    type: "line",
    labels: monthLabels,
    fullLabels: monthNames,
    values: monthlyData,
  });
  const attentionRows = attention
    .map(
      (
        item,
      ) => `<div class="record-row attention-record filter-item" role="row" data-search="${esc(`${item.area} ${item.commonIssue} ${item.people}`.toLowerCase())}">
        <div class="record-meta" role="cell"><strong>${esc(item.area)}</strong></div><div role="cell">${item.reports}</div><div class="record-meta" role="cell">${esc(item.commonIssue)}</div><div class="record-meta" role="cell">${item.daysPending} ${item.daysPending === 1 ? "day" : "days"}</div><div role="cell">${statusPill(normalizeStatus(item.priority), item.priority)}</div><div class="record-actions" role="cell"><button class="button secondary small" type="button" data-action="analytics-area-reports" data-area="${esc(item.area)}" data-issue="${esc(item.commonIssue)}">View Reports</button></div>
      </div>`,
    )
    .join("");
  const body = `<div class="content-stack analytics-content">
    ${statsStrip([
      stat("Total Reports", totalReports, "All submitted concerns", "blue", "clipboard"),
      stat("Open Reports", openReports, "Awaiting resolution", "warning", "clock"),
      stat("Resolved Reports", resolvedReports, "Marked resolved", "success", "check"),
      stat("Areas Needing Attention", attention.length, "Repeated issues or high priority", attention.length ? "danger" : "blue", "alert"),
    ])}
    ${panel("Areas Needing Attention", attention.length ? `<div class="analytics-attention-table records" role="table" aria-label="Areas needing attention"><div class="record-row record-head" role="row"><span role="columnheader">Purok / Location</span><span role="columnheader">Number of Concerns</span><span role="columnheader">Most Common Issue</span><span role="columnheader">Longest Pending</span><span role="columnheader">Priority</span><span role="columnheader">Action</span></div>${attentionRows}</div>` : `<div class="empty-state"><strong>No areas need attention</strong>An issue reported by at least two residents in the same area, or any High priority concern, will appear here.</div>`, { subtitle: "Areas with repeated issues or a high-priority concern." })}
    <div class="grid-equal analytics-chart-grid">
      ${panel("Reports by Category", categoryChart, { subtitle: "Share of all reported concerns" })}
      ${panel("Reports by Area", areaChart, { subtitle: "Concern volume across managed locations" })}
    </div>
      ${panel("Monthly Report Submissions", `<div class="analytics-chart-toolbar"><p>Submissions over time</p><label><span class="visually-hidden">Monthly chart range</span><select class="select" data-analytics-range aria-label="Monthly chart range"><option value="3"${range === 3 ? " selected" : ""}>Last 3 months</option><option value="6"${range === 6 ? " selected" : ""}>Last 6 months</option><option value="12"${range === 12 ? " selected" : ""}>Last 12 months</option></select></label></div><div class="analytics-line-wrap">${monthlyChart}</div>`, { subtitle: `Report submissions by month for the last ${range} months.` })}
  </div>`;
  return page("administrator", "analytics", body);
}
