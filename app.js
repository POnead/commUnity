"use strict";

let reportMapExpanded = false;
let reportMapSelection = null;
let reportMap = null;
let reportMapElement = null;
let reportMapMarker = null;
let reportDetailMap = null;
let reportDetailMapElement = null;

function routeState() {
  const path = currentPath();
  if (!currentUser) {
    if (path[0] === "register") return { type: "register" };
    if (path[0] === "forgot-password") return { type: "forgot-password" };
    if (path[0] === "reset-password") return { type: "reset-password" };
    return { type: "login" };
  }
  const role = currentUser.role;
  if (path[0] !== role) return { type: "app", role, page: "dashboard" };
  const requestedPage = path[1] || "dashboard";
  const pageName = role === "official" && requestedPage === "urgent" ? "concerns" : requestedPage;
  const pages = {
    resident: ["dashboard", "calendar", "collection", "report", "reports", "history", "notifications", "profile"],
    official: ["dashboard", "calendar", "concerns", "collection", "history", "announcements", "notifications", "profile"],
    administrator: ["dashboard", "calendar", "reports", "approvals", "analytics", "monitoring", "notifications", "users", "locations", "announcements", "roles", "activity", "audit", "settings", "email", "profile"],
  };
  const resolvedPage = pages[role]?.includes(pageName) ? pageName : "dashboard";
  if (!canOpenPage(currentUser, resolvedPage)) {
    window.history.replaceState(null, "", routeUrl(role, "dashboard"));
    queueMicrotask(() => toast("That workspace page is not enabled for this role.", "error"));
    return { type: "app", role, page: "dashboard" };
  }
  return { type: "app", role, page: resolvedPage };
}

function render() {
  if (!data) return;
  const route = routeState();
  currentRoute = route;
  if (route.type !== "app" || route.role !== "resident" || route.page !== "report") {
    reportMapExpanded = false;
    reportMapSelection = null;
    reportMap?.remove();
    reportMap = null;
    reportMapElement = null;
    reportMapMarker = null;
  }
  if (currentUser && route.type === "app") {
    if (currentUser.requiresPasswordChange && !modalState && !forcedPasswordDismissed) modalState = { kind: "forced-password" };
    document.documentElement.dataset.theme = ROLE_THEME[currentUser.role];
    if (window.location.hash !== routeUrl(currentUser.role, route.page)) {
      window.history.replaceState(null, "", routeUrl(currentUser.role, route.page));
    }
    let markup;
    if (route.role === "resident") {
      if (route.page === "dashboard") markup = dashboardResident();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "collection") markup = collectionResident();
      else if (route.page === "report") markup = reportPage();
      else if (route.page === "reports" || route.page === "history") markup = reportsPage("resident", route.page);
      else if (route.page === "notifications") markup = notificationsPage("resident");
      else markup = profilePage("resident");
    } else if (route.role === "official") {
      if (route.page === "dashboard") markup = dashboardOfficial();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "collection") markup = collectionOfficial();
      else if (route.page === "concerns" || route.page === "history") markup = reportsPage("official", route.page);
      else if (route.page === "notifications") markup = notificationsPage("official");
      else if (route.page === "announcements") markup = announcementsPage("official");
      else markup = profilePage("official");
    } else {
      if (route.page === "dashboard") markup = dashboardAdmin();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "reports") markup = reportsPage("administrator", "reports");
      else if (route.page === "approvals") markup = approvalsPage();
      else if (route.page === "analytics") markup = analyticsPage();
      else if (route.page === "notifications") markup = notificationsPage("administrator");
      else if (route.page === "users") markup = usersPage();
      else if (route.page === "locations") markup = locationsPage();
      else if (route.page === "announcements") markup = announcementsPage("administrator");
      else if (route.page === "activity") markup = activityLogPage();
      else if (route.page === "roles") markup = rolesPage();
      else if (route.page === "settings") markup = settingsPage();
      else if (route.page === "email") markup = emailPage();
      else markup = profilePage("administrator");
    }
    app.innerHTML = markup;
    if (route.role === "administrator" && (route.page === "settings" || route.page === "email")) loadSmtpSettings();
    updatePagination();
    if (route.role === "resident" && route.page === "report" && reportMapExpanded) initializeReportMap();
    if (modalState) {
      const input = app.querySelector(".modal input:not([type=hidden]), .modal select");
      if (input) requestAnimationFrame(() => input.focus());
    }
  } else {
    document.documentElement.dataset.theme = "auth";
    if (route.type === "register") app.innerHTML = registerMarkup();
    else if (route.type === "forgot-password") app.innerHTML = forgotPasswordMarkup();
    else if (route.type === "reset-password") {
      const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";
      app.innerHTML = resetPasswordMarkup(token);
    } else app.innerHTML = loginMarkup();
    if (modalState) app.insertAdjacentHTML("beforeend", modalMarkup());
  }
  initializeReportDetailMap();
  lastKnownHash = window.location.hash;
}

