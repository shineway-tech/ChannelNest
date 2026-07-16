import type { ChannelAccount, LanguageMode } from "../domain/types";
import type { PublishDraft } from "../pages/publish";
import { invokeCommand } from "../services/tauri-commands";

export type PublishWorkMediaRequest = {
  name: string;
  path: string;
  mediaType: "video" | "image";
  coverDataUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
};

export type PublishWorkTargetRequest = {
  accountId: string;
  title: string;
  body: string;
  visibility: PublishDraft["visibility"];
  scheduleMode: PublishDraft["scheduleMode"];
  scheduledAt: string;
  media: PublishWorkMediaRequest[];
};

export type PublishWorkRequest = {
  userId: string;
  contentType: PublishDraft["contentType"];
  targets: PublishWorkTargetRequest[];
};

export type PublishWorkTargetResult = {
  accountId: string;
  platformId: string;
  status: "success" | "failed" | "unsupported";
  message: string;
  remoteId?: string | null;
};

export type PublishWorkResponse = {
  targets: PublishWorkTargetResult[];
};

export async function submitPublishTarget(
  request: PublishWorkRequest,
  target: PublishWorkTargetRequest,
  accounts: ChannelAccount[],
  language: LanguageMode,
) {
  try {
    const response = await invokeCommand<PublishWorkResponse>("publish_channel_work", {
      request: { ...request, targets: [target] },
    });
    return response.targets[0] || failedPublishResult(
      target,
      accounts,
      language === "zh" ? "平台没有返回发布结果。" : "No publish result returned.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedPublishResult(
      target,
      accounts,
      message || (language === "zh" ? "发布失败，请稍后重试。" : "Publish failed. Please try again."),
    );
  }
}

function failedPublishResult(
  target: PublishWorkTargetRequest,
  accounts: ChannelAccount[],
  message: string,
): PublishWorkTargetResult {
  const account = accounts.find((item) => item.id === target.accountId);
  return {
    accountId: target.accountId,
    platformId: account?.platformId || "",
    status: "failed",
    message,
    remoteId: null,
  };
}
