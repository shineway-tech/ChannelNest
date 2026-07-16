import type { AuthUser, CommercePageId, LanguageMode, MenuId, ThemeMode } from "../domain/types";
import { releaseHistoryForLanguage } from "../domain/releases";
import { copy } from "../i18n/copy";
import { renderReleasesPage } from "../pages/releases";
import {
  requestApi,
  requestApiBlob,
  requestApiStream,
  type ApiRequestOptions,
  type ApiStreamRequestOptions,
} from "../services/api";
import { renderAccountDropdown } from "../ui/user-menu";
import { normalizeError as normalizeErrorMessage } from "../utils/errors";
import { readStoredMode } from "../utils/storage";
import { API_BASE_URL, AUTH_TOKEN_KEY } from "../config/app";
import { PublishController } from "../features/publish-controller";
import { UpdateController } from "../features/updater";
import { AuthController } from "./auth-controller";
import { ChannelController } from "./channel-controller";
import { CommerceController } from "./commerce-controller";
import { SettingsController } from "./settings-controller";
import { renderAppShell } from "./shell";

let language: LanguageMode = readStoredMode("channel-nest-language", "zh", ["zh", "en"]);
let theme: ThemeMode = readStoredMode("channel-nest-theme", "dark", ["dark", "light"]);
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
let currentUser: AuthUser | null = null;
let activeMenuId: MenuId = "channels";
let userMenuOpen = false;
let toastTimer: number | undefined;
let appRoot: HTMLDivElement;

const channelController = new ChannelController({
  getText: () => copy[language],
  getLanguage: () => language,
  getCurrentUserId: () => currentUser?.id || "",
  activateChannels: () => {
    activeMenuId = "channels";
    userMenuOpen = false;
  },
  render: () => render(),
  renderPreservingWorkspaceScroll: () => renderPreservingWorkspaceScroll(),
  showToast: (message) => showToast(message),
  normalizeError: (error) => normalizeError(error),
});

const updates = new UpdateController({
  getText: () => copy[language],
  getFallbackError: () => (language === "zh" ? "操作失败，请稍后重试。" : "Operation failed. Please try again."),
  canAutoCheck: () => Boolean(currentUser),
  render: () => render(),
  showToast: (message) => showToast(message),
});

const publishController = new PublishController({
  getAccounts: () => channelController.getAccounts(),
  getPlatforms: () => channelController.getPlatforms(),
  getLanguage: () => language,
  getText: () => copy[language],
  getCurrentUserId: () => currentUser?.id || "",
  getSelectedAccountId: () => channelController.getSelectedAccountId(),
  render: () => render(),
  renderPreservingPublishScroll: () => renderPreservingPublishScroll(),
  showToast: (message) => showToast(message),
});

const commerceController = new CommerceController({
  apiRequest,
  apiStreamRequest,
  apiRequestBlob: (path) => requestApiBlob(API_BASE_URL, path, authToken),
  getLanguage: () => language,
  getCurrentUserId: () => currentUser?.id || "",
  render: () => render(),
  renderPreservingScroll: () => renderPreservingElementScroll(
    ".main, .ai-input-pane, .ai-output-pane",
  ),
  showToast: (message) => showToast(message),
  normalizeError: (error) => normalizeError(error),
});

const settingsController = new SettingsController({
  getText: () => copy[language],
  getLanguage: () => language,
  setLanguage: (value) => {
    language = value;
  },
  getTheme: () => theme,
  setTheme: (value) => {
    theme = value;
  },
  getCurrentUser: () => currentUser,
  setCurrentUser: (user) => {
    currentUser = user;
  },
  apiRequest,
  render: () => render(),
  showToast: (message) => showToast(message),
  normalizeError: (error) => normalizeError(error),
});

const authController = new AuthController({
  getText: () => copy[language],
  getTheme: () => theme,
  apiRequest,
  onAuthenticated: async (session) => {
    authToken = session.token;
    currentUser = session.user;
    settingsController.setCurrentUser(session.user);
    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    await channelController.loadClientData();
    await commerceController.loadInitial();
  },
  render: () => render(),
  showToast: (message) => showToast(message),
  normalizeError: (error) => normalizeError(error),
});

export async function startApp() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("App root missing");

  appRoot = app;
  appRoot.addEventListener("click", handleRootClick);
  await channelController.bindAccountEvents();
  await boot();
}

