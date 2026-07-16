import type {
  AiRequestStatus,
  LanguageMode,
  LocalResource,
  LocalResourceType,
} from "../domain/types";
import type { PublishMediaFile } from "../features/publish-media";

type ImageOutput = AiRequestStatus["outputs"][number];
const PUBLISH_TITLE_MAX_LENGTH = 30;

export interface CreateLocalResourceInput {
  userId: string;
  type: LocalResourceType;
  title: string;
  body?: string;
  path?: string;
  thumbnailPath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  source: "ai" | "import" | "manual";
  aiRequestId?: string;
  aiOutputId?: string;
  tags: string[];
}

export interface SavedGeneratedImageFile {
  path: string;
  url: string;
  fileName: string;
}

export function filterLocalResources(
  resources: LocalResource[],
  type: LocalResourceType,
  query: string,
) {
  const keyword = query.trim().toLocaleLowerCase();
  return resources
    .filter((resource) => resource.type === type)
    .filter((resource) => !keyword || resourceSearchText(resource).includes(keyword))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function buildCopyResourceDraftPatch(resource: LocalResource) {
  const body = normalizeResourceCopyBody(resource);
  return {
    title: buildPublishTitle(resource.title, body),
    body,
  };
}

export function localResourceToPublishMediaFile(resource: LocalResource): PublishMediaFile {
  return {
    name: resource.title || fileNameFromPath(resource.path || ""),
    type: resource.mimeType || (resource.type === "video" ? "video/mp4" : "image/jpeg"),
    size: resource.size || undefined,
    width: resource.width || undefined,
    height: resource.height || undefined,
    path: resource.path || "",
  };
}

export function localResourcePreviewText(resource: LocalResource) {
  return resource.type === "copy" ? resource.body || "" : "";
}

export function buildTextResourceInput({
  userId,
  content,
  language,
}: {
  userId: string;
  content: string;
  language: LanguageMode;
}): CreateLocalResourceInput {
  const body = content.trim();
  return {
    userId,
    type: "copy",
    title: textResourceTitle(body, language),
    body,
    source: "ai",
    tags: [language === "zh" ? "AI文案" : "AI copy"],
  };
}

export function buildImageResourceInput({
  userId,
  requestId,
  output,
  localFile,
  language,
  title,
}: {
  userId: string;
  requestId: string;
  output: ImageOutput;
  localFile: SavedGeneratedImageFile;
  language: LanguageMode;
  title?: string;
}): CreateLocalResourceInput {
  return {
    userId,
    type: "image",
    title: imageResourceTitle(output, language, title),
    path: localFile.path,
    mimeType: "image/jpeg",
    width: output.width,
    height: output.height,
    size: Number(output.byteSize) || undefined,
    source: "ai",
    aiRequestId: requestId,
    aiOutputId: output.id,
    tags: [language === "zh" ? "AI图片" : "AI image"],
  };
}

function resourceSearchText(resource: LocalResource) {
  return [
    resource.title,
    resource.body,
    resource.path,
    ...(resource.tags || []),
  ].filter(Boolean).join("\n").toLocaleLowerCase();
}

function fileNameFromPath(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function textResourceTitle(content: string, language: LanguageMode) {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const fallback = language === "zh" ? "AI文案" : "AI copy";
  return (firstLine || fallback).slice(0, 40);
}

function normalizeResourceCopyBody(resource: LocalResource) {
  return (resource.body || resource.title || "").trim();
}

function buildPublishTitle(resourceTitle: string, body: string) {
  const title = firstNonEmptyLine(resourceTitle) || firstNonEmptyLine(body) || "";
  return [...title].slice(0, PUBLISH_TITLE_MAX_LENGTH).join("");
}

function firstNonEmptyLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function imageResourceTitle(output: ImageOutput, language: LanguageMode, title = "") {
  const normalized = title.trim();
  if (normalized) return [...normalized].slice(0, 60).join("");
  return language === "zh" ? `生成图片 ${output.sequenceNo}` : `Generated image ${output.sequenceNo}`;
}
