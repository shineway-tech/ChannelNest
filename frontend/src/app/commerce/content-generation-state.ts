import type {
  AiRequestStatus,
  ImageOptions,
  TextGenerationDraft,
} from "../../domain/types";
import { defaultImageDraft } from "../../utils/image-options";
import type { ImageReference } from "../../utils/image-task";
import type { SavedGeneratedImageFile } from "../../utils/local-resource-library";

export type AiMode = "text" | "image";

export const emptyTextDraft = (): TextGenerationDraft => ({
  taskType: "social_post",
  platform: "general",
  goal: "auto",
  audience: "",
  tone: "auto",
  structure: "auto",
  lengthMode: "auto",
  targetLength: "",
  input: "",
  keyPoints: "",
  cta: "auto",
  ctaText: "",
  forbiddenContent: "",
});

export class ContentGenerationState {
  imageOptions: ImageOptions | null = null;
  mode: AiMode = "text";
  textDraft = emptyTextDraft();
  textAdvancedOpen = false;
  textInputScrollTop = 0;
  textResult = "";
  textError = "";
  imageDraft = defaultImageDraft();
  referenceImages: ImageReference[] = [];
  imageRequest: AiRequestStatus | null = null;
  imageError = "";
  imageUrls: Record<string, string> = {};
  imageLocalFiles: Record<string, SavedGeneratedImageFile> = {};
  imageObjectUrls = new Set<string>();
  imageOutputDownloads = new Set<string>();
  imagePreviewOutputId = "";
  imageResourceTitleDialog: { outputId: string; title: string; error: string } | null = null;
  resourceSavedKeys = new Set<string>();
  imagePoll?: number;

  reset() {
    this.imageOptions = null;
    this.mode = "text";
    this.textDraft = emptyTextDraft();
    this.textAdvancedOpen = false;
    this.textInputScrollTop = 0;
    this.textResult = "";
    this.textError = "";
    this.imageDraft = defaultImageDraft();
    this.referenceImages = [];
    this.imageRequest = null;
    this.imageError = "";
    this.imageUrls = {};
    this.imageLocalFiles = {};
    this.imageObjectUrls.clear();
    this.imageOutputDownloads.clear();
    this.imagePreviewOutputId = "";
    this.imageResourceTitleDialog = null;
    this.resourceSavedKeys.clear();
  }

  resetImageOutputs() {
    this.imageRequest = null;
    this.imageError = "";
    this.imageUrls = {};
    this.imageLocalFiles = {};
    this.imageObjectUrls.clear();
    this.imageOutputDownloads.clear();
    Array.from(this.resourceSavedKeys)
      .filter((key) => key.startsWith("image:"))
      .forEach((key) => this.resourceSavedKeys.delete(key));
  }
}
