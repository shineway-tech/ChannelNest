import { listen } from "@tauri-apps/api/event";
import type {
  AuthTaskStatus,
  Bootstrap,
  ChannelAccount,
  LanguageMode,
  LoginTarget,
  PlatformInfo,
  StartLoginResponse,
} from "../domain/types";
import {
  type ChannelAccountContent,
  type ChannelWorksPage,
  type ChannelWork,
  type ChannelWorkType,
  type ContentTab,
  supportsAccountContent,
  supportsTypedWorks,
  supportsWorksPages,
} from "../domain/channel-content";
import { isQrAuth } from "../domain/auth-task";
import { fallbackPlatforms, normalizeChannelPlatformId } from "../domain/platforms";
import type { CopyText } from "../i18n/copy";
import { renderChannelsPage } from "../pages/channels";
import { upsertAccount } from "../features/channel-sync";
import { invokeCommand } from "../services/tauri-commands";
import {
  renderAccountNavItem,
  renderAuthDialog,
  renderPlatformTreeItem,
} from "../ui/channel-components";
import {
  formatFollowersTotal as formatAccountFollowersTotal,
  initials as accountInitials,
} from "../utils/format";

type OverviewPeriod = 1 | 7 | 30 | 90 | 36500 | 65535;

interface ChannelControllerDependencies {
  getText: () => CopyText;
  getLanguage: () => LanguageMode;
  getCurrentUserId: () => string;
  activateChannels: () => void;
  render: () => void;
  renderPreservingWorkspaceScroll: () => void;
  showToast: (message: string) => void;
  normalizeError: (error: unknown) => string;
}

const BILIBILI_TOTAL_PERIOD: OverviewPeriod = 65535;

export class ChannelController {
  private platforms: PlatformInfo[] = fallbackPlatforms;
  private accounts: ChannelAccount[] = [];
  private selectedPlatformId = "xiaohongshu";
  private selectedAccountId: string | null = null;
  private expandedPlatformIds = new Set<string>();
  private activeContentTab: ContentTab = "overview";
  private searchQuery = "";
  private searchComposing = false;
  private activeAuthTask: StartLoginResponse | null = null;
  private activeAuthMessage = "";
  private authPollTimer: number | undefined;
  private refreshingAccountIds = new Set<string>();
  private refreshingPlatformIds = new Set<string>();
  private openingHomepageIds = new Set<string>();
  private syncingContentIds = new Set<string>();
  private loadingWorksPageIds = new Set<string>();
  private accountContentCache = new Map<string, ChannelAccountContent>();
  private accountWorksPages = new Map<string, ChannelWorksPage[]>();
  private overviewPeriodByAccount = new Map<string, OverviewPeriod>();
  private workTypeByAccount = new Map<string, ChannelWorkType>();

  constructor(private readonly deps: ChannelControllerDependencies) {}

  getPlatforms() {
    return this.platforms;
  }

  getAccounts() {
    return this.accounts;
  }

  getSelectedAccountId() {
    return this.selectedAccountId;
  }

  async bindAccountEvents() {
    try {
      await listen<ChannelAccount>("channel-account-updated", (event) => {
        void this.applyAccountUpdate(event.payload, { rerender: true });
      });
    } catch (error) {
      console.warn("Account update events are not available", error);
    }
  }

  async loadClientData() {
    try {
      const bootstrap = await invokeCommand<Bootstrap>("get_bootstrap", {
        userId: this.requireCurrentUserId(),
      });
      this.platforms = bootstrap.platforms;
      this.accounts = bootstrap.accounts;
      this.syncSelection({ preferFirstWithAccounts: true, expandSelected: true });
    } catch (error) {
      console.warn("Using browser fallback because Tauri is not available", error);
      this.syncSelection({ preferFirstWithAccounts: true, expandSelected: true });
    }
  }

  reset() {
    this.stopAuthPolling();
    this.accounts = [];
    this.selectedAccountId = null;
    this.activeContentTab = "overview";
    this.activeAuthTask = null;
    this.activeAuthMessage = "";
    this.refreshingAccountIds.clear();
    this.refreshingPlatformIds.clear();
    this.openingHomepageIds.clear();
    this.syncingContentIds.clear();
    this.loadingWorksPageIds.clear();
    this.accountContentCache.clear();
    this.accountWorksPages.clear();
    this.overviewPeriodByAccount.clear();
    this.workTypeByAccount.clear();
  }

