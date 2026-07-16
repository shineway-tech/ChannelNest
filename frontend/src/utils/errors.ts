export function normalizeError(error: unknown, fallback = "操作失败，请稍后重试。") {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const networkFailure = /load failed|failed to fetch|networkerror|network request failed/i.test(message);
  const exposesTechnicalDetails = /^Error:/i.test(message)
    || /\n\s*at\s+/i.test(message)
    || /(?:\/Users\/|\/home\/|[A-Z]:\\)/i.test(message);

  if (networkFailure) {
    return /[\u4e00-\u9fff]/.test(fallback)
      ? "无法连接到服务，请检查网络后重试。"
      : "Unable to connect to the service. Check your connection and try again.";
  }
  if (exposesTechnicalDetails) return fallback;
  return message || fallback;
}

export function normalizeUpdateError(error: unknown, fallback: string, unavailableText: string) {
  const message = normalizeError(error, fallback);
  return !message || /not implemented|not available|permission|plugin/i.test(message)
    ? unavailableText
    : message;
}
