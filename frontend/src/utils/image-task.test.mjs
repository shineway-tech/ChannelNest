import assert from "node:assert/strict";
import test from "node:test";
import * as imageTask from "./image-task.ts";

const { imageGenerationInProgress } = imageTask;

test("treats submission and active task statuses as in progress", () => {
  assert.equal(imageGenerationInProgress(true, null), true);
  assert.equal(imageGenerationInProgress(false, "pending"), true);
  assert.equal(imageGenerationInProgress(false, "processing"), true);
});

test("treats terminal task statuses as idle", () => {
  for (const status of [undefined, "succeeded", "partial", "failed"]) {
    assert.equal(imageGenerationInProgress(false, status), false);
  }
});

test("removes one reference preview and releases only its object URL", () => {
  assert.equal(typeof imageTask.removeImageReference, "function");
  const released = [];
  const references = [
    { id: "first", name: "first.png", url: "blob:first" },
    { id: "second", name: "second.png", url: "blob:second" },
  ];

  const remaining = imageTask.removeImageReference(
    references,
    "first",
    (url) => released.push(url),
  );

  assert.deepEqual(remaining, [references[1]]);
  assert.deepEqual(released, ["blob:first"]);
});

test("releases every reference preview when image state is reset", () => {
  assert.equal(typeof imageTask.releaseImageReferences, "function");
  const released = [];
  const references = [
    { id: "first", name: "first.png", url: "blob:first" },
    { id: "second", name: "second.png", url: "blob:second" },
  ];

  imageTask.releaseImageReferences(references, (url) => released.push(url));

  assert.deepEqual(released, ["blob:first", "blob:second"]);
});

test("builds progressive image result slots before the whole task finishes", () => {
  assert.equal(typeof imageTask.imageResultSlots, "function");
  const slots = imageTask.imageResultSlots({
    requestId: "request-1",
    status: "processing",
    requestedCount: 3,
    successCount: 0,
    failedCount: 0,
    chargedMicros: "0",
    outputs: [
      {
        id: "output-1",
        sequenceNo: 1,
        width: 768,
        height: 1024,
        byteSize: "123",
        downloadPath: "/v1/ai/requests/request-1/outputs/output-1",
      },
    ],
  });

  assert.deepEqual(slots.map((slot) => slot.status), ["ready", "processing", "processing"]);
  assert.equal(slots[0].output.id, "output-1");
  assert.equal(slots[1].output, null);
});
