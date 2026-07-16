import { convertFileSrc } from "@tauri-apps/api/core";
import type { ChannelAccount, LanguageMode, LocalResource, PlatformInfo } from "../domain/types";
import { publishVisibilityOptions } from "../domain/publish-capabilities";
import { statusLabel } from "../utils/format";
import { escapeAttribute, escapeHtml } from "../utils/html";
import { localResourcePreviewText } from "../utils/local-resource-library";
import { renderAccountAvatar } from "../ui/channel-components";
import { icon } from "../ui/icons";
import { platformLogo } from "../ui/platform-logo";
import type { CopyText } from "../i18n/copy";

export type PublishContentType = "video" | "article";
export type PublishScheduleMode = "now" | "scheduled";
export type PublishStep = "content" | "accounts";
export type PublishResourceTab = "copy" | "image" | "video";
export type PublishProgressPhase = "running" | "success" | "failed";
type PublishText = typeof publishText.zh;

interface PublishMediaConfig {
  accept: string;
  multiple: boolean;
  hint: string;
}

const VIDEO_MEDIA_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/x-msvideo",
  "video/x-matroska",
];

export const VIDEO_MEDIA_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".avi",
  ".mkv",
];

const VIDEO_MEDIA_ACCEPT = [...VIDEO_MEDIA_MIME_TYPES, ...VIDEO_MEDIA_EXTENSIONS].join(",");

const IMAGE_MEDIA_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/heic",
  "image/heif",
];

export const IMAGE_MEDIA_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".heic",
  ".heif",
];

const IMAGE_MEDIA_ACCEPT = [...IMAGE_MEDIA_MIME_TYPES, ...IMAGE_MEDIA_EXTENSIONS].join(",");

export interface PublishAccountContentDraft {
  title: string;
  body: string;
  visibility: "public" | "friends" | "private";
  scheduleMode?: PublishScheduleMode;
  scheduledAt?: string;
  mediaName?: string;
  mediaPreviewUrl?: string;
  mediaPreviewType?: PublishContentType | "";
  mediaPreviewItems?: PublishMediaPreviewItem[];
  mediaCount?: number;
  hasMediaOverride?: boolean;
}

export interface PublishMediaPreviewItem {
  name: string;
  url: string;
  sourceUrl?: string;
  coverDataUrl?: string;
  type: PublishContentType;
  previewKind: "image" | "video";
}

interface PublishMediaDraft {
  mediaName: string;
  mediaPreviewUrl: string;
  mediaPreviewType: PublishContentType | "";
  mediaPreviewItems: PublishMediaPreviewItem[];
  mediaCount: number;
}

type ResolvedPublishAccountContentDraft = PublishAccountContentDraft & PublishMediaDraft & {
  scheduleMode: PublishScheduleMode;
  scheduledAt: string;
};

export interface PublishDraft {
  contentType: PublishContentType;
  title: string;
  body: string;
  visibility: "public" | "friends" | "private";
  scheduleMode: PublishScheduleMode;
  scheduledAt: string;
  selectedAccountIds: string[];
  mediaName: string;
  mediaPreviewUrl: string;
  mediaPreviewType: PublishContentType | "";
  mediaPreviewItems: PublishMediaPreviewItem[];
  mediaCount: number;
  accountContents: Record<string, PublishAccountContentDraft>;
}

export interface PublishProgressState {
  phase: PublishProgressPhase;
  completed: number;
  total: number;
  success: number;
  failed: number;
  currentLabel: string;
  message: string;
  results?: PublishProgressResult[];
}

export interface PublishProgressResult {
  accountId: string;
  platformId: string;
  status: "success" | "failed" | "unsupported";
  message: string;
  remoteId?: string | null;
  label?: string;
}

export interface PublishTargetAvailability {
  publishable: boolean;
  reason: "signed-out" | "unsupported" | "";
  scheduleSupported: boolean;
  visibilityOptions: PublishDraft["visibility"][];
}

export interface PublishPageState {
  text: CopyText;
  language: LanguageMode;
  draft: PublishDraft;
  activeStep: PublishStep;
  activeResourceTab: PublishResourceTab;
  collapsedAccountIds: string[];
  searchQuery: string;
  resources: LocalResource[];
  accounts: ChannelAccount[];
  platforms: PlatformInfo[];
  targetAvailability: Record<string, PublishTargetAvailability>;
  validationErrors: string[];
  attemptedSubmit: boolean;
  publishProgress: PublishProgressState | null;
}

