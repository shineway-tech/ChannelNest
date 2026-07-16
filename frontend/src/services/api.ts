import type { ApiResponse } from "../domain/types";

export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: Record<string, unknown> | FormData;
  skipAuth?: boolean;
  token?: string;
  onUnauthorized?: () => void;
}

export type ApiRequest = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

export interface ApiStreamRequestOptions extends ApiRequestOptions {
  onDelta: (content: string) => void | Promise<void>;
}

export type ApiStreamRequest = <T>(path: string, options: ApiStreamRequestOptions) => Promise<T>;

type ApiStreamEvent<T> =
  | { type: "delta"; content: string }
  | { type: "done"; data: T }
  | { type: "error"; code: number; message: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requestApi<T>(
  baseUrl: string,
  path: string,
  {
    method = "GET",
    body,
    skipAuth = false,
    token = "",
    onUnauthorized,
  }: ApiRequestOptions = {},
) {
  const headers: Record<string, string> = {};

  if (token && !skipAuth) {
    headers["X-Token"] = token;
  }

  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null) as ApiResponse<T> | null;

  if (!response.ok || !payload || payload.err_code !== 0) {
    if (response.status === 401) {
      onUnauthorized?.();
    }
    throw new ApiError(payload?.err_msg || `HTTP ${response.status}`, response.status, payload?.err_code || 0);
  }

  return payload.data;
}

export async function requestApiBlob(
  baseUrl: string,
  path: string,
  token: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { "X-Token": token } : {},
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiResponse<unknown> | null;
    throw new ApiError(payload?.err_msg || `HTTP ${response.status}`, response.status, payload?.err_code || 0);
  }

  return response.blob();
}

export async function requestApiStream<T>(
  baseUrl: string,
  path: string,
  {
    method = "POST",
    body,
    skipAuth = false,
    token = "",
    onUnauthorized,
    onDelta,
  }: ApiStreamRequestOptions,
) {
  const english = !(body instanceof FormData) && body?.language === "en";
  const messages = english ? {
    unavailable: "The content generation connection is unavailable. Please try again.",
    invalid: "The content generation service returned invalid data. Please try again.",
    failed: "Content generation failed. Please try again.",
    interrupted: "The content generation connection was interrupted. No points were charged.",
  } : {
    unavailable: "内容生成连接不可用，请稍后重试",
    invalid: "内容生成连接返回了无效数据，请稍后重试",
    failed: "内容生成失败，请稍后重试",
    interrupted: "内容生成连接意外中断，积分未扣除",
  };
  const headers: Record<string, string> = {};
  if (token && !skipAuth) headers["X-Token"] = token;
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiResponse<unknown> | null;
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(payload?.err_msg || `HTTP ${response.status}`, response.status, payload?.err_code || 0);
  }
  if (!response.body) throw new ApiError(messages.unavailable, 502, 0);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let result: T | undefined;

  const consume = async (line: string) => {
    if (!line.trim()) return;
    let event: ApiStreamEvent<T>;
    try {
      event = JSON.parse(line) as ApiStreamEvent<T>;
    } catch {
      throw new ApiError(messages.invalid, 502, 0);
    }
    if (event.type === "delta") {
      await onDelta(event.content);
    } else if (event.type === "done") {
      result = event.data;
      completed = true;
    } else if (event.type === "error") {
      throw new ApiError(english ? messages.failed : event.message || messages.failed, 503, event.code || 0);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd >= 0) {
        await consume(buffer.slice(0, lineEnd));
        buffer = buffer.slice(lineEnd + 1);
        lineEnd = buffer.indexOf("\n");
      }
      if (done) break;
    }
    await consume(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!completed) throw new ApiError(messages.interrupted, 502, 0);
  return result as T;
}