async function boot() {
  if (authToken) {
    try {
      currentUser = await apiRequest<AuthUser>("/v1/auth/me");
      settingsController.setCurrentUser(currentUser);
      await channelController.loadClientData();
      await commerceController.loadInitial();
      render();
      return;
    } catch {
      authToken = "";
      currentUser = null;
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  }
  await authController.loadCaptcha();
  render();
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return requestApi<T>(API_BASE_URL, path, {
    ...options,
    token: authToken,
    onUnauthorized: () => {
      authToken = "";
      currentUser = null;
      localStorage.removeItem(AUTH_TOKEN_KEY);
    },
  });
}

async function apiStreamRequest<T>(path: string, options: ApiStreamRequestOptions): Promise<T> {
  return requestApiStream<T>(API_BASE_URL, path, {
    ...options,
    token: authToken,
    onUnauthorized: () => {
      authToken = "";
      currentUser = null;
      localStorage.removeItem(AUTH_TOKEN_KEY);
    },
  });
}

function render() {
  if (!currentUser) {
    appRoot.innerHTML = authController.renderPage();
    authController.bindEvents();
    return;
  }

  appRoot.innerHTML = renderAppShell({
    theme,
    currentUser,
    activeMenuId,
    accountManagementLabel: copy[language].accountManagement,
    publishLabel: language === "zh" ? "发布" : "Publish",
    membershipLabel: language === "zh" ? "会员与积分" : "Membership & Points",
    messagesLabel: language === "zh" ? "消息" : "Messages",
    aiLabel: language === "zh" ? "内容生成" : "Content Generation",
    unreadCount: commerceController.getUnreadCount(),
    userMenuOpen,
    mainContent: renderMainContent(),
    accountDropdown: renderAccountDropdown({
      text: copy[language],
      user: currentUser,
      hasUpdate: updates.state.status === "available",
    }),
    authDialog: channelController.renderAuthDialog(),
  });

  bindEvents();
  updates.scheduleAutoCheck();
}

function renderMainContent() {
  if (activeMenuId === "channels") return channelController.renderPage();
  if (activeMenuId === "publish") return publishController.renderPage();
  if (["membership", "messages", "ai"].includes(activeMenuId)) {
    return commerceController.renderPage(activeMenuId as CommercePageId);
  }
  if (
    activeMenuId === "settings" ||
    activeMenuId === "profile" ||
    activeMenuId === "password" ||
    activeMenuId === "feedback"
  ) {
    return settingsController.renderPage(activeMenuId);
  }
  if (activeMenuId === "releases") return releasesPage();
  return channelController.renderPage();
}

function releasesPage() {
  return renderReleasesPage({
    text: copy[language],
    entries: releaseHistoryForLanguage(language),
    updateState: updates.state,
    autoUpdateEnabled: updates.autoEnabled,
    canInstall: updates.canInstall,
    isChecking: updates.isChecking,
    isDownloading: updates.isDownloading,
    status: updates.statusText(),
    progress: updates.progressPercent(),
    expandedReleaseVersions: updates.expandedVersions,
  });
}

function handleRootClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || channelController.handleClick(target)) return;

  const menu = target.closest<HTMLElement>("[data-menu]");
  if (menu) {
    captureDrafts();
    const nextMenu = menu.dataset.menu as MenuId | undefined;
    if (!nextMenu) return;
    activeMenuId = nextMenu;
    userMenuOpen = false;
    render();
    if (nextMenu === "publish") {
      publishController.activate();
    }
    if (["membership", "messages", "ai"].includes(nextMenu)) {
      commerceController.activate(nextMenu as CommercePageId);
    }
    return;
  }

  const action = target.closest<HTMLElement>("[data-action]");
  if (action && handleRootAction(action)) return;

  if (userMenuOpen && !target.closest(".corner-menu-wrap")) {
    captureDrafts();
    userMenuOpen = false;
    render();
  }
}

function handleRootAction(element: HTMLElement) {
  switch (element.dataset.action) {
    case "toggle-user-menu":
      captureDrafts();
      userMenuOpen = !userMenuOpen;
      render();
      return true;
    case "logout":
      userMenuOpen = false;
      logout();
      return true;
    case "check-update":
      void updates.check({ silent: false });
      return true;
    case "install-update":
      void updates.installPending();
      return true;
    case "toggle-release-content": {
      const version = element.dataset.releaseVersion;
      if (version) updates.toggleRelease(version);
      return true;
    }
    default:
      return false;
  }
}

function bindEvents() {
  channelController.bindEvents();
  publishController.bindEvents();
  settingsController.bindEvents();
  commerceController.bindEvents();
  document.querySelector<HTMLInputElement>("[data-auto-update]")?.addEventListener("change", (event) => {
    if (event.currentTarget instanceof HTMLInputElement) {
      updates.setAutoEnabled(event.currentTarget.checked);
    }
  });
}

function captureDrafts() {
  publishController.captureDraftFromForm();
  settingsController.captureDrafts();
  commerceController.captureDrafts();
}

function logout() {
  const logoutRequest = authToken
    ? apiRequest("/v1/auth/logout", { method: "POST" }).catch(() => undefined)
    : Promise.resolve();
  authToken = "";
  currentUser = null;
  activeMenuId = "channels";
  userMenuOpen = false;
  channelController.reset();
  authController.reset();
  settingsController.reset();
  commerceController.reset();
  localStorage.removeItem(AUTH_TOKEN_KEY);
  render();
  void authController.loadCaptchaAndRender();
  void logoutRequest;
}

function renderPreservingWorkspaceScroll() {
  renderPreservingElementScroll(".workspace-body");
}

function renderPreservingPublishScroll() {
  renderPreservingElementScroll(".publish-workbench, .publish-resource-list, .publish-target-strip");
}

function renderPreservingElementScroll(selector: string) {
  const scrollState = Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element, index) => ({
    index,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));
  const restore = () => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    scrollState.forEach((state) => {
      const element = elements[state.index];
      if (!element) return;
      element.scrollLeft = state.scrollLeft;
      element.scrollTop = state.scrollTop;
    });
  };
  render();
  restore();
  window.requestAnimationFrame(restore);
}

function showToast(message: string) {
  const toast = document.querySelector<HTMLDivElement>(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function normalizeError(error: unknown) {
  return normalizeErrorMessage(
    error,
    language === "zh" ? "操作失败，请稍后重试。" : "Operation failed. Please try again.",
  );
}