function makeModal(title, body) {
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></header>
    <div class="modal-content">${body}</div>
  </section></div>`;
}

function modalMarkup() {
  if (modalState.kind === "forced-password") {
    const body = `<form id="forced-password-form" class="modal-form"><div class="modal-form-fields"><p class="field-help">Your administrator issued a temporary password. Change it before continuing.</p>${inputField("Temporary password", "currentPassword", "", { type: "password", required: true, autocomplete: "current-password" })}<div class="form-grid">${inputField("New password", "newPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}${inputField("Confirm new password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}</div></div><div class="form-actions"><button class="button" type="submit">Change password</button></div></form>`;
    return makeModal("Change your password", body);
  }
  if (modalState.kind === "user-password") {
    const user = getUser(modalState.id);
    if (!user || user.email === currentUser.email) {
      modalState = null;
      return "";
    }
    const body = `<form id="user-password-form" class="modal-form"><input type="hidden" name="email" value="${esc(user.email)}">
      <div class="modal-form-fields"><p class="field-help">Approve and generate a temporary password for ${esc(user.name)}. It will be emailed to their primary address and they must change it on next sign-in.</p></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Approve &amp; Generate</button></div></form>`;
    return makeModal(user.resetRequested ? "Approve password reset" : "Reset account password", body);
  }
  if (modalState.kind === "schedule") {
    const schedule = modalState.id ? data.schedules.find((item) => item.id === modalState.id) : null;
    const title = schedule ? "Edit collection schedule" : "Add collection schedule";
    const body = `<form id="schedule-form" class="modal-form"><input type="hidden" name="id" value="${esc(schedule?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${selectField("Area", "area", locationAreas(), schedule?.area || locationAreas()[0], { required: true, labels: locationAreaLabels() })}${inputField("Collection date", "date", schedule?.date || todayISO(), { type: "date", required: true })}${inputField("Waste type", "wasteType", schedule?.wasteType || "", { required: true, placeholder: "e.g. Biodegradable" })}${selectField("Service status", "status", COLLECTION_STATUSES, schedule?.status || "Scheduled", { required: true })}${inputField("Start time", "start", schedule?.start || "6:00 AM", { required: true })}${inputField("End time", "end", schedule?.end || "9:00 AM", { required: true })}${selectField("Frequency", "frequency", ["Weekly", "Bi-weekly", "Monthly", "One-time"], schedule?.frequency || "Weekly", { required: true })}${inputField("Collection team", "team", schedule?.team || "Team A · Truck 01")}</div></div>
      <div class="form-actions">${schedule ? `<button class="button danger" type="button" data-action="delete-schedule" data-id="${esc(schedule.id)}">Remove schedule</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save schedule</button></div></form>`;
    return makeModal(title, body);
  }
  if (modalState.kind === "location") {
    const location = data.locations.find((item) => item.id === modalState.id);
    const body = `<form id="location-form" class="modal-form"><input type="hidden" name="id" value="${esc(location?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${inputField("Area label", "area", location?.area || "", { required: true, maxLength: 120, placeholder: "e.g. Purok 6" })}${inputField("Barangay", "barangay", location?.barangay || "Palsara", { required: true, maxLength: 100 })}${inputField("Purok", "purok", location?.purok || "", { required: true, maxLength: 100 })}${inputField("Street", "street", location?.street || "", { maxLength: 160, placeholder: "Optional" })}${inputField("Landmark", "landmark", location?.landmark || "", { maxLength: 160, placeholder: "Optional" })}</div></div>
      <div class="form-actions">${location ? `<button class="button danger" type="button" data-action="delete-location" data-id="${esc(location.id)}">Remove location</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save location</button></div></form>`;
    return makeModal(location ? "Edit community location" : "Add community location", body);
  }
  if (modalState.kind === "recycling") {
    const item = data.recyclingLocations.find((record) => record.id === modalState.id);
    const body = `<form id="recycling-form" class="modal-form"><input type="hidden" name="id" value="${esc(item?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${inputField("Business or site name", "name", item?.name || "", { required: true, maxLength: 120 })}${inputField("Barangay", "barangay", item?.barangay || "Palsara", { required: true, maxLength: 100 })}${inputField("Street or address", "street", item?.street || "", { required: true, maxLength: 160 })}${inputField("Purok", "purok", item?.purok || "", { maxLength: 100, placeholder: "Optional" })}${inputField("Nearby landmark", "landmark", item?.landmark || "", { maxLength: 160, placeholder: "Optional" })}${inputField("Contact number", "phone", item?.phone || "", { type: "tel", maxLength: 40, placeholder: "Optional" })}${inputField("Accepted materials", "materials", item?.materials || "", { required: true, maxLength: 500, placeholder: "e.g. PET bottles, cardboard, aluminum" })}${inputField("Opening hours", "hours", item?.hours || "", { maxLength: 120, placeholder: "Optional" })}<label class="checkbox-field span-all"><input name="active" type="checkbox" ${item?.active === false ? "" : "checked"}><span><strong>Show this listing to residents</strong></span></label></div></div>
      <div class="form-actions">${item ? `<button class="button danger" type="button" data-action="delete-recycling" data-id="${esc(item.id)}">Remove listing</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save listing</button></div></form>`;
    return makeModal(item ? "Edit recycling location" : "Add recycling location", body);
  }
  if (modalState.kind === "announcement") {
    const item = data.announcements.find((record) => record.id === modalState.id);
    const body = `<form id="announcement-form" class="modal-form"><input type="hidden" name="id" value="${esc(item?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${inputField("Title", "title", item?.title || "", { required: true, maxLength: 120 })}${inputField("Publish date", "date", item?.date || todayISO(), { type: "date", required: true })}<div class="form-field span-all"><label for="announcement-detail">Message *</label><textarea class="textarea" id="announcement-detail" name="detail" required maxlength="1000">${esc(item?.detail || "")}</textarea></div></div></div>
      <div class="form-actions">${item ? `<button class="button danger" type="button" data-action="delete-announcement" data-id="${esc(item.id)}">Remove announcement</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${item ? "Save changes" : "Publish announcement"}</button></div></form>`;
    return makeModal(item ? "Edit announcement" : "New announcement", body);
  }
  if (modalState.kind === "calendar-event") {
    const date = modalState.date || todayISO();
    const isAdmin = currentUser?.role === "administrator";
    const body = `<form id="calendar-event-form" class="modal-form"><input type="hidden" name="date" value="${esc(date)}">
      <div class="modal-form-fields"><p class="field-help"><strong>${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</strong> · ${isAdmin ? "This event is added to the calendar right away." : "Your request is sent to the administrator for approval."}</p><div class="form-grid">${inputField("Event title", "title", "", { required: true, maxLength: 120 })}</div><div class="form-field span-all"><label for="calendar-event-detail">Details *</label><textarea class="textarea" id="calendar-event-detail" name="detail" required maxlength="1000" placeholder="What happens, where, and at what time?"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${isAdmin ? "Add event" : "Submit for approval"}</button></div></form>`;
    return makeModal(isAdmin ? "Add calendar event" : "Request a calendar event", body);
  }
  if (modalState.kind === "calendar-decline") {
    const body = `<form id="calendar-decline-form" class="modal-form"><input type="hidden" name="id" value="${esc(modalState.id || "")}">
      <div class="modal-form-fields"><p class="field-help">Tell the barangay official why this event was rejected. The reason is sent to them along with the decision.</p><div class="form-field span-all"><label for="calendar-decline-reason">Reason *</label><textarea class="textarea" id="calendar-decline-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Reject event</button></div></form>`;
    return makeModal("Reject event request", body);
  }
  if (modalState.kind === "announcement-decline") {
    const body = `<form id="announcement-decline-form" class="modal-form"><input type="hidden" name="id" value="${esc(modalState.id || "")}">
      <div class="modal-form-fields"><p class="field-help">Tell the barangay official why this announcement was declined. The reason is shown to them with the decision.</p><div class="form-field span-all"><label for="announcement-decline-reason">Reason *</label><textarea class="textarea" id="announcement-decline-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Decline announcement</button></div></form>`;
    return makeModal("Decline announcement", body);
  }
  if (modalState.kind === "forgot-password") {
    const body = `<form id="forgot-password-form" class="modal-form"><div class="modal-form-fields"><div class="form-field span-all"><label for="forgot-email">Email address</label><p class="field-help">Enter the email address tied to your account. If an account exists, your barangay administrator will be notified to issue a reset.</p><input class="input" id="forgot-email" name="email" type="email" required autocomplete="email"></div></div><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Send reset request</button></div></form>`;
    return makeModal("Forgot password", body);
  }
  if (modalState.kind === "deactivate") {
    const user = modalState.id ? getUser(modalState.id) : null;
    if (!user) { modalState = null; return ""; }
    const body = `<form id="deactivate-form" class="modal-form"><input type="hidden" name="email" value="${esc(user.email)}">
      <div class="modal-form-fields"><p class="field-help">Why is ${esc(user.name)} being deactivated? The reason is recorded with the account.</p><div class="form-field span-all"><label for="deactivate-reason">Reason *</label><textarea class="textarea" id="deactivate-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Deactivate account</button></div></form>`;
    return makeModal("Deactivate account", body);
  }
  const user = modalState.id ? getUser(modalState.id) : null;
  const body = `<form id="user-form" class="modal-form"><input type="hidden" name="originalEmail" value="${esc(user?.email || "")}">
  <div class="modal-form-fields"><div class="form-grid">${inputField("Full name", "name", user?.name || "", { required: true })}${inputField("Email address", "email", user?.email || "", { type: "email", required: true, autocomplete: "email" })}${inputField("Contact number", "phone", user?.phone || "", { type: "tel", placeholder: "Optional" })}${selectField("Area", "area", [...locationAreas(), "Palsara"], user?.area || locationAreas()[0], { required: true, labels: locationAreaLabels() })}${selectField("Role", "role", Object.keys(ROLES), user?.role || "resident", { required: true, labels: ROLES })}${selectField("Account status", "status", ["Active", "Inactive"], user?.status || "Active", { required: true })}${user?.role === "official" ? inputField("Working hours", "workingHours", user.workingHours || "Monday-Friday, 8:00 AM-5:00 PM", { required: true, maxLength: 120 }) : ""}${user ? "" : inputField("Initial password", "password", "", { type: "password", required: true, minLength: 8, help: "Choose a unique password with at least 8 characters." })}</div></div>
    <div class="form-actions">${user && user.email !== currentUser.email ? `<button class="button secondary" type="button" data-action="reset-user-password" data-id="${esc(user.email)}">${user.resetRequested ? "Approve &amp; Generate" : "Reset password"}</button><button class="button ${user.status === "Active" ? "danger" : "secondary"}" type="button" data-action="toggle-user" data-id="${esc(user.email)}">${user.status === "Active" ? "Deactivate account" : "Reactivate account"}</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${user ? "Save account" : "Add account"}</button></div></form>`;
  return makeModal(user ? "Edit account" : "Add account", body);
}

function showModal(kind, id = "") {
  modalState = { kind, id };
  render();
}

function closeModal() {
  modalState = null;
  render();
  app.querySelector(".workspace-main")?.focus();
}

function refreshSearch(searchValue) {
  const query = searchValue.toLowerCase().trim();
  const roleFilter = app.querySelector("[data-user-role-filter]")?.value || "all";
  const statusFilter = app.querySelector("[data-user-status-filter]")?.value || "all";
  app.querySelectorAll(".filter-item").forEach((row) => {
    const matchesText = !query || row.dataset.search.includes(query);
    const matchesRole = roleFilter === "all" || row.dataset.search.includes(ROLES[roleFilter].toLowerCase());
    const matchesStatus = statusFilter === "all" || row.dataset.search.includes(statusFilter.toLowerCase());
    row.dataset.filteredOut = String(!(matchesText && matchesRole && matchesStatus));
  });
  updatePagination();
}

function updatePagination(onlyRecords = null) {
  const tables = onlyRecords ? [onlyRecords] : [...app.querySelectorAll(".records[data-page-size]")];
  for (const table of tables) {
    const rows = [...table.querySelectorAll(".filter-item")];
    const visible = rows.filter((row) => row.dataset.filteredOut !== "true");
    const pageSize = Number(table.dataset.pageSize);
    const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
    const page = Math.min(Number(table.dataset.page || 0), pageCount - 1);
    table.dataset.page = String(page);
    visible.forEach((row, index) => {
      row.hidden = index < page * pageSize || index >= (page + 1) * pageSize;
    });
    rows.filter((row) => row.dataset.filteredOut === "true").forEach((row) => { row.hidden = true; });
    let controls = table.nextElementSibling?.classList.contains("pagination") ? table.nextElementSibling : null;
    if (pageCount <= 1) {
      controls?.remove();
      continue;
    }
    if (!controls) {
      controls = document.createElement("nav");
      controls.className = "pagination";
      controls.setAttribute("aria-label", "Table pages");
      table.after(controls);
    }
    table.dataset.paginationId ||= `table-${Math.random().toString(36).slice(2, 10)}`;
    controls.innerHTML = `<button class="button secondary small" type="button" data-action="change-page" data-pagination-id="${table.dataset.paginationId}" data-direction="-1" ${page === 0 ? "disabled" : ""}>Previous</button><span class="pagination-status" aria-live="polite">Page ${page + 1} of ${pageCount}</span><button class="button secondary small" type="button" data-action="change-page" data-pagination-id="${table.dataset.paginationId}" data-direction="1" ${page >= pageCount - 1 ? "disabled" : ""}>Next</button>`;
  }
}

function safeCsvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv(filename, headers, rows) {
  const contents = [headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast("Your CSV export is ready.", "success");
}

function exportReports(history = false) {
  const reports = sortedReports(currentUser.role === "resident" ? userReports() : data.reports);
  if (history) {
    exportCsv("community-report-history.csv",
      ["Report ID", "Resident", "Category", "Barangay", "Purok or area", "Street or landmark", "Latitude", "Longitude", "Status", "Date and time", "Update", "Updated by"],
      reports.flatMap((report) => report.history.map((item) => [
          report.id, report.name, report.category, report.barangay || "", report.area, report.locationDetail || "", report.latitude ?? "", report.longitude ?? "", item.status, item.at, item.note, item.actorName || "",
      ])),
    );
    return;
  }
  exportCsv("community-reports.csv",
    ["Report ID", "Resident", "Email", "Category", "Concern", "Barangay", "Purok or area", "Street or landmark", "Latitude", "Longitude", "Description", "Urgent", "Status", "Assigned official", "Submitted", "Updated"],
    reports.map((report) => [
      report.id, report.name, report.userEmail, report.category, report.title, report.barangay || "", report.area, report.locationDetail || "",
      report.latitude ?? "", report.longitude ?? "", report.description, report.urgent ? "Yes" : "No", report.status, report.assignedTo?.name || "", report.submittedAt, report.updatedAt,
    ]),
  );
}

async function compressPhoto(file) {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error(`${file.name}: choose a JPG or PNG image.`);
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}: each photo must be 5 MB or smaller.`);
  const image = typeof createImageBitmap === "function"
    ? await createImageBitmap(file)
    : await new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const fallbackImage = new Image();
      fallbackImage.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(fallbackImage);
      };
      fallbackImage.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`${file.name}: this image could not be opened.`));
      };
      fallbackImage.src = objectUrl;
    });
  if (!image.width || !image.height) throw new Error(`${file.name}: this image has no usable dimensions.`);
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not prepare the selected photo.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (typeof image.close === "function") image.close();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(`${file.name}: this image could not be prepared.`)), "image/jpeg", 0.72));
  return { name: file.name.slice(0, 120), file: new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" }), previewUrl: URL.createObjectURL(blob) };
}