const publishText = {
  zh: {
    title: "发布作品",
    desc: "编辑一次内容，选择发布账号，系统会按平台规则完成发布配置。",
    resourceLibrary: "资源库",
    resourceSearchPlaceholder: "搜索资源",
    resourceEmpty: "暂无资源",
    resourceSearchEmpty: "没有找到匹配的资源",
    resourceCopy: "文案",
    resourceImage: "图片",
    resourceVideo: "视频",
    newResource: "新增资源",
    useResource: "使用资源",
    deleteResource: "删除资源",
    video: "视频",
    article: "图文",
    targetAccounts: "选择发布账号",
    nextStep: "下一步",
    prevStep: "上一步",
    accountContentEmpty: "请选择至少一个可发布账号。",
    accountSpecificTitle: "账号内容适配",
    accountSpecificDesc: "默认沿用第一步内容，也可以为单个账号覆盖。",
    titleLabel: "作品标题",
    titlePlaceholder: "输入作品标题，最多 30 个字",
    bodyPlaceholder: "写下作品描述、卖点、口播稿或图文正文，可直接输入 #话题",
    mediaVideoHint: "上传 1 个视频素材，系统会按所选平台校验大小和时长",
    mediaArticleHint: "上传图片素材，系统会按所选平台校验数量和大小",
    selectFile: "选择文件",
    noAccounts: "暂无可发布账号，请先登录平台账号。",
    unavailable: "需重新登录",
    unsupportedVideo: "暂不支持发布视频",
    unsupportedArticle: "暂不支持发布图文",
    public: "公开",
    friends: "好友可见",
    private: "私密",
    privateBilibili: "仅自己可见",
    publishTime: "发布时间",
    scheduleTime: "定时时间",
    scheduleTimePlaceholder: "选择定时时间",
    publishNow: "立即发布",
    schedule: "定时发布",
    publish: "发布作品",
    publishing: "正在发布",
    publishSuccess: "发布成功",
    publishFailed: "发布失败",
    publishUnsupported: "暂不支持",
    publishFinishedWithErrors: "发布完成，有失败账号",
    publishProgressCount: "已完成 {completed}/{total}",
    publishProgressSummary: "成功 {success}，失败 {failed}",
    remoteWorkId: "作品ID",
    validationTitle: "发布前需要处理",
  },
  en: {
    title: "Publish Work",
    desc: "Compose once, choose target accounts, and adapt settings by platform rules.",
    resourceLibrary: "Library",
    resourceSearchPlaceholder: "Search resources",
    resourceEmpty: "No resources yet",
    resourceSearchEmpty: "No matching resources",
    resourceCopy: "Copy",
    resourceImage: "Images",
    resourceVideo: "Videos",
    newResource: "New Resource",
    useResource: "Use resource",
    deleteResource: "Delete resource",
    video: "Video",
    article: "Article",
    targetAccounts: "Choose Accounts",
    nextStep: "Next",
    prevStep: "Back",
    accountContentEmpty: "Select at least one publishable account.",
    accountSpecificTitle: "Account Adaptation",
    accountSpecificDesc: "Defaults inherit step one. Override per account if needed.",
    titleLabel: "Title",
    titlePlaceholder: "Enter a title, up to 30 characters",
    bodyPlaceholder: "Write the description, script, or article body. Add #topics directly here.",
    mediaVideoHint: "Upload one video file. Limits are checked per selected platform.",
    mediaArticleHint: "Upload images. Count and size limits are checked per selected platform.",
    selectFile: "Select File",
    noAccounts: "No publishable accounts yet. Sign in to a platform account first.",
    unavailable: "Sign in again",
    unsupportedVideo: "Video publishing is not supported yet",
    unsupportedArticle: "Article publishing is not supported yet",
    public: "Public",
    friends: "Friends",
    private: "Private",
    privateBilibili: "Only me",
    publishTime: "Publish time",
    scheduleTime: "Scheduled time",
    scheduleTimePlaceholder: "Select time",
    publishNow: "Publish now",
    schedule: "Schedule",
    publish: "Publish",
    publishing: "Publishing",
    publishSuccess: "Published",
    publishFailed: "Failed",
    publishUnsupported: "Unsupported",
    publishFinishedWithErrors: "Finished with errors",
    publishProgressCount: "{completed}/{total} done",
    publishProgressSummary: "{success} succeeded, {failed} failed",
    remoteWorkId: "Work ID",
    validationTitle: "Before publishing",
  },
};

