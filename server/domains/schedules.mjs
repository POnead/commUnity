import { HttpError } from "../platform/http.mjs";
import { assertKnownArea, jsonEqual, validId, validISODate } from "../platform/validate.mjs";
import { appDateLabel, getAppTimeZone } from "../platform/time.mjs";
import { ROLES } from "../platform/roles.mjs";
import { insertNotification } from "./notifications.mjs";
import { queueEmail } from "../platform/email.mjs";

export const SCHEDULE_STATUSES = ["Scheduled", "On the way", "Collecting", "Completed", "Delayed", "Cancelled", "Rescheduled"];

function validateScheduleHistory(schedule) {
  const history = schedule?.history;
  if (history === undefined) return;
  if (!Array.isArray(history) || history.length > 100) throw new HttpError(400, "Collection history contains invalid data.");
  for (const item of history) {
    const previousStatus = item?.previousStatus ?? null;
    const replacementDate = item?.replacementDate ?? null;
    const previousDate = item?.previousDate ?? null;
    if (
      !item ||
      !SCHEDULE_STATUSES.includes(item.status) ||
      (previousStatus !== null && !SCHEDULE_STATUSES.includes(previousStatus)) ||
      typeof item.at !== "string" ||
      Number.isNaN(Date.parse(item.at)) ||
      typeof item.note !== "string" ||
      item.note.length > 500 ||
      (item.actorName !== undefined && (typeof item.actorName !== "string" || item.actorName.length > 100)) ||
      (item.actorRole !== undefined && item.actorRole !== "" && !ROLES.includes(item.actorRole)) ||
      (replacementDate !== null && !validISODate(replacementDate)) ||
      typeof (item.replacementStart ?? "") !== "string" ||
      (item.replacementStart ?? "").length > 30 ||
      typeof (item.replacementEnd ?? "") !== "string" ||
      (item.replacementEnd ?? "").length > 30 ||
      (previousDate !== null && !validISODate(previousDate)) ||
      typeof (item.previousStart ?? "") !== "string" ||
      (item.previousStart ?? "").length > 30 ||
      typeof (item.previousEnd ?? "") !== "string" ||
      (item.previousEnd ?? "").length > 30
    ) {
      throw new HttpError(400, "Collection history contains invalid data.");
    }
  }
  if (!history.length) return;
  const latest = history.at(-1);
  if (latest.status !== schedule.status) {
    throw new HttpError(400, "The latest collection history entry must match the current status.");
  }
  if (["Delayed", "Cancelled"].includes(schedule.status) && !latest.note.trim()) {
    throw new HttpError(400, `${schedule.status} collections need a reason in the collection history.`);
  }
  if (
    schedule.status === "Rescheduled" &&
    (!latest.replacementDate || !String(latest.replacementStart || "").trim() || !String(latest.replacementEnd || "").trim())
  ) {
    throw new HttpError(400, "A rescheduled collection needs the replacement pickup date and time.");
  }
}

function validateSchedule(schedule) {
  const seriesId = schedule?.seriesId ?? null;
  const recurrenceEnd = schedule?.recurrenceEnd ?? null;
  if (
    !schedule ||
    !validId(schedule.id) ||
    typeof schedule.area !== "string" ||
    schedule.area.length > 120 ||
    typeof schedule.zone !== "string" ||
    schedule.zone.length > 100 ||
    typeof schedule.wasteType !== "string" ||
    !schedule.wasteType.trim() ||
    schedule.wasteType.length > 120 ||
    typeof schedule.date !== "string" ||
    Number.isNaN(Date.parse(schedule.date)) ||
    typeof schedule.start !== "string" ||
    schedule.start.length > 30 ||
    typeof schedule.end !== "string" ||
    schedule.end.length > 30 ||
    typeof schedule.frequency !== "string" ||
    schedule.frequency.length > 50 ||
    typeof schedule.team !== "string" ||
    schedule.team.length > 120 ||
    (seriesId !== null && (typeof seriesId !== "string" || !validId(seriesId))) ||
    (recurrenceEnd !== null && !validISODate(recurrenceEnd)) ||
    !SCHEDULE_STATUSES.includes(schedule.status)
  ) {
    throw new HttpError(400, "A collection schedule contains invalid data.");
  }
  validateScheduleHistory(schedule);
}

export function validateScheduleCollection(schedules) {
  for (const schedule of schedules) validateSchedule(schedule);
}

function normalizeSchedule(schedule) {
  return {
    id: schedule.id,
    area: schedule.area,
    zone: schedule.zone,
    date: schedule.date,
    wasteType: schedule.wasteType,
    start: schedule.start,
    end: schedule.end,
    frequency: schedule.frequency,
    team: schedule.team,
    status: schedule.status,
    seriesId: schedule.seriesId ?? null,
    recurrenceEnd: schedule.recurrenceEnd ?? null,
    history: (schedule.history || []).map((item) => ({
      previousStatus: item.previousStatus ?? null,
      status: item.status,
      at: item.at,
      actorName: item.actorName || "",
      actorRole: item.actorRole || "",
      note: item.note || "",
      previousDate: item.previousDate ?? null,
      previousStart: item.previousStart ?? null,
      previousEnd: item.previousEnd ?? null,
      replacementDate: item.replacementDate ?? null,
      replacementStart: item.replacementStart ?? null,
      replacementEnd: item.replacementEnd ?? null,
    })),
  };
}