function nextReportId() {
  const numbers = data.reports.map((report) => Number(String(report.id).match(/^R(\d+)$/i)?.[1] || 0));
  return `R${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

async function submitReportDraft() {
  if (!reportDraft) return;
  const now = new Date().toISOString();
  const reportId = nextReportId();
  let photos = [];
  if (uploadPhotos.length) {
    const form = new FormData();
    uploadPhotos.forEach((photo) => form.append("photos", photo.file, photo.file.name));
    const response = await fetch(`/api/report-photos?reportId=${encodeURIComponent(reportId)}`, { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The report photos could not be uploaded.");
    photos = result.photos;
  }
  const report = {
    id: reportId,
    userEmail: currentUser.email,
    name: currentUser.name,
    category: reportDraft.category,
    title: reportDraft.category === "Other community concern" ? `Community concern in ${reportDraft.area}` : `${reportDraft.category} · ${reportDraft.area}`,
    area: reportDraft.area,
    barangay: reportDraft.barangay,
    locationDetail: reportDraft.locationDetail,
    latitude: reportDraft.latitude,
    longitude: reportDraft.longitude,
    description: reportDraft.description,
    urgent: Boolean(reportDraft.urgent),
    assignedTo: null,
    status: "Submitted",
    submittedAt: now,
    updatedAt: now,
    photos,
    history: [{ status: "Submitted", at: now, note: "Report received." }],
  };
  data.reports.unshift(report);
  addActivity(report.urgent ? "Submitted an urgent concern" : "Submitted a concern", `${report.id} · ${report.title}`);
  if (!await localSave()) {
    data.reports = data.reports.filter((item) => item.id !== report.id);
    return;
  }
  reportDraft = null;
  reportMapExpanded = false;
  reportMapSelection = null;
  uploadPhotos = [];
  selectedReportId = null;
  window.location.hash = routeUrl("resident", "reports");
  toast(`${report.id} was submitted to barangay staff.`, "success");
}

async function updateReportStatus(form) {
  const report = getReport(form.get("reportId"));
  if (!report) throw new Error("This report could not be found. Return to the concerns list and try again.");
  const status = String(form.get("status"));
  const note = String(form.get("note") || "").trim();
  if (!STATUSES.includes(status)) throw new Error("Choose a valid report status.");
  if (status === report.status && !note) {
    toast("Choose a new status or add an update for the resident.", "error");
    return;
  }
  const now = new Date().toISOString();
  report.status = status;
  report.updatedAt = now;
  report.history.push({ status, at: now, note: note || `Status updated to ${status}.` });
  addActivity("Updated a report", `${report.id} · ${status}`);
  if (!await localSave()) return;
  selectedReportId = null;
  render();
  toast(`${report.id} updated. The resident has an in-app notification.`, "success");
}

async function updateReportAssignment(id, claim) {
  const report = getReport(id);
  if (!report || currentUser.role !== "official") throw new Error("This concern cannot be assigned from this workspace.");
  if (claim) {
    if (report.assignedTo) throw new Error("This concern is already assigned. Refresh the queue before trying again.");
    report.assignedTo = { id: currentUser.id, name: currentUser.name };
  } else {
    if (report.assignedTo?.id !== currentUser.id) throw new Error("You can only release a concern assigned to you.");
    report.assignedTo = null;
  }

  async function submitFollowUp(form) {
    const response = await fetch("/api/community/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: String(form.get("reportId") || ""), message: String(form.get("message") || "").trim() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The follow-up could not be sent.");
    const stateResponse = await fetch("/api/state");
    const state = await stateResponse.json();
    if (!stateResponse.ok) throw new Error(state.error || "The follow-up was sent, but the report could not be refreshed.");
    data = state.data;
    dataRevision = state.revision;
    lastPersistedSnapshot = JSON.stringify(data);
    selectedReportId = null;
    render();
    toast("Your follow-up was sent to barangay staff.", "success");
  }
  addActivity(claim ? "Claimed a concern" : "Released a concern", `${report.id} · ${report.title}`);
  if (!await localSave()) return;
  render();
  toast(claim ? `${report.id} assigned to you.` : `${report.id} released to the queue.`, "success");
}

async function updateCollection(form) {
  const id = String(form.get("id") || "");
  const existing = id ? data.schedules.find((item) => item.id === id) : null;
  const date = String(form.get("date") || "");
  const area = String(form.get("area") || "");
  const status = String(form.get("status") || "");
  if (!locationAreas().includes(area) || !COLLECTION_STATUSES.includes(status) || !date) throw new Error("Choose a valid area, collection date, and service status.");
  const record = {
    ...(existing || { id: nextScheduleId(date) }),
    area,
    zone: existing?.zone || `Zone ${String.fromCharCode(65 + Math.max(0, locationAreas().indexOf(area)))}`,
    date,
    wasteType: String(form.get("wasteType") || "").trim(),
    start: String(form.get("start") || "").trim(),
    end: String(form.get("end") || "").trim(),
    frequency: String(form.get("frequency") || "Weekly"),
    team: String(form.get("team") || "").trim() || "Collection team",
    status,
  };
  const endMinutes = timeToMinutes(record.end);
  const startMinutes = timeToMinutes(record.start);
  if (endMinutes < 0 || startMinutes < 0 || endMinutes <= startMinutes) throw new Error("Use a valid time such as 6:00 AM, and make sure the end time is later.");
  if (!record.wasteType || !record.start || !record.end) throw new Error("Complete the service, collection time, and waste type.");
  if (existing) Object.assign(existing, record);
  else data.schedules.push(record);
  addActivity(existing ? "Updated a collection schedule" : "Added a collection schedule", `${record.id} · ${record.area} · ${status}`);
  if (!await localSave()) return;
  modalState = null;
  render();
  toast("Collection schedule saved. Residents in the affected area have an in-app update.", "success");
}

async function saveLocation(form) {
  const id = String(form.get("id") || idFor("LOC"));
  const record = {
    id,
    area: String(form.get("area") || "").trim(),
    barangay: String(form.get("barangay") || "").trim(),
    street: String(form.get("street") || "").trim(),
    purok: String(form.get("purok") || "").trim(),
    landmark: String(form.get("landmark") || "").trim(),
  };
  if (!record.area || !record.barangay || !record.purok) throw new Error("Enter an area label, barangay, and purok.");
  if (data.locations.some((item) => item.area.toLowerCase() === record.area.toLowerCase() && item.id !== id)) {
    throw new Error("Another location already uses this area label.");
  }
  const existing = data.locations.find((item) => item.id === id);
  if (existing) Object.assign(existing, record);
  else data.locations.push(record);
  addActivity(existing ? "Updated a community location" : "Added a community location", `${record.area} · ${record.barangay}`);
  if (!await localSave()) return;
  modalState = null;
  render();
  toast("Community location saved.", "success");
}

async function saveRecyclingLocation(form) {
  const id = String(form.get("id") || idFor("REC"));
  const record = {
    id,
    name: String(form.get("name") || "").trim(),
    barangay: String(form.get("barangay") || "").trim(),
    street: String(form.get("street") || "").trim(),
    purok: String(form.get("purok") || "").trim(),
    landmark: String(form.get("landmark") || "").trim(),
    materials: String(form.get("materials") || "").trim(),
    phone: String(form.get("phone") || "").trim(),
    hours: String(form.get("hours") || "").trim(),
    active: Boolean(form.get("active")),
  };
  if (!record.name || !record.barangay || !record.street || !record.materials) {
    throw new Error("Enter the business name, barangay, street address, and accepted materials.");
  }
  const existing = data.recyclingLocations.find((item) => item.id === id);
  if (existing) Object.assign(existing, record);
  else data.recyclingLocations.push(record);
  addActivity(existing ? "Updated a recycling directory listing" : "Added a recycling directory listing", record.name);
  if (!await localSave()) return;
  modalState = null;
  render();
  toast("Recycling directory listing saved.", "success");
}

async function saveAnnouncement(form) {
  const id = String(form.get("id") || "");
  const body = {
    title: String(form.get("title") || "").trim(),
    date: String(form.get("date") || ""),
    detail: String(form.get("detail") || "").trim(),
  };
  if (!body.title || !body.date || !body.detail) throw new Error("Enter an announcement title, date, and message.");
  const response = await fetch("/api/announcements", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(id ? { ...body, id } : body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The announcement could not be saved.");
  modalState = null;
  render();
  toast(id ? "Announcement updated." : "Announcement published.", "success");
}

async function decideAnnouncement(id, status, reason = "") {
  const response = await fetch("/api/announcements/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The announcement decision could not be saved.");
  data = result.data || data;
  if (result.revision) dataRevision = result.revision;
  lastPersistedSnapshot = JSON.stringify(data);
  modalState = null;
  render();
  toast(status === "declined" ? "Announcement declined." : "Announcement approved and published.", "success");
}

async function saveCalendarEvent(form) {
  const body = {
    title: String(form.get("title") || "").trim(),
    detail: String(form.get("detail") || "").trim(),
    date: String(form.get("date") || ""),
  };
  if (!body.title || !body.date) throw new Error("Enter an event title and date.");
  if (body.date < todayISO()) throw new Error("Events cannot be scheduled before today.");
  const response = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The calendar event could not be saved.");
  data = result.data || data;
  if (result.revision) dataRevision = result.revision;
  currentUser = result.user || currentUser;
  lastPersistedSnapshot = JSON.stringify(data);
  modalState = null;
  calendarSelectedDate = body.date;
  render();
  toast(currentUser.role === "administrator" ? "Event added to the calendar." : "Event request sent for approval.", "success");
}

async function decideCalendarEvent(id, status, reason = "") {
  const response = await fetch("/api/calendar/events/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The event decision could not be saved.");
  data = result.data || data;
  if (result.revision) dataRevision = result.revision;
  currentUser = result.user || currentUser;
  lastPersistedSnapshot = JSON.stringify(data);
  modalState = null;
  render();
  toast(status === "declined" ? "Event rejected and the reason sent to the official." : "Event approved and added to the calendar.", "success");
}

function nextScheduleId(date) {
  const year = asDate(date).getFullYear();
  const largest = data.schedules.reduce((value, schedule) => {
    const match = schedule.id.match(/-(\d+)$/);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `GCS-${year}-${String(largest + 1).padStart(3, "0")}`;
}

function timeToMinutes(value) {
  const match = String(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return -1;
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hours += 12;
  return hours * 60 + Number(match[2]);
}

async function updateProfile(form) {
  const name = String(form.get("name") || "").trim();
  const area = String(form.get("area") || "").trim();
  if (name.length < 2) throw new Error("Enter your full name.");
  if (currentUser.role === "resident" && !locationAreas().includes(area)) throw new Error("Choose an affected area.");
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, area, phone: String(form.get("phone") || "").trim(), recoveryEmail: String(form.get("recoveryEmail") || "").trim() }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Profile changes could not be saved.");
  currentUser = result.user;
  data = result.data;
  dataRevision = result.revision;
  lastPersistedSnapshot = JSON.stringify(data);
  render();
  toast("Profile saved.", "success");
}

async function loadSmtpSettings() {
  const response = await fetch("/api/settings/smtp");
  const result = await response.json();
  if (!response.ok) return;
  smtpSettings = result.settings;
  const form = app.querySelector("#smtp-settings-form");
  if (!form) return;
  for (const [name, value] of Object.entries(smtpSettings)) {
    const field = form.elements.namedItem(name);
    if (field && name !== "configured") field.value = value || "";
  }
  const password = form.elements.namedItem("pass");
  if (password && smtpSettings.configured) password.placeholder = "Leave blank to keep current password";
}

async function saveSmtpSettings(form) {
  const body = Object.fromEntries(new FormData(form));
  const response = await fetch("/api/settings/smtp", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "SMTP settings could not be saved.");
  smtpSettings = result.settings;
  form.elements.namedItem("pass").value = "";
  toast("SMTP settings saved.", "success");
}

function applySmtpPreset(provider) {
  const presets = {
    gmail: ["smtp.gmail.com", "587", 'Gmail: turn on 2-Step Verification, then <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">create an App Password</a>. Enter that generated password here.'],
    outlook: ["smtp.office365.com", "587", 'Outlook/Microsoft 365: <a href="https://support.microsoft.com/account-billing/how-to-get-and-use-app-passwords-5896ed9c-9f7f-4d4b-ae2c-7c9f6b2c0f2a" target="_blank" rel="noopener noreferrer">learn about app passwords</a> if your account supports them. If SMTP AUTH is disabled, ask your Microsoft 365 administrator to enable it.'],
    sendgrid: ["smtp.sendgrid.net", "587", 'SendGrid: <a href="https://docs.sendgrid.com/ui/account-and-settings/api-keys" target="_blank" rel="noopener noreferrer">create an API key</a> in Settings > API Keys. Enter apikey as the username and the generated API key as the password.'],
    custom: ["", "587", "Other provider: open its SMTP or mail-client setup page and copy the SMTP host, port, username, and app password or service key here."],
  };
  const preset = presets[provider];
  const form = app.querySelector("#smtp-settings-form");
  if (!preset || !form) return;
  form.elements.namedItem("host").value = preset[0];
  form.elements.namedItem("port").value = preset[1];
  const help = app.querySelector("#smtp-provider-help");
  if (help) help.innerHTML = preset[2];
  form.elements.namedItem("host").focus();
}

async function updatePassword(form) {
  const fields = new FormData(form);
  const oldPassword = String(fields.get("currentPassword") || "");
  const password = String(fields.get("newPassword") || "");
  const confirm = String(fields.get("confirmPassword") || "");
  if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
  if (password !== confirm) throw new Error("The new passwords do not match.");
  const response = await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword: password, confirmPassword: confirm }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Please sign in again before changing your password." : (result.error || "The password could not be changed."));
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "The account was updated, but CommUnity could not reload.");
  data = state.data;
  dataRevision = state.revision;
  currentUser = state.user;
  lastPersistedSnapshot = JSON.stringify(data);
  form.reset();
  toast("Password updated.", "success");
}

async function createResident(form) {
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const confirm = String(form.get("confirmPassword") || "");
  const area = locationAreas()[0] || "Purok 1";
  if (name.length < 2) throw new Error("Enter your full name.");
  if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
  if (password !== confirm) throw new Error("The passwords do not match.");
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name, email, area, phone: String(form.get("phone") || "").trim(),
      password, confirmPassword: confirm,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Your account could not be created.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "Your account was created, but CommUnity could not load it.");
  currentUser = state.user || result.user;
  data = state.data;
  dataRevision = state.revision;
  lastPersistedSnapshot = JSON.stringify(data);
  window.location.hash = routeUrl("resident", "dashboard");
  announceSessionChange();
  toast("Your resident account is ready.", "success");
}

async function login(emailInput, password, remember = false) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailInput.trim().toLowerCase(), password, remember }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Those sign-in details do not match an active account.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "Signed in, but CommUnity could not load your information.");
  currentUser = state.user || result.user;
  forcedPasswordDismissed = false;
  data = state.data;
  dataRevision = state.revision;
  lastPersistedSnapshot = JSON.stringify(data);
  selectedReportId = null;
  reportDraft = null;
  window.location.hash = routeUrl(currentUser.role, "dashboard");
  render();
  announceSessionChange();
  toast(`Signed in to the ${ROLES[currentUser.role]} workspace.`, "success");
}

async function resetUserPassword(form) {
  const email = String(form.get("email") || "");
  const response = await fetch("/api/users/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The account password could not be reset.");
  data = result.data;
  dataRevision = result.revision;
  currentUser = result.user;
  lastPersistedSnapshot = JSON.stringify(data);
  modalState = null;
  render();
  toast("Temporary password generated and emailed to the account holder.", "success");
}

async function requestPasswordReset(email) {
  const response = await fetch("/api/auth/password-reset-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The password reset request could not be sent.");
  toast("If that account exists, a reset request was sent to the administrator.", "success");
}

async function forgotPassword(form) {
  const fields = new FormData(form);
  const recoveryEmail = String(fields.get("recoveryEmail") || "").trim().toLowerCase();
  if (!recoveryEmail) throw new Error("Enter your recovery email address.");
  const response = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recoveryEmail }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The reset request could not be sent.");
  toast(result.message || "If an account uses that recovery email, a reset link has been sent.", "success");
  window.location.hash = "#/login";
}

async function resetPassword(form) {
  const fields = new FormData(form);
  const token = String(fields.get("token") || "").trim();
  const newPassword = String(fields.get("newPassword") || "");
  const confirm = String(fields.get("confirmPassword") || "");
  if (newPassword.length < 8) throw new Error("Choose a password with at least 8 characters.");
  if (newPassword !== confirm) throw new Error("The new passwords do not match.");
  const response = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The password could not be reset.");
  toast("Password reset. Sign in with your new password.", "success");
  window.location.hash = "#/login";
}

async function addOrEditUser(form) {
  const originalEmail = String(form.get("originalEmail") || "");
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const role = String(form.get("role") || "");
  const workingHours = String(form.get("workingHours") || "Monday-Friday, 8:00 AM-5:00 PM").trim();
  const area = String(form.get("area") || "");
  const status = String(form.get("status") || "");
  if (name.length < 2) throw new Error("Enter the account holder's name.");
  if (!Object.hasOwn(ROLES, role)) throw new Error("Select a valid account role.");
  if (!["Active", "Inactive"].includes(status)) throw new Error("Select a valid account status.");
  if (data.users.some((user) => user.email.toLowerCase() === email && user.email !== originalEmail)) throw new Error("An account already uses this email address.");
  if (email !== originalEmail && originalEmail === currentUser.email) throw new Error("You cannot change your own administrator sign-in address here.");
  if (area.length < 2) throw new Error("Enter an area for this account.");
  const existing = originalEmail ? getUser(originalEmail) : null;
  if (originalEmail && !existing) throw new Error("This account could not be found. Refresh the user list and try again.");
  if (existing?.email === currentUser.email && (role !== "administrator" || status !== "Active")) throw new Error("You cannot remove your own administrator access or deactivate your account.");
  if (existing) {
    const oldEmail = existing.email;
    Object.assign(existing, { name, email, role, area, status, workingHours, phone: String(form.get("phone") || "").trim() });
    data.reports.filter((report) => report.userEmail === oldEmail).forEach((report) => { report.name = name; });
    if (oldEmail !== email) {
      data.notifications.forEach((item) => { if (item.targetEmail === oldEmail) item.targetEmail = email; });
      data.reports.forEach((report) => { if (report.userEmail === oldEmail) report.userEmail = email; });
    }
    addActivity("Updated user account", `${name} · ${ROLES[role]}`);
  } else {
    const password = String(form.get("password") || "");
    if (password.length < 8) throw new Error("Use an initial password with at least 8 characters.");
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, area, role, status, workingHours, phone: String(form.get("phone") || "").trim(), password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The account could not be added.");
    data = result.data;
    dataRevision = result.revision;
    currentUser = result.user;
    lastPersistedSnapshot = JSON.stringify(data);
    modalState = null;
    render();
    toast("Account added.", "success");
    return;
  }
  if (!await localSave()) return;
  modalState = null;
  render();
  toast(existing ? "Account updated." : "Account added.", "success");
}

async function toggleAccount(email) {
  const user = getUser(email);
  if (!user) throw new Error("This account could not be found.");
  if (user.email === currentUser.email) throw new Error("You cannot deactivate the administrator account you are using.");
  if (user.status !== "Active") {
    user.status = "Active";
    addActivity("Reactivated user account", `${user.name} · ${ROLES[user.role]}`);
    if (!await localSave()) return;
    modalState = null;
    render();
    toast(`${user.name}'s account is ${user.status.toLowerCase()}.`, "success");
    return;
  }
  showModal("deactivate", email);
}

