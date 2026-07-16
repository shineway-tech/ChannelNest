import type {
  BillingOrderFilters,
  BillingOrderPage,
  BillingOverview,
  PaymentCheckout,
  PointLedgerFilters,
  PointLedgerPage,
} from "../../domain/types";

export type BillingView = "overview" | "membership" | "recharge";
export type BillingHistoryTab = "points" | "orders";
export type CheckoutState = ({ orderId: string } & PaymentCheckout) | null;

export const emptyPointLedgerPage = (): PointLedgerPage => ({
  items: [],
  page: 1,
  pageSize: 10,
  total: 0,
});

export const defaultPointLedgerFilters = (): PointLedgerFilters => ({
  direction: "all",
  source: "all",
  rangeDays: "all",
});

export const emptyBillingOrderPage = (): BillingOrderPage => ({
  items: [],
  page: 1,
  pageSize: 10,
  total: 0,
});

export const defaultBillingOrderFilters = (): BillingOrderFilters => ({
  orderType: "all",
  status: "all",
  rangeDays: "all",
});

export class BillingState {
  overview: BillingOverview | null = null;
  view: BillingView = "overview";
  selectedMembershipCode = "";
  selectedRechargeCode = "";
  historyTab: BillingHistoryTab = "points";
  pointLedgers = emptyPointLedgerPage();
  pointLedgerFilters = defaultPointLedgerFilters();
  pointLedgersBusy = false;
  pointLedgerRequestId = 0;
  orders = emptyBillingOrderPage();
  orderFilters = defaultBillingOrderFilters();
  ordersBusy = false;
  ordersLoaded = false;
  orderRequestId = 0;
  checkout: CheckoutState = null;
  paymentPoll?: number;

  reset() {
    this.overview = null;
    this.view = "overview";
    this.selectedMembershipCode = "";
    this.selectedRechargeCode = "";
    this.historyTab = "points";
    this.pointLedgers = emptyPointLedgerPage();
    this.pointLedgerFilters = defaultPointLedgerFilters();
    this.pointLedgersBusy = false;
    this.pointLedgerRequestId += 1;
    this.orders = emptyBillingOrderPage();
    this.orderFilters = defaultBillingOrderFilters();
    this.ordersBusy = false;
    this.ordersLoaded = false;
    this.orderRequestId += 1;
    this.checkout = null;
  }

  showOverview() {
    this.view = "overview";
    this.selectedMembershipCode = "";
    this.selectedRechargeCode = "";
  }
}