async function persistScheduleHistory(db, schedule) {
  await db.query("DELETE FROM schedule_history WHERE schedule_id=$1", [schedule.id]);
  for (const [position, item] of normalizeSchedule(schedule).history.entries()) {
    await db.query(
      `
      INSERT INTO schedule_history (schedule_id,position,previous_status,status,at,actor_name,actor_role,note,
        previous_date,previous_start,previous_end,replacement_date,replacement_start,replacement_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `,
      [
        schedule.id,
        position,
        item.previousStatus,
        item.status,
        item.at,
        item.actorName,
        item.actorRole,
        item.note,
        item.previousDate,
        item.previousStart || "",
        item.previousEnd || "",
        item.replacementDate,
        item.replacementStart || "",
        item.replacementEnd || "",
      ],
    );
  }
}

function scheduleUpdateMessage(schedule) {
  const entry = (schedule.history || []).at(-1);
  const reason = entry?.note ? ` Reason: ${entry.note}` : "";
  if (schedule.status === "Rescheduled" && entry?.replacementDate) {
    const from = entry.previousDate
      ? `${entry.previousDate}${entry.previousStart ? ` ${entry.previousStart}` : ""}`
      : "its original schedule";
    return `${schedule.wasteType} pickup for ${schedule.area} was rescheduled from ${from} to ${entry.replacementDate} ${entry.replacementStart}–${entry.replacementEnd}.${reason}`;
  }
  if (["Delayed", "Cancelled"].includes(schedule.status)) {
    return `${schedule.wasteType} pickup for ${schedule.area} on ${schedule.date} was ${schedule.status.toLowerCase()}.${reason}`;
  }
  return `${schedule.wasteType} pickup ${schedule.status.toLowerCase()} for ${schedule.area} on ${schedule.date}.${reason}`;
}