export function renderPublishPage({
  text,
  language,
  draft,
  activeStep,
  activeResourceTab,
  collapsedAccountIds,
  searchQuery,
  resources,
  accounts,
  platforms,
  targetAvailability,
  validationErrors,
  attemptedSubmit,
  publishProgress,
}: PublishPageState) {
  const t = publishText[language];
  const selectedAccounts = accounts.filter((account) => (
    draft.selectedAccountIds.includes(account.id) && targetAvailability[account.id]?.publishable
  ));
  const resourceEmptyText = searchQuery.trim() ? t.resourceSearchEmpty : t.resourceEmpty;

  return `
    <section class="publish-page">
      <aside class="publish-drafts" aria-label="${escapeAttribute(t.resourceLibrary)}">
        <div class="publish-search">
          <label class="publish-search-box">
            ${icon("search")}
            <input type="search" data-publish-search value="${escapeAttribute(searchQuery)}" placeholder="${escapeAttribute(t.resourceSearchPlaceholder)}" autocomplete="off" spellcheck="false" />
          </label>
          <button class="publish-search-add" type="button" data-publish-action="new-resource" title="${escapeAttribute(t.newResource)}">${icon("plus")}</button>
        </div>
        <div class="publish-resource-tabs" role="tablist" aria-label="${escapeAttribute(t.resourceLibrary)}">
          ${renderResourceTab("copy", activeResourceTab, t.resourceCopy)}
          ${renderResourceTab("image", activeResourceTab, t.resourceImage)}
          ${renderResourceTab("video", activeResourceTab, t.resourceVideo)}
        </div>
        <div class="publish-resource-list">
          ${resources.length ? resources.map((resource) => renderResourceCard(resource, t)).join("") : renderResourceEmpty(resourceEmptyText)}
        </div>
      </aside>

      <section class="publish-workspace">
        <header class="publish-head">
          <div class="publish-head-title">
            <div class="publish-head-icon">${icon("send")}</div>
            <div>
              <h1>${t.title}</h1>
              <p>${t.desc}</p>
            </div>
          </div>
        </header>

        <div class="publish-workbench">
          <main class="publish-main publish-flow-main">
            <form class="publish-editor publish-flow-form" data-publish-form>
              ${
                attemptedSubmit && validationErrors.length
                  ? `<div class="publish-errors"><strong>${t.validationTitle}</strong>${validationErrors.map((error) => `<span>${escapeHtml(error)}</span>`).join("")}</div>`
                  : ""
              }
              ${
                activeStep === "content"
                  ? renderPublishContentStep(draft, accounts, platforms, targetAvailability, text, t)
                  : renderPublishAccountStep(draft, selectedAccounts, platforms, targetAvailability, text, t, collapsedAccountIds)
              }
            </form>
          </main>
        </div>
        ${renderPublishFlowActions(activeStep, t, publishProgress)}
      </section>
    </section>
  `;
}

function renderPublishContentStep(
  draft: PublishDraft,
  accounts: ChannelAccount[],
  platforms: PlatformInfo[],
  targetAvailability: Record<string, PublishTargetAvailability>,
  text: CopyText,
  t: PublishText,
) {
  const titleCount = [...draft.title].length;
  const mediaConfig = publishMediaConfig(draft.contentType, t);
  return `
    <section class="publish-step-card publish-step-content">
      <div class="publish-target-row">
        <div class="publish-target-strip" data-publish-target-strip aria-label="${escapeAttribute(t.targetAccounts)}">
          ${accounts.length ? accounts.map((account) => renderPublishTargetChip(account, platforms, draft, targetAvailability[account.id], text, t)).join("") : ""}
        </div>
        <div class="publish-type-switch" role="tablist">
          ${renderTypeButton("video", t.video, draft.contentType)}
          ${renderTypeButton("article", t.article, draft.contentType)}
        </div>
      </div>

      <div class="publish-compose-surface">
        <label class="publish-title-bar">
          <span>${t.titleLabel}</span>
          <input name="title" maxlength="30" value="${escapeAttribute(draft.title)}" placeholder="${escapeAttribute(t.titlePlaceholder)}" autocomplete="off" />
          <em>${titleCount}/30</em>
        </label>
        ${renderPublishTextarea({
          name: "body",
          value: draft.body,
          placeholder: t.bodyPlaceholder,
          className: "publish-main-textarea",
          rows: 8,
        })}
        <div class="publish-compose-media-row">
          ${renderPublishMediaUploader(draft, mediaConfig, t.selectFile)}
        </div>
      </div>
    </section>
  `;
}

