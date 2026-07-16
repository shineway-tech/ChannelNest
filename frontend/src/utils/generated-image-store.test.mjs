import assert from "node:assert/strict";
import test from "node:test";
import {
  blobToBase64,
  generatedImageFileName,
} from "./generated-image-store.ts";

test("builds a safe generated image file name", () => {
  assert.equal(
    generatedImageFileName({ id: "abc/../123", sequenceNo: 2 }),
    "2-abc_123.jpg",
  );
});

test("converts image blob to base64 payload", async () => {
  const blob = new Blob(["hello"]);
  assert.equal(await blobToBase64(blob), "aGVsbG8=");
});
