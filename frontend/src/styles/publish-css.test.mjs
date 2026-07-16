import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, "publish.css"), "utf8");
const lightCss = readFileSync(join(__dirname, "theme-light.css"), "utf8");

test("publish textarea highlight layer is rendered above transparent textarea text", () => {
  const highlightRule = css.match(/\.publish-textarea-highlight\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(highlightRule, /z-index:\s*2\s*;/);
});

test("publish media upload row has spacing below the body editor", () => {
  const mediaRowRule = css.match(/\.publish-compose-media-row\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(mediaRowRule, /padding:\s*64px\s+16px\s+16px\s*;/);
});

test("publish account media row has spacing below account copy", () => {
  const accountMediaRowRule = Array.from(css.matchAll(/\.publish-account-media-row\s*\{(?<body>[^}]+)\}/g))
    .map((match) => match.groups?.body || "")
    .find((rule) => rule.includes("padding")) || "";
  assert.match(accountMediaRowRule, /padding:\s*32px\s+14px\s+14px\s*;/);
});

test("publish media gallery keeps a stable horizontal list", () => {
  const mediaGalleryRule = css.match(/\.publish-media-gallery\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(mediaGalleryRule, /min-height:\s*158px\s*;/);
  assert.match(mediaGalleryRule, /overflow-x:\s*auto\s*;/);
  assert.match(mediaGalleryRule, /overflow-y:\s*hidden\s*;/);
  assert.match(mediaGalleryRule, /scrollbar-gutter:\s*stable\s*;/);
});

test("publish resource cards reserve thumbnail layout", () => {
  const resourceCardRule = css.match(/\.publish-resource-card\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
  const resourceThumbRule = css.match(/\.publish-resource-thumb\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(resourceCardRule, /min-height:\s*66px\s*;/);
  assert.match(resourceCardRule, /contain:\s*layout paint\s*;/);
  assert.match(resourceThumbRule, /flex:\s*0 0 48px\s*;/);
});

test("publish account select disables native webkit styling", () => {
  const selectRules = Array.from(css.matchAll(/\.publish-account-field-grid select\s*\{(?<body>[^}]+)\}/g))
    .map((match) => match.groups?.body || "");
  const selectRule = selectRules.find((rule) => rule.includes("-webkit-appearance")) || "";
  assert.match(selectRule, /appearance:\s*none\s*;/);
  assert.match(selectRule, /-webkit-appearance:\s*none\s*;/);
  assert.match(selectRule, /background-image:/);
});

test("light theme keeps publish account selects on a light surface", () => {
  const lightSelectRule = lightCss.match(/\.theme-light \.publish-account-field-grid select\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(lightSelectRule, /background-color:\s*#ffffff\s*;/);
  assert.match(lightSelectRule, /color:\s*#1b3339\s*;/);
});

test("light theme makes rail version readable", () => {
  const lightRailVersionRule = lightCss.match(/\.theme-light \.rail-version\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(lightRailVersionRule, /color:\s*#496168\s*;/);
  assert.match(lightRailVersionRule, /background:\s*rgba\(255,\s*255,\s*255,\s*0\.58\)\s*;/);
});
