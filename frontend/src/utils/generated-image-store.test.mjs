import assert from "node:assert/strict";
import test from "node:test";
import {
  generatedImageFileName,
  saveGeneratedImageOutputFromUrl,
} from "./generated-image-store.ts";

test("builds a safe generated image file name", () => {
  assert.equal(
    generatedImageFileName({ id: "abc/../123", sequenceNo: 2 }),
    "2-abc_123.jpg",
  );
});

test("saves generated image output from a provider URL", async () => {
  globalThis.window = {
    __TAURI_INTERNALS__: {
      convertFileSrc: (path, protocol) => `${protocol}://${path}`,
    },
  };
  let call;
  const saved = await saveGeneratedImageOutputFromUrl(
    "request-1",
    { id: "output-1", sequenceNo: 3 },
    "https://example.com/image.jpg",
    async (command, args) => {
      call = { command, args };
      return { path: "/tmp/generated.jpg" };
    },
  );

  assert.equal(call.command, "save_generated_image_output_from_url");
  assert.deepEqual(call.args.request, {
    requestId: "request-1",
    outputId: "output-1",
    sequenceNo: 3,
    downloadUrl: "https://example.com/image.jpg",
  });
  assert.equal(saved.path, "/tmp/generated.jpg");
  assert.equal(saved.url, "asset:///tmp/generated.jpg");
  delete globalThis.window;
});
