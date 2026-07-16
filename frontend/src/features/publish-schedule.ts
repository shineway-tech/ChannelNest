import type { Instance as FlatpickrInstance } from "flatpickr/dist/types/instance";
import type { LanguageMode } from "../domain/types";
import {
  normalizePublishPlatformId,
  publishSchedulePolicy,
} from "../domain/publish-capabilities";

export const PUBLISH_SCHEDULE_MINUTE_STEP = 5;

export type PublishScheduleInput = HTMLInputElement & {
  _flatpickr?: FlatpickrInstance;
};

export function normalizePublishScheduledAt(value: string, clampToRange = false, platformId = "") {
  const date = parsePublishScheduledAt(value);
  if (!date) return "";
  const nextDate = clampToRange ? clampPublishScheduleDate(date, publishScheduleRange(platformId)) : date;
  return formatLocalDateTimeWithOffset(nextDate);
}

export function safePublishScheduledAt(value: string, platformId = "") {
  const scheduleRange = publishScheduleRange(platformId);
  const date = parsePublishScheduledAt(value);
  return formatLocalDateTimeWithOffset(clampPublishScheduleDate(date || scheduleRange.min, scheduleRange));
}

export function publishScheduledAtWithDefault(value: string, platformId = "") {
  return safePublishScheduledAt(value || defaultPublishScheduledAt(platformId), platformId);
}

export function parsePublishScheduledAt(value: string) {
  const normalized = value.trim().replace(" ", "T");
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function defaultPublishScheduledAt(platformId = "") {
  return formatLocalDateTimeValue(publishScheduleRange(platformId).min);
}

export function publishScheduleRange(platformId = "") {
  const now = new Date();
  const policy = publishSchedulePolicy(platformId);
  const min = roundDateUpToMinuteStep(new Date(
    now.getTime() + (policy.minDelayMinutes + policy.safetyBufferMinutes) * 60 * 1000,
  ));
  return {
    min,
    max: new Date(now.getTime() + policy.maxDelayDays * 24 * 60 * 60 * 1000),
  };
}

export function publishScheduleLeadText(language: LanguageMode, platformId = "") {
  const platform = normalizePublishPlatformId(platformId);
  if (platform === "bilibili" || platform === "kuaishou" || platform === "xiaohongshu") {
    return language === "zh" ? "距离当前不足 1 小时" : "less than 1 hour away";
  }
  return language === "zh" ? "早于平台允许范围" : "earlier than the platform allows";
}

export function syncSchedulePickerValue(
  input: PublishScheduleInput,
  date: Date | null,
  instance: FlatpickrInstance | undefined,
  platformId = "",
  updatePicker = true,
) {
  const scheduleRange = publishScheduleRange(platformId);
  const nextDate = clampPublishScheduleDate(date || scheduleRange.min, scheduleRange);
  input.value = formatLocalDateTimeDisplay(nextDate);
  if (instance && updatePicker) instance.setDate(nextDate, false);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return nextDate;
}

export function appendSchedulePickerConfirmAction(instance: FlatpickrInstance, language: LanguageMode) {
  if (instance.calendarContainer.querySelector("[data-publish-schedule-confirm]")) return;
  const footer = document.createElement("div");
  footer.className = "publish-schedule-calendar-footer";
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.publishScheduleConfirm = "";
  button.textContent = language === "zh" ? "确定" : "Confirm";
  button.addEventListener("click", () => instance.close());
  footer.append(button);
  instance.calendarContainer.append(footer);
}

export function updateSchedulePickerRange(
  input: PublishScheduleInput,
  instance: FlatpickrInstance | undefined,
  platformId = "",
) {
  if (!instance) return;
  const scheduleRange = publishScheduleRange(platformId);
  instance.set("minDate", scheduleRange.min);
  instance.set("maxDate", scheduleRange.max);
  syncSchedulePickerValue(input, parsePublishScheduledAt(input.value), instance, platformId);
}

export function formatLocalDateTimeDisplay(date: Date) {
  return formatLocalDateTimeParts(date).join(" ");
}

export function formatLocalDateTimeWithOffset(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offsetMinute = String(absOffset % 60).padStart(2, "0");
  return `${formatLocalDateTimeValue(date)}:00${sign}${offsetHour}:${offsetMinute}`;
}

export function clampPublishScheduleDate(date: Date, range: { min: Date; max: Date }) {
  if (date.getTime() < range.min.getTime()) return range.min;
  if (date.getTime() > range.max.getTime()) return range.max;
  return date;
}

function roundDateUpToMinuteStep(date: Date) {
  const next = new Date(date);
  const hasSubMinute = next.getSeconds() > 0 || next.getMilliseconds() > 0;
  const minute = next.getMinutes();
  let roundedMinute = Math.ceil(minute / PUBLISH_SCHEDULE_MINUTE_STEP) * PUBLISH_SCHEDULE_MINUTE_STEP;
  if (hasSubMinute && roundedMinute === minute) roundedMinute += PUBLISH_SCHEDULE_MINUTE_STEP;
  next.setSeconds(0, 0);
  if (roundedMinute >= 60) next.setHours(next.getHours() + 1, 0, 0, 0);
  else next.setMinutes(roundedMinute, 0, 0);
  return next;
}

function formatLocalDateTimeValue(date: Date) {
  return formatLocalDateTimeParts(date).join("T");
}

function formatLocalDateTimeParts(date: Date): [string, string] {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return [`${year}-${month}-${day}`, `${hour}:${minute}`];
}