async function deactivateAccount(email, reason) {
  const user = getUser(email);
  if (!user) throw new Error("This account could not be found.");
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason) throw new Error("A deactivation reason is required.");
  const response = await fetch("/api/users/deactivate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, reason: trimmedReason }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The account could not be deactivated.");
  user.status = "Inactive";
  user.deactivationReason = trimmedReason;
  addActivity("Deactivated user account", `${user.name} · ${ROLES[user.role]}`);
  if (!await localSave()) return;
  modalState = null;
  render();
  toast(`${user.name}'s account is ${user.status.toLowerCase()}.`, "success");
}

function openReport(id) {
  const report = getReport(id);
  if (!report) {
    toast("This report could not be found. Return to the concerns list and try again.", "error");
    return;
  }
  if (currentUser.role === "resident" && report.userEmail !== currentUser.email) {
    toast("Residents can only open their own reports.", "error");
    return;
  }
  selectedReportId = report.id;
  const destination = routeUrl(currentUser.role, currentUser.role === "resident" ? "reports" : currentUser.role === "administrator" ? "reports" : "concerns");
  if (window.location.hash === destination) {
    pendingReportRoute = "";
    render();
  } else {
    pendingReportRoute = destination;
    window.location.hash = destination;
  }
}

async function markNotification(id) {
  const item = data.notifications.find((notification) => notification.id === id && notification.targetEmail === currentUser.email);
  if (!item) throw new Error("This notification could not be found.");
  if (item.read) return;
  item.read = true;
  try {
    const response = await fetch("/api/community/mark-notifications-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!response.ok) throw new Error("Could not mark notification as read.");
  } catch (error) {
    item.read = false;
    throw error;
  }
  render();
}

function setReportMapPin(position) {
  const { lat: latitude, lng: longitude } = position;
  reportMapSelection = { latitude, longitude };
  const latitudeField = app.querySelector("#report-latitude");
  const longitudeField = app.querySelector("#report-longitude");
  const status = app.querySelector("#report-map-status");
  const clearButton = app.querySelector('[data-action="clear-report-map-pin"]');
  if (latitudeField) latitudeField.value = String(latitude);
  if (longitudeField) longitudeField.value = String(longitude);
  if (clearButton) clearButton.hidden = false;
  if (status) status.textContent = `Pin selected at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}. Drag the pin to adjust it.`;
  if (!reportMapMarker) {
    reportMapMarker = window.L.marker([latitude, longitude], {
      draggable: true,
      title: "Reported concern location",
    }).addTo(reportMap);
    reportMapMarker.on("dragend", (event) => setReportMapPin(event.target.getLatLng()));
  } else {
    reportMapMarker.setLatLng([latitude, longitude]);
  }
  reportMap.panTo([latitude, longitude]);
}

function initializeReportMap() {
  const mapElement = app.querySelector("#report-map");
  if (!reportMapExpanded || !mapElement?.isConnected || !window.L) return;
  if (reportMapElement !== mapElement) {
    reportMap?.remove();
    reportMapElement = mapElement;
    reportMapMarker = null;
    reportMap = window.L.map(mapElement).setView(
      reportMapSelection ? [reportMapSelection.latitude, reportMapSelection.longitude] : [14.01799, 121.09465],
      reportMapSelection ? 17 : 13,
    );
    const tileLayer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(reportMap);
    tileLayer.on("tileerror", () => {
      const status = app.querySelector("#report-map-status");
      if (status) status.textContent = "Map tiles could not be loaded. Check your internet connection; you can still submit without a pin.";
    });
    reportMap.on("click", (event) => setReportMapPin(event.latlng));
  } else {
    reportMap.invalidateSize();
  }
  if (reportMapSelection) setReportMapPin(reportMapSelection);
}

function initializeReportDetailMap() {
  const mapElement = app.querySelector("#report-detail-map");
  if (!mapElement || !window.L) {
    reportDetailMap?.remove();
    reportDetailMap = null;
    reportDetailMapElement = null;
    if (mapElement) {
      const status = app.querySelector("#report-detail-map-status");
      if (status) status.textContent = "The interactive map is unavailable. Use the directions link to open this location.";
    }
    return;
  }
  if (reportDetailMapElement === mapElement) {
    reportDetailMap.invalidateSize();
    return;
  }

  reportDetailMap?.remove();
  reportDetailMap = null;
  reportDetailMapElement = mapElement;
  const latitude = Number(mapElement.dataset.latitude);
  const longitude = Number(mapElement.dataset.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    const status = app.querySelector("#report-detail-map-status");
    if (status) status.textContent = "This report's saved map coordinates are invalid.";
    reportDetailMapElement = null;
    return;
  }

  reportDetailMap = window.L.map(mapElement).setView([latitude, longitude], 17);
  const tileLayer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  }).addTo(reportDetailMap);
  const statusElement = app.querySelector("#report-detail-map-status");
  window.L.marker([latitude, longitude], {
    title: "Exact concern location",
    alt: "Exact concern location",
  }).addTo(reportDetailMap);
  tileLayer.on("tileerror", () => {
    if (statusElement) statusElement.textContent = "Map tiles could not be loaded. Check your internet connection; the saved pin and directions link are still available.";
  });
}

