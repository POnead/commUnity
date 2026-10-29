"use strict";

function routeState() {
  const path = currentPath();
  if (!currentUser) return { type: path[0] === "register" ? "register" : "login" };
  const role = currentUser.role;
  if (path[0] !== role) return { type: "app", role, page: "dashboard" };
  const pageName = path[1] || "dashboard";
  const pages = {
    resident: ["dashboard", "collection", "report", "reports", "history", "notifications", "profile"],
    official: ["dashboard", "concerns", "urgent", "collection", "history", "notifications", "profile"],
    administrator: ["dashboard", "users", "roles", "audit", "settings", "profile"],
  };
  const resolvedPage = pages[role]?.includes(pageName) ? pageName : "dashboard";
  if (!canOpenPage(role, resolvedPage)) {
    window.history.replaceState(null, "", routeUrl(role, "dashboard"));
    queueMicrotask(() => toast("That workspace page is not enabled for this role.", "error"));
    return { type: "app", role, page: "dashboard" };
  }
  return { type: "app", role, page: resolvedPage };
}

function render() {
  if (!data) return;
  currentUser = currentUser || userFromSession();
  const route = routeState();
  currentRoute = route;
  if (currentUser && route.type === "app") {
    document.documentElement.dataset.theme = ROLE_THEME[currentUser.role];
    if (window.location.hash !== routeUrl(currentUser.role, route.page)) {
      window.history.replaceState(null, "", routeUrl(currentUser.role, route.page));
    }
    let markup;
    if (route.role === "resident") {
      if (route.page === "dashboard") markup = dashboardResident();
      else if (route.page === "collection") markup = collectionResident();
      else if (route.page === "report") markup = reportPage();
      else if (route.page === "reports" || route.page === "history") markup = reportsPage("resident", route.page);
      else if (route.page === "notifications") markup = notificationsPage("resident");
      else markup = profilePage("resident");
    } else if (route.role === "official") {
      if (route.page === "dashboard") markup = dashboardOfficial();
      else if (route.page === "collection") markup = collectionOfficial();
      else if (route.page === "concerns" || route.page === "urgent" || route.page === "history") markup = reportsPage("official", route.page);
      else if (route.page === "notifications") markup = notificationsPage("official");
      else markup = profilePage("official");
    } else {
      if (route.page === "dashboard") markup = dashboardAdmin();
      else if (route.page === "users") markup = usersPage();
      else if (route.page === "roles") markup = rolesPage();
      else if (route.page === "audit") markup = auditPage();
      else if (route.page === "settings") markup = settingsPage();
      else markup = profilePage("administrator");
    }
    app.innerHTML = markup;
    if (modalState) {
      const input = app.querySelector(".modal input:not([type=hidden]), .modal select");
      if (input) requestAnimationFrame(() => input.focus());
    }
  } else {
    document.documentElement.dataset.theme = "auth";
    app.innerHTML = route.type === "register" ? registerMarkup() : loginMarkup();
  }
  lastKnownHash = window.location.hash;
}

