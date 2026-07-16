# Direct Image Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route image tasks directly to OpenAI-compatible image endpoints without an image-planning Responses API call.

**Architecture:** Keep prompt construction in the worker, replace SDK image calls with an ArtForgeStudio-style HTTP adapter, and preserve the existing worker settlement flow. A dedicated Undici transport supplies the image-only 14-minute timeout while text generation continues to use the OpenAI SDK.

**Tech Stack:** Node.js CommonJS, Undici fetch, OpenAI-compatible Images API, Sequelize worker, ESLint, TypeScript/Vite frontend.

## Global Constraints

- Never call `/v1/responses` as part of an image task.
- Use `/v1/images/generations` without references and `/v1/images/edits` with references.
- Send provider `size`, `quality`, and a task-item `Idempotency-Key`.
- Do not add automatic image retries.
- Do not modify relay or Nginx services.

---

### Task 1: Direct Image HTTP Adapter

**Files:**
- Modify: `backend/channel_nest_api/src/services/openai.js`
- Test temporarily: `backend/channel_nest_api/tmp-direct-image-provider.test.js`

**Interfaces:**
- Consumes: `createProviderTransport(timeoutMs)` from `src/services/provider_http.js`.
- Produces: `createImage({ prompt, providerSize, providerQuality, referencePaths, idempotencyKey })`.

- [ ] **Step 1: Write a failing local-provider test**

The test starts a local HTTP server, calls `createImage`, and asserts the path is `/v1/images/generations`, the JSON contains `size` and `quality`, and the request includes `Idempotency-Key`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tmp-direct-image-provider.test.js`

Expected: FAIL because the current SDK image call does not forward the task-item idempotency key through the new direct-adapter interface.

- [ ] **Step 3: Implement direct provider requests**

Use the configured base URL and API key with the dedicated Undici transport. JSON-encode generation requests, multipart-encode edit requests, parse `data[0].b64_json`, preserve usage accounting, and translate provider HTTP errors into the existing error fields.

- [ ] **Step 4: Run the local-provider test**

Run: `node --test tmp-direct-image-provider.test.js`

Expected: PASS with one request to `/v1/images/generations`.

### Task 2: Remove Image Planning

**Files:**
- Modify: `backend/channel_nest_api/src/workers/ai_image_worker.js`
- Modify: `backend/channel_nest_api/src/services/image_prompt_builder.js`
- Modify: `backend/channel_nest_api/src/services/openai.js`
- Modify: `backend/channel_nest_api/config/index.js`
- Modify: `backend/channel_nest_api/config/config.example.json`

**Interfaces:**
- Consumes: local `buildImagePrompt(input)`.
- Produces: one direct image-provider call per requested image.

- [ ] **Step 1: Add a failing source-level regression assertion**

Assert that `ai_image_worker.js` contains neither `createPlan` nor `/v1/responses`.

- [ ] **Step 2: Remove planner execution and configuration**

Delete the plan schema, validation, Responses API provider call, planner service method, and unused planner configuration. Build each prompt from the user's selected options and sequence number.

- [ ] **Step 3: Pass the idempotency key**

Pass `${request.id}-${sequenceNo}` from the worker to `createImage`.

- [ ] **Step 4: Run the regression test**

Run: `node --test tmp-direct-image-provider.test.js`

Expected: PASS with no image-task Responses API reference.

### Task 3: Verification And Restart

**Files:**
- Delete: `backend/channel_nest_api/tmp-direct-image-provider.test.js`

**Interfaces:**
- Consumes: completed direct image adapter and worker flow.
- Produces: a running local desktop client using the new image path.

- [ ] **Step 1: Run backend lint**

Run: `npm run lint` in `backend/channel_nest_api`.

Expected: exit code 0.

- [ ] **Step 2: Run frontend build**

Run: `npm run build` in `frontend`.

Expected: TypeScript and Vite build exit code 0.

- [ ] **Step 3: Check the diff**

Run: `git diff --check`.

Expected: exit code 0.

- [ ] **Step 4: Restart the desktop client**

Stop the current `tauri:dev` session and run `npm run tauri:dev` from the repository root. Confirm Vite listens on `127.0.0.1:1420` and the local API listens on `127.0.0.1:3100`.
