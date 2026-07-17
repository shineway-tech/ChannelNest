import type {
  AiRequestStatus,
  BillingOrder,
  BillingOrderFilters,
  BillingOrderPage,
  BillingOverview,
  CommercePageId,
  ImageOptions,
  PaymentCheckout,
  PointLedgerFilters,
  PointLedgerPage,
  TextGenerationDraft,
  UserMessage,
} from "../domain/types";
import {
  BillingState,
  type BillingHistoryTab,
  type BillingView,
  type CheckoutState,
} from "./commerce/billing-state";
import { ContentGenerationState, type AiMode } from "./commerce/content-generation-state";
import { MessagesState } from "./commerce/messages-state";
import { commerceCopy } from "../i18n/commerce";
import { renderCommercePage } from "../pages/commerce";
import { ApiError, type ApiRequest, type ApiStreamRequest } from "../services/api";
import { invokeCommand } from "../services/tauri-commands";
import { formValue } from "../utils/forms";
import {
  imageGenerationInProgress,
  releaseImageReferences,
  removeImageReference,
  type ImageReference,
} from "../utils/image-task";
import { defaultImageDraft, normalizeImageDraftForAssetType } from "../utils/image-options";
import {
  saveGeneratedImageOutput,
  saveGeneratedImageToDownloads,
} from "../utils/generated-image-store";
import {
  buildImageResourceInput,
  buildTextResourceInput,
  type CreateLocalResourceInput,
  type SavedGeneratedImageFile,
} from "../utils/local-resource-library";

interface CommerceControllerDependencies {
  apiRequest: ApiRequest;
  apiStreamRequest: ApiStreamRequest;
  apiRequestBlob: (path: string) => Promise<Blob>;
  getLanguage: () => "zh" | "en";
  getCurrentUserId: () => string;
  render: () => void;
  renderPreservingScroll: () => void;
  showToast: (message: string) => void;
  normalizeError: (error: unknown) => string;
}

export class CommerceController {
  private readonly billing = new BillingState();
  private readonly messageCenter = new MessagesState();
  private readonly generation = new ContentGenerationState();
  private busy = false;

  private get overview() { return this.billing.overview; }
  private set overview(value: BillingOverview | null) { this.billing.overview = value; }
  private get billingView() { return this.billing.view; }
  private set billingView(value: BillingView) { this.billing.view = value; }
  private get selectedMembershipCode() { return this.billing.selectedMembershipCode; }
  private set selectedMembershipCode(value: string) { this.billing.selectedMembershipCode = value; }
  private get selectedRechargeCode() { return this.billing.selectedRechargeCode; }
  private set selectedRechargeCode(value: string) { this.billing.selectedRechargeCode = value; }
  private get billingHistoryTab() { return this.billing.historyTab; }
  private set billingHistoryTab(value: BillingHistoryTab) { this.billing.historyTab = value; }
  private get pointLedgers() { return this.billing.pointLedgers; }
  private set pointLedgers(value: PointLedgerPage) { this.billing.pointLedgers = value; }
  private get pointLedgerFilters() { return this.billing.pointLedgerFilters; }
  private set pointLedgerFilters(value: PointLedgerFilters) { this.billing.pointLedgerFilters = value; }
  private get pointLedgersBusy() { return this.billing.pointLedgersBusy; }
  private set pointLedgersBusy(value: boolean) { this.billing.pointLedgersBusy = value; }
  private get pointLedgerRequestId() { return this.billing.pointLedgerRequestId; }
  private set pointLedgerRequestId(value: number) { this.billing.pointLedgerRequestId = value; }
  private get billingOrders() { return this.billing.orders; }
  private set billingOrders(value: BillingOrderPage) { this.billing.orders = value; }
  private get billingOrderFilters() { return this.billing.orderFilters; }
  private set billingOrderFilters(value: BillingOrderFilters) { this.billing.orderFilters = value; }
  private get billingOrdersBusy() { return this.billing.ordersBusy; }
  private set billingOrdersBusy(value: boolean) { this.billing.ordersBusy = value; }
  private get billingOrdersLoaded() { return this.billing.ordersLoaded; }
  private set billingOrdersLoaded(value: boolean) { this.billing.ordersLoaded = value; }
  private get billingOrderRequestId() { return this.billing.orderRequestId; }
  private set billingOrderRequestId(value: number) { this.billing.orderRequestId = value; }
  private get checkout() { return this.billing.checkout; }
  private set checkout(value: CheckoutState) { this.billing.checkout = value; }
  private get paymentPoll() { return this.billing.paymentPoll; }
  private set paymentPoll(value: number | undefined) { this.billing.paymentPoll = value; }

  private get messages() { return this.messageCenter.items; }
  private set messages(value: UserMessage[]) { this.messageCenter.items = value; }
  private get unreadCount() { return this.messageCenter.unreadCount; }
  private set unreadCount(value: number) { this.messageCenter.unreadCount = value; }