async function handleAction(button, clickEvent) {
  const action = button.dataset.action;
  if (action === "forgot-password") {
    window.location.hash = "#/forgot-password";
  } else if (action === "request-admin-reset") {
    const email = window.prompt("Enter your CommUnity account email:");
    if (email?.trim()) {
      const response = await fetch("/api/auth/request-admin-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The request could not be sent.");
      toast(result.message || "If an account exists, an admin has been notified.", "success");
    }
  } else if (action === "toggle-password") {
    const field = app.querySelector('#login-form input[name="password"]');
    if (field) {
      field.type = field.type === "password" ? "text" : "password";
      button.setAttribute("aria-label", field.type === "password" ? "Show password" : "Hide password");
    }
  } else if (action === "logout") {
    if (!confirmLeaveWithUnsavedPermissions()) return;
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("CommUnity could not sign you out. Try again.");
    clearSession();
    permissionDrafts = {};
    permissionOpenGroups = {};
    selectedPermissionRole = "resident";
    window.location.hash = "#/login";
    render();
    announceSessionChange();
    toast("You have signed out.", "success");
  } else if (action === "test-smtp") {
    const response = await fetch("/api/settings/smtp/test", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The test email could not be sent.");
    toast("Test email sent to your administrator address.", "success");
  } else if (action === "smtp-preset") {
    applySmtpPreset(button.dataset.provider);
  } else if (action === "view-report" || action === "view-notification-report") {
    openReport(button.dataset.id);
  } else if (action === "claim-report" || action === "release-report") {
    await updateReportAssignment(button.dataset.id, action === "claim-report");
  } else if (action === "back-list") {
    selectedReportId = null;
    render();
  } else if (action === "filter-reports") {
    reportFilter = button.dataset.value;
    render();
  } else if (action === "filter-notifications") {
    notificationFilter = button.dataset.value;
    render();
  } else if (action === "change-page") {
    const table = app.querySelector(`.records[data-pagination-id="${button.dataset.paginationId}"]`);
    if (table) {
      table.dataset.page = String(Number(table.dataset.page || 0) + Number(button.dataset.direction));
      updatePagination(table);
    }
  } else if (action === "mark-read") {
    await markNotification(button.dataset.id);
  } else if (action === "mark-all-read") {
    const unreadItems = data.notifications.filter((item) => item.targetEmail === currentUser.email && !item.read);
    const unreadIds = unreadItems.map((item) => item.id);
    unreadItems.forEach((item) => { item.read = true; });
    try {
      if (unreadIds.length) {
        const response = await fetch("/api/community/mark-notifications-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: unreadIds }),
        });
        if (!response.ok) throw new Error("Could not mark notifications as read.");
      }
      render();
      toast("All notifications marked as read.", "success");
    } catch (error) {
      unreadItems.forEach((item) => { item.read = false; });
      throw error;
    }
  } else if (action === "add-schedule") {
    showModal("schedule");
  } else if (action === "edit-schedule") {
    showModal("schedule", button.dataset.id);
  } else if (action === "delete-schedule") {
    const schedule = data.schedules.find((item) => item.id === button.dataset.id);
    if (!schedule) throw new Error("This schedule could not be found.");
    if (window.confirm(`Remove the ${schedule.wasteType} collection schedule for ${schedule.area}? A notice will be posted to residents in the affected area.`)) {
      data.schedules = data.schedules.filter((item) => item.id !== schedule.id);
      addActivity("Removed a collection schedule", `${schedule.id} · ${schedule.area}`);
      if (await localSave()) {
        closeModal();
        toast("Schedule removed and residents notified.", "success");
      }
    }
  } else if (action === "add-user") {
    showModal("user");
  } else if (action === "edit-user") {
    showModal("user", button.dataset.id);
  } else if (action === "reset-user-password") {
    showModal("user-password", button.dataset.id);
  } else if (action === "toggle-user") {
    const user = getUser(button.dataset.id);
    if (user?.status === "Active") showModal("deactivate", button.dataset.id);
    else await toggleAccount(button.dataset.id);
  } else if (action === "add-location") {
    showModal("location");
  } else if (action === "edit-location") {
    showModal("location", button.dataset.id);
  } else if (action === "delete-location") {
    const location = data.locations.find((item) => item.id === button.dataset.id);
    if (!location) throw new Error("This community location could not be found.");
    if (window.confirm(`Remove ${location.area}? Locations used by accounts, reports, or schedules cannot be removed.`)) {
      data.locations = data.locations.filter((item) => item.id !== location.id);
      addActivity("Removed a community location", location.area);
      if (await localSave()) {
        modalState = null;
        render();
        toast("Community location removed.", "success");
      }
    }
  } else if (action === "add-recycling") {
    showModal("recycling");
  } else if (action === "edit-recycling") {
    showModal("recycling", button.dataset.id);
  } else if (action === "delete-recycling") {
    const item = data.recyclingLocations.find((record) => record.id === button.dataset.id);
    if (!item) throw new Error("This recycling listing could not be found.");
    if (window.confirm(`Remove ${item.name} from the recycling directory?`)) {
      data.recyclingLocations = data.recyclingLocations.filter((record) => record.id !== item.id);
      addActivity("Removed a recycling directory listing", item.name);
      if (await localSave()) {
        modalState = null;
        render();
        toast("Recycling listing removed.", "success");
      }
    }
  } else if (action === "add-announcement") {
    showModal("announcement");
  } else if (action === "edit-announcement") {
    showModal("announcement", button.dataset.id);
  } else if (action === "approve-announcement") {
    await decideAnnouncement(button.dataset.id, "approved");
  } else if (action === "decline-announcement") {
    modalState = { kind: "announcement-decline", id: button.dataset.id };
    render();
  } else if (action === "delete-announcement") {
    const item = data.announcements.find((record) => record.id === button.dataset.id);
    if (!item) throw new Error("This announcement could not be found.");
    if (window.confirm(`Remove the announcement “${item.title}”?`)) {
      const response = await fetch("/api/announcements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The announcement could not be removed.");
      data = result.data;
      dataRevision = result.revision;
      currentUser = result.user;
      lastPersistedSnapshot = JSON.stringify(data);
      modalState = null;
      render();
      toast("Announcement removed.", "success");
    }
  } else if (action === "select-permission-role") {
    const { role } = button.dataset;
    if (!Object.hasOwn(data.permissions, role)) throw new Error("This role could not be found.");
    rememberOpenPermissionGroups();
    selectedPermissionRole = role;
    render();
    app.querySelector(`[data-action="select-permission-role"][data-role="${role}"]`)?.focus();
  } else if (action === "toggle-permission") {
    const permission = button.dataset.permission;
    const role = selectedPermissionRole;
    if (role !== "official") throw new Error("Only the Barangay official role can have permission changes.");
    if (!Object.hasOwn(data.permissions, role) || !Object.hasOwn(data.permissions[role], permission)) throw new Error("This permission could not be found.");
    permissionDrafts[role] ||= { ...data.permissions[role] };
    permissionDrafts[role][permission] = !permissionDrafts[role][permission];
    rememberOpenPermissionGroups();
    render();
    [...app.querySelectorAll('[data-action="toggle-permission"]')]
      .find((item) => item.dataset.permission === permission)
      ?.focus();
  } else if (action === "toggle-account-permission") {
    const email = button.dataset.email;
    const permission = button.dataset.permission;
    const account = (data.users || []).find((user) => user.email === email);
    if (account?.role !== "official") throw new Error("Only Barangay official accounts can have permission overrides.");
    data.accountOverrides = data.accountOverrides || {};
    data.accountOverrides[email] = data.accountOverrides[email] || {};
    const current = data.accountOverrides[email][permission] ?? Boolean(data.permissions.official?.[permission]);
    data.accountOverrides[email][permission] = !current;
    if (await localSave()) {
      render();
      toast("Barangay official permissions saved.", "success");
    }
  } else if (action === "reset-account-permissions") {
    const email = button.dataset.email;
    const account = (data.users || []).find((user) => user.email === email);
    if (account?.role !== "official") throw new Error("Only Barangay official accounts can have permission overrides.");
    if (data.accountOverrides?.[email]) {
      delete data.accountOverrides[email];
      if (await localSave()) {
        render();
        toast("Barangay official permissions reset to role default.", "success");
      }
    } else {
      toast("No overrides to reset.", "success");
    }
  } else if (action === "discard-permission-draft") {
    rememberOpenPermissionGroups();
    delete permissionDrafts[selectedPermissionRole];
    render();
    app.querySelector('[data-action="select-permission-role"][aria-pressed="true"]')?.focus();
    toast("Unsaved role permission changes discarded.", "success");
  } else if (action === "save-permission-draft") {
    rememberOpenPermissionGroups();
    const role = selectedPermissionRole;
    if (role !== "official") {
      delete permissionDrafts[role];
      render();
      return;
    }
    const draft = permissionDrafts[role];
    if (!draft) throw new Error("There are no role permission changes to save.");
    for (const permission of ["manageUsers", "manageRoles"]) {
      if (role === "administrator" && data.permissions[role][permission] && !draft[permission]) {
        const anotherAdminCanManage = data.users.some((user) =>
          user.role === "administrator" && user.status === "Active" && user.email !== currentUser.email &&
          data.permissions.administrator[permission],
        );
        if (!anotherAdminCanManage) throw new Error("Keep these permissions enabled for at least one active administrator so the local workspace remains manageable.");
      }
    }
    const changes = PERMISSION_DEFS.filter(({ id }) => draft[id] !== Boolean(data.permissions[role][id]));
    if (!changes.length) {
      delete permissionDrafts[role];
      render();
      return;
    }
    data.permissions[role] = { ...draft };
    changes.forEach((permission) => addActivity("Changed role permission", `${ROLES[role]} · ${permission.label}`));
    if (await localSave()) {
      delete permissionDrafts[role];
      render();
      app.querySelector('[data-action="select-permission-role"][aria-pressed="true"]')?.focus();
      toast(`${ROLES[role]} permissions saved.`, "success");
    }
  } else if (action === "export-activity-log") {
    exportCsv("community-activity-log.csv", ["Date and time", "Actor", "Role", "Action", "Details", "Result"], data.activities.map((item) => [item.at, item.actor, ROLES[item.role] || item.role, item.action, item.detail, item.result]));
  } else if (action === "export-reports") {
    exportReports();
  } else if (action === "export-report-history") {
    exportReports(true);
  } else if (action === "toggle-menu") {
    const drawer = app.querySelector("#mobile-navigation");
    drawer.hidden = false;
    button.setAttribute("aria-expanded", "true");
    app.querySelector(".mobile-drawer [data-action=close-menu]")?.focus();
  } else if (action === "close-menu" || action === "close-menu-backdrop") {
    const drawer = app.querySelector("#mobile-navigation");
    if (drawer && (action !== "close-menu-backdrop" || button === clickEvent.target)) {
      drawer.hidden = true;
      app.querySelector(".mobile-menu-button")?.setAttribute("aria-expanded", "false");
      app.querySelector(".mobile-menu-button")?.focus();
    }
  } else if (action === "close-modal") {
    closeModal();
  } else if (action === "close-modal-backdrop" && button === clickEvent.target) {
    closeModal();
  } else if (action === "calendar-prev") {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    render();
  } else if (action === "calendar-next") {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    render();
  } else if (action === "calendar-day") {
    calendarSelectedDate = button.dataset.date || "";
    render();
  } else if (action === "add-calendar-event") {
    modalState = { kind: "calendar-event", id: "", date: button.dataset.date || calendarSelectedDate || todayISO() };
    render();
  } else if (action === "approve-calendar-event") {
    await decideCalendarEvent(button.dataset.id, "approved");
  } else if (action === "decline-calendar-event") {
    modalState = { kind: "calendar-decline", id: button.dataset.id };
    render();
  } else if (action === "toggle-report-map") {
    reportMapExpanded = !reportMapExpanded;
    const region = app.querySelector("#report-map-region");
    const toggle = app.querySelector('[data-action="toggle-report-map"]');
    region.hidden = !reportMapExpanded;
    toggle.setAttribute("aria-expanded", String(reportMapExpanded));
    toggle.textContent = reportMapExpanded ? "Hide map" : "Choose location on map";
    if (reportMapExpanded) initializeReportMap();
  } else if (action === "clear-report-map-pin") {
    reportMapSelection = null;
    app.querySelector("#report-latitude").value = "";
    app.querySelector("#report-longitude").value = "";
    app.querySelector('[data-action="clear-report-map-pin"]').hidden = true;
    if (reportMapMarker) reportMap.removeLayer(reportMapMarker);
    reportMapMarker = null;
    const status = app.querySelector("#report-map-status");
    if (status) status.textContent = "No pin selected. Click the map to place one, or continue without it.";
  } else if (action === "edit-report-draft") {
    reportDraft.step = "details";
    reportMapSelection = reportDraft.latitude === null ? null : {
      latitude: reportDraft.latitude,
      longitude: reportDraft.longitude,
    };
    render();
  } else if (action === "submit-report") {
    submitReportDraft().catch((error) => toast(error.message, "error"));
  } else if (action === "remove-photo") {
    uploadPhotos.splice(Number(button.dataset.index), 1);
    render();
  }
}