function makeModal(title, description, body) {
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
    <header class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2><p id="modal-description">${esc(description)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></header>
    <div class="modal-content">${body}</div>
  </section></div>`;
}

function modalMarkup() {
  if (modalState.kind === "schedule") {
    const schedule = modalState.id ? data.schedules.find((item) => item.id === modalState.id) : null;
    const title = schedule ? "Edit collection schedule" : "Add collection schedule";
    const body = `<form id="schedule-form" class="modal-form"><input type="hidden" name="id" value="${esc(schedule?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${selectField("Area", "area", AREAS, schedule?.area || "Purok 1", { required: true })}${inputField("Collection date", "date", schedule?.date || todayISO(), { type: "date", required: true })}${inputField("Waste type", "wasteType", schedule?.wasteType || "", { required: true, placeholder: "e.g. Biodegradable" })}${selectField("Service status", "status", COLLECTION_STATUSES, schedule?.status || "Scheduled", { required: true })}${inputField("Start time", "start", schedule?.start || "6:00 AM", { required: true })}${inputField("End time", "end", schedule?.end || "9:00 AM", { required: true })}${selectField("Frequency", "frequency", ["Weekly", "Bi-weekly", "Monthly", "One-time"], schedule?.frequency || "Weekly", { required: true })}${inputField("Collection team", "team", schedule?.team || "Team A · Truck 01")}</div></div>
      <div class="form-actions">${schedule ? `<button class="button danger" type="button" data-action="delete-schedule" data-id="${esc(schedule.id)}">Remove schedule</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save schedule</button></div></form>`;
    return makeModal(title, "Service updates for this area will appear in resident workspaces.", body);
  }
  const user = modalState.id ? getUser(modalState.id) : null;
  const body = `<form id="user-form" class="modal-form"><input type="hidden" name="originalEmail" value="${esc(user?.email || "")}">
    <div class="modal-form-fields"><div class="form-grid">${inputField("Full name", "name", user?.name || "", { required: true })}${inputField("Email address", "email", user?.email || "", { type: "email", required: true, autocomplete: "email" })}${inputField("Contact number", "phone", user?.phone || "", { type: "tel", placeholder: "Optional" })}${selectField("Area", "area", AREAS.concat(["Balete, Batangas"]), user?.area || "Purok 1", { required: true })}${selectField("Role", "role", Object.keys(ROLES), user?.role || "resident", { required: true, labels: ROLES })}${selectField("Account status", "status", ["Active", "Inactive"], user?.status || "Active", { required: true })}${user ? "" : inputField("Initial password", "password", "", { type: "password", required: true, minLength: 10, help: "For this local prototype only; do not reuse a real password." })}</div></div>
    <div class="form-actions">${user && user.email !== currentUser.email ? `<button class="button ${user.status === "Active" ? "danger" : "secondary"}" type="button" data-action="toggle-user" data-id="${esc(user.email)}">${user.status === "Active" ? "Deactivate account" : "Reactivate account"}</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${user ? "Save account" : "Add account"}</button></div></form>`;
  return makeModal(user ? "Edit account" : "Add account", "Accounts and role changes are stored only in this browser.", body);
}

function showModal(kind, id = "") {
  modalState = { kind, id };
  render();
}

function closeModal() {
  modalState = null;
  render();
}

function refreshSearch(searchValue) {
  const query = searchValue.toLowerCase().trim();
  const roleFilter = app.querySelector("[data-user-role-filter]")?.value || "all";
  const statusFilter = app.querySelector("[data-user-status-filter]")?.value || "all";
  app.querySelectorAll(".filter-item").forEach((row) => {
    const matchesText = !query || row.dataset.search.includes(query);
    const matchesRole = roleFilter === "all" || row.dataset.search.includes(ROLES[roleFilter].toLowerCase());
    const matchesStatus = statusFilter === "all" || row.dataset.search.includes(statusFilter.toLowerCase());
    row.hidden = !(matchesText && matchesRole && matchesStatus);
  });
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

async function compressPhoto(file) {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error(`${file.name}: choose a JPG or PNG image.`);
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}: each photo must be 5 MB or smaller.`);
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not prepare the selected photo.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return { name: file.name.slice(0, 120), data: canvas.toDataURL("image/jpeg", 0.72) };
}

function nextReportId() {
  const largest = data.reports.reduce((value, report) => {
    const number = Number(report.id.split("-").at(-1));
    return Number.isFinite(number) ? Math.max(value, number) : value;
  }, 0);
  return `RPT-${new Date().getFullYear()}-${String(largest + 1).padStart(3, "0")}`;
}

