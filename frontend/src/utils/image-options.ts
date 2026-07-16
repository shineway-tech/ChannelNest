import type { ImageAssetTypeOption, ImageOptionItem, ImageOptions } from "../domain/types";

export function defaultImageDraft() {
  return {
    assetType: "general",
    resolution: "1k",
    aspectRatio: "3:4",
    count: 1,
    style: "auto",
    layout: "auto",
    palette: "auto",
    preset: "auto",
    referenceMode: "style",
    prompt: "",
  };
}

function findAssetType(options: ImageOptions, assetType: string): ImageAssetTypeOption | null {
  return options.assetTypes.find((item) => item.code === assetType) || null;
}

function filterByCodes<T extends ImageOptionItem>(items: T[], codes?: string[]) {
  if (!codes || !codes.length) return items;
  const allowed = new Set(codes);
  return items.filter((item) => allowed.has(item.code));
}

export function imageOptionsForAssetType(options: ImageOptions, assetType: string) {
  const asset = findAssetType(options, assetType);

  return {
    asset,
    styles: filterByCodes(options.styles, asset?.styleCodes),
    layouts: filterByCodes(options.layouts, asset?.layoutCodes),
    presets: filterByCodes(options.presets, asset?.presetCodes),
  };
}

function includesCode<T extends ImageOptionItem>(items: T[], code: unknown) {
  return items.some((item) => item.code === code);
}

export function normalizeImageDraftForAssetType<T extends Record<string, unknown>>(
  options: ImageOptions,
  draft: T,
  behavior: { resetAspectRatio?: boolean } = { resetAspectRatio: true },
) {
  const scoped = imageOptionsForAssetType(options, String(draft.assetType || ""));
  const asset = scoped.asset;

  return {
    ...draft,
    assetType: asset?.code || draft.assetType,
    aspectRatio: behavior.resetAspectRatio ? asset?.defaultAspectRatio || draft.aspectRatio : draft.aspectRatio,
    style: includesCode(scoped.styles, draft.style) ? draft.style : "auto",
    layout: includesCode(scoped.layouts, draft.layout) ? draft.layout : "auto",
    preset: includesCode(scoped.presets, draft.preset) ? draft.preset : "auto",
  };
}