  private get imageOptions() { return this.generation.imageOptions; }
  private set imageOptions(value: ImageOptions | null) { this.generation.imageOptions = value; }
  private get aiMode() { return this.generation.mode; }
  private set aiMode(value: AiMode) { this.generation.mode = value; }
  private get textDraft() { return this.generation.textDraft; }
  private set textDraft(value: TextGenerationDraft) { this.generation.textDraft = value; }
  private get textAdvancedOpen() { return this.generation.textAdvancedOpen; }
  private set textAdvancedOpen(value: boolean) { this.generation.textAdvancedOpen = value; }
  private get textInputScrollTop() { return this.generation.textInputScrollTop; }
  private set textInputScrollTop(value: number) { this.generation.textInputScrollTop = value; }
  private get textResult() { return this.generation.textResult; }
  private set textResult(value: string) { this.generation.textResult = value; }
  private get textError() { return this.generation.textError; }
  private set textError(value: string) { this.generation.textError = value; }
  private get imageDraft() { return this.generation.imageDraft; }
  private set imageDraft(value: ReturnType<typeof defaultImageDraft>) { this.generation.imageDraft = value; }
  private get imagePromptOptimizing() { return this.generation.imagePromptOptimizing; }
  private set imagePromptOptimizing(value: boolean) { this.generation.imagePromptOptimizing = value; }
  private get referenceImages() { return this.generation.referenceImages; }
  private set referenceImages(value: ImageReference[]) { this.generation.referenceImages = value; }
  private get imageRequest() { return this.generation.imageRequest; }
  private set imageRequest(value: AiRequestStatus | null) { this.generation.imageRequest = value; }
  private get imageError() { return this.generation.imageError; }
  private set imageError(value: string) { this.generation.imageError = value; }
  private get imageUrls() { return this.generation.imageUrls; }
  private set imageUrls(value: Record<string, string>) { this.generation.imageUrls = value; }
  private get imageLocalFiles() { return this.generation.imageLocalFiles; }
  private set imageLocalFiles(value: Record<string, SavedGeneratedImageFile>) {
    this.generation.imageLocalFiles = value;
  }
  private get imageObjectUrls() { return this.generation.imageObjectUrls; }
  private get imageOutputDownloads() { return this.generation.imageOutputDownloads; }
  private get imagePreviewOutputId() { return this.generation.imagePreviewOutputId; }
  private set imagePreviewOutputId(value: string) { this.generation.imagePreviewOutputId = value; }
  private get imageResourceTitleDialog() { return this.generation.imageResourceTitleDialog; }
  private set imageResourceTitleDialog(
    value: { outputId: string; title: string; error: string } | null,
  ) {
    this.generation.imageResourceTitleDialog = value;
  }
  private get resourceSavedKeys() { return this.generation.resourceSavedKeys; }
  private get imagePoll() { return this.generation.imagePoll; }
  private set imagePoll(value: number | undefined) { this.generation.imagePoll = value; }

  constructor(private readonly deps: CommerceControllerDependencies) {}

  getUnreadCount() {
    return this.unreadCount;
  }

  private getText() {
    return commerceCopy[this.deps.getLanguage()];
  }

  private normalizeError(error: unknown) {
    const localized = error instanceof ApiError ? this.getText().errors[error.code] : "";
    return localized || this.deps.normalizeError(error);
  }

  renderPage(page: CommercePageId) {
    return renderCommercePage({
      page,
      overview: this.overview,
      billingView: this.billingView,
      selectedMembershipCode: this.selectedMembershipCode,
      selectedRechargeCode: this.selectedRechargeCode,
      billingHistoryTab: this.billingHistoryTab,
      pointLedgers: this.pointLedgers,
      pointLedgerFilters: this.pointLedgerFilters,
      pointLedgersBusy: this.pointLedgersBusy,
      billingOrders: this.billingOrders,
      billingOrderFilters: this.billingOrderFilters,
      billingOrdersBusy: this.billingOrdersBusy,
      messages: this.messages,
      unreadCount: this.unreadCount,
      imageOptions: this.imageOptions,
      aiMode: this.aiMode,
      busy: this.busy,
      textDraft: this.textDraft,
      textAdvancedOpen: this.textAdvancedOpen,
      textResult: this.textResult,
      textError: this.textError,
      imageDraft: this.imageDraft,
      imagePromptOptimizing: this.imagePromptOptimizing,
      referenceImages: this.referenceImages,
      imageRequest: this.imageRequest,
      imageError: this.imageError,
      imageUrls: this.imageUrls,
      imageLocalFileIds: Object.keys(this.imageLocalFiles),
      imagePreview: this.imagePreviewState(),
      imageResourceTitleDialog: this.imageResourceTitleDialog,
      resourceSavedKeys: Array.from(this.resourceSavedKeys),
      checkout: this.checkout,
      language: this.deps.getLanguage(),
    });
  }

  async loadInitial() {
    await Promise.allSettled([
      this.loadOverview(false),
      this.loadPointLedgers(1, false),
      this.loadUnreadCount(false),
    ]);
  }

  activate(page: CommercePageId) {
    if (page === "membership") {
      const needsRender = this.billingView !== "overview";
      this.billingView = "overview";
      this.selectedMembershipCode = "";
      this.selectedRechargeCode = "";
      if (needsRender) this.deps.render();
      void this.refreshBilling();
    } else if (page === "messages") {
      void this.loadMessages();
    } else if (page === "ai" && !this.imageOptions) {
      void this.loadImageOptions();
    }
  }

