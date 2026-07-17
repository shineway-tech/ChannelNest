import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { AiRequestStatus } from "../domain/types";

type ImageOutput = AiRequestStatus["outputs"][number];

interface SaveGeneratedImageResponse {
  path: string;
}

interface SaveGeneratedImageToDownloadsResponse {
  path: string;
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function safeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

export function generatedImageFileName(output: Pick<ImageOutput, "id" | "sequenceNo">) {
  return `${output.sequenceNo}-${safeFileSegment(output.id)}.jpg`;
}

export async function saveGeneratedImageOutputFromUrl(
  requestId: string,
  output: ImageOutput,
  downloadUrl: string,
  invokeFn: InvokeFn = invoke,
) {
  const result = await invokeFn<SaveGeneratedImageResponse>("save_generated_image_output_from_url", {
    request: {
      requestId,
      outputId: output.id,
      sequenceNo: output.sequenceNo,
      downloadUrl,
    },
  });

  return {
    path: result.path,
    url: convertFileSrc(result.path),
    fileName: generatedImageFileName(output),
  };
}

export async function saveGeneratedImageToDownloads(
  localFile: { path: string; fileName: string },
  invokeFn: InvokeFn = invoke,
) {
  return invokeFn<SaveGeneratedImageToDownloadsResponse>("save_generated_image_to_downloads", {
    request: {
      sourcePath: localFile.path,
      fileName: localFile.fileName,
    },
  });
}
