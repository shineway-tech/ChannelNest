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
  PointLedgerItem,
  PointLedgerPage,
  TextGenerationDraft,
  UserMessage,
} from "../domain/types";
import { commerceCopy, interpolate } from "../i18n/commerce";
import { icon } from "../ui/icons";
import { escapeAttribute, escapeHtml } from "../utils/html";
import { imageOptionsForAssetType } from "../utils/image-options";
import {
  imageGenerationInProgress,
  imageResultSlots,
  type ImageReference,
  type ImageResultSlot,
} from "../utils/image-task";

type CommerceText = (typeof commerceCopy)["zh"] | (typeof commerceCopy)["en"];

export interface CommercePageState {
  page: CommercePageId;
  overview: BillingOverview | null;
  billingView: "overview" | "membership" | "recharge";
  selectedMembershipCode: string;
  selectedRechargeCode: string;
  billingHistoryTab: "points" | "orders";
  pointLedgers: PointLedgerPage;
  pointLedgerFilters: PointLedgerFilters;
  pointLedgersBusy: boolean;
  billingOrders: BillingOrderPage;
  billingOrderFilters: BillingOrderFilters;
  billingOrdersBusy: boolean;
  messages: UserMessage[];
  unreadCount: number;
  imageOptions: ImageOptions | null;
  aiMode: "text" | "image";
  busy: boolean;
  textDraft: TextGenerationDraft;
  textAdvancedOpen: boolean;
  textResult: string;
  textError: string;
  imageDraft: Record<string, string | number>;
  imagePromptOptimizing: boolean;
  referenceImages: ImageReference[];
  imageRequest: AiRequestStatus | null;
  imageError: string;
  imageUrls: Record<string, string>;
  imageLocalFileIds: string[];
  imagePreview: { title: string; url: string } | null;
  imageResourceTitleDialog: { outputId: string; title: string; error: string } | null;
  resourceSavedKeys: string[];
  checkout: ({ orderId: string } & PaymentCheckout) | null;
  language: "zh" | "en";
}

function locale(language: CommercePageState["language"]) {
  return language === "en" ? "en-US" : "zh-CN";
}

function formatMessageDate(value: string, language: CommercePageState["language"]) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(locale(language));
}

function points(micros: string | number, language: CommercePageState["language"]) {
  return (Number(micros) / 1000).toLocaleString(locale(language), { maximumFractionDigits: 3 });
}

function money(fen: number) {
  return `¥${(fen / 100).toFixed(2)}`;
}

function pageHead(title: string, action = "") {
  return `<section class="page-head"><div><h1>${title}</h1></div>${action}</section>`;
}

function billingPageHead(title: string, text: CommerceText) {
  return `
    <section class="page-head billing-page-head">
      <div>
        <button class="billing-back" type="button" data-billing-view="overview" title="${text.back}" aria-label="${text.back}">${icon("chevron")}</button>
        <h1>${title}</h1>
      </div>
    </section>`;
}

function membershipEndsAt(state: CommercePageState) {
  const endsAt = state.overview?.membership.endsAt;
  return endsAt
    ? new Date(endsAt).toLocaleDateString(locale(state.language))
    : commerceCopy[state.language].permanent;
}

function upgradePlans(overview: BillingOverview) {
  const currentRank = overview.plans.find(
    (plan) => plan.code === overview.membership.planCode,
  )?.rank || 0;
  return overview.plans
    .filter((plan) => plan.code !== "free" && plan.rank > currentRank)
    .sort((left, right) => left.rank - right.rank);
}

function selected(value: string, expected: string) {
  return value === expected ? "selected" : "";
}

function formatLedgerDate(
  value: string | null | undefined,
  language: CommercePageState["language"],
  withTime = false,
) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return withTime
    ? date.toLocaleString(locale(language))
    : date.toLocaleDateString(locale(language));
}

function ledgerSourceLabel(type: string, text: CommerceText) {
  return text.ledgerSources[type] || text.change;
}

function renderPointLedgerRow(item: PointLedgerItem, state: CommercePageState) {
  const text = commerceCopy[state.language];
  const income = item.type === "grant";
  return `
    <tr>
      <td><strong>${income ? text.pointsReceived : text.pointsSpent}</strong><span>${ledgerSourceLabel(item.businessType, text)}</span></td>
      <td class="ledger-change ${income ? "is-income" : "is-expense"}">${income ? "+" : "-"}${points(item.amountMicros, state.language)}</td>
      <td>${points(item.availableAfterMicros, state.language)}</td>
      <td>${income ? formatLedgerDate(item.expiresAt, state.language) : "-"}</td>
      <td><time>${formatLedgerDate(item.createdAt, state.language, true)}</time></td>
    </tr>`;
}

function paginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", ...Array.from({ length: 5 }, (_, index) => totalPages - 4 + index)];
  }
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