export async function syncSchedules(db, oldSchedules, newSchedules, user) {
  validateScheduleCollection(newSchedules);
  const oldById = new Map(oldSchedules.map((item) => [item.id, item]));
  const newById = new Map(newSchedules.map((item) => [item.id, item]));
  const changed = new Set();
  for (const item of newSchedules) {
    await assertKnownArea(db, item.area);
    const previous = oldById.get(item.id);
    let history = Array.isArray(item.history) ? item.history.map((entry) => ({ ...entry })) : [];
    if (!previous) {
      if (item.status === "Rescheduled")
        throw new HttpError(400, "A new collection cannot be marked Rescheduled. Save it first, then move it to a replacement date.");
      if (!history.length && ["Delayed", "Cancelled"].includes(item.status)) {
        throw new HttpError(400, `${item.status} collections need a reason in the collection history.`);
      }
      if (history.length > 1) throw new HttpError(400, "A new collection can only start with one history entry.");
      if (!history.length) {
        history = [
          {
            previousStatus: null,
            status: item.status,
            at: new Date().toISOString(),
            actorName: "",
            actorRole: "",
            note: `Collection ${item.status.toLowerCase()}.`,
            previousDate: null,
            previousStart: null,
            previousEnd: null,
            replacementDate: null,
            replacementStart: null,
            replacementEnd: null,
          },
        ];
      }
      history.at(-1).actorName = user.name;
      history.at(-1).actorRole = user.role;
      history.at(-1).at = new Date().toISOString();
    } else {
      const oldHistory = Array.isArray(previous.history) ? previous.history : [];
      const statusChanged = item.status !== previous.status;
      if (statusChanged) {
        const entry = history.at(-1);
        const validTransition =
          Boolean(entry) &&
          history.length === oldHistory.length + 1 &&
          jsonEqual(history.slice(0, -1), oldHistory) &&
          entry.status === item.status &&
          (entry.previousStatus ?? null) === previous.status;
        if (!validTransition) {
          throw new HttpError(400, "A collection status change must add one history entry that records the previous and new status.");
        }
        history.at(-1).actorName = user.name;
        history.at(-1).actorRole = user.role;
        history.at(-1).at = new Date().toISOString();
        history.at(-1).previousDate = previous.date;
        history.at(-1).previousStart = previous.start;
        history.at(-1).previousEnd = previous.end;
        if (["Delayed", "Cancelled"].includes(item.status) && !history.at(-1).note.trim()) {
          throw new HttpError(400, `${item.status} collections need a reason in the collection history.`);
        }
        if (item.status === "Rescheduled") {
          const replacement = history.at(-1);
          if (
            !replacement.replacementDate ||
            !String(replacement.replacementStart || "").trim() ||
            !String(replacement.replacementEnd || "").trim()
          ) {
            throw new HttpError(400, "A rescheduled collection needs the replacement pickup date and time.");
          }
          item.date = replacement.replacementDate;
          item.start = replacement.replacementStart;
          item.end = replacement.replacementEnd;
        }
      } else if (!jsonEqual(history, oldHistory)) {
        throw new HttpError(400, "Collection history can only change together with a status update.");
      }
    }
    item.history = history;
    const schedule = normalizeSchedule(item);
    if (!previous || !jsonEqual(normalizeSchedule(previous), schedule)) {
      changed.add(item.id);
      await db.query(
        `
        INSERT INTO schedules (id,area,zone,date,waste_type,start_time,end_time,frequency,series_id,recurrence_end,team,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET area=excluded.area,zone=excluded.zone,date=excluded.date,
          waste_type=excluded.waste_type,start_time=excluded.start_time,end_time=excluded.end_time,
          frequency=excluded.frequency,series_id=excluded.series_id,recurrence_end=excluded.recurrence_end,
          team=excluded.team,status=excluded.status
      `,
        [
          schedule.id,
          schedule.area,
          schedule.zone,
          schedule.date,
          schedule.wasteType,
          schedule.start,
          schedule.end,
          schedule.frequency,
          schedule.seriesId,
          schedule.recurrenceEnd,
          schedule.team,
          schedule.status,
        ],
      );
      await persistScheduleHistory(db, item);
      if (previous && previous.date !== item.date) {
        await db.query("DELETE FROM schedule_reminders WHERE schedule_id=$1", [item.id]);
      }
    }
  }
  for (const item of oldSchedules) {
    if (!newById.has(item.id)) {
      changed.add(item.id);
      await db.query("DELETE FROM schedules WHERE id=$1", [item.id]);
    }
  }
  const additionsByGroup = new Map();
  for (const id of changed) {
    const schedule = newById.get(id);
    if (schedule && !oldById.has(id)) {
      const key = `${schedule.area}\u0000${schedule.wasteType}`;
      if (!additionsByGroup.has(key)) additionsByGroup.set(key, []);
      additionsByGroup.get(key).push(schedule);
      continue;
    }
    const removed = oldById.get(id);
    const message = schedule
      ? scheduleUpdateMessage(schedule)
      : `${removed.wasteType} collection previously scheduled for ${removed.area} has been removed.`;
    const residents = await db.query("SELECT email FROM users WHERE role='resident' AND status='Active' AND area=$1", [
      (schedule || removed).area,
    ]);
    for (const resident of residents.rows)
      await insertNotification(
        db,
        resident.email,
        schedule ? `Collection update for ${schedule.area}` : "Collection schedule removed",
        message,
      );
  }
  for (const group of additionsByGroup.values()) {
    group.sort((left, right) => left.date.localeCompare(right.date));
    const first = group[0];
    const last = group[group.length - 1];
    const message =
      group.length === 1
        ? `${first.wasteType} pickup ${first.status.toLowerCase()} for ${first.area} on ${first.date}.`
        : `${group.length} ${first.wasteType} pickups are scheduled for ${first.area} from ${first.date} to ${last.date}.`;
    const title = group.length === 1 ? `Collection update for ${first.area}` : `Collection schedule added for ${first.area}`;
    const residents = await db.query("SELECT email FROM users WHERE role='resident' AND status='Active' AND area=$1", [first.area]);
    for (const resident of residents.rows) await insertNotification(db, resident.email, title, message);
  }
}

export async function runScheduleReminders(db, { mailer, smtpFrom, appOrigin } = {}) {
  const due = await db.query(
    `
    SELECT s.id AS schedule_id, s.area, to_char(s.date, 'YYYY-MM-DD') AS date, s.start_time, s.waste_type, u.email AS user_email
    FROM schedules s
    JOIN users u ON u.area=s.area AND u.role='resident' AND u.status='Active'
    WHERE s.date = (now() AT TIME ZONE $1::text)::date + 1 AND s.status NOT IN ('Completed','Cancelled')
  `,
    [getAppTimeZone()],
  );
  let created = 0;
  for (const reminder of due.rows) {
    const claimed = await db.query(
      "INSERT INTO schedule_reminders (schedule_id,user_email) VALUES ($1,$2) ON CONFLICT (schedule_id,user_email) DO NOTHING",
      [reminder.schedule_id, reminder.user_email],
    );
    if (!claimed.rowCount) continue;
    const body = `${reminder.waste_type} collection for ${reminder.area} is scheduled tomorrow, ${appDateLabel(reminder.date, { month: "long", day: "numeric" })} at ${reminder.start_time}.`;
    await insertNotification(db, reminder.user_email, "Collection reminder", body);
    queueEmail(mailer, {
      from: smtpFrom,
      to: reminder.user_email,
      subject: `Collection reminder for ${reminder.area}`,
      text: `${body}\n\nView your collection schedule in CommUnity: ${appOrigin || ""}/#/resident/collection`,
    });
    created += 1;
  }
  // Notifications are part of the shared state browsers sync against, so a
  // background write must advance the same revision a browser save does.
  if (created) await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  return created;
}
