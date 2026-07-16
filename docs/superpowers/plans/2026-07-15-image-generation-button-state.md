# 图片生成按钮任务状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 图片任务提交、排队和生成期间持续显示禁用的“生成中”按钮，并阻止重复提交。

**Architecture:** 新增一个纯函数统一判断提交状态和服务端任务状态。控制器使用它保护提交入口，页面渲染使用它决定按钮图标、文案和禁用状态。

**Tech Stack:** TypeScript、原生 DOM、Node.js test runner、Vite。

## Global Constraints

- `busy`、`pending`、`processing` 均视为生成中。
- `succeeded`、`partial`、`failed` 以及无任务状态均不视为生成中。
- 复用现有 `refresh` 旋转图标和 `generating` 中英文文案。
- 不修改图片任务接口和服务端状态机。

---

### Task 1: 统一图片任务进行中状态

**Files:**
- Create: `frontend/src/utils/image-task.ts`
- Create: `frontend/src/utils/image-task.test.mjs`
- Modify: `frontend/src/app/commerce-controller.ts`
- Modify: `frontend/src/pages/commerce.ts`

**Interfaces:**
- Produces: `imageGenerationInProgress(submitting: boolean, status?: string | null): boolean`
- Consumes: `CommerceController.busy`、`AiRequestStatus.status`、`CommercePageState.imageRequest`

- [ ] **Step 1: 写失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { imageGenerationInProgress } from "./image-task.ts";

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
```

- [ ] **Step 2: 确认测试因缺少实现而失败**

Run: `node --experimental-strip-types --test frontend/src/utils/image-task.test.mjs`

Expected: FAIL，提示无法找到 `image-task.ts`。

- [ ] **Step 3: 添加最小状态判断实现**

```ts
const activeImageStatuses = new Set(["pending", "processing"]);

export function imageGenerationInProgress(submitting: boolean, status?: string | null) {
  return submitting || activeImageStatuses.has(status || "");
}
```

- [ ] **Step 4: 接入控制器和按钮渲染**

控制器在 `generateImages()` 开头调用共享函数，进行中直接返回。页面计算 `imageGenerating`，为按钮设置 `disabled`，使用 `icon("refresh")` 和 `text.generating`；空闲时继续使用 `icon("spark")` 和 `text.generateImages`。

- [ ] **Step 5: 运行回归测试和完整前端构建**

Run: `node --experimental-strip-types --test frontend/src/utils/image-task.test.mjs`

Expected: 2 tests passed, 0 failed。

Run: `npm --prefix frontend run build`

Expected: TypeScript 检查和 Vite 构建均以退出码 0 完成。
