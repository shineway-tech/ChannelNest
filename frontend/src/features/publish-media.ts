import { convertFileSrc } from "@tauri-apps/api/core";
import type { LanguageMode } from "../domain/types";
import {
  IMAGE_MEDIA_EXTENSIONS,
  type PublishDraft,
  type PublishMediaPreviewItem,
  VIDEO_MEDIA_EXTENSIONS,
} from "../pages/publish";

export type PublishMediaFile = {
  name: string;
  type: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  file?: File;
  path?: string;
};

export type PublishMediaFields = Pick<
  PublishDraft,
  "mediaName" | "mediaPreviewUrl" | "mediaPreviewType" | "mediaPreviewItems" | "mediaCount"
>;

export function pickPublishMediaFilesWithInput(accept: string, multiple: boolean) {
  return new Promise<PublishMediaFile[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => {
      resolve(Array.from(input.files || []).map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        file,
      })));
    }, { once: true });
    input.click();
  });
}

export function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
}

export function inferPublishMediaType(path: string) {
  if (hasPublishMediaExtension(path, VIDEO_MEDIA_EXTENSIONS)) return "video";
  if (hasPublishMediaExtension(path, IMAGE_MEDIA_EXTENSIONS)) return "image";
  return "";
}

export function readPublishMediaAccount(element: HTMLElement | null | undefined) {
  return element?.dataset.publishMediaAccount || "";
}

export function createPublishMediaFields(
  files: PublishMediaFile[],
  previewItems: PublishMediaPreviewItem[],
  language: LanguageMode,
): PublishMediaFields {
  const mediaName = files.length < 2
    ? files[0]?.name || ""
    : `${files[0].name} ${language === "zh" ? `等 ${files.length} 个文件` : `and ${files.length - 1} more`}`;
  return {
    mediaName,
    mediaPreviewUrl: previewItems[0]?.url || "",
    mediaPreviewType: previewItems[0]?.type || "",
    mediaPreviewItems: previewItems,
    mediaCount: files.length,
  };
}

export function publishMediaSourceUrl(mediaFile: PublishMediaFile) {
  if (mediaFile.file) return URL.createObjectURL(mediaFile.file);
  if (mediaFile.path) return convertFileSrc(mediaFile.path);
  return "";
}

export async function readPublishVideoMetadata(mediaFile: PublishMediaFile) {
  const source = createPublishMediaMetadataSource(mediaFile);
  if (!source.url) return {};
  const video = document.createElement("video");
  try {
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = source.url;
    video.load();
    await waitForVideoReady(video, 1, "loadedmetadata", 8000);
    return {
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
      duration: Number.isFinite(video.duration) ? video.duration : undefined,
    };
  } catch (error) {
    console.warn("Failed to read video metadata", error);
    return {};
  } finally {
    video.removeAttribute("src");
    video.load();
    if (source.revoke) URL.revokeObjectURL(source.url);
  }
}

export async function readPublishImageMetadata(mediaFile: PublishMediaFile) {
  const source = createPublishMediaMetadataSource(mediaFile);
  if (!source.url) return {};
  const image = new Image();
  try {
    image.decoding = "async";
    image.src = source.url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image metadata is not available"));
    });
    return {
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
    };
  } catch (error) {
    console.warn("Failed to read image metadata", error);
    return {};
  } finally {
    if (source.revoke) URL.revokeObjectURL(source.url);
  }
}

export async function createVideoPosterDataUrl(sourceUrl: string) {
  const video = document.createElement("video");
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = sourceUrl;
    Object.assign(video.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(video);
    video.load();

    await waitForVideoReady(video, 1, "loadedmetadata", 5000);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const targetTime = duration > 0 ? Math.min(0.12, Math.max(0, duration / 10)) : 0;
    if (targetTime > 0) {
      const seeked = waitForVideoEvent(video, "seeked", 5000).catch(() => undefined);
      video.currentTime = targetTime;
      await seeked;
    }
    if (video.readyState < 2) await waitForVideoReady(video, 2, "loadeddata", 5000);
    await nextAnimationFrame();
    await nextAnimationFrame();
    if (!video.videoWidth || !video.videoHeight) throw new Error("Video frame is not ready");

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

export function movePublishItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

export function clearPublishMediaDragState() {
  document.querySelectorAll<HTMLElement>(".publish-media-image-card.is-dragging, .publish-media-image-card.is-drag-over")
    .forEach((element) => {
      element.classList.remove("is-dragging", "is-drag-over");
      element.style.removeProperty("--publish-drag-x");
      element.style.removeProperty("--publish-drag-y");
    });
}

export function clearPublishMediaDragOverState() {
  document.querySelectorAll<HTMLElement>(".publish-media-image-card.is-drag-over")
    .forEach((element) => element.classList.remove("is-drag-over"));
}

export function revokePublishMediaPreviewItems(items: PublishMediaPreviewItem[]) {
  const urls = new Set(items.flatMap((item) => [item.url, item.sourceUrl || ""]).filter(Boolean));
  urls.forEach((url) => {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  });
}

export function readPublishMediaIndex(value: string | undefined) {
  if (value === undefined) return null;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function isVideoMediaFile(file: PublishMediaFile) {
  return file.type.startsWith("video/") || hasPublishMediaExtension(file.name, VIDEO_MEDIA_EXTENSIONS);
}

export function isImageMediaFile(file: PublishMediaFile) {
  return file.type.startsWith("image/") || hasPublishMediaExtension(file.name, IMAGE_MEDIA_EXTENSIONS);
}

export function publishMediaFileSize(file: PublishMediaFile) {
  return file.size ?? file.file?.size;
}

export function hasPublishMediaDimensions(file: PublishMediaFile) {
  return Number.isFinite(file.width) && Number(file.width) > 0
    && Number.isFinite(file.height) && Number(file.height) > 0;
}

export function hasPublishVideoDuration(file: PublishMediaFile) {
  return Number.isFinite(file.duration) && Number(file.duration) > 0;
}

function createPublishMediaMetadataSource(mediaFile: PublishMediaFile) {
  if (mediaFile.file) return { url: URL.createObjectURL(mediaFile.file), revoke: true };
  if (mediaFile.path) return { url: convertFileSrc(mediaFile.path), revoke: false };
  return { url: "", revoke: false };
}

function waitForVideoReady(video: HTMLVideoElement, readyState: number, eventName: string, timeoutMs: number) {
  return video.readyState >= readyState
    ? Promise.resolve()
    : waitForVideoEvent(video, eventName, timeoutMs);
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Video ${eventName} failed`));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Video ${eventName} timed out`));
    }, timeoutMs);
    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function hasPublishMediaExtension(fileName: string, extensions: string[]) {
  const normalizedName = fileName.toLowerCase();
  return extensions.some((extension) => normalizedName.endsWith(extension.toLowerCase()));
}
