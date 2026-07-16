import { normalizeChannelPlatformId } from "./platforms";

export type PublishContentType = "video" | "article";
export type PublishVisibility = "public" | "friends" | "private";
export type PublishScheduleMode = "now" | "scheduled";

type PublishPlatformCapability = {
  video: boolean;
  article: boolean;
  scheduled: boolean | PublishContentType[];
};

const PUBLISH_PLATFORM_CAPABILITIES: Record<string, PublishPlatformCapability> = {
  kuaishou: { video: true, article: true, scheduled: true },
  bilibili: { video: true, article: true, scheduled: true },
  xiaohongshu: { video: true, article: true, scheduled: true },
  douyin: { video: true, article: true, scheduled: false },
  "wechat-channels": { video: true, article: true, scheduled: false },
};

export type PublishMediaPolicy = {
  name: { zh: string; en: string };
  maxImageCount?: number;
  maxImageBytes?: number;
  maxVideoBytes?: number;
  maxVideoDurationSeconds?: number;
  requireImageDimensions?: boolean;
  requireVideoDimensions?: boolean;
  requireVideoDuration?: boolean;
  requireVideoCover?: boolean;
  maxCaptionChars?: Partial<Record<PublishContentType, number>>;
};

const PUBLISH_MEDIA_POLICIES: Record<string, PublishMediaPolicy> = {
  kuaishou: {
    name: { zh: "快手", en: "Kuaishou" },
    maxImageCount: 31,
    maxImageBytes: 15 * 1024 * 1024,
    maxVideoBytes: 12 * 1024 * 1024 * 1024,
    maxVideoDurationSeconds: 60 * 60,
    maxCaptionChars: { video: 500, article: 500 },
  },
  xiaohongshu: {
    name: { zh: "小红书", en: "Xiaohongshu" },
    maxImageCount: 18,
    maxImageBytes: 20 * 1024 * 1024,
    requireImageDimensions: true,
    requireVideoDimensions: true,
    requireVideoDuration: true,
    requireVideoCover: true,
  },
  douyin: {
    name: { zh: "抖音", en: "Douyin" },
  },
  bilibili: {
    name: { zh: "B 站", en: "Bilibili" },
    maxImageCount: 9,
    maxImageBytes: 20 * 1024 * 1024,
    requireVideoCover: true,
    maxCaptionChars: { article: 2000 },
  },
  "wechat-channels": {
    name: { zh: "视频号", en: "WeChat Channels" },
    requireImageDimensions: true,
    requireVideoDimensions: true,
    requireVideoDuration: true,
    requireVideoCover: true,
  },
};

export type PublishSchedulePolicy = {
  minDelayMinutes: number;
  maxDelayDays: number;
  safetyBufferMinutes: number;
};

const PUBLISH_SCHEDULE_POLICIES: Record<string, PublishSchedulePolicy> = {
  kuaishou: { minDelayMinutes: 60, maxDelayDays: 14, safetyBufferMinutes: 5 },
  bilibili: { minDelayMinutes: 60, maxDelayDays: 15, safetyBufferMinutes: 0 },
  xiaohongshu: { minDelayMinutes: 60, maxDelayDays: 14, safetyBufferMinutes: 0 },
};

export function normalizePublishPlatformId(value: string) {
  return normalizeChannelPlatformId(value);
}

export function publishCapabilityForPlatform(platformId: string) {
  return PUBLISH_PLATFORM_CAPABILITIES[normalizePublishPlatformId(platformId)];
}

export function supportsPublishContentType(platformId: string, contentType: PublishContentType) {
  return Boolean(publishCapabilityForPlatform(platformId)?.[contentType]);
}

export function supportsPublishSchedule(platformId: string, contentType: PublishContentType) {
  const capability = publishCapabilityForPlatform(platformId);
  return capability ? publishCapabilitySupportsSchedule(capability, contentType) : false;
}

export function publishCapabilitySupportsSchedule(
  capability: { scheduled: boolean | PublishContentType[] },
  contentType: PublishContentType,
) {
  if (capability.scheduled === true) return true;
  if (Array.isArray(capability.scheduled)) return capability.scheduled.includes(contentType);
  return false;
}

export function publishMediaPolicy(platformId: string) {
  return PUBLISH_MEDIA_POLICIES[normalizePublishPlatformId(platformId)];
}

export function publishSchedulePolicy(platformId: string): PublishSchedulePolicy {
  return PUBLISH_SCHEDULE_POLICIES[normalizePublishPlatformId(platformId)]
    || PUBLISH_SCHEDULE_POLICIES.kuaishou;
}

export function publishVisibilityOptions(
  platformId = "",
  contentType: PublishContentType = "video",
  scheduleMode: PublishScheduleMode = "now",
): PublishVisibility[] {
  switch (normalizePublishPlatformId(platformId)) {
    case "kuaishou":
    case "xiaohongshu":
    case "douyin":
      return ["public", "friends", "private"];
    case "bilibili":
      if (contentType === "article" && scheduleMode === "scheduled") return ["public"];
      return ["public", "private"];
    case "wechat-channels":
    default:
      return ["public"];
  }
}
