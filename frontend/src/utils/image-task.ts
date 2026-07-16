import type { AiRequestStatus } from "../domain/types";

const activeImageStatuses = new Set(["pending", "processing"]);
const terminalImageStatuses = new Set(["succeeded", "partial", "failed"]);

type ImageOutput = AiRequestStatus["outputs"][number];

export interface ImageResultSlot {
  sequenceNo: number;
  status: "pending" | "processing" | "ready" | "failed";
  output: ImageOutput | null;
}

export interface ImageReference {
  id: string;
  name: string;
  url: string;
}

type RevokeObjectUrl = (url: string) => void;

const revokeObjectUrl: RevokeObjectUrl = (url) => URL.revokeObjectURL(url);

export function imageGenerationInProgress(submitting: boolean, status?: string | null) {
  return submitting || activeImageStatuses.has(status || "");
}

export function imageResultSlots(request?: Pick<
  AiRequestStatus,
  "status" | "requestedCount" | "outputs"
> | null): ImageResultSlot[] {
  if (!request) return [];
  const outputs = new Map(request.outputs.map((output) => [output.sequenceNo, output]));
  const count = Math.max(0, Number(request.requestedCount || request.outputs.length || 0));
  const terminal = terminalImageStatuses.has(request.status);

  return Array.from({ length: count }, (_, index) => {
    const sequenceNo = index + 1;
    const output = outputs.get(sequenceNo) || null;
    if (output) return { sequenceNo, status: "ready", output };
    if (terminal) return { sequenceNo, status: "failed", output: null };
    return { sequenceNo, status: request.status === "pending" ? "pending" : "processing", output: null };
  });
}

export function removeImageReference(
  references: ImageReference[],
  referenceId: string,
  revoke: RevokeObjectUrl = revokeObjectUrl,
) {
  const removed = references.find((reference) => reference.id === referenceId);
  if (removed) revoke(removed.url);
  return references.filter((reference) => reference.id !== referenceId);
}

export function releaseImageReferences(
  references: ImageReference[],
  revoke: RevokeObjectUrl = revokeObjectUrl,
) {
  references.forEach((reference) => revoke(reference.url));
}