function renderPagination(
  kind: "ledger" | "order",
  currentPage: number,
  totalPages: number,
  busy: boolean,
  text: CommerceText,
) {
  if (totalPages <= 1) return "";
  const attribute = kind === "ledger" ? "data-ledger-page" : "data-order-page";
  const pages = paginationItems(currentPage, totalPages);
  return `
    <div class="ledger-pagination">
      <button type="button" ${attribute}="${currentPage - 1}" title="${text.previousPage}" aria-label="${text.previousPage}" ${currentPage <= 1 || busy ? "disabled" : ""}>${icon("chevron")}</button>
      ${pages.map((page) => page === "ellipsis"
    ? '<span class="pagination-ellipsis">…</span>'
    : `<button type="button" ${attribute}="${page}" class="${page === currentPage ? "is-active" : ""}" aria-label="${interpolate(text.pageNumber, { page })}" aria-current="${page === currentPage ? "page" : "false"}" ${busy ? "disabled" : ""}>${page}</button>`).join("")}
      <button type="button" ${attribute}="${currentPage + 1}" title="${text.nextPage}" aria-label="${text.nextPage}" ${currentPage >= totalPages || busy ? "disabled" : ""}>${icon("chevron-right")}</button>
    </div>`;
}

function renderPointLedgers(state: CommercePageState) {
  const text = commerceCopy[state.language];
  const { pointLedgers: page, pointLedgerFilters: filters } = state;
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  let tableBody = `<tr><td class="ledger-empty" colspan="5">${text.noPointRecords}</td></tr>`;
  if (state.pointLedgersBusy) {
    tableBody = `<tr><td class="ledger-empty" colspan="5">${text.loading}</td></tr>`;
  } else if (page.items.length) {
    tableBody = page.items.map((item) => renderPointLedgerRow(item, state)).join("");
  }

  return `
    <section class="point-ledger-section">
      <div class="point-ledger-head">
        <div><span>${interpolate(text.totalItems, { count: page.total })}</span></div>
        <div class="ledger-filters">
          <label><span>${text.type}</span><select data-ledger-filter="direction">
            <option value="all" ${selected(filters.direction, "all")}>${text.all}</option>
            <option value="income" ${selected(filters.direction, "income")}>${text.income}</option>
            <option value="expense" ${selected(filters.direction, "expense")}>${text.expense}</option>
          </select></label>
          <label><span>${text.source}</span><select data-ledger-filter="source">
            <option value="all" ${selected(filters.source, "all")}>${text.allSources}</option>
            <option value="signup" ${selected(filters.source, "signup")}>${text.signupGift}</option>
            <option value="membership" ${selected(filters.source, "membership")}>${text.membershipGift}</option>
            <option value="recharge" ${selected(filters.source, "recharge")}>${text.recharge}</option>
            <option value="ai_text" ${selected(filters.source, "ai_text")}>${text.aiText}</option>
            <option value="ai_image" ${selected(filters.source, "ai_image")}>${text.aiImage}</option>
          </select></label>
          <label><span>${text.time}</span><select data-ledger-filter="rangeDays">
            <option value="all" ${selected(filters.rangeDays, "all")}>${text.allTime}</option>
            <option value="7" ${selected(filters.rangeDays, "7")}>${text.last7Days}</option>
            <option value="30" ${selected(filters.rangeDays, "30")}>${text.last30Days}</option>
            <option value="90" ${selected(filters.rangeDays, "90")}>${text.last90Days}</option>
            <option value="365" ${selected(filters.rangeDays, "365")}>${text.lastYear}</option>
          </select></label>
        </div>
      </div>
      <div class="point-ledger-table-wrap ${state.pointLedgersBusy ? "is-loading" : ""}">
        <table class="point-ledger-table">
          <thead><tr><th>${text.record}</th><th>${text.change}</th><th>${text.balance}</th><th>${text.validity}</th><th>${text.time}</th></tr></thead>
          <tbody>${tableBody}</tbody>
        </table>
      </div>
      ${renderPagination("ledger", page.page, totalPages, state.pointLedgersBusy, text)}
    </section>`;
}

function orderTypeLabel(type: string, text: CommerceText) {
  return text.orderTypes[type] || text.membershipOrders;
}

function orderStatusLabel(status: string, text: CommerceText) {
  return text.orderStatuses[status] || text.loading;
}

function orderProductName(order: BillingOrder, state: CommercePageState) {
  const key = state.language === "en" ? "name_en" : "name_zh";
  const snapshotName = order.product[key];
  if (typeof snapshotName === "string" && snapshotName) return snapshotName;
  const plan = state.overview?.plans.find((item) => item.code === order.productCode);
  if (plan) return state.language === "en" ? plan.nameEn : plan.name;
  const grantMicros = order.product.grant_micros;
  if (state.language === "en" && typeof grantMicros === "string") {
    return `${points(grantMicros, state.language)} ${commerceCopy.en.points}`;
  }
  return order.productCode;
}