function publishMediaConfig(contentType: PublishContentType, t: PublishText): PublishMediaConfig {
  return contentType === "video"
    ? { accept: VIDEO_MEDIA_ACCEPT, multiple: false, hint: t.mediaVideoHint }
    : { accept: IMAGE_MEDIA_ACCEPT, multiple: true, hint: t.mediaArticleHint };
}

function renderPublishMediaUploader(
  draft: PublishMediaDraft,
  mediaConfig: PublishMediaConfig,
  selectFileText: string,
  accountId = "",
) {
  const scopeAttrs = publishMediaScopeAttributes(accountId);
  if (draft.mediaPreviewType === "article" && draft.mediaPreviewItems.length) {
    return `
      <div class="publish-media-gallery" aria-label="${escapeAttribute(draft.mediaName || mediaConfig.hint)}">
        ${draft.mediaPreviewItems.map((item, index) => renderPublishImagePreviewItem(item, index, draft.mediaPreviewItems.length, accountId)).join("")}
        <button class="publish-media-add-card" type="button" data-publish-media-picker data-publish-media-mode="append" data-publish-media-accept="${escapeAttribute(mediaConfig.accept)}" ${mediaConfig.multiple ? 'data-publish-media-multiple="true"' : ""}${scopeAttrs} title="${escapeAttribute(mediaConfig.hint)}">
          <span>${icon("plus")}</span>
          <strong>${selectFileText}</strong>
        </button>
      </div>
    `;
  }

  if (draft.mediaPreviewType === "video" && draft.mediaPreviewItems.length) {
    return renderPublishVideoPreviewItem(draft.mediaPreviewItems[0], accountId);
  }

  return `
    <button class="publish-media-upload" type="button" data-publish-media-picker data-publish-media-mode="replace" data-publish-media-accept="${escapeAttribute(mediaConfig.accept)}" ${mediaConfig.multiple ? 'data-publish-media-multiple="true"' : ""}${scopeAttrs} aria-label="${escapeAttribute(draft.mediaName || mediaConfig.hint)}" title="${escapeAttribute(draft.mediaName || mediaConfig.hint)}">
      ${renderPublishMediaUploadFrame(draft, selectFileText)}
    </button>
  `;
}

function publishMediaScopeAttributes(accountId: string) {
  return accountId ? ` data-publish-media-account="${escapeAttribute(accountId)}"` : "";
}

function renderPublishImagePreviewItem(item: PublishMediaPreviewItem, index: number, total: number, accountId = "") {
  const label = `${index + 1}/${total}`;
  const scopeAttrs = publishMediaScopeAttributes(accountId);
  return `
    <div class="publish-media-image-card" data-publish-media-drag-index="${index}"${scopeAttrs} title="${escapeAttribute(item.name)}">
      <img src="${escapeAttribute(item.url)}" alt="" />
      <button class="publish-media-remove" type="button" data-publish-media-remove-index="${index}"${scopeAttrs} aria-label="移除图片" title="移除图片">${icon("x")}</button>
      <span class="publish-media-count">${label}</span>
    </div>
  `;
}

function renderPublishVideoPreviewItem(item: PublishMediaPreviewItem, accountId = "") {
  const sourceUrl = escapeAttribute(item.sourceUrl || item.url);
  const poster = item.previewKind === "image" ? ` poster="${escapeAttribute(item.url)}"` : "";
  const scopeAttrs = publishMediaScopeAttributes(accountId);
  return `
    <div class="publish-media-video-card" title="${escapeAttribute(item.name)}">
      <video src="${sourceUrl}#t=0.1"${poster} muted playsinline preload="metadata"></video>
      <button class="publish-media-video-play" type="button" data-publish-video-open${scopeAttrs} aria-label="播放视频" title="播放视频">
        <span class="publish-media-video-play-icon">${icon("play")}</span>
      </button>
      <button class="publish-media-remove" type="button" data-publish-media-clear${scopeAttrs} aria-label="移除素材" title="移除素材">${icon("x")}</button>
    </div>
  `;
}