async function submitReportDraft() {
  if (!reportDraft) return;
  const now = new Date().toISOString();
  const report = {
    id: nextReportId(),
    userEmail: currentUser.email,
    name: currentUser.name,
    category: reportDraft.category,
    title: reportDraft.category === "Other community concern" ? `Community concern in ${reportDraft.area}` : `${reportDraft.category} · ${reportDraft.area}`,
    area: reportDraft.area,
    description: reportDraft.description,
    urgent: Boolean(reportDraft.urgent),
    status: "Submitted",
    submittedAt: now,
    updatedAt: now,
    photos: uploadPhotos,
    history: [{ status: "Submitted", at: now, note: "Report received in this browser." }],
  };
  data.reports.unshift(report);
  addRoleNotification("official", report.urgent ? `Urgent concern: ${report.title}` : `New concern: ${report.title}`, `${currentUser.name} submitted a report for ${report.area}.`, report.id);
  addRoleNotification("administrator", "Community concern submitted", `${report.id} · ${report.title}`, report.id);
  addActivity(report.urgent ? "Submitted an urgent concern" : "Submitted a concern", `${report.id} · ${report.title}`);
  if (!localSave()) {
    data.reports = data.reports.filter((item) => item.id !== report.id);
    return;
  }
  reportDraft = null;
  uploadPhotos = [];
  selectedReportId = null;
  window.location.hash = routeUrl("resident", "reports");
  toast(`Concern ${report.id} saved in this browser demo.`, "success");
}

function updateReportStatus(form) {
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
  addNotification(report.userEmail, `Report ${status.toLowerCase()}`, `${report.id}: ${note || `Your concern is now ${status.toLowerCase()}.`}`, report.id);
  addActivity("Updated a report", `${report.id} · ${status}`);
  if (!localSave()) return;
  selectedReportId = null;
  render();
  toast(`${report.id} updated. The resident has an in-app notification.`, "success");
}