  bindEvents() {
    document.querySelectorAll<HTMLElement>("[data-history-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.historyTab;
        if ((tab !== "points" && tab !== "orders") || tab === this.billingHistoryTab) return;
        this.billingHistoryTab = tab;
        this.deps.render();
        if (tab === "orders" && !this.billingOrdersLoaded) void this.loadBillingOrders();
      });
    });
    document.querySelectorAll<HTMLElement>("[data-billing-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.billingView;
        if (view !== "overview" && view !== "membership" && view !== "recharge") return;
        this.billingView = view;
        if (view === "membership") this.selectedMembershipCode = "";
        if (view === "recharge") this.selectedRechargeCode = "";
        this.deps.render();
      });
    });
    document.querySelectorAll<HTMLInputElement>("[data-membership-option]").forEach((input) => {
      input.addEventListener("change", () => {
        this.selectedMembershipCode = input.value;
        this.deps.render();
      });
    });
    document.querySelectorAll<HTMLInputElement>("[data-recharge-option]").forEach((input) => {
      input.addEventListener("change", () => {
        this.selectedRechargeCode = input.value;
        this.deps.render();
      });
    });
    document.querySelectorAll<HTMLFormElement>("[data-billing-purchase]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const orderType = form.dataset.billingPurchase;
        if (orderType === "membership" && this.selectedMembershipCode) {
          void this.buy(orderType, this.selectedMembershipCode);
        } else if (orderType === "recharge" && this.selectedRechargeCode) {
          void this.buy(orderType, this.selectedRechargeCode);
        }
      });
    });
    document.querySelectorAll<HTMLSelectElement>("[data-ledger-filter]").forEach((select) => {
      select.addEventListener("change", () => {
        const filter = select.dataset.ledgerFilter;
        if (filter === "direction") {
          this.pointLedgerFilters.direction = select.value as PointLedgerFilters["direction"];
        } else if (filter === "source") {
          this.pointLedgerFilters.source = select.value as PointLedgerFilters["source"];
        } else if (filter === "rangeDays") {
          this.pointLedgerFilters.rangeDays = select.value as PointLedgerFilters["rangeDays"];
        }
        void this.loadPointLedgers(1);
      });
    });
    document.querySelectorAll<HTMLElement>("[data-ledger-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const page = Number(button.dataset.ledgerPage);
        if (Number.isInteger(page) && page > 0) void this.loadPointLedgers(page);
      });
    });
    document.querySelectorAll<HTMLSelectElement>("[data-order-filter]").forEach((select) => {
      select.addEventListener("change", () => {
        const filter = select.dataset.orderFilter;
        if (filter === "orderType") {
          this.billingOrderFilters.orderType = select.value as BillingOrderFilters["orderType"];
        } else if (filter === "status") {
          this.billingOrderFilters.status = select.value as BillingOrderFilters["status"];
        } else if (filter === "rangeDays") {
          this.billingOrderFilters.rangeDays = select.value as BillingOrderFilters["rangeDays"];
        }
        void this.loadBillingOrders();
      });
    });
    document.querySelectorAll<HTMLElement>("[data-order-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const page = Number(button.dataset.orderPage);
        if (Number.isInteger(page) && page > 0) void this.loadBillingOrders(page);
      });
    });
    document.querySelectorAll<HTMLElement>("[data-order-continue]").forEach((button) => {
      button.addEventListener("click", () => {
        const orderId = button.dataset.orderContinue;
        if (orderId) void this.continuePayment(orderId);
      });
    });
    document.querySelector<HTMLElement>("[data-close-checkout]")?.addEventListener("click", () => {
      this.checkout = null;
      this.stopPaymentPoll();
      this.deps.render();
    });
    document.querySelectorAll<HTMLElement>("[data-message-read]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.messageRead;
        if (id) void this.markMessageRead(id);
      });
    });
    document.querySelector<HTMLElement>("[data-message-read-all]")?.addEventListener("click", () => {
      void this.markAllMessagesRead();
    });
    document.querySelectorAll<HTMLElement>("[data-ai-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        this.captureDrafts();
        this.aiMode = button.dataset.aiMode === "image" ? "image" : "text";
        this.deps.render();
        if (this.aiMode === "image" && !this.imageOptions) void this.loadImageOptions();
      });
    });
    const textForm = document.querySelector<HTMLFormElement>("[data-ai-text-form]");
    textForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLFormElement) void this.generateText(event.currentTarget);
    });
    if (textForm) {
      textForm.scrollTop = this.textInputScrollTop;
      textForm.addEventListener("scroll", () => {
        this.textInputScrollTop = textForm.scrollTop;
      }, { passive: true });
    }
    const textInput = document.querySelector<HTMLTextAreaElement>("[data-ai-text-input]");
    const updateTextCount = () => {
      if (!textInput) return;
      this.textDraft.input = textInput.value;
      const counter = document.querySelector<HTMLOutputElement>("[data-ai-text-count]");
      if (counter) counter.value = `${textInput.value.length} / 2000`;
    };
    if (textInput) {
      let composing = false;
      textInput.addEventListener("compositionstart", () => { composing = true; });
      textInput.addEventListener("compositionend", () => {
        composing = false;
        updateTextCount();
      });
      textInput.addEventListener("input", () => {
        if (!composing) updateTextCount();
      });
    }
    const lengthMode = document.querySelector<HTMLSelectElement>("[data-ai-length-mode]");
    const targetLength = document.querySelector<HTMLElement>("[data-ai-target-length]");
    const syncTargetLength = () => {
      if (!lengthMode || !targetLength) return;
      targetLength.hidden = lengthMode.value !== "custom";
      const input = targetLength.querySelector<HTMLInputElement>("input");
      if (input) input.required = lengthMode.value === "custom";
    };
    lengthMode?.addEventListener("change", syncTargetLength);
    syncTargetLength();
    const cta = document.querySelector<HTMLSelectElement>("[data-ai-cta]");
    const customCta = document.querySelector<HTMLElement>("[data-ai-custom-cta]");
    const syncCustomCta = () => {
      if (!cta || !customCta) return;
      customCta.hidden = cta.value !== "custom";
      const input = customCta.querySelector<HTMLInputElement>("input");
      if (input) input.required = cta.value === "custom";
    };
    cta?.addEventListener("change", syncCustomCta);
    syncCustomCta();
    document.querySelector<HTMLDetailsElement>("[data-ai-advanced]")?.addEventListener(
      "toggle",
      (event) => {
        if (event.currentTarget instanceof HTMLDetailsElement) {
          this.textAdvancedOpen = event.currentTarget.open;
        }
      },
    );
    document.querySelector<HTMLFormElement>("[data-ai-image-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLFormElement) void this.generateImages(event.currentTarget);
    });
    document.querySelector<HTMLElement>("[data-ai-optimize-image-prompt]")?.addEventListener("click", () => {
      const imageForm = document.querySelector<HTMLFormElement>("[data-ai-image-form]");
      if (imageForm) void this.optimizeImagePrompt(imageForm);
    });
    document.querySelector<HTMLSelectElement>("[data-ai-asset-type]")?.addEventListener("change", (event) => {
      if (!this.imageOptions || !(event.currentTarget instanceof HTMLSelectElement)) return;
      const imageForm = event.currentTarget.form;
      if (imageForm) this.captureImageDraft(imageForm);
      this.imageDraft.assetType = event.currentTarget.value;
      this.imageDraft = normalizeImageDraftForAssetType(this.imageOptions, this.imageDraft);
      this.deps.renderPreservingScroll();
    });
    document.querySelector<HTMLInputElement>("[data-ai-references]")?.addEventListener("change", (event) => {
      if (event.currentTarget instanceof HTMLInputElement) {
        void this.uploadReferences(Array.from(event.currentTarget.files || []));
      }
    });
    document.querySelectorAll<HTMLButtonElement>("[data-remove-reference]").forEach((button) => {
      button.addEventListener("click", () => {
        const referenceId = button.dataset.removeReference;
        if (referenceId) void this.removeReference(referenceId);
      });
    });
    document.querySelectorAll<HTMLInputElement>("[data-ai-palette-option]").forEach((input) => {
      input.addEventListener("change", () => {
        const output = document.querySelector<HTMLOutputElement>("[data-ai-palette-name]");
        if (output) output.value = input.dataset.paletteName || "";
      });
    });
    document.querySelector<HTMLElement>("[data-copy-ai]")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.textResult).then(() => {
        this.deps.showToast(this.getText().copied);
      });
    });
    document.querySelector<HTMLElement>("[data-ai-save-text-resource]")?.addEventListener("click", () => {
      void this.saveTextResource();
    });
    document.querySelectorAll<HTMLElement>("[data-ai-preview-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const outputId = button.dataset.aiPreviewImage;
        if (outputId) this.openImagePreview(outputId);
      });
    });
    document.querySelectorAll<HTMLElement>("[data-ai-download-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const outputId = button.dataset.aiDownloadImage;
        if (outputId) void this.downloadImage(outputId);
      });
    });
    document.querySelector<HTMLElement>("[data-close-image-preview]")?.addEventListener("click", () => {
      this.closeImagePreview();
    });
    document.querySelector<HTMLElement>("[data-image-preview-backdrop]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeImagePreview();
    });
    document.querySelectorAll<HTMLElement>("[data-ai-save-image-resource]").forEach((button) => {
      button.addEventListener("click", () => {
        const outputId = button.dataset.aiSaveImageResource;
        if (outputId) this.openImageResourceTitleDialog(outputId);
      });
    });
    document.querySelectorAll<HTMLElement>("[data-close-image-resource-title]").forEach((button) => {
      button.addEventListener("click", () => {
        this.closeImageResourceTitleDialog();
      });
    });
    document.querySelector<HTMLElement>("[data-image-resource-title-backdrop]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeImageResourceTitleDialog();
    });
    document.querySelector<HTMLFormElement>("[data-image-resource-title-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLFormElement) {
        void this.confirmImageResourceTitle(event.currentTarget);
      }
    });
    this.bindCheckoutFrame();
  }

  captureDrafts() {
    const textForm = document.querySelector<HTMLFormElement>("[data-ai-text-form]");
    if (textForm) this.captureTextDraft(textForm);
    const imageForm = document.querySelector<HTMLFormElement>("[data-ai-image-form]");
    if (imageForm) this.captureImageDraft(imageForm);
  }

  reset() {
    this.stopPaymentPoll();
    this.stopImagePoll();
    this.releaseGeneratedImageUrls();
    releaseImageReferences(this.referenceImages);
    this.billing.reset();
    this.messageCenter.reset();
    this.generation.reset();
    this.busy = false;
  }

  private async loadOverview(render = true) {
    try {
      this.overview = await this.deps.apiRequest<BillingOverview>("/v1/billing/overview");
      if (render) this.deps.render();
    } catch (error) {
      if (render) this.deps.showToast(this.normalizeError(error));
    }
  }

  private async loadPointLedgers(page = 1, render = true) {
    const requestId = ++this.pointLedgerRequestId;
    const query = new URLSearchParams({
      page: String(page),
      page_size: "10",
      direction: this.pointLedgerFilters.direction,
      source: this.pointLedgerFilters.source,
      range_days: this.pointLedgerFilters.rangeDays,
    });
    this.pointLedgersBusy = true;
    if (render) this.deps.render();
    try {
      const result = await this.deps.apiRequest<PointLedgerPage>(`/v1/billing/ledgers?${query}`);
      if (requestId !== this.pointLedgerRequestId) return;
      this.pointLedgers = result;
    } catch (error) {
      if (requestId === this.pointLedgerRequestId && render) {
        this.deps.showToast(this.normalizeError(error));
      }
    } finally {
      if (requestId === this.pointLedgerRequestId) {
        this.pointLedgersBusy = false;
        if (render) this.deps.render();
      }
    }
  }

  private async loadBillingOrders(page = 1, render = true) {
    const requestId = ++this.billingOrderRequestId;
    const query = new URLSearchParams({
      page: String(page),
      page_size: "10",
      order_type: this.billingOrderFilters.orderType,
      status: this.billingOrderFilters.status,
      range_days: this.billingOrderFilters.rangeDays,
    });
    this.billingOrdersBusy = true;
    if (render) this.deps.render();
    try {
      const result = await this.deps.apiRequest<BillingOrderPage>(`/v1/billing/orders?${query}`);
      if (requestId !== this.billingOrderRequestId) return;
      this.billingOrders = result;
      this.billingOrdersLoaded = true;
    } catch (error) {
      if (requestId === this.billingOrderRequestId && render) {
        this.deps.showToast(this.normalizeError(error));
      }
    } finally {
      if (requestId === this.billingOrderRequestId) {
        this.billingOrdersBusy = false;
        if (render) this.deps.render();
      }
    }
  }

  private async refreshBilling(render = true) {
    const historyRequest = this.billingHistoryTab === "orders"
      ? this.loadBillingOrders(1, false) : this.loadPointLedgers(1, false);
    await Promise.all([this.loadOverview(false), historyRequest]);
    if (render) this.deps.render();
  }

  private async loadUnreadCount(render = true) {
    try {
      const result = await this.deps.apiRequest<{ count: number }>("/v1/messages/unread-count");
      this.unreadCount = result.count;
      if (render) this.deps.render();
    } catch {
      this.unreadCount = 0;
    }
  }

  private async loadMessages() {
    try {
      const result = await this.deps.apiRequest<{ items: UserMessage[] }>(
        `/v1/messages?limit=50&language=${this.deps.getLanguage()}`,
      );
      this.messages = result.items;
      this.unreadCount = result.items.filter((item) => !item.readAt).length;
      this.deps.render();
    } catch (error) {
      this.deps.showToast(this.normalizeError(error));
    }
  }

  private async markMessageRead(id: string) {
    const result = await this.deps.apiRequest<{ count: number }>(`/v1/messages/${id}/read`, {
      method: "POST",
    });
    this.unreadCount = result.count;
    this.messages = this.messages.map((item) => item.id === id
      ? { ...item, readAt: item.readAt || new Date().toISOString() }
      : item);
    this.deps.render();
  }

  private async markAllMessagesRead() {
    await this.deps.apiRequest("/v1/messages/read-all", { method: "POST" });
    this.unreadCount = 0;
    this.messages = this.messages.map((item) => ({
      ...item,
      readAt: item.readAt || new Date().toISOString(),
    }));
    this.deps.render();
  }

  private async buy(orderType: "membership" | "recharge", productCode: string) {
    if (this.busy) return;
    this.busy = true;
    this.deps.render();
    try {
      const order = await this.deps.apiRequest<BillingOrder>("/v1/billing/orders", {
        method: "POST",
        body: {
          order_type: orderType,
          product_code: productCode,
          client_request_id: crypto.randomUUID(),
        },
      });
      await this.openCheckout(order.id);
    } catch (error) {
      this.deps.showToast(this.normalizeError(error));
    } finally {
      this.busy = false;
      this.deps.render();
    }
  }

  private async continuePayment(orderId: string) {
    if (this.busy) return;
    this.busy = true;
    this.deps.render();
    try {
      await this.openCheckout(orderId);
    } catch (error) {
      this.deps.showToast(this.normalizeError(error));
    } finally {
      this.busy = false;
      this.deps.render();
    }
  }

  private async openCheckout(orderId: string) {
    const checkout = await this.deps.apiRequest<PaymentCheckout>(
      `/v1/billing/orders/${orderId}/payment`,
      { method: "POST", body: { client_request_id: crypto.randomUUID() } },
    );
    if (!checkout.checkoutValue || checkout.checkoutType !== "checkout_url") {
      throw new Error(this.getText().checkoutCreationFailed);
    }
    this.checkout = { ...checkout, orderId };
    this.startPaymentPoll(orderId);
  }

  private bindCheckoutFrame() {
    const frame = document.querySelector<HTMLIFrameElement>("[data-checkout-frame]");
    frame?.addEventListener("error", () => {
      this.deps.showToast(this.getText().checkoutLoadFailed);
    });
  }

  private startPaymentPoll(orderId: string) {
    this.stopPaymentPoll();
    this.paymentPoll = window.setInterval(() => {
      void this.deps.apiRequest<BillingOrder>(`/v1/billing/orders/${orderId}`).then((order) => {
        if (order.status === "paid") {
          this.stopPaymentPoll();
          this.checkout = null;
          this.billing.showOverview();
          this.deps.showToast(this.getText().paymentSucceeded);
          void this.refreshBilling();
        } else if (["closed", "failed"].includes(order.status)) {
          this.stopPaymentPoll();
          this.checkout = null;
          this.deps.showToast(this.getText().orderClosed);
          this.deps.render();
        }
      }).catch(() => undefined);
    }, 2500);
  }

  private stopPaymentPoll() {
    if (this.paymentPoll) window.clearInterval(this.paymentPoll);
    this.paymentPoll = undefined;
  }

  private async generateText(form: HTMLFormElement) {
    if (this.busy) return;
    this.captureTextDraft(form);
    this.textError = "";
    this.textResult = "";
    this.resourceSavedKeys.delete("text");
    this.busy = true;
    this.deps.render();
    try {
      await this.deps.apiStreamRequest<{ requestId: string }>("/v1/ai/text/stream", {
        method: "POST",
        body: {
          client_request_id: crypto.randomUUID(),
          task_type: this.textDraft.taskType,
          platform: this.textDraft.platform,
          goal: this.textDraft.goal,
          audience: this.textDraft.audience,
          tone: this.textDraft.tone,
          structure: this.textDraft.structure,
          length_mode: this.textDraft.lengthMode,
          target_length: this.textDraft.lengthMode === "custom"
            ? Number(this.textDraft.targetLength)
            : null,
          input: this.textDraft.input,
          key_points: this.textDraft.keyPoints,
          cta: this.textDraft.cta,
          cta_text: this.textDraft.cta === "custom" ? this.textDraft.ctaText : "",
          forbidden_content: this.textDraft.forbiddenContent,
          language: this.deps.getLanguage(),
        },
        onDelta: (content) => this.appendTextDelta(content),
      });
      this.textError = "";
      await this.refreshBilling(false);
    } catch (error) {
      this.textError = this.normalizeError(error);
      this.deps.showToast(this.textError);
    } finally {
      this.busy = false;
      this.deps.render();
    }
  }

  private captureTextDraft(form: HTMLFormElement) {
    this.textInputScrollTop = form.scrollTop;
    const advanced = form.querySelector<HTMLDetailsElement>("[data-ai-advanced]");
    if (advanced) this.textAdvancedOpen = advanced.open;
    this.textDraft = {
      taskType: formValue(form, "taskType") || "social_post",
      platform: formValue(form, "platform") || "general",
      goal: formValue(form, "goal") || "auto",
      audience: formValue(form, "audience"),
      tone: formValue(form, "tone") || "auto",
      structure: formValue(form, "structure") || "auto",
      lengthMode: formValue(form, "lengthMode") || "auto",
      targetLength: formValue(form, "targetLength"),
      input: formValue(form, "input"),
      keyPoints: formValue(form, "keyPoints"),
      cta: formValue(form, "cta") || "auto",
      ctaText: formValue(form, "ctaText"),
      forbiddenContent: formValue(form, "forbiddenContent"),
    };
  }

  private async appendTextDelta(content: string) {
    const characters = Array.from(content);
    for (let index = 0; index < characters.length; index += 16) {
      this.textResult += characters.slice(index, index + 16).join("");
      const output = document.querySelector<HTMLElement>("[data-ai-text-result]");
      if (output) {
        let text = output.querySelector<HTMLElement>("[data-ai-text-content]");
        if (!text) {
          text = document.createElement("div");
          text.className = "ai-text-content is-streaming";
          text.dataset.aiTextContent = "";
          output.replaceChildren(text);
        }
        text.textContent = this.textResult;
        const pane = output.closest<HTMLElement>(".ai-output-pane");
        if (pane) pane.scrollTop = pane.scrollHeight;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  private async loadImageOptions() {
    try {
      this.imageOptions = await this.deps.apiRequest<ImageOptions>("/v1/ai/image-options");
      const firstAllowed = this.imageOptions.resolutions.find((item) => item.allowed);
      if (firstAllowed) this.imageDraft.resolution = firstAllowed.code;
      this.imageDraft = normalizeImageDraftForAssetType(this.imageOptions, this.imageDraft);
      this.deps.render();
    } catch (error) {
      this.deps.showToast(this.normalizeError(error));
    }
  }

  private captureImageDraft(form: HTMLFormElement) {
    const defaults = defaultImageDraft();
    this.imageDraft = {
      assetType: formValue(form, "assetType") || defaults.assetType,
      resolution: formValue(form, "resolution") || defaults.resolution,
      aspectRatio: formValue(form, "aspectRatio") || defaults.aspectRatio,
      count: Number(formValue(form, "count") || defaults.count),
      style: formValue(form, "style") || defaults.style,
      layout: formValue(form, "layout") || defaults.layout,
      palette: formValue(form, "palette") || defaults.palette,
      preset: formValue(form, "preset") || defaults.preset,
      referenceMode: formValue(form, "referenceMode") || defaults.referenceMode,
      prompt: formValue(form, "prompt"),
    };
    if (this.imageOptions) {
      this.imageDraft = normalizeImageDraftForAssetType(
        this.imageOptions,
        this.imageDraft,
        { resetAspectRatio: false },
      );
    }
  }

  private async uploadReferences(files: File[]) {
    if (!files.length) return;
    this.busy = true;
    this.deps.renderPreservingScroll();
    try {
      const maxReferences = this.imageOptions?.limits.maxReferenceImages || 4;
      for (const file of files.slice(0, maxReferences - this.referenceImages.length)) {
        const body = new FormData();
        body.append("file", file);
        const result = await this.deps.apiRequest<{ referenceId: string }>(
          "/v1/ai/image-references",
          { method: "POST", body },
        );
        this.referenceImages.push({
          id: result.referenceId,
          name: file.name,
          url: URL.createObjectURL(file),
        });
        this.deps.renderPreservingScroll();
      }
    } catch (error) {
      this.deps.showToast(this.normalizeError(error));
    } finally {
      this.busy = false;
      this.deps.renderPreservingScroll();
    }
  }

  private async removeReference(referenceId: string) {
    if (this.busy || !this.referenceImages.some((reference) => reference.id === referenceId)) return;
    this.referenceImages = removeImageReference(this.referenceImages, referenceId);
    this.deps.renderPreservingScroll();
    try {
      await this.deps.apiRequest(`/v1/ai/image-references/${referenceId}`, { method: "DELETE" });
    } catch (error) {
      console.warn("Failed to remove uploaded image reference from server", error);
    }
  }

  private async optimizeImagePrompt(form: HTMLFormElement) {
    if (this.busy || this.imagePromptOptimizing) return;
    this.captureImageDraft(form);
    if (!this.imageDraft.prompt.trim()) {
      this.deps.showToast(this.getText().imagePromptRequired);
      return;
    }

    this.imagePromptOptimizing = true;
    this.deps.renderPreservingScroll();
    try {
      const result = await this.deps.apiRequest<{ optimizedPrompt: string }>(
        "/v1/ai/image-prompt/optimize",
        {
          method: "POST",
          body: {
            client_request_id: crypto.randomUUID(),
            asset_type: this.imageDraft.assetType,
            prompt: this.imageDraft.prompt,
            aspect_ratio: this.imageDraft.aspectRatio,
            language: this.deps.getLanguage(),
            style: this.imageDraft.style,
            layout: this.imageDraft.layout,
            palette: this.imageDraft.palette,
            preset: this.imageDraft.preset,
            reference_mode: this.imageDraft.referenceMode,
            reference_count: this.referenceImages.length,
          },
        },
      );
      const optimizedPrompt = result.optimizedPrompt.trim();
      if (optimizedPrompt) {
        this.imageDraft.prompt = optimizedPrompt.slice(0, 2000);
        this.deps.showToast(this.getText().imagePromptOptimized);
      }
      await this.refreshBilling(false);
    } catch (error) {
      this.deps.showToast(this.normalizeError(error));
    } finally {
      this.imagePromptOptimizing = false;
      this.deps.renderPreservingScroll();
    }
  }

  private async generateImages(form: HTMLFormElement) {
    if (imageGenerationInProgress(this.busy, this.imageRequest?.status)) return;
    this.captureImageDraft(form);
    this.releaseGeneratedImageUrls();
    this.generation.resetImageOutputs();
    this.busy = true;
    this.deps.renderPreservingScroll();
    try {
      const result = await this.deps.apiRequest<{ requestId: string }>("/v1/ai/images", {
        method: "POST",
        body: {
          client_request_id: crypto.randomUUID(),
          asset_type: this.imageDraft.assetType,
          prompt: this.imageDraft.prompt,
          resolution: this.imageDraft.resolution,
          aspect_ratio: this.imageDraft.aspectRatio,
          count: this.imageDraft.count,
          language: this.deps.getLanguage(),
          style: this.imageDraft.style,
          layout: this.imageDraft.layout,
          palette: this.imageDraft.palette,
          preset: this.imageDraft.preset,
          reference_ids: this.referenceImages.map((reference) => reference.id),
          reference_mode: this.imageDraft.referenceMode,
        },
      });
      if (this.referenceImages.length) {
        releaseImageReferences(this.referenceImages);
        this.referenceImages = [];
      }
      this.imageRequest = {
        requestId: result.requestId,
        status: "pending",
        resolution: String(this.imageDraft.resolution),
        requestedCount: Number(this.imageDraft.count),
        successCount: 0,
        failedCount: 0,
        chargedMicros: "0",
        outputs: [],
      };
      this.startImagePoll(result.requestId);
    } catch (error) {
      this.imageError = this.normalizeError(error);
      this.deps.showToast(this.imageError);
    } finally {
      this.busy = false;
      this.deps.renderPreservingScroll();
    }
  }

  private startImagePoll(requestId: string) {
    this.stopImagePoll();
    const poll = async () => {
      try {
        this.imageRequest = await this.deps.apiRequest<AiRequestStatus>(`/v1/ai/requests/${requestId}`);
        this.loadImageOutputs(this.imageRequest);
        if (["succeeded", "partial", "failed"].includes(this.imageRequest.status)) {
          this.stopImagePoll();
          if (this.imageRequest.status === "failed") {
            const errors = this.getText().imageErrors;
            this.imageError = errors[this.imageRequest.errorCode || ""] || errors.default;
            this.deps.showToast(this.imageError);
          }
          await this.refreshBilling(false);
        }
        this.deps.renderPreservingScroll();
      } catch (error) {
        this.stopImagePoll();
        this.deps.showToast(this.normalizeError(error));
      }
    };
    void poll();
    this.imagePoll = window.setInterval(() => void poll(), 2500);
  }

  private loadImageOutputs(request: AiRequestStatus) {
    request.outputs.forEach((output) => {
      if (this.imageUrls[output.id] || this.imageOutputDownloads.has(output.id)) return;
      this.imageOutputDownloads.add(output.id);
      void this.deps.apiRequestBlob(output.downloadPath)
        .then(async (blob) => {
          let shouldAckServerFile = false;
          let url = "";
          try {
            const saved = await saveGeneratedImageOutput(request.requestId, output, blob);
            url = saved.url;
            this.imageLocalFiles[output.id] = saved;
            shouldAckServerFile = true;
          } catch (error) {
            console.warn("Failed to save generated image output locally", error);
            url = URL.createObjectURL(blob);
            this.imageObjectUrls.add(url);
          }

          if (this.imageRequest?.requestId === request.requestId) {
            this.imageUrls[output.id] = url;
            this.deps.renderPreservingScroll();
          } else {
            this.releaseGeneratedImageUrl(url);
          }
          if (shouldAckServerFile) {
            await this.ackImageOutput(request.requestId, output.id);
          }
        })
        .catch((error) => {
          console.warn("Failed to load generated image output", error);
        })
        .finally(() => {
          this.imageOutputDownloads.delete(output.id);
      });
    });
  }

  private async ackImageOutput(requestId: string, outputId: string) {
    try {
      await this.deps.apiRequest(`/v1/ai/requests/${requestId}/outputs/${outputId}/ack`, {
        method: "POST",
      });
    } catch (error) {
      console.warn("Failed to acknowledge generated image output", error);
    }
  }

  private async saveTextResource() {
    if (!this.textResult.trim() || this.resourceSavedKeys.has("text")) return;
    try {
      await this.createLocalResource(buildTextResourceInput({
        userId: this.requireCurrentUserId(),
        content: this.textResult,
        language: this.deps.getLanguage(),
      }));
      this.resourceSavedKeys.add("text");
      this.deps.showToast(this.getText().resourceSaved);
      this.deps.renderPreservingScroll();
    } catch (error) {
      this.deps.showToast(this.normalizeResourceError(error));
    }
  }

  private openImagePreview(outputId: string) {
    if (!this.imageUrls[outputId]) return;
    this.captureDrafts();
    this.imagePreviewOutputId = outputId;
    this.deps.renderPreservingScroll();
  }

  private closeImagePreview() {
    if (!this.imagePreviewOutputId) return;
    this.imagePreviewOutputId = "";
    this.deps.renderPreservingScroll();
  }

  private async downloadImage(outputId: string) {
    const localFile = this.imageLocalFiles[outputId];
    if (!localFile) return;
    try {
      await saveGeneratedImageToDownloads(localFile);
      this.deps.showToast(this.getText().imageSavedToDownloads);
    } catch (error) {
      console.warn("Failed to save generated image to downloads", error);
      this.deps.showToast(this.getText().imageSaveFailed);
    }
  }

  private openImageResourceTitleDialog(outputId: string) {
    const request = this.imageRequest;
    const output = request?.outputs.find((item) => item.id === outputId);
    const localFile = this.imageLocalFiles[outputId];
    if (!request || !output || !localFile || this.resourceSavedKeys.has(`image:${outputId}`)) return;
    this.captureDrafts();
    this.imageResourceTitleDialog = {
      outputId,
      title: this.imageOutputTitle(output),
      error: "",
    };
    this.deps.renderPreservingScroll();
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>("[data-image-resource-title-form] input")?.select();
    }, 0);
  }

  private closeImageResourceTitleDialog() {
    if (!this.imageResourceTitleDialog) return;
    this.imageResourceTitleDialog = null;
    this.deps.renderPreservingScroll();
  }

  private async confirmImageResourceTitle(form: HTMLFormElement) {
    const outputId = form.dataset.imageResourceTitleForm || this.imageResourceTitleDialog?.outputId || "";
    const title = formValue(form, "resourceTitle").trim();
    if (!title) {
      this.imageResourceTitleDialog = {
        outputId,
        title,
        error: this.getText().resourceTitleRequired,
      };
      this.deps.renderPreservingScroll();
      return;
    }
    await this.saveImageResource(outputId, title);
  }

  private async saveImageResource(outputId: string, title: string) {
    const request = this.imageRequest;
    const output = request?.outputs.find((item) => item.id === outputId);
    const localFile = this.imageLocalFiles[outputId];
    const key = `image:${outputId}`;
    if (!request || !output || !localFile || this.resourceSavedKeys.has(key)) return;
    try {
      await this.createLocalResource(buildImageResourceInput({
        userId: this.requireCurrentUserId(),
        requestId: request.requestId,
        output,
        localFile,
        language: this.deps.getLanguage(),
        title,
      }));
      this.resourceSavedKeys.add(key);
      this.imageResourceTitleDialog = null;
      this.deps.showToast(this.getText().resourceSaved);
      this.deps.renderPreservingScroll();
    } catch (error) {
      this.deps.showToast(this.normalizeResourceError(error));
    }
  }

  private async createLocalResource(request: CreateLocalResourceInput) {
    await invokeCommand("create_local_resource", { request });
  }

  private imagePreviewState() {
    if (!this.imagePreviewOutputId) return null;
    const output = this.imageRequest?.outputs.find((item) => item.id === this.imagePreviewOutputId);
    const url = this.imageUrls[this.imagePreviewOutputId];
    if (!output || !url) return null;
    return {
      title: this.imageOutputTitle(output),
      url,
    };
  }

  private imageOutputTitle(output: AiRequestStatus["outputs"][number]) {
    const text = this.getText();
    return text.generatedImage.replace("{number}", String(output.sequenceNo));
  }

  private requireCurrentUserId() {
    const userId = this.deps.getCurrentUserId();
    if (!userId) throw new Error(this.deps.getLanguage() === "zh" ? "请先登录当前工具账号。" : "Sign in first.");
    return userId;
  }

  private normalizeResourceError(error: unknown) {
    const message = this.deps.normalizeError(error);
    return message || this.getText().resourceSaveFailed;
  }

  private releaseGeneratedImageUrls() {
    this.imageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.imageObjectUrls.clear();
  }

  private releaseGeneratedImageUrl(url: string) {
    if (!this.imageObjectUrls.has(url)) return;
    URL.revokeObjectURL(url);
    this.imageObjectUrls.delete(url);
  }

  private stopImagePoll() {
    if (this.imagePoll) window.clearInterval(this.imagePoll);
    this.imagePoll = undefined;
  }
}