function renderOrderRow(order: BillingOrder, state: CommercePageState) {
  const text = commerceCopy[state.language];
  const pending = ["created", "paying"].includes(order.status);
  const expired = pending && new Date(order.expiresAt).getTime() <= Date.now();
  const displayedStatus = expired ? "expired" : order.status;
  const canContinue = pending && !expired;
  return `
    <tr>
      <td><strong>${escapeHtml(orderProductName(order, state))}</strong><span>${escapeHtml(order.orderNo)}</span></td>
      <td>${orderTypeLabel(order.orderType, text)}</td>
      <td class="order-amount">${money(order.payAmountFen)}</td>
      <td><span class="order-status is-${escapeAttribute(displayedStatus)}">${orderStatusLabel(displayedStatus, text)}</span></td>
      <td><time>${formatLedgerDate(order.createdAt, state.language, true)}</time>${order.paidAt ? `<span>${formatLedgerDate(order.paidAt, state.language, true)} ${text.paidAt}</span>` : ""}</td>
      <td>${canContinue ? `<button class="ghost-btn order-action" type="button" data-order-continue="${escapeAttribute(order.id)}" ${state.busy ? "disabled" : ""}>${text.continuePayment}</button>` : "-"}</td>
    </tr>`;
}

function renderBillingOrders(state: CommercePageState) {
  const text = commerceCopy[state.language];
  const { billingOrders: page, billingOrderFilters: filters } = state;
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  let tableBody = `<tr><td class="ledger-empty" colspan="6">${text.noOrderRecords}</td></tr>`;
  if (state.billingOrdersBusy && !page.items.length) {
    tableBody = `<tr><td class="ledger-empty" colspan="6">${text.loading}</td></tr>`;
  } else if (page.items.length) {
    tableBody = page.items.map((order) => renderOrderRow(order, state)).join("");
  }

  return `
    <section class="point-ledger-section">
      <div class="point-ledger-head">
        <div><span>${interpolate(text.totalItems, { count: page.total })}</span></div>
        <div class="ledger-filters">
          <label><span>${text.type}</span><select data-order-filter="orderType">
            <option value="all" ${selected(filters.orderType, "all")}>${text.allOrders}</option>
            <option value="membership" ${selected(filters.orderType, "membership")}>${text.membershipOrders}</option>
            <option value="recharge" ${selected(filters.orderType, "recharge")}>${text.recharge}</option>
          </select></label>
          <label><span>${text.status}</span><select data-order-filter="status">
            <option value="all" ${selected(filters.status, "all")}>${text.allStatuses}</option>
            <option value="pending" ${selected(filters.status, "pending")}>${text.pendingPayment}</option>
            <option value="paid" ${selected(filters.status, "paid")}>${text.paid}</option>
            <option value="expired" ${selected(filters.status, "expired")}>${text.expired}</option>
            <option value="closed" ${selected(filters.status, "closed")}>${text.closed}</option>
            <option value="failed" ${selected(filters.status, "failed")}>${text.paymentFailed}</option>
          </select></label>
          <label><span>${text.time}</span><select data-order-filter="rangeDays">
            <option value="all" ${selected(filters.rangeDays, "all")}>${text.allTime}</option>
            <option value="7" ${selected(filters.rangeDays, "7")}>${text.last7Days}</option>
            <option value="30" ${selected(filters.rangeDays, "30")}>${text.last30Days}</option>
            <option value="90" ${selected(filters.rangeDays, "90")}>${text.last90Days}</option>
            <option value="365" ${selected(filters.rangeDays, "365")}>${text.lastYear}</option>
          </select></label>
        </div>
      </div>
      <div class="point-ledger-table-wrap ${state.billingOrdersBusy ? "is-loading" : ""}">
        <table class="point-ledger-table order-history-table">
          <thead><tr><th>${text.order}</th><th>${text.type}</th><th>${text.amountPaid}</th><th>${text.status}</th><th>${text.time}</th><th>${text.action}</th></tr></thead>
          <tbody>${tableBody}</tbody>
        </table>
      </div>
      ${renderPagination("order", page.page, totalPages, state.billingOrdersBusy, text)}
    </section>`;
}

function renderBillingHistory(state: CommercePageState) {
  const text = commerceCopy[state.language];
  return `
    <section class="billing-history">
      <div class="billing-history-tabs" role="tablist" aria-label="${text.transactionHistory}">
        <button type="button" role="tab" data-history-tab="points" aria-selected="${state.billingHistoryTab === "points"}" class="${state.billingHistoryTab === "points" ? "is-active" : ""}">${text.pointHistory}</button>
        <button type="button" role="tab" data-history-tab="orders" aria-selected="${state.billingHistoryTab === "orders"}" class="${state.billingHistoryTab === "orders" ? "is-active" : ""}">${text.orderHistory}</button>
      </div>
      ${state.billingHistoryTab === "orders" ? renderBillingOrders(state) : renderPointLedgers(state)}
    </section>`;
}