function updateCollection(form) {
  const id = String(form.get("id") || "");
  const existing = id ? data.schedules.find((item) => item.id === id) : null;
  const date = String(form.get("date") || "");
  const area = String(form.get("area") || "");
  const status = String(form.get("status") || "");
  if (!AREAS.includes(area) || !COLLECTION_STATUSES.includes(status) || !date) throw new Error("Choose a valid area, collection date, and service status.");
  const record = {
    ...(existing || { id: nextScheduleId(date) }),
    area,
    zone: existing?.zone || `Zone ${String.fromCharCode(65 + Math.max(0, AREAS.indexOf(area)))}`,
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
  const message = `${record.wasteType} pickup ${status.toLowerCase()} for ${record.area} on ${dateLabel(record.date)}.`;
  data.users.filter((user) => user.role === "resident" && user.area === record.area)
    .forEach((user) => addNotification(user.email, `Collection update for ${record.area}`, message));
  addActivity(existing ? "Updated a collection schedule" : "Added a collection schedule", `${record.id} · ${record.area} · ${status}`);
  if (!localSave()) return;
  modalState = null;
  render();
  toast("Collection schedule saved. Residents in the affected area have an in-app update.", "success");
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

function updateProfile(form) {
  const name = String(form.get("name") || "").trim();
  const area = String(form.get("area") || "").trim();
  if (name.length < 2) throw new Error("Enter your full name.");
  if (currentUser.role === "resident" && !AREAS.includes(area)) throw new Error("Choose an affected area.");
  currentUser.name = name;
  currentUser.area = area;
  currentUser.phone = String(form.get("phone") || "").trim();
  addActivity("Updated profile information", currentUser.email);
  if (!localSave()) return;
  render();
  toast("Profile saved in this browser.", "success");
}

async function updatePassword(form) {
  const oldPassword = String(form.get("currentPassword") || "");
  const password = String(form.get("newPassword") || "");
  const confirm = String(form.get("confirmPassword") || "");
  if (password.length < 10) throw new Error("Choose a password with at least 10 characters.");
  if (password !== confirm) throw new Error("The new passwords do not match.");
  if (!await verifyPassword(currentUser, oldPassword)) throw new Error("The current password does not match this local account.");
  await setPassword(currentUser, password);
  addActivity("Changed account password", currentUser.email);
  if (!localSave()) return;
  form.reset();
  toast("Password updated for this browser account.", "success");
}

async function createResident(form) {
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const confirm = String(form.get("confirmPassword") || "");
  const area = String(form.get("area") || "");
  if (name.length < 2) throw new Error("Enter your full name.");
  if (data.users.some((user) => user.email.toLowerCase() === email)) throw new Error("An account already uses this email address. Sign in or choose another address.");
  if (password.length < 10) throw new Error("Use a password with at least 10 characters.");
  if (password === DEMO_PASSWORD) throw new Error("Choose a password other than the shared demo password.");
  if (password !== confirm) throw new Error("The passwords do not match.");
  if (!AREAS.includes(area)) throw new Error("Choose a purok or affected area.");
  const account = {
    id: idFor("U"), email, name, area, phone: String(form.get("phone") || "").trim(),
    role: "resident", status: "Active", joinedAt: todayISO(),
  };
  await setPassword(account, password);
  data.users.push(account);
  addActivity("Created resident account", `${name} · ${area}`);
  if (!localSave()) {
    data.users = data.users.filter((user) => user.email !== email);
    return;
  }
  setSession(account, true);
  window.location.hash = routeUrl("resident", "dashboard");
  toast("Your resident account is ready in this browser.", "success");
}

async function login(emailInput, password, remember = false) {
  const email = emailInput.trim().toLowerCase();
  const account = data.users.find((user) => user.email.toLowerCase() === email);
  if (!account || !await verifyPassword(account, password)) throw new Error("Those sign-in details do not match an account in this browser.");
  if (account.status !== "Active") throw new Error("This local account is inactive. Ask the administrator in the demonstration to reactivate it.");
  setSession(account, remember);
  addActivity("Signed in", ROLES[account.role]);
  const saved = localSave();
  selectedReportId = null;
  reportDraft = null;
  window.location.hash = routeUrl(account.role, "dashboard");
  render();
  toast(
    saved ? `Signed in to the ${ROLES[account.role]} workspace.` : "Signed in, but this browser could not save the activity record.",
    saved ? "success" : "error",
  );
}

async function addOrEditUser(form) {
  const originalEmail = String(form.get("originalEmail") || "");
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const role = String(form.get("role") || "");
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
    Object.assign(existing, { name, email, role, area, status, phone: String(form.get("phone") || "").trim() });
    data.reports.filter((report) => report.userEmail === oldEmail).forEach((report) => { report.name = name; });
    if (oldEmail !== email) {
      data.notifications.forEach((item) => { if (item.targetEmail === oldEmail) item.targetEmail = email; });
      data.reports.forEach((report) => { if (report.userEmail === oldEmail) report.userEmail = email; });
      if (currentUser === existing) {
        localStorage.setItem(SESSION_KEY, email);
        currentUser = existing;
      }
    }
    addActivity("Updated user account", `${name} · ${ROLES[role]}`);
  } else {
    const password = String(form.get("password") || "");
    if (password.length < 10) throw new Error("Use an initial password with at least 10 characters.");
    const account = {
      id: idFor("U"), email, name, area, role, status, phone: String(form.get("phone") || "").trim(), joinedAt: todayISO(),
    };
    await setPassword(account, password);
    data.users.push(account);
    addActivity("Added user account", `${name} · ${ROLES[role]}`);
  }
  if (!localSave()) return;
  modalState = null;
  render();
  toast(existing ? "Account updated in this browser." : "Account added in this browser.", "success");
}

function toggleAccount(email) {
  const user = getUser(email);
  if (!user) throw new Error("This account could not be found.");
  if (user.email === currentUser.email) throw new Error("You cannot deactivate the administrator account you are using.");
  user.status = user.status === "Active" ? "Inactive" : "Active";
  addActivity(user.status === "Active" ? "Reactivated user account" : "Deactivated user account", `${user.name} · ${ROLES[user.role]}`);
  if (!localSave()) return;
  modalState = null;
  render();
  toast(`${user.name}'s account is ${user.status.toLowerCase()}.`, "success");
}

function openReport(id) {
  const report = getReport(id);
  if (!report) {
    toast("This report could not be found in the local sample.", "error");
    return;
  }
  if (currentUser.role === "resident" && report.userEmail !== currentUser.email) {
    toast("Residents can only open their own reports.", "error");
    return;
  }
  selectedReportId = report.id;
  const destination = routeUrl(currentUser.role, currentUser.role === "resident" ? "reports" : "concerns");
  if (window.location.hash === destination) {
    pendingReportRoute = "";
    render();
  } else {
    pendingReportRoute = destination;
    window.location.hash = destination;
  }
}

function markNotification(id) {
  const item = data.notifications.find((notification) => notification.id === id && notification.targetEmail === currentUser.email);
  if (!item) throw new Error("This notification could not be found.");
  item.read = true;
  localSave();
  render();
}

function handleAction(button, clickEvent) {
  const action = button.dataset.action;
  if (action === "demo-login") {
    const field = app.querySelector('#login-form input[name="email"]');
    const password = app.querySelector('#login-form input[name="password"]');
    if (field && password) {
      field.value = button.dataset.email;
      password.value = DEMO_PASSWORD;
      login(field.value, DEMO_PASSWORD).catch((error) => toast(error.message, "error"));
    }
  } else if (action === "forgot-password") {
    toast("Password recovery needs a trusted email service. Use a sample account or create a new resident account.");
  } else if (action === "toggle-password") {
    const field = app.querySelector('#login-form input[name="password"]');
    if (field) {
      field.type = field.type === "password" ? "text" : "password";
      button.setAttribute("aria-label", field.type === "password" ? "Show password" : "Hide password");
    }
  } else if (action === "logout") {
    if (!confirmLeaveWithUnsavedPermissions()) return;
    addActivity("Signed out", ROLES[currentUser.role]);
    localSave();
    clearSession();
    permissionDrafts = {};
    permissionOpenGroups = {};
    selectedPermissionRole = "resident";
    window.location.hash = "#/login";
    render();
    toast("You have signed out.", "success");
  } else if (action === "view-report" || action === "view-notification-report") {
    openReport(button.dataset.id);
  } else if (action === "back-list") {
    selectedReportId = null;
    render();
  } else if (action === "filter-reports") {
    reportFilter = button.dataset.value;
    render();
  } else if (action === "filter-notifications") {
    notificationFilter = button.dataset.value;
    render();
  } else if (action === "mark-read") {
    markNotification(button.dataset.id);
  } else if (action === "mark-all-read") {
    data.notifications.filter((item) => item.targetEmail === currentUser.email).forEach((item) => { item.read = true; });
    if (localSave()) {
      render();
      toast("All notifications marked as read.", "success");
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
      data.users.filter((user) => user.role === "resident" && user.area === schedule.area).forEach((user) => addNotification(user.email, "Collection schedule removed", `${schedule.wasteType} collection previously scheduled for ${schedule.area} has been removed.`, ""));
      addActivity("Removed a collection schedule", `${schedule.id} · ${schedule.area}`);
      if (localSave()) {
        closeModal();
        toast("Schedule removed and residents notified in this browser.", "success");
      }
    }
  } else if (action === "add-user") {
    showModal("user");
  } else if (action === "edit-user") {
    showModal("user", button.dataset.id);
  } else if (action === "toggle-user") {
    toggleAccount(button.dataset.id);
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
    if (!Object.hasOwn(data.permissions, role) || !Object.hasOwn(data.permissions[role], permission)) throw new Error("This permission could not be found.");
    permissionDrafts[role] ||= { ...data.permissions[role] };
    permissionDrafts[role][permission] = !permissionDrafts[role][permission];
    rememberOpenPermissionGroups();
    render();
    [...app.querySelectorAll('[data-action="toggle-permission"]')]
      .find((item) => item.dataset.permission === permission)
      ?.focus();
  } else if (action === "discard-permission-draft") {
    rememberOpenPermissionGroups();
    delete permissionDrafts[selectedPermissionRole];
    render();
    app.querySelector('[data-action="select-permission-role"][aria-pressed="true"]')?.focus();
    toast("Unsaved role permission changes discarded.", "success");
  } else if (action === "save-permission-draft") {
    rememberOpenPermissionGroups();
    const role = selectedPermissionRole;
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
    if (localSave()) {
      delete permissionDrafts[role];
      render();
      app.querySelector('[data-action="select-permission-role"][aria-pressed="true"]')?.focus();
      toast(`${ROLES[role]} permissions saved in this browser.`, "success");
    }
  } else if (action === "export-audit") {
    exportCsv("community-audit-demo.csv", ["Date and time", "Actor", "Role", "Action", "Details", "Result"], data.activities.map((item) => [item.at, item.actor, ROLES[item.role] || item.role, item.action, item.detail, item.result]));
  } else if (action === "reset-data" || action === "reset-corrupt") {
    if (window.confirm("Restore the sample accounts and reports? This permanently removes all CommUnity demonstration changes saved in this browser.")) {
      localStorage.removeItem(DATA_KEY);
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      currentUser = null;
      data = null;
      window.location.hash = "#/login";
      initialize().then(() => toast("Sample data restored.", "success")).catch((error) => showFatal(error));
    }
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
  } else if (action === "edit-report-draft") {
    reportDraft.step = "details";
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
      const draft = {
        category: String(fields.get("category") || ""),
        area: String(fields.get("area") || ""),
        description: String(fields.get("description") || "").trim(),
        urgent: Boolean(fields.get("urgent")),
        step: "review",
      };
      if (!CATEGORIES.includes(draft.category) || !AREAS.includes(draft.area)) throw new Error("Choose a concern type and affected area.");
      if (draft.description.length < 12) throw new Error("Describe the concern in at least 12 characters.");
      reportDraft = draft;
      render();
    } else if (formId === "report-status-form") {
      updateReportStatus(fields);
    } else if (formId === "schedule-form") {
      updateCollection(fields);
    } else if (formId === "profile-form") {
      updateProfile(fields);
    } else if (formId === "password-form") {
      await updatePassword(fields);
    } else if (formId === "user-form") {
      await addOrEditUser(fields);
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
    render();
  } catch (error) {
    console.error("CommUnity could not prepare the selected report photo.", error);
    toast(error.message, "error");
  }
}

function showFatal(error) {
  console.error("CommUnity could not start.", error);
  app.innerHTML = `<main class="fatal-screen">${brandMark()}<h1>CommUnity could not start</h1><p>${esc(error.message || "Check browser storage and reload this page.")}</p><p>Try a current browser over localhost if local file storage is unavailable.</p></main>`;
}

async function initialize() {
  if (!loadLocalData()) return;
  if (!localStorage.getItem(DATA_KEY)) {
    for (const demo of DEMO_USERS) {
      const account = getUser(demo.email);
      await setPassword(account, DEMO_PASSWORD);
    }
    if (!localSave()) throw new Error("Sample data could not be saved. Check this browser's local storage.");
  }
  for (const role of Object.keys(ROLES)) {
    data.permissions[role] ||= {};
    for (const permission of PERMISSION_DEFS) {
      if (typeof data.permissions[role][permission.id] !== "boolean") {
        data.permissions[role][permission.id] = Boolean(seedData().permissions[role][permission.id]);
      }
    }
  }
  checkDataConsistency();
  currentUser = userFromSession();
  if (!window.location.hash) window.history.replaceState(null, "", currentUser ? routeUrl(currentUser.role, "dashboard") : "#/login");
  lastKnownHash = window.location.hash;
  render();
}

app.addEventListener("click", (clickEvent) => {
  const button = clickEvent.target.closest("[data-action]");
  if (!button) return;
  try {
    handleAction(button, clickEvent);
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

window.addEventListener("storage", (storageEvent) => {
  if (storageEvent.key === DATA_KEY && storageEvent.newValue) {
    try {
      const parsed = JSON.parse(storageEvent.newValue);
      if (parsed.version === 1) {
        data = parsed;
        currentUser = userFromSession();
        render();
        toast("This demonstration was updated in another tab.", "success");
      }
    } catch (error) {
      console.error("CommUnity could not read a cross-tab data update.", error);
      toast("Another tab saved data that could not be read here. Reload this page.", "error");
    }
  }
});

initialize().catch(showFatal);
