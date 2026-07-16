import type { LanguageMode } from "../domain/types";
import {
  publishMediaPolicy,
  type PublishContentType,
} from "../domain/publish-capabilities";
import {
  hasPublishMediaDimensions,
  hasPublishVideoDuration,
  isImageMediaFile,
  isVideoMediaFile,
  publishMediaFileSize,
  type PublishMediaFile,
} from "./publish-media";

export function validatePublishMediaFiles(
  files: PublishMediaFile[],
  contentType: PublishContentType,
  platformId: string,
  language: LanguageMode,
) {
  if (!files.length) return "";
  const emptyFile = files.find((file) => publishMediaFileSize(file) === 0);
  if (emptyFile) {
    return language === "zh"
      ? `素材文件为空，无法发布：${emptyFile.name}`
      : `Media file is empty and cannot be published: ${emptyFile.name}`;
  }

  const policy = publishMediaPolicy(platformId);
  const platformName = policy?.name[language] || "";
  if (contentType === "video") {
    if (files.length !== 1) {
      return platformName
        ? localized(language, `${platformName}视频发布只支持选择 1 个视频素材。`, `${platformName} video posts support one video file.`)
        : localized(language, "视频模式只能上传 1 个视频素材。", "Video mode supports one video file.");
    }
    const video = files[0];
    if (!isVideoMediaFile(video)) {
      return platformName
        ? localized(language, `${platformName}视频发布请上传视频素材。`, `Upload a video file for ${platformName} video posts.`)
        : localized(language, "视频模式请上传视频素材。", "Upload a video file for video mode.");
    }
    const size = publishMediaFileSize(video);
    if (policy?.maxVideoBytes && size !== undefined && size > policy.maxVideoBytes) {
      return localized(
        language,
        `${platformName}视频最大支持 ${formatByteLimit(policy.maxVideoBytes, "zh")}。`,
        `${platformName} videos can be up to ${formatByteLimit(policy.maxVideoBytes, "en")}.`,
      );
    }
    if (
      policy?.maxVideoDurationSeconds
      && Number.isFinite(video.duration)
      && Number(video.duration) > policy.maxVideoDurationSeconds
    ) {
      return localized(
        language,
        `${platformName}视频时长最长支持 1 小时。`,
        `${platformName} videos can be up to 1 hour long.`,
      );
    }
    if (policy?.requireVideoDimensions && !hasPublishMediaDimensions(video)) {
      return localized(
        language,
        `${platformName}视频发布需要读取视频宽高，请重新选择视频后再发布。`,
        `${platformName} video publishing needs video dimensions. Re-select the video before publishing.`,
      );
    }
    if (policy?.requireVideoDuration && !hasPublishVideoDuration(video)) {
      return localized(
        language,
        `${platformName}视频发布需要读取视频时长，请重新选择视频后再发布。`,
        `${platformName} video publishing needs video duration. Re-select the video before publishing.`,
      );
    }
    return "";
  }

  if (policy?.maxImageCount && files.length > policy.maxImageCount) {
    return localized(
      language,
      `${platformName}图文最多支持 ${policy.maxImageCount} 张图片。`,
      `${platformName} article posts support up to ${policy.maxImageCount} images.`,
    );
  }
  const invalid = files.find((file) => !isImageMediaFile(file));
  if (invalid) {
    return platformName
      ? localized(language, `${platformName}图文发布请上传图片素材。`, `Upload image files for ${platformName} article posts.`)
      : localized(language, "图文模式请上传图片素材。", "Upload image files for article mode.");
  }
  const oversized = policy?.maxImageBytes
    ? files.find((file) => (publishMediaFileSize(file) || 0) > policy.maxImageBytes!)
    : undefined;
  if (oversized && policy?.maxImageBytes) {
    return localized(
      language,
      `${platformName}图片单张最大支持 ${formatByteLimit(policy.maxImageBytes, "zh")}：${oversized.name}`,
      `${platformName} images can be up to ${formatByteLimit(policy.maxImageBytes, "en")} each: ${oversized.name}`,
    );
  }
  const missingDimensions = policy?.requireImageDimensions
    ? files.find((file) => !hasPublishMediaDimensions(file))
    : undefined;
  if (missingDimensions) {
    return localized(
      language,
      `${platformName}图文发布需要读取图片宽高，请重新选择素材后再发布：${missingDimensions.name}`,
      `${platformName} article publishing needs image dimensions. Re-select this image: ${missingDimensions.name}`,
    );
  }
  return "";
}

export function publishCaptionLimit(platformId: string, contentType: PublishContentType) {
  return publishMediaPolicy(platformId)?.maxCaptionChars?.[contentType];
}

export function requiresPublishVideoCover(platformId: string) {
  return Boolean(publishMediaPolicy(platformId)?.requireVideoCover);
}

function localized(language: LanguageMode, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

function formatByteLimit(bytes: number, language: LanguageMode) {
  const gb = bytes / (1024 * 1024 * 1024);
  if (Number.isInteger(gb)) return `${gb}${language === "zh" ? "G" : " GB"}`;
  const mb = bytes / (1024 * 1024);
  return `${mb}${language === "zh" ? "M" : " MB"}`;
}