  renderPage() {
    this.syncSelection();
    const selectedPlatform = this.getSelectedPlatform();
    const selectedAccount = this.getSelectedAccount();
    const selectedWorkType = selectedAccount ? this.selectedWorkType(selectedAccount.id) : "video";
    const selectedAccounts = this.accounts.filter((item) => this.samePlatform(item.platformId, selectedPlatform.id));
    const visiblePlatforms = this.visiblePlatforms();
    const allWorks = this.worksForCurrentSelection(selectedAccount, selectedPlatform.id);
    const works = allWorks.filter((item) =>
      selectedAccount
        ? item.accountId === selectedAccount.id
        : this.samePlatform(item.platformId, selectedPlatform.id),
    );
    const selectedContent = selectedAccount
      ? this.accountContentCache.get(selectedAccount.id) || null
      : null;
    const selectedWorksPages = selectedAccount
      ? this.accountWorksPages.get(this.worksStateKeyForAccount(selectedAccount, selectedWorkType)) || []
      : [];

    return renderChannelsPage({
      text: this.deps.getText(),
      language: this.deps.getLanguage(),
      selectedPlatform,
      selectedAccount,
      selectedAccounts,
      platformRefreshing: this.refreshingPlatformIds.has(selectedPlatform.id),
      selectedAccountRefreshing: selectedAccount
        ? this.refreshingAccountIds.has(selectedAccount.id)
        : false,
      selectedAccountOpeningHomepage: selectedAccount
        ? this.openingHomepageIds.has(selectedAccount.id)
        : false,
      selectedAccountContent: selectedContent,
      selectedAccountContentLoading: selectedAccount
        ? this.syncingContentIds.has(selectedAccount.id)
        : false,
      selectedWorksPages,
      selectedWorksLoading: selectedAccount ? this.isWorksLoading(selectedAccount.id) : false,
      selectedWorkType,
      overviewPeriod: selectedAccount ? this.selectedOverviewPeriod(selectedAccount) : 7,
      activeTab: this.activeContentTab,
      works,
      platforms: visiblePlatforms,
      searchQuery: this.searchQuery,
      hasSearchResults: visiblePlatforms.length > 0,
      platformTree: (platform) => this.renderPlatformTree(platform),
      formatFollowersTotal: (items) => formatAccountFollowersTotal(items, this.deps.getLanguage()),
    });
  }

  renderAuthDialog() {
    if (!this.activeAuthTask) return "";
    const text = this.deps.getText();
    const description =
      this.activeAuthMessage ||
      this.activeAuthTask.instructions ||
      (isQrAuth(this.activeAuthTask) ? text.authQrDesc : text.authDesc);
    return renderAuthDialog({
      task: this.activeAuthTask,
      text,
      platform: this.getSelectedPlatform(),
      description,
    });
  }

  bindEvents() {
    const search = document.querySelector<HTMLInputElement>("[data-channel-search]");
    search?.addEventListener("compositionstart", () => {
      this.searchComposing = true;
    });
    search?.addEventListener("compositionend", (event) => {
      if (!(event.currentTarget instanceof HTMLInputElement)) return;
      this.searchComposing = false;
      this.updateSearch(event.currentTarget.value);
    });
    search?.addEventListener("input", (event) => {
      if (!(event.currentTarget instanceof HTMLInputElement) || this.searchComposing) return;
      this.updateSearch(event.currentTarget.value);
    });
  }