function renderBillingOverview(state: CommercePageState, overview: BillingOverview) {
  const text = commerceCopy[state.language];
  const currentPlan = overview.plans.find((plan) => plan.code === overview.membership.planCode);
  const current = currentPlan
    ? (state.language === "en" ? currentPlan.nameEn : currentPlan.name)
    : overview.membership.planCode;
  const discount = (overview.entitlements.plan?.rechargeDiscountBps || 10000) / 100;
  const nextExpiry = overview.wallet.expiring[0];
  const canUpgrade = upgradePlans(overview).length > 0;

  return `
    ${pageHead(text.membershipAndPoints)}
    <section class="billing-summary">
      <div class="billing-summary-item">
        <div class="billing-overview-icon">${icon("crown")}</div>
        <div class="billing-overview-copy">
          <span>${text.currentMembership}</span>
          <strong>${escapeHtml(current)}</strong>
          <small>${interpolate(text.validUntil, { date: membershipEndsAt(state) })}</small>
        </div>
        ${canUpgrade ? `<button class="primary-btn" type="button" data-billing-view="membership">${text.upgrade}</button>` : ""}
      </div>
      <div class="billing-summary-item">
        <div class="billing-overview-icon">${icon("wallet")}</div>
        <div class="billing-overview-copy">
          <span>${text.availablePoints}</span>
          <strong>${escapeHtml(overview.wallet.availablePoints)}</strong>
          <small>${nextExpiry
    ? interpolate(text.pointsExpire, {
      points: points(nextExpiry.amountMicros, state.language),
      date: formatLedgerDate(nextExpiry.expiresAt, state.language),
    })
    : interpolate(text.rechargeDiscount, { discount })}</small>
        </div>
        <button class="primary-btn" type="button" data-billing-view="recharge">${text.rechargePoints}</button>
      </div>
    </section>
    ${renderBillingHistory(state)}
    ${renderCheckout(state)}
  `;
}

function renderMembershipOptions(state: CommercePageState, overview: BillingOverview) {
  const text = commerceCopy[state.language];
  const plans = upgradePlans(overview);
  const selected = plans.find((plan) => plan.code === state.selectedMembershipCode);

  return `
    ${billingPageHead(text.upgradeMembership, text)}
    <form class="billing-options-form" data-billing-purchase="membership">
      <div class="plan-grid" role="radiogroup" aria-label="${text.membershipPlans}">
        ${plans.map((plan) => `
          <label class="plan-card billing-choice ${state.selectedMembershipCode === plan.code ? "is-selected" : ""}">
            <input type="radio" name="productCode" value="${escapeAttribute(plan.code)}" data-membership-option ${state.selectedMembershipCode === plan.code ? "checked" : ""} />
            <div class="plan-card-head"><h2>${escapeHtml(state.language === "en" ? plan.nameEn : plan.name)}</h2></div>
            <div class="plan-price"><strong>${money(plan.priceFen)}</strong><span>/ ${plan.cycleDays} ${text.days}</span></div>
            <dl>
              <div><dt>${text.monthlyGrant}</dt><dd>${points(plan.grantMicros, state.language)} ${text.points}</dd></div>
              <div><dt>${text.rechargeDiscount.replace(" {discount}%", "")}</dt><dd>${(plan.rechargeDiscountBps / 100).toFixed(0)}%</dd></div>
              <div><dt>${text.imageQuality}</dt><dd>${plan.code === "professional" ? "1K / 2K / 4K" : plan.code === "advanced" ? "1K / 2K" : "1K"}</dd></div>
            </dl>
            <span class="choice-indicator">${icon("check")}</span>
          </label>`).join("")}
      </div>
      <div class="billing-purchase-bar">
        <div><span>${text.selectedPlan}</span><strong>${selected ? `${escapeHtml(state.language === "en" ? selected.nameEn : selected.name)} · ${money(selected.priceFen)}` : text.selectMembershipPlan}</strong></div>
        <button class="primary-btn" type="submit" ${selected && !state.busy ? "" : "disabled"}>${state.busy ? text.creatingOrder : text.confirmUpgrade}</button>
      </div>
    </form>
    ${renderCheckout(state)}
  `;
}

function renderRechargeOptions(state: CommercePageState, overview: BillingOverview) {
  const text = commerceCopy[state.language];
  const selected = overview.rechargePackages.find((item) => item.productCode === state.selectedRechargeCode);
  const discount = (overview.entitlements.plan?.rechargeDiscountBps || 10000) / 100;

  return `
    ${billingPageHead(text.rechargePoints, text)}
    <form class="billing-options-form" data-billing-purchase="recharge">
      <div class="commerce-section-head"><h2>${text.selectRechargePoints}</h2><span>${interpolate(text.currentRechargeDiscount, { discount })}</span></div>
      <div class="recharge-grid" role="radiogroup" aria-label="${text.rechargePlans}">
        ${overview.rechargePackages.map((item) => `
          <label class="recharge-card billing-choice ${state.selectedRechargeCode === item.productCode ? "is-selected" : ""}">
            <input type="radio" name="productCode" value="${escapeAttribute(item.productCode)}" data-recharge-option ${state.selectedRechargeCode === item.productCode ? "checked" : ""} />
            <div><strong>${points(item.pointsMicros, state.language)}</strong><span>${text.points}</span></div>
            <p>${item.payAmountFen === item.listAmountFen ? "" : `<del>${money(item.listAmountFen)}</del>`}<b>${money(item.payAmountFen)}</b></p>
            <span class="choice-indicator">${icon("check")}</span>
          </label>`).join("")}
      </div>
      <div class="billing-purchase-bar">
        <div><span>${text.rechargeAmount}</span><strong>${selected ? `${points(selected.pointsMicros, state.language)} ${text.points} · ${money(selected.payAmountFen)}` : text.selectRechargePlan}</strong></div>
        <button class="primary-btn" type="submit" ${selected && !state.busy ? "" : "disabled"}>${state.busy ? text.creatingOrder : text.confirmRecharge}</button>
      </div>
    </form>
    ${renderCheckout(state)}
  `;
}

