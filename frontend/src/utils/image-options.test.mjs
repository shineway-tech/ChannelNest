import assert from "node:assert/strict";
import test from "node:test";
import { defaultImageDraft, imageOptionsForAssetType, normalizeImageDraftForAssetType } from "./image-options.ts";

const options = {
  assetTypes: [
    {
      code: "xhs_card",
      name: "社交图片卡片",
      nameEn: "Social image card",
      defaultAspectRatio: "3:4",
      styleCodes: ["auto", "cute"],
      layoutCodes: ["auto", "dense"],
      presetCodes: ["auto", "knowledge-card"],
    },
    {
      code: "infographic",
      name: "信息图",
      nameEn: "Infographic",
      defaultAspectRatio: "9:16",
      styleCodes: ["auto", "craft-handmade"],
      layoutCodes: ["auto", "bento-grid", "funnel"],
      presetCodes: ["auto"],
    },
  ],
  styles: [
    { code: "auto", name: "自动", nameEn: "Auto" },
    { code: "cute", name: "可爱", nameEn: "Cute" },
    { code: "craft-handmade", name: "手作", nameEn: "Craft" },
  ],
  layouts: [
    { code: "auto", name: "自动", nameEn: "Auto" },
    { code: "dense", name: "紧凑", nameEn: "Dense" },
    { code: "bento-grid", name: "便当网格", nameEn: "Bento grid" },
    { code: "funnel", name: "漏斗", nameEn: "Funnel" },
  ],
  palettes: [],
  presets: [
    { code: "auto", name: "自动", nameEn: "Auto" },
    { code: "knowledge-card", name: "知识卡片", nameEn: "Knowledge card" },
  ],
  aspectRatios: [],
  resolutions: [],
  limits: { maxCount: 4, maxReferenceImages: 4 },
};

test("uses general image as the default asset type", () => {
  assert.equal(defaultImageDraft().assetType, "general");
});

test("filters image controls by selected asset type", () => {
  const social = imageOptionsForAssetType(options, "xhs_card");
  const infographic = imageOptionsForAssetType(options, "infographic");

  assert.deepEqual(social.styles.map((item) => item.code), ["auto", "cute"]);
  assert.deepEqual(social.layouts.map((item) => item.code), ["auto", "dense"]);
  assert.deepEqual(social.presets.map((item) => item.code), ["auto", "knowledge-card"]);
  assert.deepEqual(infographic.styles.map((item) => item.code), ["auto", "craft-handmade"]);
  assert.deepEqual(infographic.layouts.map((item) => item.code), ["auto", "bento-grid", "funnel"]);
  assert.deepEqual(infographic.presets.map((item) => item.code), ["auto"]);
});

test("normalizes stale image draft values when asset type changes", () => {
  const draft = normalizeImageDraftForAssetType(options, {
    assetType: "infographic",
    aspectRatio: "3:4",
    style: "cute",
    layout: "dense",
    preset: "knowledge-card",
  });

  assert.equal(draft.assetType, "infographic");
  assert.equal(draft.aspectRatio, "9:16");
  assert.equal(draft.style, "auto");
  assert.equal(draft.layout, "auto");
  assert.equal(draft.preset, "auto");
});