  handleClick(target: Element) {
    const login = target.closest<HTMLElement>("[data-login]");
    if (login) {
      this.deps.activateChannels();
      void this.startLogin(
        login.dataset.login || this.selectedPlatformId,
        this.readLoginTarget(login),
        login.dataset.loginAccount,
      );
      return true;
    }

    const accountCommand = target.closest<HTMLElement>(
      "[data-delete-account], [data-refresh-account], [data-open-homepage], [data-copy-account]",
    );
    if (accountCommand) {
      if (accountCommand.dataset.deleteAccount !== undefined) {
        void this.deleteAccount(accountCommand.dataset.deleteAccount);
      } else if (accountCommand.dataset.refreshAccount !== undefined) {
        void this.refreshAccount(accountCommand.dataset.refreshAccount);
      } else if (accountCommand.dataset.openHomepage !== undefined) {
        void this.openHomepage(accountCommand.dataset.openHomepage);
      } else if (accountCommand.dataset.copyAccount !== undefined) {
        void this.copyAccountValue(accountCommand.dataset.copyAccount);
      }
      return true;
    }

    const platformToggle = target.closest<HTMLElement>("[data-toggle-platform]");
    if (platformToggle) {
      const platformId = platformToggle.dataset.togglePlatform;
      if (!platformId) return true;
      this.togglePlatformExpanded(platformId);
      this.deps.activateChannels();
      this.deps.render();
      return true;
    }

    const accountItem = target.closest<HTMLElement>("[data-account]");
    if (accountItem) {
      const account = this.accounts.find((candidate) => candidate.id === accountItem.dataset.account);
      if (!account) return true;
      this.selectedAccountId = account.id;
      this.selectedPlatformId = normalizeChannelPlatformId(account.platformId);
      this.expandedPlatformIds.add(this.selectedPlatformId);
      this.activeContentTab = "overview";
      this.deps.activateChannels();
      void this.syncAccountContent(account.id);
      this.deps.render();
      return true;
    }

    const channelTab = target.closest<HTMLElement>("[data-channel-tab]");
    if (channelTab) {
      const nextTab = channelTab.dataset.channelTab;
      if (!this.isContentTab(nextTab)) return true;
      this.activeContentTab = nextTab;
      this.deps.activateChannels();
      this.deps.render();
      if (nextTab === "works") {
        void this.loadWorksPage({ force: !this.selectedAccountHasWorksPage() });
      }
      return true;
    }

    const action = target.closest<HTMLElement>("[data-action]");
    if (action && this.handleAction(action)) return true;

    const platformItem = target.closest<HTMLElement>("[data-platform]");
    if (platformItem) {
      const nextPlatformId = platformItem.dataset.platform || this.selectedPlatformId;
      this.selectedPlatformId = normalizeChannelPlatformId(nextPlatformId);
      this.selectedAccountId = null;
      if (!this.normalizedSearch()) this.togglePlatformExpanded(nextPlatformId);
      this.deps.activateChannels();
      this.deps.render();
      return true;
    }

    return false;
  }

  handleAction(element: HTMLElement) {
    switch (element.dataset.action) {
      case "refresh-platform":
        void this.refreshPlatform(this.selectedPlatformId);
        return true;
      case "overview-period": {
        const account = this.getSelectedAccount();
        if (account) this.overviewPeriodByAccount.set(account.id, this.readOverviewPeriod(element.dataset.period));
        this.deps.render();
        return true;
      }
      case "work-type": {
        const account = this.getSelectedAccount();
        const workType = element.dataset.workType === "article" ? "article" : "video";
        if (!account || !supportsTypedWorks(account.platformId)) return true;
        this.workTypeByAccount.set(account.id, workType);
        this.deps.render();
        if (this.activeContentTab === "works") {
          void this.loadWorksPage({ force: !this.selectedAccountHasWorksPage() });
        }
        return true;
      }
      case "load-more-works":
        void this.loadWorksPage({ next: true });
        return true;
      case "close-auth":
        this.stopAuthPolling();
        this.activeAuthTask = null;
        this.activeAuthMessage = "";
        this.deps.render();
        return true;
      case "check-auth":
        void this.checkAuthOnce();
        return true;
      default:
        return false;
    }
  }

  stopAuthPolling() {
    if (this.authPollTimer) {
      window.clearInterval(this.authPollTimer);
      this.authPollTimer = undefined;
    }
  }

  private requireCurrentUserId() {
    const userId = this.deps.getCurrentUserId();
    if (!userId) throw new Error(this.deps.getText().loginRequired);
    return userId;
  }