function renderPublishMediaUploadFrame(draft: PublishMediaDraft, selectFileText: string) {
  if (!draft.mediaPreviewUrl) {
    return `
      <span class="publish-media-upload-frame">
        <span class="publish-media-upload-icon">${icon("plus")}</span>
        <strong>${selectFileText}</strong>
      </span>
    `;
  }

  const previewUrl = escapeAttribute(draft.mediaPreviewUrl);
  const previewItem = draft.mediaPreviewItems[0];
  const media = draft.mediaPreviewType === "video" && previewItem?.previewKind === "video"
    ? `<video src="${previewUrl}#t=0.1" muted playsinline preload="auto"></video>`
    : `<img src="${previewUrl}" alt="" />`;
  const videoOverlay = draft.mediaPreviewType === "video"
    ? `
      <span class="publish-media-play">${icon("play")}</span>
      <button class="publish-media-remove" type="button" data-publish-media-clear aria-label="移除素材" title="移除素材">${icon("x")}</button>
    `
    : `<span class="publish-media-replace">${icon("plus")}</span>`;

  return `
    <span class="publish-media-upload-frame has-preview ${draft.mediaPreviewType === "video" ? "is-video-preview" : ""}">
      ${media}
      ${videoOverlay}
    </span>
  `;
}

function renderPublishAccountStep(
  draft: PublishDraft,
  selectedAccounts: ChannelAccount[],
  platforms: PlatformInfo[],
  targetAvailability: Record<string, PublishTargetAvailability>,
  text: CopyText,
  t: PublishText,
  collapsedAccountIds: string[],
) {
  return `
    <section class="publish-step-card publish-step-accounts">
      <div class="publish-step-head">
        <div>
          <strong>${t.accountSpecificTitle}</strong>
          <span>${t.accountSpecificDesc}</span>
        </div>
      </div>
      <div class="publish-account-edit-list">
        ${
          selectedAccounts.length
            ? selectedAccounts.map((account) => renderPublishAccountEditor(
                account,
                platforms,
                draft,
                targetAvailability[account.id],
                text,
                t,
                collapsedAccountIds.includes(account.id),
              )).join("")
            : `<div class="publish-empty">${t.accountContentEmpty}</div>`
        }
      </div>
    </section>
  `;
}