async function handleSubmit(formEvent) {
  formEvent.preventDefault();
  const form = formEvent.target;
  const formId = form.getAttribute("id");
  const fields = new FormData(form);
  try {
    if (formId === "login-form") {
      await login(String(fields.get("email") || ""), String(fields.get("password") || ""), Boolean(fields.get("remember")));
    } else if (formId === "register-form") {
      await createResident(fields);
    } else if (formId === "report-draft-form") {
      const readOptionalCoordinate = (value) => {
        const text = String(value || "").trim();
        return text ? Number(text) : null;
      };
      const draft = {
        category: String(fields.get("category") || ""),
        barangay: "Palsara",
        area: String(fields.get("area") || ""),
        locationDetail: String(fields.get("locationDetail") || "").trim(),
        latitude: readOptionalCoordinate(fields.get("latitude")),
        longitude: readOptionalCoordinate(fields.get("longitude")),
        description: String(fields.get("description") || "").trim(),
        urgent: Boolean(fields.get("urgent")),
        step: "review",
      };
      if (!CATEGORIES.includes(draft.category) ||
          !data.locations.some((location) => location.area === draft.area && location.barangay === "Palsara")) {
        throw new Error("Choose a valid area within Palsara barangay.");
      }
      if (!draft.locationDetail || draft.locationDetail.length > 250) throw new Error("Enter a street or nearby landmark no longer than 250 characters.");
      if (draft.description.length < 12) throw new Error("Describe the concern in at least 12 characters.");
      if ((draft.latitude === null) !== (draft.longitude === null) ||
          (draft.latitude !== null && (!Number.isFinite(draft.latitude) || draft.latitude < -90 || draft.latitude > 90 ||
            !Number.isFinite(draft.longitude) || draft.longitude < -180 || draft.longitude > 180))) {
        throw new Error("Choose a valid map location or clear the pin before continuing.");
      }
      reportMapSelection = draft.latitude === null ? null : {
        latitude: draft.latitude,
        longitude: draft.longitude,
      };
      reportDraft = draft;
      render();
    } else if (formId === "report-status-form") {
      await updateReportStatus(fields);
    } else if (formId === "follow-up-form") {
      await submitFollowUp(fields);
    } else if (formId === "schedule-form") {
      await updateCollection(fields);
    } else if (formId === "profile-form") {
      await updateProfile(fields);
    } else if (formId === "smtp-settings-form") {
      await saveSmtpSettings(form);
    } else if (formId === "password-form") {
      await updatePassword(fields);
    } else if (formId === "forced-password-form") {
      await updatePassword(form);
      modalState = null;
      render();
    } else if (formId === "user-form") {
      await addOrEditUser(fields);
    } else if (formId === "user-password-form") {
      await resetUserPassword(fields);
    } else if (formId === "deactivate-form") {
      await deactivateAccount(String(fields.get("email") || ""), String(fields.get("reason") || ""));
    } else if (formId === "forgot-password-form") {
      await forgotPassword(form);
    } else if (formId === "reset-password-form") {
      await resetPassword(form);
    } else if (formId === "location-form") {
      await saveLocation(fields);
    } else if (formId === "recycling-form") {
      await saveRecyclingLocation(fields);
    } else if (formId === "announcement-form") {
      await saveAnnouncement(fields);
    } else if (formId === "calendar-event-form") {
      await saveCalendarEvent(fields);
    } else if (formId === "calendar-decline-form") {
      await decideCalendarEvent(String(fields.get("id") || ""), "declined", String(fields.get("reason") || "").trim());
    } else if (formId === "announcement-decline-form") {
      await decideAnnouncement(String(fields.get("id") || ""), "declined", String(fields.get("reason") || "").trim());
    }
  } catch (error) {
    console.error(`CommUnity could not complete ${formId}.`, error);
    toast(error.message || "The change could not be completed. Check the form and try again.", "error");
  }
}