  private async applyAccountUpdate(updated: ChannelAccount, options: { rerender?: boolean } = {}) {
    const userId = this.deps.getCurrentUserId();
    if (userId && updated.userId && updated.userId !== userId) return;
    this.accounts = upsertAccount(this.accounts, updated, userId || undefined);
    this.expandedPlatformIds.add(updated.platformId);
    this.syncSelection();
    if (options.rerender) this.deps.render();
  }

  private async startLogin(platformId: string, loginTarget?: LoginTarget, accountId?: string) {
    try {
      const normalizedPlatformId = normalizeChannelPlatformId(platformId);
      this.selectedPlatformId = normalizedPlatformId;
      this.selectedAccountId = null;
      this.expandedPlatformIds.add(normalizedPlatformId);
      this.activeAuthTask = await invokeCommand<StartLoginResponse>("start_channel_login", {
        request: {
          userId: this.requireCurrentUserId(),
          platformId: normalizedPlatformId,
          ...(loginTarget ? { loginTarget } : {}),
          ...(accountId ? { accountId } : {}),
        },
      });
      this.activeAuthMessage =
        this.activeAuthTask.instructions ||
        (isQrAuth(this.activeAuthTask) ? this.deps.getText().authQrDesc : this.deps.getText().authDesc);
      this.deps.showToast(
        isQrAuth(this.activeAuthTask) ? this.deps.getText().authQrOpened : this.deps.getText().authOpened,
      );
      this.deps.render();
      this.startAuthPolling();
    } catch (error) {
      this.deps.showToast(this.deps.normalizeError(error));
    }
  }

  private readLoginTarget(element: HTMLElement): LoginTarget | undefined {
    const target = element.dataset.loginTarget;
    return target === "home" || target === "creator" ? target : undefined;
  }

  private startAuthPolling() {
    this.stopAuthPolling();
    this.authPollTimer = window.setInterval(() => void this.checkAuthOnce(false), 1800);
  }

  private async checkAuthOnce(verbose = true) {
    if (!this.activeAuthTask) return;
    try {
      const result = await invokeCommand<AuthTaskStatus>("get_auth_task_status", {
        taskId: this.activeAuthTask.taskId,
        userId: this.requireCurrentUserId(),
      });
      if (result.status === "success") {
        this.stopAuthPolling();
        let accountIdToSync: string | null = null;
        this.accounts = await invokeCommand<ChannelAccount[]>("list_channel_accounts", {
          userId: this.requireCurrentUserId(),
        });
        if (result.account?.id) {
          this.selectedAccountId = result.account.id;
          this.activeContentTab = "overview";
          accountIdToSync = result.account.id;
        }
        this.syncSelection({ expandSelected: true });
        this.activeAuthTask = null;
        this.activeAuthMessage = "";
        this.deps.activateChannels();
        this.deps.showToast(this.deps.getText().authDone);
        this.deps.render();
        if (accountIdToSync) void this.syncAccountContent(accountIdToSync, { force: true });
      } else if (result.status === "failed") {
        this.stopAuthPolling();
        this.activeAuthTask = null;
        this.activeAuthMessage = "";
        this.deps.showToast(result.message || this.deps.getText().authFailed);
        this.deps.render();
      } else {
        const message = result.message || this.deps.getText().authWaiting;
        if (this.activeAuthMessage !== message) {
          this.activeAuthMessage = message;
          this.deps.render();
        }
        if (verbose) this.deps.showToast(message);
      }
    } catch (error) {
      if (verbose) {
        const message = this.deps.normalizeError(error);
        this.activeAuthMessage = message;
        this.deps.showToast(message);
        this.deps.render();
      }
    }
  }

  private markAccountUnavailableLocally(accountId: string) {
    const syncedAt = new Date().toISOString();
    let updatedAccount: ChannelAccount | null = null;
    this.accounts = this.accounts.map((item) => {
      if (item.id !== accountId) return item;
      updatedAccount = {
        ...item,
        status: "expired",
        lastSyncAt: syncedAt,
        updatedAt: syncedAt,
      };
      return updatedAccount;
    });
    return updatedAccount;
  }