function renderMembership(state: CommercePageState) {
  const text = commerceCopy[state.language];
  const overview = state.overview;
  if (!overview) return `${pageHead(text.membershipAndPoints)}<div class="commerce-loading">${icon("refresh")}</div>`;
  if (state.billingView === "membership") return renderMembershipOptions(state, overview);
  if (state.billingView === "recharge") return renderRechargeOptions(state, overview);
  return renderBillingOverview(state, overview);
}

function renderMessages(state: CommercePageState) {
  const text = commerceCopy[state.language];
  return `
    ${pageHead(text.messageCenter, `<button class="ghost-btn" type="button" data-message-read-all ${state.unreadCount ? "" : "disabled"}>${icon("check")}${text.markAllRead}</button>`)}
    <section class="message-list">
      ${state.messages.length ? state.messages.map((message) => `
        <button class="message-row ${message.readAt ? "" : "is-unread"}" type="button" data-message-read="${message.id}">
          <span class="message-unread-dot" aria-hidden="true"></span>
          <span class="message-copy"><strong>${escapeHtml(message.title)}</strong><span>${escapeHtml(message.body)}</span></span>
          <time>${formatMessageDate(message.createdAt, state.language)}</time>
        </button>`).join("") : `<div class="empty-commerce">${text.noMessages}</div>`}
    </section>
  `;
}

function optionList(
  items: Array<{ code: string; name: string; nameEn: string }>,
  selected: string,
  language: CommercePageState["language"],
) {
  return items.map((item) => `<option value="${escapeAttribute(item.code)}" ${selected === item.code ? "selected" : ""}>${escapeHtml(language === "en" ? item.nameEn : item.name)}</option>`).join("");
}

function mappedOptions(items: Record<string, string>, selectedValue: string) {
  return Object.entries(items).map(([value, label]) => (
    `<option value="${escapeAttribute(value)}" ${selectedValue === value ? "selected" : ""}>${escapeHtml(label)}</option>`
  )).join("");
}

function paletteGradient(colors: string[]) {
  const safeColors = colors.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 4);
  return safeColors.length
    ? `linear-gradient(135deg, ${safeColors.join(", ")})`
    : "var(--panel)";
}

function renderAi(state: CommercePageState) {
  const text = commerceCopy[state.language];
  return `
    ${pageHead(text.contentGeneration)}
    <div class="ai-mode-tabs" role="tablist">
      <button class="${state.aiMode === "text" ? "active" : ""}" type="button" data-ai-mode="text">${text.text}</button>
      <button class="${state.aiMode === "image" ? "active" : ""}" type="button" data-ai-mode="image">${text.image}</button>
    </div>
    ${state.aiMode === "text" ? renderAiText(state) : renderAiImage(state)}
    ${renderImagePreview(state)}
    ${renderImageResourceTitleDialog(state)}
  `;
}