async function handlePhotoSelection(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  if (uploadPhotos.length + files.length > 3) {
    toast("Attach up to three photos to one report.", "error");
    input.value = "";
    return;
  }
  try {
    const prepared = [];
    for (const file of files) prepared.push(await compressPhoto(file));
    uploadPhotos.push(...prepared);
    input.value = "";
    render();
  } catch (error) {
    console.error("CommUnity could not prepare the selected report photo.", error);
    toast(error.message, "error");
  }
}

function showFatal(error) {
  console.error("CommUnity could not start.", error);
  app.innerHTML = `<main class="fatal-screen">${brandMark()}<h1>CommUnity could not start</h1><p>${esc(error.message || "Check that the Node server is running and reload this page.")}</p>`;
}

let sessionSyncing = false;

async function syncSessionAcrossTabs() {
  if (sessionSyncing) return;
  sessionSyncing = true;
  try {
    const sessionResponse = await fetch("/api/session");
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) return;
    const nextUser = session.user || null;
    if ((nextUser?.email || "") === (currentUser?.email || "")) return;

    if (!nextUser) {
      clearSession();
      data = emptyState();
      dataRevision = 0;
      lastPersistedSnapshot = "";
      modalState = null;
      permissionDrafts = {};
      window.location.hash = "#/login";
      render();
      return;
    }

    const stateResponse = await fetch("/api/state");
    const state = await stateResponse.json();
    if (!stateResponse.ok) return;
    currentUser = state.user;
    data = state.data;
    dataRevision = state.revision;
    lastPersistedSnapshot = JSON.stringify(data);
    modalState = null;
    permissionDrafts = {};
    selectedReportId = null;
    window.location.hash = routeUrl(currentUser.role, "dashboard");
    render();
    toast(`This browser is now signed in as ${currentUser.name}.`, "success");
  } catch (error) {
    console.error("CommUnity could not sync the tab session.", error);
  } finally {
    sessionSyncing = false;
  }
}

