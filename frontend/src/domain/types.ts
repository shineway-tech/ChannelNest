export type AuthMode = "creator" | "oAuth";
export type AccountStatus = "active" | "expired" | "pending";
export type UserMenuPageId =
  | "settings"
  | "releases"
  | "feedback";
export type CommercePageId = "membership" | "messages" | "ai";
export type AppPageId = "channels" | "publish" | CommercePageId | UserMenuPageId;
export type MenuId = AppPageId | "profile" | "password";
export type LanguageMode = "zh" | "en";
export type ThemeMode = "dark" | "light";
export type LoginTarget = "home" | "creator";
export type AuthViewMode = "login" | "register" | "reset";
export type UpdateStatus = "idle" | "checking" | "latest" | "available" | "downloading" | "installed" | "error";

export interface ApiResponse<T> {
  err_code: number;
  err_msg: string;
  data: T;
}

export interface AuthUser {
  id: string;
  account: string;
  email?: string | null;
  emailVerified?: boolean;
  needsEmailBinding?: boolean;
  nickname: string;
  status: string;
  lastLoginAt?: string | null;
}

export interface WalletSummary {
  availableMicros: string;
  frozenMicros: string;
  availablePoints: string;
  expiring: Array<{ amountMicros: string; expiresAt: string }>;
}

export interface MembershipPlanSummary {
  code: string;
  name: string;
  nameEn: string;
  rank: number;
  cycleDays: number;
  priceFen: number;
  grantMicros: string;
  rechargeDiscountBps: number;
}

export interface RechargePackageSummary {
  productCode: string;
  name: string;
  nameEn: string;
  pointsMicros: string;
  listAmountFen: number;
  payAmountFen: number;
}

export interface BillingOverview {
  wallet: WalletSummary;
  membership: {
    planCode: string;
    status: string;
    startsAt?: string | null;
    endsAt?: string | null;
  };
  plans: MembershipPlanSummary[];
  rechargePackages: RechargePackageSummary[];
  entitlements: {
    plan?: { name: string; code: string; rechargeDiscountBps: number } | null;
    maxImageResolution: string | null;
    premiumFeatures: boolean;
    capabilities: Record<string, { allowed: boolean; reason: string | null }>;
  };
}

export interface PointLedgerItem {
  id: string;
  type: "grant" | "consume";
  businessType: string;
  amountMicros: string;
  availableDeltaMicros: string;
  availableAfterMicros: string;
  expiresAt?: string | null;
  createdAt: string;
}

export interface PointLedgerPage {
  items: PointLedgerItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PointLedgerFilters {
  direction: "all" | "income" | "expense";
  source: "all" | "signup" | "membership" | "recharge" | "ai_text" | "ai_image";
  rangeDays: "all" | "7" | "30" | "90" | "365";
}

export interface BillingOrder {
  id: string;
  orderNo: string;
  orderType: string;
  productCode: string;
  product: Record<string, unknown>;
  listAmountFen: number;
  discountBps: number;
  payAmountFen: number;
  currency: string;
  status: string;
  expiresAt: string;
  paidAt?: string | null;
  createdAt: string;
}

export interface BillingOrderPage {
  items: BillingOrder[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BillingOrderFilters {
  orderType: "all" | "membership" | "recharge";
  status: "all" | "pending" | "paid" | "expired" | "closed" | "failed";
  rangeDays: "all" | "7" | "30" | "90" | "365";
}

export interface PaymentCheckout {
  attemptId: string;
  checkoutType: "qr_code" | "checkout_url";
  checkoutValue: string;
  expiresAt: string;
}

export interface UserMessage {
  id: string;
  category: string;
  level: string;
  templateCode: string;
  title: string;
  body: string;
  actionCode?: string | null;
  actionRefId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface TextGenerationDraft {
  taskType: string;
  platform: string;
  goal: string;
  audience: string;
  tone: string;
  structure: string;
  lengthMode: string;
  targetLength: string;
  input: string;
  keyPoints: string;
  cta: string;
  ctaText: string;
  forbiddenContent: string;
}

export interface ImageOptionItem {
  code: string;
  name: string;
  nameEn: string;
}

export interface ImageAssetTypeOption extends ImageOptionItem {
  defaultAspectRatio: string;
  styleCodes?: string[];
  layoutCodes?: string[];
  presetCodes?: string[];
}

export interface ImageOptions {
  assetTypes: ImageAssetTypeOption[];
  styles: ImageOptionItem[];
  layouts: ImageOptionItem[];
  palettes: Array<{ code: string; name: string; nameEn: string; colors: string[] }>;
  presets: ImageOptionItem[];
  aspectRatios: ImageOptionItem[];
  resolutions: Array<{ code: string; priceMicros: string; allowed: boolean }>;
  limits: { maxCount: number; maxReferenceImages: number };
}

export interface AiRequestStatus {
  requestId: string;
  status: "pending" | "processing" | "succeeded" | "partial" | "failed";
  errorCode?: string | null;
  resolution: string;
  requestedCount: number;
  successCount: number;
  failedCount: number;
  chargedMicros: string;
  outputs: Array<{
    id: string;
    sequenceNo: number;
    width: number;
    height: number;
    byteSize: string;
    downloadUrl?: string | null;
  }>;
}

export type LocalResourceType = "copy" | "image" | "video";
export type LocalResourceSource = "ai" | "import" | "manual";

export interface LocalResource {
  id: string;
  userId: string;
  type: LocalResourceType;
  title: string;
  body?: string | null;
  path?: string | null;
  thumbnailPath?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  source: LocalResourceSource;
  aiRequestId?: string | null;
  aiOutputId?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CaptchaResponse {
  captchaId: string;
  image: string;
  expiresAt: string;
}

export interface AuthSession {
  token: string;
  tokenName: string;
  expiresIn: number;
  user: AuthUser;
}

export interface PlatformInfo {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string;
}

export interface PlatformAuthSettings {
  platformId: string;
  mode: AuthMode;
  authUrl: string;
  tokenUrl: string;
  profileUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export interface AuthSettings {
  platforms: PlatformAuthSettings[];
}

export interface ChannelAccount {
  id: string;
  userId?: string;
  platformId: string;
  uid: string;
  nickname: string;
  avatar: string;
  followers?: number | null;
  following?: number | null;
  likes?: number | null;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string | null;
}

export interface Bootstrap {
  platforms: PlatformInfo[];
  accounts: ChannelAccount[];
  settings: AuthSettings;
  callbackBaseUrl?: string | null;
}

export interface StartLoginResponse {
  taskId: string;
  url: string;
  callbackUrl: string;
  mode: AuthMode;
  authType?: string;
  sessionId?: string | null;
  expiresAt?: string | null;
  instructions?: string | null;
}

export interface AuthTaskStatus {
  taskId: string;
  status: "pending" | "success" | "failed" | "unknown";
  account?: ChannelAccount | null;
  message?: string | null;
}

export interface UpdateState {
  status: UpdateStatus;
  availableVersion?: string;
  notes?: string;
  downloadedBytes: number;
  contentLength?: number;
  error?: string;
}