  private async markAccountUnavailable(accountId: string) {
    try {
      const updated = await invokeCommand<ChannelAccount>("mark_channel_account_unavailable", {
        accountId,
        userId: this.requireCurrentUserId(),
      });
      this.accounts = this.accounts.map((item) => (item.id === updated.id ? updated : item));
      return updated;
    } catch (error) {
      console.warn("Failed to persist unavailable account status", error);
      return this.markAccountUnavailableLocally(accountId);
    }
  }

  private async refreshAccount(accountId: string) {
    if (!accountId || this.refreshingAccountIds.has(accountId)) return;
    this.refreshingAccountIds.add(accountId);
    this.deps.render();
    let toastMessage = "";
    try {
      const updated = await invokeCommand<ChannelAccount>("refresh_channel_account", {
        accountId,
        userId: this.requireCurrentUserId(),
      });
      await this.applyAccountUpdate(updated);
      await this.syncAccountContent(accountId, { force: true, silent: true });
      toastMessage = this.deps.getText().accountRefreshed;
    } catch (error) {
      const expired = await this.markAccountUnavailable(accountId);
      if (expired) await this.applyAccountUpdate(expired);
      toastMessage = this.deps.normalizeError(error);
    } finally {
      this.refreshingAccountIds.delete(accountId);
      this.deps.render();
      if (toastMessage) this.deps.showToast(toastMessage);
    }
  }

  private async syncAccountContent(accountId: string, options: { force?: boolean; silent?: boolean } = {}) {
    const account = this.accounts.find((item) => item.id === accountId);
    if (!account || !supportsAccountContent(account.platformId) || this.syncingContentIds.has(accountId)) return;
    this.syncingContentIds.add(accountId);
    this.deps.render();
    try {
      const content = await invokeCommand<ChannelAccountContent>("sync_channel_account_content", {
        request: {
          accountId,
          userId: this.requireCurrentUserId(),
          force: Boolean(options.force),
        },
      });
      this.accountContentCache.set(accountId, content);
      this.applyContentProfileToAccount(content);
      if (content.error && !options.silent) this.deps.showToast(content.error);
    } catch (error) {
      if (!options.silent) this.deps.showToast(this.deps.normalizeError(error));
    } finally {
      this.syncingContentIds.delete(accountId);
      this.deps.render();
    }
  }

  private async loadWorksPage(options: { next?: boolean; force?: boolean } = {}) {
    const account = this.getSelectedAccount();
    if (!account || !supportsWorksPages(account.platformId)) return;
    const workType = this.selectedWorkType(account.id);
    const pagesKey = this.worksStateKeyForAccount(account, workType);
    const pages = this.accountWorksPages.get(pagesKey) || [];
    const pageKey = options.next ? pages[pages.length - 1]?.nextPageKey || "" : "";
    if (options.next && !pageKey) return;
    const loadingKey = `${pagesKey}:${pageKey}`;
    if (this.loadingWorksPageIds.has(loadingKey)) return;
    this.loadingWorksPageIds.add(loadingKey);
    options.next ? this.deps.renderPreservingWorkspaceScroll() : this.deps.render();
    try {
      const page = await invokeCommand<ChannelWorksPage>("load_channel_account_works_page", {
        request: {
          accountId: account.id,
          userId: this.requireCurrentUserId(),
          pageKey,
          workType: supportsTypedWorks(account.platformId) ? workType : undefined,
          force: Boolean(options.force),
        },
      });
      const existingPages = options.next ? pages : [];
      const nextPages = [...existingPages.filter((item) => item.pageKey !== page.pageKey), page].sort(
        (left, right) => this.pageSortValue(left.pageKey) - this.pageSortValue(right.pageKey),
      );
      this.accountWorksPages.set(pagesKey, nextPages);
      if (page.error && options.next) this.deps.showToast(page.error);
    } catch (error) {
      const message = this.deps.normalizeError(error);
      this.deps.showToast(message);
      const hasCachedWorks = pages.some((page) => (page.works || []).length > 0);
      if (!options.next && !hasCachedWorks) {
        this.accountWorksPages.set(pagesKey, [{
          accountId: account.id,
          platformId: account.platformId,
          pageKey: "",
          workType,
          nextPageKey: null,
          hasMore: false,
          works: [],
          syncStatus: "error",
          error: message,
        }]);
      }
    } finally {
      this.loadingWorksPageIds.delete(loadingKey);
      options.next ? this.deps.renderPreservingWorkspaceScroll() : this.deps.render();
    }
  }

