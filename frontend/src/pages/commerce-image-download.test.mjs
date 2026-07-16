import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const commercePage = readFileSync(join(__dirname, "commerce.ts"), "utf8");

test("generated image save uses a desktop command button instead of a navigation link", () => {
  assert.match(commercePage, /data-ai-download-image/);
  assert.doesNotMatch(commercePage, /<a class="ghost-btn"[^`]+download=/);
});
