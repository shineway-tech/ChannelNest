import {
  publishVisibilityOptions,
  supportsPublishSchedule,
} from "../domain/publish-capabilities";
import type {
  PublishAccountContentDraft,
  PublishContentType,
  PublishDraft,
} from "../pages/publish";
import {
  defaultPublishScheduledAt,
  normalizePublishScheduledAt,
  safePublishScheduledAt,
} from "./publish-schedule";

export type PublishAccountField = "title" | "body" | "visibility" | "scheduleMode" | "scheduledAt";

const PUBLISH_ACCOUNT_FIELDS: PublishAccountField[] = [
  "title",
  "body",
  "visibility",
  "scheduleMode",
  "scheduledAt",
];

export function createEmptyPublishDraft(): PublishDraft {
  return {
    contentType: "video",
    title: "",
    body: "",
    visibility: "private",
    scheduleMode: "now",
    scheduledAt: "",
    selectedAccountIds: [],
    mediaName: "",
    mediaPreviewUrl: "",
    mediaPreviewType: "",
    mediaPreviewItems: [],
    mediaCount: 0,
    accountContents: {},
  };
}

export function isPublishAccountField(value: string): value is PublishAccountField {
  return PUBLISH_ACCOUNT_FIELDS.includes(value as PublishAccountField);
}

export function applyPublishAccountField(
  current: PublishAccountContentDraft,
  field: PublishAccountField,
  value: string,
  platformId = "",
  contentType: PublishContentType = "video",
): PublishAccountContentDraft {
  if (field === "title" || field === "body") return { ...current, [field]: value };
  if (field === "visibility") {
    return {
      ...current,
      visibility: normalizePublishVisibilityForPlatform(value, platformId, contentType, current.scheduleMode),
    };
  }
  if (field === "scheduledAt") {
    return { ...current, scheduledAt: normalizePublishScheduledAt(value, false, platformId) };
  }
  if (value === "scheduled" && !supportsPublishSchedule(platformId, contentType)) {
    return { ...current, scheduleMode: "now", scheduledAt: "" };
  }
  const scheduleMode = value === "scheduled" ? "scheduled" : "now";
  return {
    ...current,
    visibility: normalizePublishVisibilityForPlatform(current.visibility, platformId, contentType, scheduleMode),
    scheduleMode,
    scheduledAt: scheduleMode === "scheduled"
      ? safePublishScheduledAt(current.scheduledAt || defaultPublishScheduledAt(platformId), platformId)
      : "",
  };
}

export function normalizePublishVisibility(value: string): PublishDraft["visibility"] {
  return value === "friends" || value === "private" ? value : "public";
}

export function publishCaptionLength(title: string, body: string) {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  return [...(trimmedTitle && trimmedBody ? `${trimmedTitle}\n${trimmedBody}` : trimmedTitle || trimmedBody)].length;
}

export function selectedPublishScheduledAt(
  current: PublishAccountContentDraft | undefined,
  draft: PublishDraft,
  content: PublishAccountContentDraft,
) {
  if (current && "scheduledAt" in current) return current.scheduledAt || "";
  return draft.scheduledAt || content.scheduledAt || "";
}

export function normalizePublishVisibilityForPlatform(
  value: string,
  platformId: string,
  contentType: PublishContentType,
  scheduleMode: PublishAccountContentDraft["scheduleMode"] = "now",
) {
  const visibility = normalizePublishVisibility(value);
  return publishVisibilityOptions(platformId, contentType, scheduleMode).includes(visibility)
    ? visibility
    : "public";
}
