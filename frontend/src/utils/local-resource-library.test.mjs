import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCopyResourceDraftPatch,
  buildImageResourceInput,
  buildTextResourceInput,
  filterLocalResources,
  localResourcePreviewText,
  localResourceToPublishMediaFile,
} from "./local-resource-library.ts";

const resources = [
  {
    id: "old-copy",
    userId: "user-1",
    type: "copy",
    title: "旧文案",
    body: "旧正文",
    source: "ai",
    tags: ["故事"],
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
  },
  {
    id: "new-copy",
    userId: "user-1",
    type: "copy",
    title: "种草标题",
    body: "适合小红书的正文",
    source: "ai",
    tags: ["小红书"],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  },
  {
    id: "image-1",
    userId: "user-1",
    type: "image",
    title: "夏日海报",
    path: "/tmp/summer.jpg",
    mimeType: "image/jpeg",
    width: 768,
    height: 1024,
    size: 2048,
    source: "ai",
    tags: [],
    createdAt: "2026-07-16T09:00:00.000Z",
    updatedAt: "2026-07-16T09:00:00.000Z",
  },
];

test("filters local resources by tab and keyword, newest first", () => {
  const filtered = filterLocalResources(resources, "copy", "小红书");
  assert.deepEqual(filtered.map((item) => item.id), ["new-copy"]);
});

test("builds a publish draft patch from copy resource", () => {
  assert.deepEqual(buildCopyResourceDraftPatch(resources[1]), {
    title: "种草标题",
    body: "适合小红书的正文",
  });
});

test("uses copy title as publish body when older resource has no body", () => {
  assert.deepEqual(buildCopyResourceDraftPatch({
    id: "legacy-copy",
    userId: "user-1",
    type: "copy",
    title: "旧资源只有标题",
    source: "ai",
    tags: [],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  }), {
    title: "旧资源只有标题",
    body: "旧资源只有标题",
  });
});

test("trims copy resource title to the publish title limit", () => {
  const patch = buildCopyResourceDraftPatch({
    id: "long-title-copy",
    userId: "user-1",
    type: "copy",
    title: "这是一条明显超过三十个字符的发布标题，需要在填入发布页面前截断处理",
    body: "正文内容",
    source: "ai",
    tags: [],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  });

  assert.equal([...patch.title].length, 30);
  assert.equal(patch.body, "正文内容");
});

test("converts an image resource into a publish media file", () => {
  assert.deepEqual(localResourceToPublishMediaFile(resources[2]), {
    name: "夏日海报",
    type: "image/jpeg",
    size: 2048,
    width: 768,
    height: 1024,
    path: "/tmp/summer.jpg",
  });
});

test("builds an image resource input with a user title", () => {
  assert.deepEqual(buildImageResourceInput({
    userId: "user-1",
    requestId: "request-1",
    output: {
      id: "output-1",
      sequenceNo: 1,
      width: 1024,
      height: 1024,
      byteSize: "4096",
      downloadPath: "/download",
    },
    localFile: {
      path: "/tmp/output.jpg",
      fileName: "output.jpg",
      url: "asset://output.jpg",
    },
    language: "zh",
    title: "夏季新品主图",
  }).title, "夏季新品主图");
});

test("does not expose image paths in resource preview text", () => {
  assert.equal(localResourcePreviewText(resources[1]), "适合小红书的正文");
  assert.equal(localResourcePreviewText(resources[2]), "");
});

test("builds a text resource input from generated text", () => {
  assert.deepEqual(buildTextResourceInput({
    userId: "user-1",
    content: "这是第一行标题\n这是正文",
    language: "zh",
  }), {
    userId: "user-1",
    type: "copy",
    title: "这是第一行标题",
    body: "这是第一行标题\n这是正文",
    source: "ai",
    tags: ["AI文案"],
  });
});

test("builds an image resource input from saved generated image", () => {
  assert.deepEqual(buildImageResourceInput({
    userId: "user-1",
    requestId: "request-1",
    output: {
      id: "output-1",
      sequenceNo: 2,
      width: 768,
      height: 1024,
      byteSize: "2048",
      downloadPath: "/download",
    },
    localFile: {
      path: "/tmp/output.jpg",
      fileName: "2-output-1.jpg",
      url: "asset://output.jpg",
    },
    language: "zh",
  }), {
    userId: "user-1",
    type: "image",
    title: "生成图片 2",
    path: "/tmp/output.jpg",
    mimeType: "image/jpeg",
    width: 768,
    height: 1024,
    size: 2048,
    source: "ai",
    aiRequestId: "request-1",
    aiOutputId: "output-1",
    tags: ["AI图片"],
  });
});
