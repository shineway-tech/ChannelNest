import { open as openDialog } from "@tauri-apps/plugin-dialog";
import flatpickr from "flatpickr";
import { Mandarin } from "flatpickr/dist/l10n/zh";
import type { ChannelAccount, LanguageMode, LocalResource, PlatformInfo } from "../domain/types";
import type { CopyText } from "../i18n/copy";
import {
  normalizePublishPlatformId,
  publishCapabilityForPlatform,
  publishCapabilitySupportsSchedule,
  publishVisibilityOptions,
  supportsPublishContentType,
  supportsPublishSchedule,
} from "../domain/publish-capabilities";
import {
  IMAGE_MEDIA_EXTENSIONS,
  type PublishAccountContentDraft,
  type PublishContentType,
  type PublishDraft,
  type PublishMediaPreviewItem,
  type PublishProgressState,
  type PublishResourceTab,
  type PublishStep,
  type PublishTargetAvailability,
  VIDEO_MEDIA_EXTENSIONS,
  renderPublishPage,
} from "../pages/publish";
import { invokeCommand } from "../services/tauri-commands";
import { formValue } from "../utils/forms";
import { escapeHtml } from "../utils/html";
import {
  buildCopyResourceDraftPatch,
  filterLocalResources,
  localResourceToPublishMediaFile,
} from "../utils/local-resource-library";
import {
  applyPublishAccountField,
  createEmptyPublishDraft,
  isPublishAccountField,
  normalizePublishVisibility,
  normalizePublishVisibilityForPlatform,
  publishCaptionLength,
  selectedPublishScheduledAt,
} from "./publish-draft";
import {
  clearPublishMediaDragOverState,
  clearPublishMediaDragState,
  createPublishMediaFields,
  createVideoPosterDataUrl,
  fileNameFromPath,
  inferPublishMediaType,
  isImageMediaFile,
  isVideoMediaFile,
  movePublishItem,
  pickPublishMediaFilesWithInput,
  publishMediaSourceUrl,
  readPublishImageMetadata,
  readPublishMediaAccount,
  readPublishMediaIndex,
  readPublishVideoMetadata,
  revokePublishMediaPreviewItems,
  type PublishMediaFile,
} from "./publish-media";
import {
  publishCaptionLimit,
  requiresPublishVideoCover,
  validatePublishMediaFiles,
} from "./publish-rules";
import {
  appendSchedulePickerConfirmAction,
  clampPublishScheduleDate,
  defaultPublishScheduledAt,
  formatLocalDateTimeDisplay,
  formatLocalDateTimeWithOffset,
  parsePublishScheduledAt,
  PUBLISH_SCHEDULE_MINUTE_STEP,
  publishScheduleLeadText,
  publishScheduleRange,
  publishScheduledAtWithDefault,
  syncSchedulePickerValue,
  updateSchedulePickerRange,
  type PublishScheduleInput,
} from "./publish-schedule";
import {
  submitPublishTarget,
  type PublishWorkRequest,
  type PublishWorkResponse,
  type PublishWorkTargetRequest,
  type PublishWorkTargetResult,
} from "./publish-submit";

interface PublishControllerDeps {
  getAccounts: () => ChannelAccount[];
  getPlatforms: () => PlatformInfo[];
  getLanguage: () => LanguageMode;
  getText: () => CopyText;
  getCurrentUserId: () => string;
  getSelectedAccountId: () => string | null;
  render: () => void;
  renderPreservingPublishScroll: () => void;
  showToast: (message: string) => void;
}

type LocalMediaMetadataResponse = {
  size: number;
};

