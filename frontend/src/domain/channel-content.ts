import { normalizeChannelPlatformId } from "./platforms";

export type ContentTab = "overview" | "works";
export type ChannelWorkType = "video" | "article";

export type WorkStatus = "published" | "reviewing" | "draft";

const ACCOUNT_CONTENT_PLATFORM_IDS = ["xiaohongshu", "wechat-channels", "douyin", "bilibili", "kuaishou"] as const;
const WORKS_PAGE_PLATFORM_IDS = ACCOUNT_CONTENT_PLATFORM_IDS;
const TYPED_WORKS_PLATFORM_IDS = ["wechat-channels", "bilibili"] as const;

export function supportsAccountContent(platformId: string) {
  return includesPlatformId(ACCOUNT_CONTENT_PLATFORM_IDS, platformId);
}

export function supportsWorksPages(platformId: string) {
  return includesPlatformId(WORKS_PAGE_PLATFORM_IDS, platformId);
}

export function supportsTypedWorks(platformId: string) {
  return includesPlatformId(TYPED_WORKS_PLATFORM_IDS, platformId);
}

function includesPlatformId(platformIds: readonly string[], platformId: string) {
  return platformIds.includes(normalizeChannelPlatformId(platformId));
}

export interface ChannelWork {
  id: string;
  platformId: string;
  accountId: string;
  title: string;
  workType?: "video" | "article" | string | null;
  publishedAt?: string | null;
  status: WorkStatus;
  coverUrl?: string | null;
  link?: string | null;
  views?: number | null;
  impressions?: number | null;
  likes?: number | null;
  collects?: number | null;
  comments?: number | null;
  shares?: number | null;
  coverClickRate?: string | null;
  avgViewTime?: string | null;
  gainedFollowers?: number | null;
  dataUpdatedAt?: string | null;
  metrics?: ChannelWorkMetric[];
  badges?: string[];
}

export interface ChannelWorkMetric {
  key: string;
  label: string;
  value?: string | null;
}

export interface ChannelOverviewMetric {
  key: string;
  label: string;
  value?: string | null;
  compareLabel?: string | null;
  trend?: string | null;
  tone?: "up" | "down" | string | null;
}

export interface ChannelAccountOverview {
  accountId: string;
  platformId: string;
  periodDays: number;
  metrics: ChannelOverviewMetric[];
  summary?: string | null;
  updatedAt?: string | null;
  syncStatus?: string;
  error?: string | null;
}

export interface ChannelAccountProfileSnapshot {
  accountId: string;
  platformId: string;
  followers?: number | null;
  following?: number | null;
  likes?: number | null;
  lastSyncAt?: string | null;
  updatedAt?: string | null;
  syncStatus?: string;
  error?: string | null;
}

export interface ChannelAccountContent {
  accountId: string;
  platformId: string;
  profile?: ChannelAccountProfileSnapshot | null;
  overviewYesterday?: ChannelAccountOverview | null;
  overviewSeven?: ChannelAccountOverview | null;
  overviewThirty?: ChannelAccountOverview | null;
  overviewNinety?: ChannelAccountOverview | null;
  overviewHistory?: ChannelAccountOverview | null;
  overviewTotal?: ChannelAccountOverview | null;
  latestWork?: ChannelWork | null;
  latestWorkSeven?: ChannelWork | null;
  latestWorkThirty?: ChannelWork | null;
  syncStatus?: string;
  error?: string | null;
}

export interface ChannelWorksPage {
  accountId: string;
  platformId: string;
  pageKey: string;
  workType?: "video" | "article" | string | null;
  nextPageKey?: string | null;
  hasMore: boolean;
  works: ChannelWork[];
  updatedAt?: string | null;
  syncStatus?: string;
  error?: string | null;
}