function watchSessionAcrossTabs() {
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_SYNC_KEY) syncSessionAcrossTabs();
  });
  sessionSyncChannel?.addEventListener("message", (event) => {
    if (event.data?.type === "session") syncSessionAcrossTabs();
  });
}

async function initialize() {
  watchSessionAcrossTabs();
  await loadLocalData();
  if (!data) return;
  for (const role of Object.keys(ROLES)) {
    data.permissions[role] ||= {};
    for (const permission of PERMISSION_DEFS) {
      if (typeof data.permissions[role][permission.id] !== "boolean") {
        data.permissions[role][permission.id] = Boolean(DEFAULT_PERMISSIONS[role][permission.id]);
      }
    }
  }
  checkDataConsistency();
  if (!window.location.hash) window.history.replaceState(null, "", currentUser ? routeUrl(currentUser.role, "dashboard") : "#/login");
  lastKnownHash = window.location.hash;
  render();
}

app.addEventListener("click", async (clickEvent) => {
  const button = clickEvent.target.closest("[data-action]");
  if (!button) return;
  try {
    await handleAction(button, clickEvent);
  } catch (error) {
    console.error("CommUnity action failed.", error);
    toast(error.message || "This action could not be completed.", "error");
  }
});

app.addEventListener("submit", (submitEvent) => {
  handleSubmit(submitEvent);
});

app.addEventListener("input", (inputEvent) => {
  if (inputEvent.target.matches("[data-search-input]")) refreshSearch(inputEvent.target.value);
});

app.addEventListener("change", (changeEvent) => {
  const target = changeEvent.target;
  if (target.matches("#report-photos")) handlePhotoSelection(target);
  else if (target.matches("[data-user-role-filter], [data-user-status-filter]")) {
    const query = app.querySelector("[data-search-input]")?.value || "";
    refreshSearch(query);
  }
});

document.addEventListener("keydown", (keyEvent) => {
  if (keyEvent.key === "Escape" && modalState) closeModal();
  if (keyEvent.key === "Escape") {
    const drawer = app.querySelector("#mobile-navigation");
    if (drawer && !drawer.hidden) {
      drawer.hidden = true;
      app.querySelector(".mobile-menu-button")?.setAttribute("aria-expanded", "false");
      app.querySelector(".mobile-menu-button")?.focus();
    }
  }
  if (keyEvent.key !== "Tab") return;
  const dialog = app.querySelector(".modal-backdrop .modal, #mobile-navigation:not([hidden]) .mobile-drawer");
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    keyEvent.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (keyEvent.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    keyEvent.preventDefault();
    last.focus();
  } else if (!keyEvent.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    keyEvent.preventDefault();
    first.focus();
  }
});

window.addEventListener("hashchange", () => {
  const destination = window.location.hash;
  if (destination !== lastKnownHash && !confirmLeaveWithUnsavedPermissions()) {
    window.history.replaceState(null, "", lastKnownHash || "#/login");
    pendingReportRoute = "";
    return;
  }
  if (destination !== lastKnownHash) permissionDrafts = {};
  if (window.location.hash !== pendingReportRoute) selectedReportId = null;
  pendingReportRoute = "";
  render();
});

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedPermissionChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

initialize().catch(showFatal);