function renderAiText(state: CommercePageState) {
  const text = commerceCopy[state.language];
  const draft = state.textDraft;
  const result = state.textResult
    ? `<div class="ai-text-content ${state.busy ? "is-streaming" : ""}" data-ai-text-content>${escapeHtml(state.textResult)}</div>`
    : state.busy && !state.textError ? `<div class="ai-stream-waiting">${text.generating}</div>` : "";
  const error = state.textError
    ? `<div class="ai-result-error" role="alert">${icon("help")}<span>${escapeHtml(state.textError)}</span></div>`
    : "";

  return `
    <section class="ai-workbench ai-text-workbench">
      <form class="ai-input-pane" data-ai-text-form>
        <div class="ai-control-grid ai-text-control-grid">
          <label><span>${text.task}</span><select name="taskType">${mappedOptions(text.textTasks, draft.taskType)}</select></label>
          <label><span>${text.platform}</span><select name="platform">${mappedOptions(text.textPlatforms, draft.platform)}</select></label>
          <label><span>${text.tone}</span><select name="tone">${mappedOptions(text.textTones, draft.tone)}</select></label>
          <label><span>${text.contentLength}</span><select name="lengthMode" data-ai-length-mode>${mappedOptions(text.textLengths, draft.lengthMode)}</select></label>
          <label class="ai-field-wide" data-ai-target-length ${draft.lengthMode === "custom" ? "" : "hidden"}><span>${text.customLength}</span><input name="targetLength" type="number" min="50" max="2000" value="${escapeAttribute(draft.targetLength)}" placeholder="${text.customLengthPlaceholder}" /></label>
          <label class="ai-field-wide"><span>${text.audience}</span><input name="audience" maxlength="200" value="${escapeAttribute(draft.audience)}" placeholder="${escapeAttribute(text.audiencePlaceholder)}" /></label>
        </div>
        <label class="ai-prompt"><span>${text.content}</span><div class="ai-textarea-shell"><textarea name="input" maxlength="2000" required data-ai-text-input placeholder="${escapeAttribute(text.contentPlaceholder)}">${escapeHtml(draft.input)}</textarea><output class="ai-character-count" data-ai-text-count>${draft.input.length} / 2000</output></div></label>
        <details class="ai-advanced-settings" data-ai-advanced ${state.textAdvancedOpen ? "open" : ""}>
          <summary>${text.advancedSettings}${icon("chevron-right")}</summary>
          <div class="ai-advanced-content">
            <div class="ai-control-grid">
              <label><span>${text.goal}</span><select name="goal">${mappedOptions(text.textGoals, draft.goal)}</select></label>
              <label><span>${text.structure}</span><select name="structure">${mappedOptions(text.textStructures, draft.structure)}</select></label>
              <label><span>${text.callToAction}</span><select name="cta" data-ai-cta>${mappedOptions(text.textCtas, draft.cta)}</select></label>
            </div>
            <label data-ai-custom-cta ${draft.cta === "custom" ? "" : "hidden"}><span>${text.customCta}</span><input name="ctaText" maxlength="120" value="${escapeAttribute(draft.ctaText)}" placeholder="${escapeAttribute(text.customCtaPlaceholder)}" /></label>
            <label class="ai-supporting-text"><span>${text.keyPoints}</span><textarea name="keyPoints" maxlength="600" placeholder="${escapeAttribute(text.keyPointsPlaceholder)}">${escapeHtml(draft.keyPoints)}</textarea></label>
            <label><span>${text.forbiddenContent}</span><textarea name="forbiddenContent" maxlength="300" placeholder="${escapeAttribute(text.forbiddenContentPlaceholder)}">${escapeHtml(draft.forbiddenContent)}</textarea></label>
          </div>
        </details>
        <div class="ai-submit-row"><span>${text.pointsPerRequest}</span><button class="primary-btn" type="submit" ${state.busy ? "disabled" : ""}>${icon(state.busy ? "refresh" : "spark")}${state.busy ? text.generating : text.generate}</button></div>
      </form>
      <section class="ai-output-pane"><div class="ai-output-head"><h2>${text.generationResult}</h2>${state.textResult && !state.busy ? `<span class="ai-output-actions"><button class="ghost-btn" type="button" data-copy-ai>${icon("copy")}${text.copy}</button><button class="ghost-btn" type="button" data-ai-save-text-resource ${state.resourceSavedKeys.includes("text") ? "disabled" : ""}>${icon("folder")}${state.resourceSavedKeys.includes("text") ? text.addedToResourceLibrary : text.addToResourceLibrary}</button></span>` : ""}</div><div class="ai-text-result" data-ai-text-result aria-live="polite">${result}${error}</div></section>
    </section>
  `;
}

function renderImageResultSlot(
  slot: ImageResultSlot,
  state: CommercePageState,
  text: CommerceText,
) {
  const title = interpolate(text.generatedImage, { number: slot.sequenceNo });
  const url = slot.output ? state.imageUrls[slot.output.id] : "";
  if (slot.output && url) {
    const imageKey = `image:${slot.output.id}`;
    const localReady = state.imageLocalFileIds.includes(slot.output.id);
    const saved = state.resourceSavedKeys.includes(imageKey);
    return `
      <figure class="ai-image-slot is-ready">
        <button class="ai-image-preview-trigger" type="button" data-ai-preview-image="${escapeAttribute(slot.output.id)}" aria-label="${escapeAttribute(text.previewImage)}" title="${escapeAttribute(text.previewImage)}">
          <img src="${escapeAttribute(url)}" alt="${escapeAttribute(title)}" />
        </button>
        <span class="ai-image-actions">
          <button class="ghost-btn" type="button" data-ai-download-image="${escapeAttribute(slot.output.id)}" ${!localReady ? "disabled" : ""}>${icon("download")}${text.save}</button>
          <button class="ghost-btn" type="button" data-ai-save-image-resource="${escapeAttribute(slot.output.id)}" ${!localReady || saved ? "disabled" : ""}>${icon("folder")}${saved ? text.addedToResourceLibrary : text.addToResourceLibrary}</button>
        </span>
      </figure>
    `;
  }

  const taskActive = imageGenerationInProgress(false, state.imageRequest?.status);
  const status = slot.status === "failed" || (slot.output && !url && !taskActive)
    ? "failed"
    : "processing";
  const label = status === "failed"
    ? text.imageStatuses.failed
    : text.imageStatuses.processing;

  return `
    <figure class="ai-image-slot is-${status}">
      <div class="ai-image-slot-placeholder">
        ${icon(status === "failed" ? "help" : "refresh")}
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>
    </figure>
  `;
}