  private applyContentProfileToAccount(content: ChannelAccountContent) {
    if (!content.profile) return;
    this.accounts = this.accounts.map((account) => account.id !== content.accountId
      ? account
      : {
          ...account,
          followers: content.profile?.followers ?? account.followers,
          following: content.profile?.following ?? account.following,
          likes: content.profile?.likes ?? account.likes,
          lastSyncAt: content.profile?.lastSyncAt || account.lastSyncAt,
        });
  }

  private pageSortValue(pageKey: string) {
    const normalized = pageKey.includes(":") ? pageKey.split(":").pop() || "" : pageKey;
    if (!normalized) return 0;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  private async refreshPlatform(platformId: string) {
    const normalizedPlatformId = normalizeChannelPlatformId(platformId);
    if (this.refreshingPlatformIds.has(normalizedPlatformId)) return;
    const list = this.accounts.filter((item) => this.samePlatform(item.platformId, normalizedPlatformId));
    if (!list.length) return;
    this.refreshingPlatformIds.add(normalizedPlatformId);
    list.forEach((account) => this.refreshingAccountIds.add(account.id));
    this.deps.render();
    let failedCount = 0;
    for (const account of list) {
      try {
        const updated = await invokeCommand<ChannelAccount>("refresh_channel_account", {
          accountId: account.id,
          userId: this.requireCurrentUserId(),
        });
        await this.applyAccountUpdate(updated);
        if (updated.status === "active" && supportsAccountContent(updated.platformId)) {
          await this.syncAccountContent(updated.id, { force: true, silent: true });
        }
      } catch (error) {
        console.warn("Failed to refresh account status", error);
        failedCount += 1;
      }
    }
    list.forEach((account) => this.refreshingAccountIds.delete(account.id));
    this.refreshingPlatformIds.delete(normalizedPlatformId);
    const language = this.deps.getLanguage();
    const message = failedCount
      ? `${this.deps.getText().platformRefreshed} ${language === "zh" ? `${failedCount} 个账号失败。` : `${failedCount} failed.`}`
      : this.deps.getText().platformRefreshed;
    this.deps.render();
    this.deps.showToast(message);
  }

  private async openHomepage(accountId: string) {
    if (!accountId || this.openingHomepageIds.has(accountId) || this.refreshingAccountIds.has(accountId)) return;
    this.openingHomepageIds.add(accountId);
    this.deps.render();
    try {
      await withTimeout(
        invokeCommand<ChannelAccount>("open_account_homepage", {
          accountId,
          userId: this.requireCurrentUserId(),
        }),
        5000,
        this.deps.getLanguage() === "zh"
          ? "打开主页窗口超时，请稍后重试。"
          : "Opening the homepage window timed out. Please try again.",
      );
    } catch (error) {
      this.deps.showToast(this.deps.normalizeError(error));
    } finally {
      this.openingHomepageIds.delete(accountId);
      this.deps.render();
    }
  }

  private async copyAccountValue(value: string) {
    const account = value.trim();
    if (!account) return;
    try {
      await this.writeClipboardText(account);
      this.deps.showToast(this.deps.getText().accountCopied);
    } catch (error) {
      this.deps.showToast(this.deps.normalizeError(error));
    }
  }

  private async writeClipboardText(value: string) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Embedded WebViews can deny Clipboard API access.
      }
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error(this.deps.getText().accountCopyFailed);
  }

  private async deleteAccount(accountId: string) {
    if (!accountId) return;
    try {
      await invokeCommand<void>("delete_channel_account", {
        accountId,
        userId: this.requireCurrentUserId(),
      });
      this.accounts = this.accounts.filter((item) => item.id !== accountId);
      this.accountContentCache.delete(accountId);
      this.deleteWorksStateForAccount(accountId);
      this.overviewPeriodByAccount.delete(accountId);
      this.workTypeByAccount.delete(accountId);
      if (this.selectedAccountId === accountId) this.selectedAccountId = null;
      this.syncSelection();
      this.deps.showToast(this.deps.getText().accountDeleted);
      this.deps.render();
    } catch (error) {
      this.deps.showToast(this.deps.normalizeError(error));
    }
  }

  private getSelectedPlatform() {
    return this.platforms.find((item) => this.samePlatform(item.id, this.selectedPlatformId))
      || this.platforms[0]
      || fallbackPlatforms[0];
  }

  private getSelectedAccount() {
    return this.selectedAccountId
      ? this.accounts.find((item) => item.id === this.selectedAccountId) || null
      : null;
  }

  private samePlatform(left: string, right: string) {
    return normalizeChannelPlatformId(left) === normalizeChannelPlatformId(right);
  }

  private worksForCurrentSelection(selectedAccount: ChannelAccount | null, platformId: string): ChannelWork[] {
    if (selectedAccount && supportsWorksPages(selectedAccount.platformId)) {
      return this.worksForAccount(selectedAccount, this.selectedWorkType(selectedAccount.id));
    }
    return selectedAccount ? [] : this.worksForPlatform(platformId);
  }

  private worksForAccount(account: ChannelAccount, workType: ChannelWorkType = "video") {
    const pages = this.accountWorksPages.get(this.worksStateKeyForAccount(account, workType)) || [];
    return this.uniqueWorks(pages.flatMap((page) => page.works || []));
  }

  private worksForPlatform(platformId: string) {
    const works = this.accounts
      .filter((account) => this.samePlatform(account.platformId, platformId) && supportsWorksPages(account.platformId))
      .flatMap((account) => this.worksForPlatformAccount(account.id));
    return this.uniqueWorks(works).sort((left, right) => this.workSortTime(right) - this.workSortTime(left));
  }

  private worksForPlatformAccount(accountId: string) {
    const prefix = `${accountId}:`;
    return Array.from(this.accountWorksPages.entries())
      .filter(([key]) => key === accountId || key.startsWith(prefix))
      .flatMap(([, pages]) => pages.flatMap((page) => page.works || []));
  }

  private uniqueWorks(works: ChannelWork[]) {
    const seen = new Set<string>();
    return works.filter((work) => {
      if (seen.has(work.id)) return false;
      seen.add(work.id);
      return true;
    });
  }

  private workSortTime(work: ChannelWork) {
    const value = Date.parse(work.publishedAt || "");
    return Number.isFinite(value) ? value : 0;
  }

  private isWorksLoading(accountId: string) {
    const account = this.accounts.find((item) => item.id === accountId);
    if (!account) return false;
    const prefix = `${this.worksStateKeyForAccount(account, this.selectedWorkType(accountId))}:`;
    return Array.from(this.loadingWorksPageIds).some((key) => key.startsWith(prefix));
  }

  private selectedWorkType(accountId: string): ChannelWorkType {
    return this.workTypeByAccount.get(accountId) || "video";
  }

  private selectedAccountHasWorksPage() {
    const account = this.getSelectedAccount();
    if (!account) return false;
    const pages = this.accountWorksPages.get(this.worksStateKeyForAccount(account, this.selectedWorkType(account.id))) || [];
    return pages.some((page) => {
      if ((page.works || []).length > 0) return true;
      const status = (page.syncStatus || "").trim();
      return (status === "synced" || status === "cached") && !page.error;
    });
  }

  private selectedOverviewPeriod(account: ChannelAccount): OverviewPeriod {
    const platformId = normalizeChannelPlatformId(account.platformId);
    return this.overviewPeriodByAccount.get(account.id)
      || (platformId === "douyin" ? 1 : platformId === "bilibili" ? BILIBILI_TOTAL_PERIOD : 7);
  }

  private readOverviewPeriod(value: string | undefined): OverviewPeriod {
    if (value === "1" || value === "30" || value === "90" || value === "36500" || value === "65535") {
      return Number(value) as OverviewPeriod;
    }
    return 7;
  }

  private worksStateKey(accountId: string, workType: ChannelWorkType) {
    return `${accountId}:${workType}`;
  }

  private worksStateKeyForAccount(account: ChannelAccount, workType: ChannelWorkType) {
    return supportsTypedWorks(account.platformId) ? this.worksStateKey(account.id, workType) : account.id;
  }

  private deleteWorksStateForAccount(accountId: string) {
    Array.from(this.accountWorksPages.keys()).forEach((key) => {
      if (key === accountId || key.startsWith(`${accountId}:`)) this.accountWorksPages.delete(key);
    });
  }

  private syncSelection(options: { preferFirstWithAccounts?: boolean; expandSelected?: boolean } = {}) {
    if (!this.platforms.length) return;
    const selectedAccount = this.getSelectedAccount();
    if (selectedAccount) {
      this.selectedPlatformId = normalizeChannelPlatformId(selectedAccount.platformId);
      if (options.expandSelected) this.expandedPlatformIds.add(this.selectedPlatformId);
      return;
    }
    this.selectedAccountId = null;
    if (options.preferFirstWithAccounts) {
      const firstPlatform = this.platforms.find((platform) =>
        this.accounts.some((account) => this.samePlatform(account.platformId, platform.id)));
      if (firstPlatform) this.selectedPlatformId = firstPlatform.id;
    }
    if (!this.platforms.some((item) => this.samePlatform(item.id, this.selectedPlatformId))) {
      this.selectedPlatformId = this.platforms[0].id;
    }
    if (options.expandSelected) this.expandedPlatformIds.add(this.selectedPlatformId);
  }

  private isContentTab(value: string | undefined): value is ContentTab {
    return value === "overview" || value === "works";
  }

  private updateSearch(value: string) {
    this.searchQuery = value;
    this.deps.render();
    window.requestAnimationFrame(() => {
      const search = document.querySelector<HTMLInputElement>("[data-channel-search]");
      if (!search) return;
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    });
  }

  private togglePlatformExpanded(platformId: string) {
    const normalizedPlatformId = normalizeChannelPlatformId(platformId);
    if (!this.accounts.some((account) => this.samePlatform(account.platformId, normalizedPlatformId))) return;
    if (this.expandedPlatformIds.has(normalizedPlatformId)) {
      this.expandedPlatformIds.delete(normalizedPlatformId);
    } else {
      this.expandedPlatformIds.add(normalizedPlatformId);
    }
  }

  private visiblePlatforms() {
    const query = this.normalizedSearch();
    if (!query) return this.platforms;
    return this.platforms.filter((platform) =>
      this.matchesPlatformSearch(platform, query)
      || this.accounts.some((account) =>
        this.samePlatform(account.platformId, platform.id) && this.matchesAccountSearch(account, query)));
  }

  private renderPlatformTree(platform: PlatformInfo) {
    const query = this.normalizedSearch();
    const platformMatches = query ? this.matchesPlatformSearch(platform, query) : false;
    const allPlatformAccounts = this.accounts.filter((item) => this.samePlatform(item.platformId, platform.id));
    const platformAccounts = query && !platformMatches
      ? allPlatformAccounts.filter((account) => this.matchesAccountSearch(account, query))
      : allPlatformAccounts;
    return renderPlatformTreeItem({
      platform,
      count: allPlatformAccounts.length,
      active: !this.selectedAccountId && this.samePlatform(platform.id, this.selectedPlatformId),
      expanded: query ? platformAccounts.length > 0 : this.expandedPlatformIds.has(platform.id),
      canToggle: !query,
      accountsHtml: platformAccounts.map((account) => this.renderAccountNavItem(account)).join(""),
    });
  }

  private normalizedSearch() {
    return this.searchQuery.trim().toLowerCase();
  }

  private matchesPlatformSearch(platform: PlatformInfo, query: string) {
    return platform.name.toLowerCase().includes(query);
  }

  private matchesAccountSearch(account: ChannelAccount, query: string) {
    return account.nickname.toLowerCase().includes(query);
  }

  private renderAccountNavItem(account: ChannelAccount) {
    const platform = this.platforms.find((item) => this.samePlatform(item.id, account.platformId));
    return renderAccountNavItem({
      account,
      text: this.deps.getText(),
      platform,
      active: this.selectedAccountId === account.id,
      isUnavailable: account.status !== "active",
      fallbackAvatar: accountInitials(account.nickname),
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) window.clearTimeout(timer);
    }),
    timeout,
  ]);
}