function renderPublishFlowActions(activeStep: PublishStep, t: PublishText, publishProgress: PublishProgressState | null) {
  const progress = renderPublishProgress(publishProgress, t);
  const actionsClass = `publish-flow-actions${publishProgress ? " has-progress" : ""}`;
  const disabled = publishProgress?.phase === "running" ? "disabled" : "";
  if (activeStep === "content") {
    return `
      <div class="${actionsClass}">
        ${progress}
        <div class="publish-flow-buttons">
          <button class="primary-btn compact-btn publish-next-btn" type="button" data-publish-action="publish-next" ${disabled}>${t.nextStep}${icon("chevron")}</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="${actionsClass}">
      ${progress}
      <div class="publish-flow-buttons">
        <button class="ghost-btn compact-btn" type="button" data-publish-action="publish-prev" ${disabled}>${icon("chevron")}${t.prevStep}</button>
        <button class="primary-btn compact-btn" type="button" data-publish-action="publish" ${disabled}>${icon("send")}${t.publish}</button>
      </div>
    </div>
  `;
}

function renderPublishProgress(progress: PublishProgressState | null, t: PublishText) {
  if (!progress) return "";
  const total = Math.max(progress.total, 1);
  const completed = Math.min(Math.max(progress.completed, 0), total);
  const runningPercent = Math.round(((completed + 0.35) / total) * 100);
  const percent = progress.phase === "running"
    ? Math.min(96, Math.max(8, runningPercent))
    : 100;
  const statusText = progress.phase === "running"
    ? t.publishing
    : progress.phase === "success"
      ? t.publishSuccess
      : t.publishFinishedWithErrors;
  const countText = t.publishProgressCount
    .replace("{completed}", String(completed))
    .replace("{total}", String(progress.total));
  const summaryText = t.publishProgressSummary
    .replace("{success}", String(progress.success))
    .replace("{failed}", String(progress.failed));
  const message = progress.message || statusText;
  const results = progress.results?.length
    ? `<div class="publish-progress-results">
        ${progress.results.map((result) => renderPublishProgressResult(result, t)).join("")}
      </div>`
    : "";
  return `
    <div class="publish-flow-progress is-${progress.phase}" style="--publish-progress: ${percent}%;">
      <div class="publish-flow-progress-head">
        <span class="publish-flow-progress-title">${escapeHtml(message)}</span>
        <span>${escapeHtml(countText)}</span>
      </div>
      <div class="publish-flow-progress-track" aria-label="${escapeAttribute(statusText)}">
        <span class="publish-flow-progress-fill"></span>
      </div>
      <div class="publish-flow-progress-meta">
        <span>${escapeHtml(summaryText)}</span>
        ${progress.currentLabel ? `<span>${escapeHtml(progress.currentLabel)}</span>` : ""}
      </div>
      ${results}
    </div>
  `;
}

function renderPublishProgressResult(result: PublishProgressResult, t: PublishText) {
  const label = result.label || result.accountId;
  const statusText = result.status === "success"
    ? t.publishSuccess
    : result.status === "unsupported"
      ? t.publishUnsupported
      : t.publishFailed;
  const remoteId = result.remoteId
    ? `<span class="publish-progress-result-remote" title="${escapeAttribute(`${t.remoteWorkId}: ${result.remoteId}`)}">${escapeHtml(`${t.remoteWorkId}: ${result.remoteId}`)}</span>`
    : "";
  const message = result.message
    ? `<span class="publish-progress-result-message" title="${escapeAttribute(result.message)}">${escapeHtml(result.message)}</span>`
    : "";
  return `
    <div class="publish-progress-result is-${result.status}">
      <span class="publish-progress-result-main">
        <span class="publish-progress-result-status">${escapeHtml(statusText)}</span>
        <span class="publish-progress-result-label" title="${escapeAttribute(label)}">${escapeHtml(label)}</span>
      </span>
      ${remoteId}
      ${message}
    </div>
  `;
}

function renderPublishTargetChip(
  account: ChannelAccount,
  platforms: PlatformInfo[],
  draft: PublishDraft,
  availability: PublishTargetAvailability | undefined,
  text: CopyText,
  t: PublishText,
) {
  const platform = platforms.find((item) => item.id === account.platformId);
  const publishable = Boolean(availability?.publishable);
  const checked = publishable && draft.selectedAccountIds.includes(account.id);
  const unsupportedText = draft.contentType === "video" ? t.unsupportedVideo : t.unsupportedArticle;
  const stateText = publishable
    ? statusLabel(account.status, text)
    : availability?.reason === "unsupported"
      ? unsupportedText
      : t.unavailable;
  const loginTarget = account.platformId === "xiaohongshu" ? ' data-login-target="creator"' : "";
  if (availability?.reason === "signed-out") {
    return `
      <button class="publish-account-chip disabled" type="button" data-login="${escapeAttribute(account.platformId)}" data-login-account="${escapeAttribute(account.id)}"${loginTarget} title="${escapeAttribute(`${account.nickname} · ${stateText}`)}">
        ${renderAccountAvatar(account, platform, escapeHtml(account.nickname.slice(0, 1)), "publish-account-chip-avatar")}
        <span class="publish-account-chip-platform">${platform ? platformLogo(platform, "avatar") : ""}</span>
      </button>
    `;
  }
  if (!publishable) {
    return `
      <button class="publish-account-chip disabled unsupported" type="button" disabled title="${escapeAttribute(`${account.nickname} · ${stateText}`)}">
        ${renderAccountAvatar(account, platform, escapeHtml(account.nickname.slice(0, 1)), "publish-account-chip-avatar")}
        <span class="publish-account-chip-platform">${platform ? platformLogo(platform, "avatar") : ""}</span>
      </button>
    `;
  }
  return `
    <label class="publish-account-chip ${checked ? "checked" : ""}" title="${escapeAttribute(`${account.nickname} · ${stateText}`)}">
      <input type="checkbox" data-publish-target="${escapeAttribute(account.id)}" ${checked ? "checked" : ""} />
      ${renderAccountAvatar(account, platform, escapeHtml(account.nickname.slice(0, 1)), "publish-account-chip-avatar")}
      <span class="publish-account-chip-platform">${platform ? platformLogo(platform, "avatar") : ""}</span>
      <span class="publish-account-chip-check">${icon("check")}</span>
    </label>
  `;
}

function renderPublishAccountEditor(
  account: ChannelAccount,
  platforms: PlatformInfo[],
  draft: PublishDraft,
  availability: PublishTargetAvailability | undefined,
  text: CopyText,
  t: PublishText,
  collapsed: boolean,
) {
  const platform = platforms.find((item) => item.id === account.platformId);
  const accountDraft = accountContentForDraft(draft, account.id);
  const scheduleSupported = Boolean(availability?.scheduleSupported);
  const scheduleMode = scheduleSupported ? accountDraft.scheduleMode : "now";
  const availableVisibilityOptions: PublishDraft["visibility"][] = availability?.visibilityOptions?.length
    ? availability.visibilityOptions
    : ["public"];
  const supportedVisibilityOptions = publishVisibilityOptions(account.platformId, draft.contentType, scheduleMode);
  const visibilityOptions = availableVisibilityOptions.filter((value) => supportedVisibilityOptions.includes(value));
  const visibility = visibilityOptions.includes(accountDraft.visibility) ? accountDraft.visibility : "public";
  const mediaConfig = publishMediaConfig(draft.contentType, t);
  const scheduledAtParts = splitScheduledAt(scheduleMode === "scheduled" ? accountDraft.scheduledAt : "");
  return `
    <article class="publish-account-editor ${collapsed ? "collapsed" : ""}">
      <button class="publish-account-editor-toggle" type="button" data-publish-account-toggle="${escapeAttribute(account.id)}" aria-expanded="${!collapsed}">
        <span class="publish-account-editor-identity">
          ${renderAccountAvatar(account, platform, escapeHtml(account.nickname.slice(0, 1)), "publish-account-editor-avatar")}
          <span class="publish-account-editor-platform">${platform ? platformLogo(platform, "avatar") : ""}</span>
        </span>
        <span class="publish-account-editor-title">
          <strong>${escapeHtml(account.nickname)}</strong>
          <span>${statusLabel(account.status, text)}</span>
        </span>
        <span class="publish-account-editor-chevron">${icon("chevron")}</span>
      </button>
      ${collapsed ? "" : `
        <div class="publish-account-editor-card">
          <label class="publish-title-bar publish-account-title-bar">
            <span>${t.titleLabel}</span>
            <input data-publish-account-content="${escapeAttribute(account.id)}" data-publish-account-field="title" maxlength="30" value="${escapeAttribute(accountDraft.title)}" placeholder="${escapeAttribute(t.titlePlaceholder)}" autocomplete="off" />
            <em>${[...accountDraft.title].length}/30</em>
          </label>
          <div class="publish-account-compose-body">
            ${renderPublishTextarea({
              value: accountDraft.body,
              placeholder: t.bodyPlaceholder,
              className: "publish-account-textarea",
              rows: 5,
              attributes: `data-publish-account-content="${escapeAttribute(account.id)}" data-publish-account-field="body"`,
            })}
          </div>
          <div class="publish-account-media-row">
            ${renderPublishMediaUploader(accountDraft, mediaConfig, t.selectFile, account.id)}
          </div>
          <div class="publish-account-field-grid">
            <label>
              <span>可见范围</span>
              <select data-publish-account-content="${escapeAttribute(account.id)}" data-publish-account-field="visibility">
                ${visibilityOptions.map((option) => `
                  <option value="${option}" ${visibility === option ? "selected" : ""}>${publishVisibilityLabel(option, t, account.platformId)}</option>
                `).join("")}
              </select>
            </label>
            <label>
              <span>${t.publishTime}</span>
              <select data-publish-account-content="${escapeAttribute(account.id)}" data-publish-account-field="scheduleMode">
                <option value="now" ${scheduleMode === "now" ? "selected" : ""}>${t.publishNow}</option>
                ${scheduleSupported ? `<option value="scheduled" ${scheduleMode === "scheduled" ? "selected" : ""}>${t.schedule}</option>` : ""}
              </select>
            </label>
            ${scheduleMode === "scheduled" ? `
              <label class="publish-account-schedule-time">
                <span>${t.scheduleTime}</span>
                <span class="publish-account-schedule-control">
                  <input class="publish-schedule-picker" type="text" data-publish-schedule-picker data-publish-account-content="${escapeAttribute(account.id)}" data-publish-account-field="scheduledAt" value="${escapeAttribute(formatScheduledAtDisplay(scheduledAtParts))}" placeholder="${escapeAttribute(t.scheduleTimePlaceholder)}" autocomplete="off" inputmode="numeric" />
                  <button class="publish-schedule-open" type="button" data-publish-schedule-open="${escapeAttribute(account.id)}" aria-label="${escapeAttribute(t.scheduleTimePlaceholder)}" title="${escapeAttribute(t.scheduleTimePlaceholder)}">${icon("calendar")}</button>
                </span>
              </label>
            ` : ""}
          </div>
        </div>
      `}
    </article>
  `;
}

function publishVisibilityLabel(visibility: PublishDraft["visibility"], t: PublishText, platformId = "") {
  if (visibility === "friends") return t.friends;
  if (visibility === "private") {
    return platformId === "bilibili" ? t.privateBilibili : t.private;
  }
  return t.public;
}

function accountContentForDraft(draft: PublishDraft, accountId: string): ResolvedPublishAccountContentDraft {
  const accountDraft = draft.accountContents[accountId];
  const useAccountMedia = Boolean(accountDraft?.hasMediaOverride);
  return {
    title: accountDraft?.title ?? draft.title,
    body: accountDraft?.body ?? draft.body,
    visibility: accountDraft?.visibility ?? draft.visibility,
    scheduleMode: accountDraft?.scheduleMode ?? draft.scheduleMode,
    scheduledAt: (accountDraft?.scheduleMode ?? draft.scheduleMode) === "scheduled"
      ? accountDraft?.scheduledAt ?? draft.scheduledAt
      : "",
    mediaName: useAccountMedia ? accountDraft?.mediaName || "" : draft.mediaName,
    mediaPreviewUrl: useAccountMedia ? accountDraft?.mediaPreviewUrl || "" : draft.mediaPreviewUrl,
    mediaPreviewType: useAccountMedia ? accountDraft?.mediaPreviewType || "" : draft.mediaPreviewType,
    mediaPreviewItems: useAccountMedia ? accountDraft?.mediaPreviewItems || [] : draft.mediaPreviewItems,
    mediaCount: useAccountMedia ? accountDraft?.mediaCount || 0 : draft.mediaCount,
    hasMediaOverride: accountDraft?.hasMediaOverride,
  };
}

function splitScheduledAt(value: string) {
  const normalized = value.trim().replace(" ", "T");
  const [date = "", rawTime = ""] = normalized.split("T");
  return {
    date,
    time: rawTime.slice(0, 5),
  };
}

function formatScheduledAtDisplay(parts: { date: string; time: string }) {
  if (!parts.date || !parts.time) return "";
  return `${parts.date} ${parts.time}`;
}

function renderPublishTextarea({
  name,
  value,
  placeholder,
  className,
  rows,
  attributes = "",
}: {
  name?: string;
  value: string;
  placeholder: string;
  className: string;
  rows: number;
  attributes?: string;
}) {
  return `
    <div class="publish-textarea-wrap">
      <div class="publish-textarea-highlight" data-publish-highlight aria-hidden="true">${renderHighlightedTags(value)}</div>
      <textarea class="${className} publish-tag-textarea" ${name ? `name="${escapeAttribute(name)}"` : ""} ${attributes} data-publish-highlight-input rows="${rows}" placeholder="${escapeAttribute(placeholder)}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

function renderHighlightedTags(value: string) {
  if (!value) return "";
  return value
    .split(/(#[^\s#]+)/g)
    .map((part) => part.startsWith("#") ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))
    .join("");
}

function renderResourceTab(value: PublishResourceTab, activeResourceTab: PublishResourceTab, label: string) {
  return `
    <button class="publish-resource-tab ${activeResourceTab === value ? "active" : ""}" type="button" data-publish-resource-tab="${value}" role="tab" aria-selected="${activeResourceTab === value}">
      ${label}
    </button>
  `;
}

function renderResourceEmpty(message: string) {
  return `
    <div class="publish-resource-empty">
      <span>${icon("folder")}</span>
      <strong>${escapeHtml(message)}</strong>
    </div>
  `;
}

function renderResourceCard(resource: LocalResource, t: PublishText) {
  const meta = resource.tags?.length ? resource.tags.slice(0, 2).join(" · ") : resource.source.toUpperCase();
  const body = localResourcePreviewText(resource);
  const image = resource.type === "image" && resource.path
    ? `<img src="${escapeAttribute(convertFileSrc(resource.path))}" alt="${escapeAttribute(resource.title)}" width="48" height="48" loading="eager" decoding="async" />`
    : "";
  const mediaIcon = resource.type === "copy" ? "copy" : resource.type === "video" ? "play" : "folder";
  return `
    <article class="publish-resource-card" title="${escapeAttribute(t.useResource)}">
      <button class="publish-resource-main" type="button" data-publish-resource-use="${escapeAttribute(resource.id)}">
        <span class="publish-resource-thumb ${image ? "has-image" : ""}">${image || icon(mediaIcon)}</span>
        <span class="publish-resource-copy">
          <strong>${escapeHtml(resource.title)}</strong>
          ${body ? `<span>${escapeHtml(body)}</span>` : ""}
          <small>${escapeHtml(meta)}</small>
        </span>
      </button>
      <button class="publish-resource-delete" type="button" data-publish-resource-delete="${escapeAttribute(resource.id)}" aria-label="${escapeAttribute(t.deleteResource)}" title="${escapeAttribute(t.deleteResource)}">${icon("x")}</button>
    </article>
  `;
}

function renderTypeButton(
  value: PublishContentType,
  label: string,
  selected: PublishContentType,
) {
  return `
    <button class="${selected === value ? "active" : ""}" type="button" data-publish-type="${value}">
      ${label}
    </button>
  `;
}