function renderAiImage(state: CommercePageState) {
  const text = commerceCopy[state.language];
  const options = state.imageOptions;
  if (!options) return `<div class="commerce-loading">${icon("refresh")}</div>`;
  const draft = state.imageDraft;
  const assetScopedOptions = imageOptionsForAssetType(options, String(draft.assetType));
  const selectedPalette = options.palettes.find((item) => item.code === draft.palette)
    || options.palettes[0];
  const imageGenerating = imageGenerationInProgress(state.busy, state.imageRequest?.status);
  const visibleCompleted = state.imageRequest
    ? Math.max(state.imageRequest.successCount, state.imageRequest.outputs.length)
    : 0;
  const taskMeta = state.imageRequest
    ? `<div class="ai-output-meta"><span>${interpolate(text.imageTask, { status: text.imageStatuses[state.imageRequest.status] || state.imageRequest.status })}</span><span>${visibleCompleted} / ${state.imageRequest.requestedCount}</span></div>`
    : "";
  const error = state.imageError
    ? `<div class="ai-result-error" role="alert">${icon("help")}<span>${escapeHtml(state.imageError)}</span></div>`
    : "";
  const slots = imageResultSlots(state.imageRequest);

  return `
    <section class="ai-workbench ai-image-workbench">
      <form class="ai-input-pane" data-ai-image-form>
        <div class="ai-control-grid">
          <label><span>${text.imageType}</span><select name="assetType" data-ai-asset-type>${options.assetTypes.map((item) => `<option value="${item.code}" ${draft.assetType === item.code ? "selected" : ""}>${escapeHtml(state.language === "en" ? item.nameEn : item.name)}</option>`).join("")}</select></label>
          <label><span>${text.resolution}</span><select name="resolution">${options.resolutions.map((item) => `<option value="${item.code}" ${draft.resolution === item.code ? "selected" : ""} ${item.allowed ? "" : "disabled"}>${item.code.toUpperCase()} · ${points(item.priceMicros, state.language)} ${text.pointsPerImage}${item.allowed ? "" : ` · ${text.upgradeRequired}`}</option>`).join("")}</select></label>
          <label><span>${text.aspectRatio}</span><select name="aspectRatio">${optionList(options.aspectRatios, String(draft.aspectRatio), state.language)}</select></label>
          <label><span>${text.count}</span><input name="count" type="number" min="1" max="${options.limits.maxCount}" value="${draft.count}" /></label>
          <label><span>${text.style}</span><select name="style">${optionList(assetScopedOptions.styles, String(draft.style), state.language)}</select></label>
          <label><span>${text.layout}</span><select name="layout">${optionList(assetScopedOptions.layouts, String(draft.layout), state.language)}</select></label>
          <fieldset class="ai-palette-field">
            <legend><span>${text.palette}</span><output data-ai-palette-name>${escapeHtml(state.language === "en" ? selectedPalette.nameEn : selectedPalette.name)}</output></legend>
            <div class="ai-palette-swatches">
              ${options.palettes.map((item) => {
    const name = state.language === "en" ? item.nameEn : item.name;
    return `<label class="ai-palette-choice" title="${escapeAttribute(name)}"><input type="radio" name="palette" value="${escapeAttribute(item.code)}" data-ai-palette-option data-palette-name="${escapeAttribute(name)}" ${draft.palette === item.code ? "checked" : ""} /><span style="background:${escapeAttribute(paletteGradient(item.colors))}" aria-hidden="true"></span></label>`;
  }).join("")}
            </div>
          </fieldset>
          <label><span>${text.preset}</span><select name="preset">${optionList(assetScopedOptions.presets, String(draft.preset), state.language)}</select></label>
        </div>
        <div class="ai-prompt">
          <div class="ai-prompt-head">
            <label for="ai-image-prompt">${text.imageContent}</label>
            <span class="ai-prompt-tools">
              <button class="ghost-btn ai-optimize-btn ${state.imagePromptOptimizing ? "is-loading" : ""}" type="button" data-ai-optimize-image-prompt ${imageGenerating || state.imagePromptOptimizing ? "disabled" : ""}>${icon(state.imagePromptOptimizing ? "refresh" : "spark")}${state.imagePromptOptimizing ? text.optimizingPrompt : text.optimizePrompt}</button>
              <small>${text.imagePromptOptimizeCost}</small>
            </span>
          </div>
          <textarea id="ai-image-prompt" name="prompt" maxlength="2000" required ${state.imagePromptOptimizing ? "readonly" : ""}>${escapeHtml(String(draft.prompt))}</textarea>
        </div>
        <div class="reference-section">
          <div class="reference-row">
            <label class="ghost-btn reference-upload">${icon("plus")}${text.referenceImage}<input type="file" accept="image/jpeg,image/png" multiple data-ai-references /></label>
            <label class="reference-mode"><span>${text.referenceMode}</span><select name="referenceMode">${Object.entries(text.referenceModes).map(([code, name]) => `<option value="${escapeAttribute(code)}" ${draft.referenceMode === code ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>
            <span class="reference-status">${state.referenceImages.length ? interpolate(text.referencesAdded, { count: state.referenceImages.length }) : text.noReferences}</span>
          </div>
          ${state.referenceImages.length ? `<div class="reference-previews">${state.referenceImages.map((reference, index) => {
    const alt = interpolate(text.referenceImageNumber, { number: index + 1 });
    return `<figure class="reference-preview"><img src="${escapeAttribute(reference.url)}" alt="${escapeAttribute(alt)}" title="${escapeAttribute(reference.name)}" /><button type="button" data-remove-reference="${escapeAttribute(reference.id)}" title="${escapeAttribute(text.removeReference)}" aria-label="${escapeAttribute(text.removeReference)}" ${state.busy ? "disabled" : ""}>${icon("x")}</button></figure>`;
  }).join("")}</div>` : ""}
        </div>
        <div class="ai-submit-row ai-submit-row-actions"><button class="primary-btn" type="submit" ${imageGenerating ? "disabled" : ""}>${icon(imageGenerating ? "refresh" : "spark")}${imageGenerating ? text.generating : text.generateImages}</button></div>
      </form>
      <section class="ai-output-pane"><div class="ai-output-head"><h2>${text.generationResult}</h2>${taskMeta}</div>
        <div class="ai-image-results">${error}${slots.map((slot) => renderImageResultSlot(slot, state, text)).join("")}</div>
      </section>
    </section>
  `;
}

function renderImagePreview(state: CommercePageState) {
  if (!state.imagePreview) return "";
  const text = commerceCopy[state.language];
  return `
    <div class="modal-backdrop" data-image-preview-backdrop>
      <section class="image-preview-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttribute(text.previewImage)}">
        <div class="checkout-head"><h2>${escapeHtml(state.imagePreview.title)}</h2><button type="button" data-close-image-preview title="${escapeAttribute(text.close)}" aria-label="${escapeAttribute(text.close)}">${icon("x")}</button></div>
        <div class="image-preview-frame">
          <img src="${escapeAttribute(state.imagePreview.url)}" alt="${escapeAttribute(state.imagePreview.title)}" />
        </div>
      </section>
    </div>
  `;
}

function renderImageResourceTitleDialog(state: CommercePageState) {
  const dialog = state.imageResourceTitleDialog;
  if (!dialog) return "";
  const text = commerceCopy[state.language];
  return `
    <div class="modal-backdrop" data-image-resource-title-backdrop>
      <section class="resource-title-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-title-heading">
        <div class="checkout-head"><h2 id="resource-title-heading">${text.editResourceTitle}</h2><button type="button" data-close-image-resource-title title="${escapeAttribute(text.close)}" aria-label="${escapeAttribute(text.close)}">${icon("x")}</button></div>
        <form data-image-resource-title-form="${escapeAttribute(dialog.outputId)}">
          <label><span>${text.resourceTitle}</span><input name="resourceTitle" maxlength="60" required value="${escapeAttribute(dialog.title)}" placeholder="${escapeAttribute(text.resourceTitlePlaceholder)}" autocomplete="off" /></label>
          ${dialog.error ? `<p class="resource-title-error" role="alert">${escapeHtml(dialog.error)}</p>` : ""}
          <div class="resource-title-actions">
            <button class="ghost-btn" type="button" data-close-image-resource-title>${text.close}</button>
            <button class="primary-btn" type="submit">${icon("folder")}${text.confirmSaveResource}</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderCheckout(state: CommercePageState) {
  if (!state.checkout) return "";
  const text = commerceCopy[state.language];
  let checkoutUrl = "";
  try {
    const parsed = new URL(state.checkout.checkoutValue);
    const trustedHosts = new Set(["openapi.alipay.com", "openapi-sandbox.dl.alipaydev.com"]);
    if (parsed.protocol === "https:" && trustedHosts.has(parsed.hostname)) {
      checkoutUrl = parsed.toString();
    }
  } catch {
    checkoutUrl = "";
  }
  return `
    <div class="modal-backdrop">
      <section class="checkout-dialog" role="dialog" aria-modal="true">
        <div class="checkout-head"><h2>${text.alipayCheckout}</h2><button type="button" data-close-checkout title="${text.close}">${icon("x")}</button></div>
        ${checkoutUrl
    ? `<div class="checkout-frame-shell"><iframe class="checkout-frame" data-checkout-frame src="${escapeAttribute(checkoutUrl)}" title="${text.alipayCheckout}" referrerpolicy="no-referrer" scrolling="no"></iframe></div>`
    : `<div class="checkout-error">${text.invalidCheckout}</div>`}
        <div class="checkout-status"><span class="status-pulse"></span>${text.waitingForPayment}</div>
      </section>
    </div>
  `;
}

export function renderCommercePage(state: CommercePageState) {
  if (state.page === "membership") return renderMembership(state);
  if (state.page === "messages") return renderMessages(state);
  return renderAi(state);
}