type PublishMediaPointerDrag = {
  fromIndex: number;
  accountId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

const MEDIA_DRAG_START_DISTANCE = 12;
const MEDIA_DRAG_HORIZONTAL_RATIO = 1.25;

export class PublishController {
  private draft: PublishDraft = createEmptyPublishDraft();
  private mediaFiles: PublishMediaFile[] = [];
  private accountMediaFiles = new Map<string, PublishMediaFile[]>();
  private validationErrors: string[] = [];
  private attempted = false;
  private resources: LocalResource[] = [];
  private resourcesLoaded = false;
  private resourcesLoading = false;
  private searchQuery = "";
  private searchComposing = false;
  private resourceTab: PublishResourceTab = "copy";
  private activeStep: PublishStep = "content";
  private targetsTouched = false;
  private collapsedAccountIds = new Set<string>();
  private mediaPointerDrag: PublishMediaPointerDrag | null = null;
  private publishing = false;
  private publishProgress: PublishProgressState | null = null;
  private publishProgressClearTimer: number | null = null;

  constructor(private readonly deps: PublishControllerDeps) {}

  renderPage() {
    this.ensureTargets();
    return renderPublishPage({
      text: this.deps.getText(),
      language: this.language,
      draft: this.draft,
      activeStep: this.activeStep,
      activeResourceTab: this.resourceTab,
      collapsedAccountIds: Array.from(this.collapsedAccountIds),
      searchQuery: this.searchQuery,
      resources: filterLocalResources(this.resources, this.resourceTab, this.searchQuery),
      accounts: this.accounts,
      platforms: this.platforms,
      targetAvailability: this.targetAvailability(),
      validationErrors: this.validationErrors,
      attemptedSubmit: this.attempted,
      publishProgress: this.publishProgress,
    });
  }

  bindEvents() {
    this.ensureLocalResourcesLoaded();
    this.bindActions();
    this.bindResourceTabs();
    this.bindResourceActions();
    this.bindAccountToggles();
    this.bindSearch();
    this.bindContentTypeSwitch();
    this.bindMediaPickers();
    this.bindMediaRemoval();
    this.bindMediaDrag();
    this.bindVideoOverlay();
    this.bindTargets();
    this.bindTargetWheel();
    this.bindSchedulePickers();
    this.bindTagHighlight();
    this.bindForm();
  }

  activate() {
    this.resourcesLoaded = false;
    void this.loadLocalResources(true);
  }

  captureDraftFromForm(changedField?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    const form = document.querySelector<HTMLFormElement>("[data-publish-form]");
    if (!form) return;
    const titleField = form.elements.namedItem("title");
    const bodyField = form.elements.namedItem("body");
    const visibilityField = form.elements.namedItem("visibility");
    const visibility = visibilityField ? formValue(form, "visibility") : this.draft.visibility;
    const accountContents = { ...this.draft.accountContents };

    const accountFields = changedField?.matches("[data-publish-account-content][data-publish-account-field]")
      ? [changedField]
      : Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "[data-publish-account-content][data-publish-account-field]",
      ));
    accountFields.forEach((field) => {
      const accountId = field.dataset.publishAccountContent;
      const accountField = field.dataset.publishAccountField;
      if (!accountId || !accountField || !isPublishAccountField(accountField)) return;
      accountContents[accountId] = applyPublishAccountField(
        accountContents[accountId] || this.accountContentWithDefaults(accountId),
        accountField,
        field.value,
        this.platformIdForAccountId(accountId),
        this.draft.contentType,
      );
    });
    Object.entries(accountContents).forEach(([accountId, accountDraft]) => {
      if (accountDraft.scheduleMode !== "scheduled") {
        accountContents[accountId] = { ...accountDraft, scheduledAt: "" };
      }
    });

    this.draft = {
      ...this.draft,
      title: !changedField || changedField === titleField ? formValue(form, "title") : this.draft.title,
      body: !changedField || changedField === bodyField ? formValue(form, "body") : this.draft.body,
      visibility: !changedField || changedField === visibilityField
        ? normalizePublishVisibility(visibility)
        : this.draft.visibility,
      accountContents,
    };
  }

  private get accounts() {
    return this.deps.getAccounts();
  }

  private get platforms() {
    return this.deps.getPlatforms();
  }

  private get language() {
    return this.deps.getLanguage();
  }

  private bindActions() {
    document.querySelectorAll<HTMLElement>("[data-publish-action]").forEach((element) => {
      element.addEventListener("click", () => {
        this.handleAction(element.dataset.publishAction);
      });
    });
  }

  private bindResourceTabs() {
    document.querySelectorAll<HTMLElement>("[data-publish-resource-tab]").forEach((element) => {
      element.addEventListener("click", () => {
        const resourceTab = element.dataset.publishResourceTab;
        if (resourceTab !== "copy" && resourceTab !== "image" && resourceTab !== "video") return;
        this.resourceTab = resourceTab;
        this.deps.render();
      });
    });
  }

  private bindResourceActions() {
    document.querySelectorAll<HTMLElement>("[data-publish-resource-use]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        element.blur();
        const resourceId = element.dataset.publishResourceUse;
        if (resourceId) void this.applyResource(resourceId);
      });
    });
    document.querySelectorAll<HTMLElement>("[data-publish-resource-delete]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const resourceId = element.dataset.publishResourceDelete;
        if (resourceId) void this.deleteResource(resourceId);
      });
    });
  }

  private bindAccountToggles() {
    document.querySelectorAll<HTMLElement>("[data-publish-account-toggle]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const accountId = element.dataset.publishAccountToggle;
        if (!accountId) return;
        this.captureDraftFromForm();
        if (this.collapsedAccountIds.has(accountId)) {
          this.collapsedAccountIds.delete(accountId);
        } else {
          this.collapsedAccountIds.add(accountId);
        }
        this.deps.renderPreservingPublishScroll();
      });
    });
  }

  private bindSearch() {
    const publishSearch = document.querySelector<HTMLInputElement>("[data-publish-search]");
    publishSearch?.addEventListener("compositionstart", () => {
      this.searchComposing = true;
    });
    publishSearch?.addEventListener("compositionend", (event) => {
      if (!(event.currentTarget instanceof HTMLInputElement)) return;
      this.searchComposing = false;
      this.updateSearch(event.currentTarget.value);
    });
    publishSearch?.addEventListener("input", (event) => {
      if (!(event.currentTarget instanceof HTMLInputElement) || this.searchComposing) return;
      this.updateSearch(event.currentTarget.value);
    });
  }

  private bindContentTypeSwitch() {
    document.querySelectorAll<HTMLElement>("[data-publish-type]").forEach((element) => {
      element.addEventListener("click", () => {
        const contentType = element.dataset.publishType === "article" ? "article" : "video";
        this.captureDraftFromForm();
        this.draft.contentType = contentType;
        this.resetValidation();
        const mediaError = this.validateSharedMediaFiles(this.mediaFiles, contentType);
        const accountMediaError = this.clearInvalidAccountMediaOverrides(contentType);
        if (mediaError) {
          this.clearMediaFiles();
        }
        if (mediaError || accountMediaError) this.deps.showToast(mediaError || accountMediaError);
        this.deps.render();
      });
    });
  }

  private bindMediaPickers() {
    document.querySelectorAll<HTMLElement>("[data-publish-media-picker]").forEach((element) => {
      element.addEventListener("click", async () => {
        this.captureDraftFromForm();
        const accountId = readPublishMediaAccount(element);
        const files = await this.pickMediaFiles(element);
        if (!files.length) return;
        const currentFiles = this.getMediaFiles(accountId);
        const nextFiles = element.dataset.publishMediaMode === "append" ? [...currentFiles, ...files] : files;
        const mediaError = accountId
          ? this.validateMediaFiles(nextFiles, this.draft.contentType, this.platformIdForAccountId(accountId))
          : this.validateSharedMediaFiles(nextFiles, this.draft.contentType);
        if (mediaError) {
          this.resetValidation();
          this.deps.showToast(mediaError);
          this.deps.renderPreservingPublishScroll();
          return;
        }

        await this.setMediaFilesForScope(accountId, nextFiles);
        this.resetValidation();
        this.deps.renderPreservingPublishScroll();
      });
    });
  }

  private bindMediaRemoval() {
    document.querySelectorAll<HTMLElement>("[data-publish-media-clear]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.captureDraftFromForm();
        this.clearMediaFilesForScope(readPublishMediaAccount(element));
        this.resetValidation();
        this.deps.renderPreservingPublishScroll();
      });
    });

    document.querySelectorAll<HTMLElement>("[data-publish-media-remove-index]").forEach((element) => {
      element.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = readPublishMediaIndex(element.dataset.publishMediaRemoveIndex);
        if (index === null) return;
        this.captureDraftFromForm();
        const accountId = readPublishMediaAccount(element);
        const nextFiles = this.getMediaFiles(accountId).filter((_, fileIndex) => fileIndex !== index);
        if (nextFiles.length) {
          await this.setMediaFilesForScope(accountId, nextFiles);
        } else {
          this.clearMediaFilesForScope(accountId);
        }
        this.resetValidation();
        this.deps.renderPreservingPublishScroll();
      });
    });
  }

  private bindMediaDrag() {
    document.querySelectorAll<HTMLElement>("[data-publish-media-drag-index]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("button,input,label")) return;
        event.preventDefault();
        const fromIndex = readPublishMediaIndex(element.dataset.publishMediaDragIndex);
        if (fromIndex === null) return;
        this.mediaPointerDrag = {
          fromIndex,
          accountId: readPublishMediaAccount(element),
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dragging: false,
        };
        element.setPointerCapture(event.pointerId);
      });

      element.addEventListener("pointermove", (event) => {
        if (!this.mediaPointerDrag || this.mediaPointerDrag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - this.mediaPointerDrag.startX;
        const deltaY = event.clientY - this.mediaPointerDrag.startY;
        const horizontalDistance = Math.abs(deltaX);
        const verticalDistance = Math.abs(deltaY);
        if (!this.mediaPointerDrag.dragging) {
          if (
            horizontalDistance < MEDIA_DRAG_START_DISTANCE
            || horizontalDistance < verticalDistance * MEDIA_DRAG_HORIZONTAL_RATIO
          ) {
            return;
          }
        }
        event.preventDefault();
        this.mediaPointerDrag.dragging = true;
        element.classList.add("is-dragging");
        element.style.setProperty("--publish-drag-x", `${deltaX}px`);
        element.style.setProperty("--publish-drag-y", `${deltaY}px`);
        clearPublishMediaDragOverState();
        const target = this.findDropTarget(event.clientX, event.clientY, this.mediaPointerDrag.accountId);
        target?.classList.add("is-drag-over");
      });

      element.addEventListener("pointerup", (event) => {
        if (!this.mediaPointerDrag || this.mediaPointerDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const dragState = this.mediaPointerDrag;
        this.mediaPointerDrag = null;
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
        const target = this.findDropTarget(event.clientX, event.clientY, dragState.accountId);
        const toIndex = readPublishMediaIndex(target?.dataset.publishMediaDragIndex);
        clearPublishMediaDragState();
        if (!dragState.dragging || toIndex === null || dragState.fromIndex === toIndex) return;
        if (this.isOutwardEdgeDrag(dragState.accountId, dragState.fromIndex, event.clientX, dragState.startX)) return;
        this.captureDraftFromForm();
        this.reorderMediaFiles(dragState.accountId, dragState.fromIndex, toIndex);
        this.resetValidation();
        this.deps.renderPreservingPublishScroll();
      });

      element.addEventListener("pointercancel", () => {
        this.mediaPointerDrag = null;
        clearPublishMediaDragState();
      });
    });
  }

  private bindVideoOverlay() {
    document.querySelectorAll<HTMLButtonElement>("[data-publish-video-open]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openVideoOverlay(readPublishMediaAccount(button));
      });
    });
  }

  private bindTargets() {
    document.querySelectorAll<HTMLInputElement>("[data-publish-target]").forEach((element) => {
      element.addEventListener("change", (event) => {
        event.stopPropagation();
        const accountId = element.dataset.publishTarget;
        if (!accountId) return;
        const account = this.accounts.find((item) => item.id === accountId);
        if (!account || !this.isAccountSelectable(account)) return;
        this.captureDraftFromForm();
        if (element.checked) {
          this.draft.selectedAccountIds = Array.from(new Set([...this.draft.selectedAccountIds, accountId]));
        } else {
          this.draft.selectedAccountIds = this.draft.selectedAccountIds.filter((id) => id !== accountId);
        }
        this.targetsTouched = true;
        this.resetValidation();
        this.deps.render();
      });
    });
  }

  private bindTargetWheel() {
    document.querySelectorAll<HTMLElement>("[data-publish-target-strip]").forEach((element) => {
      element.addEventListener("wheel", (event) => {
        if (element.scrollWidth <= element.clientWidth) return;
        if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        event.preventDefault();
        element.scrollLeft += event.deltaY;
      }, { passive: false });
    });
  }

  private bindSchedulePickers() {
    document.querySelectorAll<PublishScheduleInput>("[data-publish-schedule-picker]").forEach((input) => {
      const accountId = input.dataset.publishAccountContent || "";
      const platformId = this.platformIdForAccountId(accountId);
      const scheduleRange = publishScheduleRange(platformId);
      const currentDate = clampPublishScheduleDate(
        parsePublishScheduledAt(input.value) || parsePublishScheduledAt(defaultPublishScheduledAt(platformId)) || scheduleRange.min,
        scheduleRange,
      );
      input.value = formatLocalDateTimeDisplay(currentDate);
      flatpickr(input, {
        allowInput: true,
        clickOpens: true,
        closeOnSelect: false,
        defaultDate: currentDate,
        disableMobile: true,
        enableTime: true,
        minuteIncrement: PUBLISH_SCHEDULE_MINUTE_STEP,
        minDate: scheduleRange.min,
        maxDate: scheduleRange.max,
        time_24hr: true,
        dateFormat: "Y-m-d H:i",
        locale: this.language === "zh" ? Mandarin : undefined,
        onReady: (_selectedDates, _dateStr, instance) => {
          instance.calendarContainer.classList.add("publish-schedule-calendar");
          appendSchedulePickerConfirmAction(instance, this.language);
        },
        onOpen: (_selectedDates, _dateStr, instance) => {
          updateSchedulePickerRange(input, instance, platformId);
        },
        onChange: (selectedDates, dateStr, instance) => {
          const nextDate = syncSchedulePickerValue(
            input,
            selectedDates[0] || parsePublishScheduledAt(dateStr),
            instance,
            platformId,
            false,
          );
          if (accountId) this.setAccountScheduledAt(accountId, nextDate);
        },
        onClose: () => {
          const nextDate = syncSchedulePickerValue(input, parsePublishScheduledAt(input.value), input._flatpickr, platformId);
          if (accountId) this.setAccountScheduledAt(accountId, nextDate);
          this.captureDraftFromForm();
          this.resetValidation();
        },
      });
      input.addEventListener("blur", () => {
        const nextDate = syncSchedulePickerValue(input, parsePublishScheduledAt(input.value), input._flatpickr, platformId);
        if (accountId) this.setAccountScheduledAt(accountId, nextDate);
        this.captureDraftFromForm();
        this.resetValidation();
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-publish-schedule-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = button.parentElement?.querySelector<PublishScheduleInput>("[data-publish-schedule-picker]");
        input?._flatpickr?.open();
      });
    });

    document.querySelectorAll<HTMLElement>(".publish-account-schedule-control").forEach((control) => {
      control.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-publish-schedule-open]")) return;
        const input = control.querySelector<PublishScheduleInput>("[data-publish-schedule-picker]");
        input?._flatpickr?.open();
      });
    });
  }

  private bindTagHighlight() {
    document.querySelectorAll<HTMLTextAreaElement>("[data-publish-highlight-input]").forEach((textarea) => {
      const sync = () => syncPublishHighlight(textarea);
      textarea.addEventListener("input", sync);
      textarea.addEventListener("scroll", sync);
      sync();
    });
  }

  private bindForm() {
    const form = document.querySelector<HTMLFormElement>("[data-publish-form]");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.captureDraftFromForm();
    });
    form.addEventListener("keydown", (event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.name !== "title") return;
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.captureDraftFromForm(event.target);
      form.querySelector<HTMLTextAreaElement>('textarea[name="body"]')?.focus();
    });
    const capture = (event: Event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
      if (field instanceof HTMLInputElement && field.type === "file") return;
      this.captureDraftFromForm(field);
      this.resetValidation();
      if (event.type === "change" && field.dataset.publishAccountField === "scheduleMode") {
        this.deps.renderPreservingPublishScroll();
      }
    };
    form.addEventListener("input", capture);
    form.addEventListener("change", capture);
  }

  private handleAction(action: string | undefined) {
    switch (action) {
      case "publish":
        void this.submitDraft();
        return;
      case "publish-next":
        this.captureDraftFromForm();
        this.attempted = true;
        this.validationErrors = this.validateContentStep();
        if (this.validationErrors.length) {
          this.deps.showToast(this.validationErrors[0]);
          this.deps.render();
          return;
        }
        this.activeStep = "accounts";
        this.resetValidation();
        this.deps.render();
        return;
      case "publish-prev":
        this.captureDraftFromForm();
        this.activeStep = "content";
        this.deps.render();
        return;
      case "new-resource":
        this.deps.showToast(this.language === "zh" ? "可以在内容生成页将生成结果加入资源库。" : "Add generated results to the library from Content Generation.");
        return;
      default:
        return;
    }
  }

  private ensureTargets() {
    const accountMap = new Map(this.accounts.map((account) => [account.id, account]));
    this.draft.selectedAccountIds = this.draft.selectedAccountIds.filter((accountId) => {
      const account = accountMap.get(accountId);
      return account && this.isAccountSelectable(account);
    });

    if (this.draft.selectedAccountIds.length) return;
    if (this.targetsTouched) return;

    const selectedAccountId = this.deps.getSelectedAccountId();
    const selectedAccount = selectedAccountId ? accountMap.get(selectedAccountId) : null;
    if (selectedAccount && this.isAccountSelectable(selectedAccount)) {
      this.draft.selectedAccountIds = [selectedAccount.id];
      return;
    }

    const activeAccounts = this.accounts
      .filter((account) => this.isAccountSelectable(account))
      .map((account) => account.id);
    this.draft.selectedAccountIds = activeAccounts;
  }

  private targetAvailability(): Record<string, PublishTargetAvailability> {
    return Object.fromEntries(this.accounts.map((account) => [account.id, this.accountAvailability(account)]));
  }

  private accountAvailability(account: ChannelAccount): PublishTargetAvailability {
    const visibilityOptions = publishVisibilityOptions(account.platformId, this.draft.contentType);
    if (account.status !== "active") {
      return { publishable: false, reason: "signed-out", scheduleSupported: false, visibilityOptions };
    }
    const scheduleSupported = supportsPublishSchedule(account.platformId, this.draft.contentType);
    if (!supportsPublishContentType(account.platformId, this.draft.contentType)) {
      return { publishable: false, reason: "unsupported", scheduleSupported, visibilityOptions };
    }
    return { publishable: true, reason: "", scheduleSupported, visibilityOptions };
  }

  private isAccountSelectable(account: ChannelAccount) {
    return this.accountAvailability(account).publishable;
  }

  private resetValidation() {
    this.attempted = false;
    this.validationErrors = [];
    if (!this.publishing) {
      this.clearPublishProgressTimer();
      this.publishProgress = null;
    }
  }

  private updateSearch(value: string) {
    this.searchQuery = value;
    this.deps.render();
    window.requestAnimationFrame(() => {
      const search = document.querySelector<HTMLInputElement>("[data-publish-search]");
      if (!search) return;
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    });
  }

  private ensureLocalResourcesLoaded() {
    if (!document.querySelector(".publish-page")) return;
    if (this.resourcesLoaded || this.resourcesLoading) return;
    void this.loadLocalResources(true);
  }

  private async loadLocalResources(render = true) {
    const userId = this.deps.getCurrentUserId();
    if (!userId || this.resourcesLoading) return;
    this.resourcesLoading = true;
    try {
      this.resources = await invokeCommand<LocalResource[]>("list_local_resources", {
        request: { userId },
      });
      this.resourcesLoaded = true;
      if (render) this.deps.renderPreservingPublishScroll();
    } catch (error) {
      console.warn("Failed to load local resources", error);
      this.deps.showToast(this.language === "zh" ? "资源库加载失败，请稍后重试。" : "Failed to load the resource library.");
    } finally {
      this.resourcesLoading = false;
    }
  }

  private async applyResource(resourceId: string) {
    const resource = this.resources.find((item) => item.id === resourceId);
    if (!resource) return;
    this.captureDraftFromForm();
    if (resource.type === "copy") {
      this.draft = { ...this.draft, ...buildCopyResourceDraftPatch(resource) };
      this.activeStep = "content";
      this.resetValidation();
      this.deps.showToast(this.language === "zh" ? "文案已填入发布内容。" : "Copy applied to the draft.");
      this.renderAfterResourceApplied();
      return;
    }
    if (!resource.path) {
      this.deps.showToast(this.language === "zh" ? "资源文件路径为空，无法用于发布。" : "This resource has no local file path.");
      return;
    }

    const contentType = resource.type === "video" ? "video" : "article";
    if (this.draft.contentType !== contentType) {
      this.clearAccountMediaOverrides();
      this.draft = { ...this.draft, contentType };
    }
    const mediaFile = localResourceToPublishMediaFile(resource);
    const nextFiles = resource.type === "image" && this.draft.contentType === "article"
      ? [...this.mediaFiles, mediaFile]
      : [mediaFile];
    const mediaError = this.validateSharedContentMedia(nextFiles, contentType);
    if (mediaError) {
      this.deps.showToast(mediaError);
      return;
    }
    await this.setMediaFiles(nextFiles);
    this.activeStep = "content";
    this.resetValidation();
    this.deps.showToast(this.language === "zh" ? "素材已加入发布内容。" : "Media added to the draft.");
    this.renderAfterResourceApplied();
  }

  private renderAfterResourceApplied() {
    const resourceSidebar = document.querySelector<HTMLElement>(".publish-drafts");
    this.deps.renderPreservingPublishScroll();
    const nextSidebar = document.querySelector<HTMLElement>(".publish-drafts");
    if (resourceSidebar && nextSidebar) {
      nextSidebar.replaceWith(resourceSidebar);
    }
  }

  private async deleteResource(resourceId: string) {
    const userId = this.deps.getCurrentUserId();
    if (!userId) return;
    try {
      await invokeCommand("delete_local_resource", {
        request: { userId, id: resourceId },
      });
      this.resources = this.resources.filter((resource) => resource.id !== resourceId);
      this.deps.showToast(this.language === "zh" ? "资源已移除。" : "Resource removed.");
      this.deps.renderPreservingPublishScroll();
    } catch (error) {
      console.warn("Failed to delete local resource", error);
      this.deps.showToast(this.language === "zh" ? "删除资源失败，请稍后重试。" : "Failed to delete the resource.");
    }
  }

  private async submitDraft() {
    if (this.publishing) return;
    this.clearPublishProgressTimer();
    this.publishProgress = null;
    this.captureDraftFromForm();
    this.attempted = true;
    this.validationErrors = this.validateDraft();
    this.deps.render();
    if (this.validationErrors.length) {
      this.deps.showToast(this.validationErrors[0]);
      return;
    }

    let request: PublishWorkRequest;
    try {
      request = this.createPublishWorkRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.showToast(message);
      return;
    }

    this.publishing = true;
    const results: PublishWorkTargetResult[] = [];
    const total = request.targets.length;
    let completed = 0;
    let success = 0;
    let failed = 0;
    try {
      for (const target of request.targets) {
        const currentLabel = this.publishTargetLabel(target.accountId);
        this.updatePublishProgress({
          phase: "running",
          completed,
          total,
          success,
          failed,
          currentLabel,
          message: this.language === "zh" ? `正在发布 ${currentLabel}` : `Publishing ${currentLabel}`,
        });

        const result = await submitPublishTarget(request, target, this.accounts, this.language);
        results.push(result);
        completed += 1;
        if (result.status === "success") {
          success += 1;
        } else {
          failed += 1;
        }

        this.updatePublishProgress({
          phase: "running",
          completed,
          total,
          success,
          failed,
          currentLabel,
          message: this.language === "zh" ? `已处理 ${currentLabel}` : `Finished ${currentLabel}`,
          results: this.publishProgressResults(results),
        });
      }

      const response = { targets: results };
      const finalMessage = this.publishResultMessage(response);
      this.updatePublishProgress({
        phase: failed ? "failed" : "success",
        completed,
        total,
        success,
        failed,
        currentLabel: "",
        message: finalMessage,
        results: this.publishProgressResults(results),
      });
      this.deps.showToast(finalMessage);
      this.scheduleClearPublishProgress();
    } finally {
      this.publishing = false;
      this.deps.renderPreservingPublishScroll();
    }
  }

  private publishProgressResults(results: PublishWorkTargetResult[]) {
    return results.map((result) => ({
      accountId: result.accountId,
      platformId: result.platformId,
      status: result.status,
      message: result.message,
      remoteId: result.remoteId ?? null,
      label: this.publishTargetLabel(result.accountId),
    }));
  }

  private publishTargetLabel(accountId: string) {
    const account = this.accounts.find((item) => item.id === accountId);
    if (!account) return accountId;
    const platformName = this.platformName(account.platformId);
    return platformName ? `${platformName} · ${account.nickname}` : account.nickname;
  }

  private platformName(platformId: string) {
    return this.platforms.find((item) => item.id === platformId)?.name || platformId;
  }

  private updatePublishProgress(progress: PublishProgressState) {
    this.publishProgress = progress;
    this.deps.renderPreservingPublishScroll();
  }

  private clearPublishProgressTimer() {
    if (this.publishProgressClearTimer === null) return;
    window.clearTimeout(this.publishProgressClearTimer);
    this.publishProgressClearTimer = null;
  }

  private scheduleClearPublishProgress() {
    this.clearPublishProgressTimer();
    this.publishProgressClearTimer = window.setTimeout(() => {
      this.publishProgressClearTimer = null;
      this.publishProgress = null;
      this.deps.renderPreservingPublishScroll();
    }, 12000);
  }

  private validateContentStep() {
    const messages: string[] = [];
    if (!this.draft.title.trim()) {
      messages.push(this.language === "zh" ? "请输入作品标题。" : "Enter a title.");
    }
    if (!this.draft.body.trim()) {
      messages.push(this.language === "zh" ? "请输入正文或作品描述。" : "Enter body or description.");
    }
    if (!this.mediaFiles.length) {
      messages.push(this.language === "zh" ? "请添加作品素材。" : "Add media.");
    } else {
      const mediaError = this.validateSharedContentMedia(this.mediaFiles, this.draft.contentType);
      if (mediaError) messages.push(mediaError);
    }
    return messages;
  }

  private validateDraft() {
    const activeTargetCount = this.draft.selectedAccountIds
      .map((accountId) => this.accounts.find((account) => account.id === accountId))
      .filter((account): account is ChannelAccount => Boolean(account && this.isAccountSelectable(account)))
      .length;
    const messages = this.validateContentStep();
    if (!activeTargetCount) {
      messages.push(this.language === "zh" ? "请选择至少一个已登录账号。" : "Select at least one signed-in account.");
    }
    if (activeTargetCount && !messages.length) {
      const capabilityError = this.validateSelectedTargetCapabilities();
      if (capabilityError) {
        messages.push(capabilityError);
      } else {
        const textError = this.validateSelectedTargetText();
        if (textError) messages.push(textError);
        const targetMediaError = this.validateSelectedTargetMedia();
        if (targetMediaError) messages.push(targetMediaError);
        const scheduleError = this.validateSelectedTargetSchedules();
        if (scheduleError) messages.push(scheduleError);
      }
    }
    return messages;
  }

  private validateSelectedTargetCapabilities() {
    const activeTargets = this.draft.selectedAccountIds
      .map((accountId) => this.accounts.find((account) => account.id === accountId))
      .filter((account): account is ChannelAccount => Boolean(account && account.status === "active"));
    for (const account of activeTargets) {
      const platformId = normalizePublishPlatformId(account.platformId);
      const platformName = this.platformName(account.platformId);
      const capability = publishCapabilityForPlatform(platformId);
      if (!capability || (!capability.video && !capability.article)) {
        return this.language === "zh"
          ? `${account.nickname} 的${platformName}发布链路还未接入。`
          : `${platformName} publishing is not connected for ${account.nickname} yet.`;
      }
      if (!capability[this.draft.contentType]) {
        const contentLabel = this.draft.contentType === "video" ? "视频" : "图文";
        return this.language === "zh"
          ? `${account.nickname} 当前不支持发布${contentLabel}到${platformName}。`
          : `${platformName} does not support ${this.draft.contentType} publishing for ${account.nickname} yet.`;
      }
      const content = this.accountContentWithDefaults(account.id);
      if (content.scheduleMode === "scheduled" && !publishCapabilitySupportsSchedule(capability, this.draft.contentType)) {
        return this.language === "zh"
          ? `${account.nickname} 的${platformName}定时发布还未接入，请先使用立即发布。`
          : `${platformName} scheduled publishing is not connected for ${account.nickname} yet. Use publish now.`;
      }
    }
    return "";
  }

  private validateSelectedTargetSchedules() {
    const activeTargets = this.draft.selectedAccountIds
      .map((accountId) => this.accounts.find((account) => account.id === accountId))
      .filter((account): account is ChannelAccount => Boolean(account && account.status === "active"));
    for (const account of activeTargets) {
      const content = this.accountContentWithDefaults(account.id);
      if (content.scheduleMode !== "scheduled") continue;
      const platformId = normalizePublishPlatformId(account.platformId);
      const platformName = this.platformName(account.platformId);
      const current = this.draft.accountContents[account.id];
      const scheduledAt = selectedPublishScheduledAt(current, this.draft, content);
      const scheduledDate = parsePublishScheduledAt(scheduledAt);
      if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
        return this.language === "zh" ? `请选择 ${account.nickname} 的定时发布时间。` : `Select a scheduled time for ${account.nickname}.`;
      }
      const scheduleRange = publishScheduleRange(platformId);
      if (scheduledDate.getTime() < scheduleRange.min.getTime()) {
        this.setAccountScheduledAt(account.id, scheduleRange.min);
        return this.scheduleTooEarlyMessage(account, scheduledDate, scheduleRange.min, true);
      }
      if (scheduledDate.getTime() > scheduleRange.max.getTime()) {
        this.setAccountScheduledAt(account.id, scheduleRange.max);
        return this.language === "zh"
          ? `${account.nickname} 的定时时间不能晚于${platformName}允许的 ${formatLocalDateTimeDisplay(scheduleRange.max)}，已帮你调整，请确认后再发布。`
          : `${account.nickname}'s scheduled time cannot be later than ${platformName}'s limit ${formatLocalDateTimeDisplay(scheduleRange.max)}. Review the adjusted time and publish again.`;
      }
    }
    return "";
  }

  private validateSelectedTargetText() {
    const activeTargets = this.draft.selectedAccountIds
      .map((accountId) => this.accounts.find((account) => account.id === accountId))
      .filter((account): account is ChannelAccount => Boolean(account && account.status === "active"));
    for (const account of activeTargets) {
      const platformId = normalizePublishPlatformId(account.platformId);
      const content = this.accountContentWithDefaults(account.id);
      const captionLength = publishCaptionLength(content.title, content.body);
      if (!content.title.trim() && !content.body.trim()) {
        return this.language === "zh"
          ? `${account.nickname} 的作品标题或正文至少需要填写一个。`
          : `Enter a title or body for ${account.nickname}.`;
      }
      if (platformId === "wechat-channels" && !content.title.trim()) {
        return this.language === "zh"
          ? `${account.nickname} 的视频号发布需要填写作品标题。`
          : `Enter a title for ${account.nickname}'s WeChat Channels post.`;
      }
      if (platformId === "wechat-channels" && !content.body.trim()) {
        return this.language === "zh"
          ? `${account.nickname} 的视频号发布需要填写作品正文。`
          : `Enter body text for ${account.nickname}'s WeChat Channels post.`;
      }
      const captionLimit = publishCaptionLimit(platformId, this.draft.contentType);
      if (captionLimit && captionLength > captionLimit) {
        const platformName = this.platformName(platformId);
        return this.language === "zh"
          ? `${account.nickname} 的${platformName}作品文案最多 ${captionLimit} 个字，当前 ${captionLength} 个字。`
          : `${account.nickname}'s ${platformName} caption can be up to ${captionLimit} characters. Current: ${captionLength}.`;
      }
    }
    return "";
  }

  private setAccountScheduledAt(accountId: string, date: Date) {
    this.draft = {
      ...this.draft,
      accountContents: {
        ...this.draft.accountContents,
        [accountId]: {
          ...this.accountContentWithDefaults(accountId),
          scheduleMode: "scheduled",
          scheduledAt: formatLocalDateTimeWithOffset(date),
        },
      },
    };
  }

  private createPublishWorkRequest(): PublishWorkRequest {
    const userId = this.deps.getCurrentUserId();
    if (!userId) {
      throw new Error(this.language === "zh" ? "请先登录当前工具账号。" : "Sign in first.");
    }

    const accountMap = new Map(this.accounts.map((account) => [account.id, account]));
    const targets = this.draft.selectedAccountIds
      .map((accountId) => accountMap.get(accountId))
      .filter((account): account is ChannelAccount => Boolean(account && this.isAccountSelectable(account)))
      .map((account) => this.createPublishTargetRequest(account));

    if (!targets.length) {
      throw new Error(this.language === "zh" ? "请选择至少一个已登录账号。" : "Select at least one signed-in account.");
    }

    return {
      userId,
      contentType: this.draft.contentType,
      targets,
    };
  }

  private createPublishTargetRequest(account: ChannelAccount): PublishWorkTargetRequest {
    const content = this.accountContentWithDefaults(account.id);
    const mediaFiles = this.accountMediaFiles.has(account.id)
      ? this.accountMediaFiles.get(account.id) || []
      : this.mediaFiles;
    const previewItems = this.getMediaPreviewItems(account.id);
    const mediaError = this.validateMediaFilesForTarget(mediaFiles, account);
    if (mediaError) {
      throw new Error(mediaError);
    }
    const media = mediaFiles.map((file, index) => {
      if (!file.path) {
        throw new Error(this.language === "zh"
          ? "当前环境无法读取素材路径，请使用客户端文件选择器重新选择素材。"
          : "The local media path is unavailable. Re-select media with the desktop picker.");
      }
      const mediaType = isVideoMediaFile(file) ? "video" as const : "image" as const;
      const coverDataUrl = mediaType === "video" ? previewItems[index]?.coverDataUrl : undefined;
      return {
        name: file.name,
        path: file.path,
        mediaType,
        ...(coverDataUrl ? { coverDataUrl } : {}),
        ...(Number.isFinite(file.width) && file.width ? { width: Math.round(file.width) } : {}),
        ...(Number.isFinite(file.height) && file.height ? { height: Math.round(file.height) } : {}),
        ...(Number.isFinite(file.duration) && file.duration ? { duration: file.duration } : {}),
      };
    });

    return {
      accountId: account.id,
      title: content.title,
      body: content.body,
      visibility: content.visibility,
      scheduleMode: content.scheduleMode || "now",
      scheduledAt: content.scheduleMode === "scheduled" ? this.requirePublishScheduledAt(account, content.scheduledAt) : "",
      media,
    };
  }

  private requirePublishScheduledAt(account: ChannelAccount, value: string) {
    const platformId = normalizePublishPlatformId(account.platformId);
    const platformName = this.platformName(account.platformId);
    const scheduledDate = parsePublishScheduledAt(value);
    if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
      throw new Error(this.language === "zh" ? `请选择 ${account.nickname} 的定时发布时间。` : `Select a scheduled time for ${account.nickname}.`);
    }
    const scheduleRange = publishScheduleRange(platformId);
    if (scheduledDate.getTime() < scheduleRange.min.getTime()) {
      throw new Error(this.scheduleTooEarlyMessage(account, scheduledDate, scheduleRange.min, false));
    }
    if (scheduledDate.getTime() > scheduleRange.max.getTime()) {
      throw new Error(this.language === "zh"
        ? `${account.nickname} 的定时时间不能晚于${platformName}允许的 ${formatLocalDateTimeDisplay(scheduleRange.max)}。`
        : `${account.nickname}'s scheduled time cannot be later than ${platformName}'s limit ${formatLocalDateTimeDisplay(scheduleRange.max)}.`);
    }
    return formatLocalDateTimeWithOffset(scheduledDate);
  }

  private scheduleTooEarlyMessage(account: ChannelAccount, scheduledDate: Date, earliestDate: Date, adjusted: boolean) {
    const platformId = normalizePublishPlatformId(account.platformId);
    const platformName = this.platformName(account.platformId);
    const isPast = scheduledDate.getTime() < Date.now();
    const reasonText = isPast
      ? (this.language === "zh" ? "已过期" : "is in the past")
      : publishScheduleLeadText(this.language, platformId);
    const suffix = adjusted
      ? (this.language === "zh" ? "，已帮你调整，请确认后再发布。" : ". Review the adjusted time and publish again.")
      : (this.language === "zh" ? "。" : ".");
    return this.language === "zh"
      ? `${account.nickname} 的定时时间 ${formatLocalDateTimeDisplay(scheduledDate)} ${reasonText}，${platformName}最早可选 ${formatLocalDateTimeDisplay(earliestDate)}${suffix}`
      : `${account.nickname}'s scheduled time ${formatLocalDateTimeDisplay(scheduledDate)} ${reasonText}. The earliest ${platformName} time is ${formatLocalDateTimeDisplay(earliestDate)}${suffix}`;
  }

  private publishResultMessage(response: PublishWorkResponse) {
    const targets = response.targets || [];
    const successCount = targets.filter((target) => target.status === "success").length;
    const failed = targets.filter((target) => target.status !== "success");
    if (failed.length) {
      const firstMessage = failed[0]?.message || (this.language === "zh" ? "部分账号发布失败。" : "Some accounts failed.");
      return this.language === "zh"
        ? `发布完成：${successCount} 个成功，${failed.length} 个失败。${firstMessage}`
        : `Publish finished: ${successCount} succeeded, ${failed.length} failed. ${firstMessage}`;
    }
    return this.language === "zh"
      ? `发布成功：${successCount} 个账号已提交。`
      : `Published successfully to ${successCount} account(s).`;
  }

  private async pickMediaFiles(element: HTMLElement): Promise<PublishMediaFile[]> {
    const multiple = element.dataset.publishMediaMultiple === "true";
    const accept = element.dataset.publishMediaAccept || "";
    try {
      const selected = await openDialog({
        multiple,
        directory: false,
        filters: [this.mediaDialogFilter()],
      });
      if (!selected) return [];
      const paths = Array.isArray(selected) ? selected : [selected];
      const files = paths
        .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
        .map((path) => ({
          name: fileNameFromPath(path),
          type: inferPublishMediaType(path),
          path,
        }));
      return Promise.all(files.map((file) => this.enrichMediaFile(file)));
    } catch (error) {
      console.warn("Native media picker is not available, falling back to file input", error);
      const files = await pickPublishMediaFilesWithInput(accept, multiple);
      return Promise.all(files.map((file) => this.enrichMediaFile(file)));
    }
  }

  private async enrichMediaFile(mediaFile: PublishMediaFile): Promise<PublishMediaFile> {
    const size = mediaFile.file?.size ?? (await this.readLocalMediaSize(mediaFile.path));
    const nextFile = { ...mediaFile, size };
    if (isVideoMediaFile(nextFile)) {
      const metadata = await readPublishVideoMetadata(nextFile);
      return { ...nextFile, ...metadata };
    }
    const metadata = await readPublishImageMetadata(nextFile);
    return { ...nextFile, ...metadata };
  }

  private async readLocalMediaSize(path: string | undefined) {
    if (!path) return undefined;
    try {
      const metadata = await invokeCommand<LocalMediaMetadataResponse>("inspect_local_media", {
        request: { path },
      });
      return metadata.size;
    } catch (error) {
      console.warn("Failed to inspect local media", error);
      return undefined;
    }
  }

  private mediaDialogFilter() {
    if (this.draft.contentType === "video") {
      return {
        name: this.language === "zh" ? "视频文件" : "Video files",
        extensions: VIDEO_MEDIA_EXTENSIONS.map((extension) => extension.replace(/^\./, "")),
      };
    }
    return {
      name: this.language === "zh" ? "图片文件" : "Image files",
      extensions: IMAGE_MEDIA_EXTENSIONS.map((extension) => extension.replace(/^\./, "")),
    };
  }

  private getMediaFiles(accountId: string) {
    if (!accountId) return this.mediaFiles;
    return this.accountMediaFiles.get(accountId) || this.mediaFiles;
  }

  private getMediaPreviewItems(accountId: string) {
    if (!accountId) return this.draft.mediaPreviewItems;
    const accountDraft = this.draft.accountContents[accountId];
    if (accountDraft?.hasMediaOverride) return accountDraft.mediaPreviewItems || [];
    return this.draft.mediaPreviewItems;
  }

  private accountContentWithDefaults(accountId: string) {
    const current = this.draft.accountContents[accountId];
    const platformId = this.platformIdForAccountId(accountId);
    const scheduleSupported = supportsPublishSchedule(platformId, this.draft.contentType);
    const scheduleMode = scheduleSupported ? current?.scheduleMode ?? this.draft.scheduleMode : "now";
    const scheduledAt = scheduleMode === "scheduled"
      ? publishScheduledAtWithDefault(current?.scheduledAt ?? this.draft.scheduledAt, platformId)
      : "";
    const visibility = normalizePublishVisibilityForPlatform(
      current?.visibility ?? this.draft.visibility,
      platformId,
      this.draft.contentType,
      scheduleMode,
    );
    return {
      title: current?.title ?? this.draft.title,
      body: current?.body ?? this.draft.body,
      visibility,
      scheduleMode,
      scheduledAt,
      mediaName: current?.mediaName,
      mediaPreviewUrl: current?.mediaPreviewUrl,
      mediaPreviewType: current?.mediaPreviewType,
      mediaPreviewItems: current?.mediaPreviewItems,
      mediaCount: current?.mediaCount,
      hasMediaOverride: current?.hasMediaOverride,
    };
  }

  private platformIdForAccountId(accountId: string) {
    return normalizePublishPlatformId(
      this.accounts.find((account) => account.id === accountId)?.platformId || "",
    );
  }

  private async setMediaFilesForScope(accountId: string, files: PublishMediaFile[]) {
    if (accountId) {
      await this.setAccountMediaFiles(accountId, files);
      return;
    }
    await this.setMediaFiles(files);
  }

  private async setMediaFiles(files: PublishMediaFile[]) {
    this.revokeMediaPreview();
    const previewItems = await Promise.all(files.map((file) => this.createMediaPreviewItem(file)));
    this.mediaFiles = files;
    this.draft = {
      ...this.draft,
      ...createPublishMediaFields(files, previewItems, this.language),
    };
  }

  private async setAccountMediaFiles(accountId: string, files: PublishMediaFile[]) {
    const current = this.draft.accountContents[accountId];
    if (current?.hasMediaOverride) {
      revokePublishMediaPreviewItems(current.mediaPreviewItems || []);
    }
    const previewItems = await Promise.all(files.map((file) => this.createMediaPreviewItem(file)));
    this.accountMediaFiles.set(accountId, files);
    this.draft = {
      ...this.draft,
      accountContents: {
        ...this.draft.accountContents,
        [accountId]: {
          ...this.accountContentWithDefaults(accountId),
          ...createPublishMediaFields(files, previewItems, this.language),
          hasMediaOverride: true,
        },
      },
    };
  }

  private async createMediaPreviewItem(mediaFile: PublishMediaFile) {
    if (isVideoMediaFile(mediaFile)) {
      const sourceUrl = publishMediaSourceUrl(mediaFile);
      try {
        const coverDataUrl = await createVideoPosterDataUrl(sourceUrl);
        return {
          name: mediaFile.name,
          url: coverDataUrl,
          sourceUrl,
          coverDataUrl,
          type: "video" as const,
          previewKind: "image" as const,
        };
      } catch (error) {
        console.warn("Failed to generate video poster", error);
        return {
          name: mediaFile.name,
          url: sourceUrl,
          sourceUrl,
          type: "video" as const,
          previewKind: "video" as const,
        };
      }
    }

    return {
      name: mediaFile.name,
      url: publishMediaSourceUrl(mediaFile),
      type: "article" as const,
      previewKind: "image" as const,
    };
  }

  private clearMediaFiles() {
    this.revokeMediaPreview();
    this.mediaFiles = [];
    this.draft = {
      ...this.draft,
      ...createPublishMediaFields([], [], this.language),
    };
  }

  private clearAccountMediaFiles(accountId: string) {
    const current = this.draft.accountContents[accountId];
    if (current?.hasMediaOverride) {
      revokePublishMediaPreviewItems(current.mediaPreviewItems || []);
    }
    this.accountMediaFiles.set(accountId, []);
    this.draft = {
      ...this.draft,
      accountContents: {
        ...this.draft.accountContents,
        [accountId]: {
          ...this.accountContentWithDefaults(accountId),
          ...createPublishMediaFields([], [], this.language),
          hasMediaOverride: true,
        },
      },
    };
  }

  private clearAccountMediaOverrides() {
    this.draft = {
      ...this.draft,
      accountContents: Object.fromEntries(Object.entries(this.draft.accountContents).map(([accountId, content]) => {
        if (content.hasMediaOverride) {
          revokePublishMediaPreviewItems(content.mediaPreviewItems || []);
          this.accountMediaFiles.delete(accountId);
          return [accountId, {
            ...content,
            ...createPublishMediaFields([], [], this.language),
            hasMediaOverride: false,
          }];
        }
        return [accountId, content];
      })),
    };
  }

  private clearMediaFilesForScope(accountId: string) {
    if (accountId) {
      this.clearAccountMediaFiles(accountId);
      return;
    }
    this.clearMediaFiles();
  }

  private reorderMediaFiles(accountId: string, fromIndex: number, toIndex: number) {
    const scopedFiles = this.getMediaFiles(accountId);
    const previewItems = this.getMediaPreviewItems(accountId);
    if (!scopedFiles[fromIndex] || !scopedFiles[toIndex] || !previewItems[fromIndex] || !previewItems[toIndex]) return;
    const mediaFiles = movePublishItem(scopedFiles, fromIndex, toIndex);
    const reorderedPreviewItems = movePublishItem(previewItems, fromIndex, toIndex);
    if (accountId) {
      this.accountMediaFiles.set(accountId, mediaFiles);
      this.draft = {
        ...this.draft,
        accountContents: {
          ...this.draft.accountContents,
          [accountId]: {
            ...this.accountContentWithDefaults(accountId),
            ...createPublishMediaFields(mediaFiles, reorderedPreviewItems, this.language),
            hasMediaOverride: true,
          },
        },
      };
      return;
    }
    this.mediaFiles = mediaFiles;
    this.draft = {
      ...this.draft,
      ...createPublishMediaFields(mediaFiles, reorderedPreviewItems, this.language),
    };
  }

  private findDropTarget(clientX: number, clientY: number, accountId: string) {
    const pointTarget = document.elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLElement => (
        element instanceof HTMLElement
        && Boolean(element.dataset.publishMediaDragIndex)
        && readPublishMediaAccount(element) === accountId
        && !element.classList.contains("is-dragging")
      ));
    if (pointTarget) return pointTarget;

    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-publish-media-drag-index]:not(.is-dragging)"))
      .filter((card) => readPublishMediaAccount(card) === accountId);
    let nearestCard: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(clientX - centerX, clientY - centerY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCard = card;
      }
    });
    return nearestCard;
  }

  private isOutwardEdgeDrag(accountId: string, fromIndex: number, currentX: number, startX: number) {
    const lastIndex = this.getMediaFiles(accountId).length - 1;
    return (fromIndex === 0 && currentX < startX) || (fromIndex === lastIndex && currentX > startX);
  }

  private openVideoOverlay(accountId = "") {
    const sourceUrl = this.getMediaPreviewItems(accountId).find((item) => item.type === "video")?.sourceUrl;
    if (!sourceUrl) return;
    document.querySelector<HTMLElement>(".publish-video-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "publish-video-overlay";
    const dialog = document.createElement("div");
    dialog.className = "publish-video-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const closeButton = document.createElement("button");
    closeButton.className = "publish-video-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", this.language === "zh" ? "关闭" : "Close");
    closeButton.textContent = "×";
    const video = document.createElement("video");
    video.className = "publish-video-player";
    video.src = sourceUrl;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    dialog.append(closeButton, video);
    overlay.append(dialog);

    const close = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      overlay.remove();
      window.removeEventListener("keydown", handleKeydown);
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    closeButton.addEventListener("click", close);
    window.addEventListener("keydown", handleKeydown);
    document.body.appendChild(overlay);

    video.play().catch(() => {
      this.deps.showToast(this.language === "zh" ? "视频暂时无法播放。" : "Video playback failed.");
    });
  }

  private revokeMediaPreview() {
    revokePublishMediaPreviewItems(this.draft.mediaPreviewItems);
  }

  private clearInvalidAccountMediaOverrides(contentType = this.draft.contentType) {
    let firstError = "";
    Array.from(this.accountMediaFiles.entries()).forEach(([accountId, files]) => {
      const mediaError = this.validateMediaFiles(files, contentType, this.platformIdForAccountId(accountId));
      if (!mediaError) return;
      if (!firstError) firstError = mediaError;
      this.clearAccountMediaFiles(accountId);
    });
    return firstError;
  }

  private validateSharedMediaFiles(files: PublishMediaFile[], contentType = this.draft.contentType) {
    const selectedAccounts = this.draft.selectedAccountIds
      .map((accountId) => this.accounts.find((account) => account.id === accountId))
      .filter((account): account is ChannelAccount => Boolean(account && this.isAccountSelectable(account)));
    for (const account of selectedAccounts) {
      const mediaError = this.validateMediaFiles(files, contentType, account.platformId);
      if (mediaError) return mediaError;
    }
    return this.validateMediaFiles(files, contentType);
  }

  private validateMediaFiles(
    files: PublishMediaFile[],
    contentType = this.draft.contentType,
    platformId = "",
  ) {
    return validatePublishMediaFiles(files, contentType, platformId, this.language);
  }

  private validateSelectedTargetMedia() {
    const activeTargets = this.draft.selectedAccountIds
      .map((accountId) => this.accounts.find((account) => account.id === accountId))
      .filter((account): account is ChannelAccount => Boolean(account && account.status === "active"));
    for (const account of activeTargets) {
      const files = this.accountMediaFiles.has(account.id)
        ? this.accountMediaFiles.get(account.id) || []
        : this.mediaFiles;
      const mediaError = this.validateMediaFilesForTarget(files, account);
      if (mediaError) return mediaError;
    }
    return "";
  }

  private validateMediaFilesForTarget(files: PublishMediaFile[], account: ChannelAccount) {
    if (!files.length) {
      return this.language === "zh"
        ? `请为 ${account.nickname} 添加作品素材。`
        : `Add media for ${account.nickname}.`;
    }
    const mediaError = this.validateMediaFiles(files, this.draft.contentType, account.platformId);
    if (mediaError) return mediaError;
    return this.validateVideoCoverForTarget(account);
  }

  private validateVideoCoverForTarget(account: ChannelAccount) {
    if (this.draft.contentType !== "video") return "";
    const platformId = normalizePublishPlatformId(account.platformId);
    if (!requiresPublishVideoCover(platformId)) return "";
    const coverDataUrl = this.getMediaPreviewItems(account.id)[0]?.coverDataUrl;
    if (coverDataUrl) return "";
    const platformName = this.platformName(account.platformId);
    return this.language === "zh"
      ? `${account.nickname} 的${platformName}视频封面生成失败，请重新选择视频后再发布。`
      : `${platformName} video cover generation failed for ${account.nickname}. Re-select the video before publishing.`;
  }

  private validateSharedContentMedia(files: PublishMediaFile[], contentType = this.draft.contentType) {
    return validatePublishMediaFiles(files, contentType, "", this.language);
  }
}

function syncPublishHighlight(textarea: HTMLTextAreaElement) {
  const highlight = textarea.parentElement?.querySelector<HTMLElement>("[data-publish-highlight]");
  if (!highlight) return;
  highlight.innerHTML = highlightPublishTags(textarea.value);
  highlight.scrollTop = textarea.scrollTop;
  highlight.scrollLeft = textarea.scrollLeft;
}

function highlightPublishTags(value: string) {
  return value
    .split(/(#[^\s#]+)/g)
    .map((part) => part.startsWith("#") ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))
    .join("");
}
