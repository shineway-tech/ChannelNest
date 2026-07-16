import type { AuthUser, MenuId } from "../domain/types";
import { APP_VERSION } from "../config/app";
import { icon } from "../ui/icons";
import { escapeAttribute } from "../utils/html";

export interface AppShellState {
  theme: string;
  currentUser: AuthUser;
  activeMenuId: MenuId;
  accountManagementLabel: string;
  publishLabel: string;
  membershipLabel: string;
  messagesLabel: string;
  aiLabel: string;
  unreadCount: number;
  userMenuOpen: boolean;
  mainContent: string;
  accountDropdown: string;
  authDialog: string;
}

export function renderAppShell({
  theme,
  currentUser,
  activeMenuId,
  accountManagementLabel,
  publishLabel,
  membershipLabel,
  messagesLabel,
  aiLabel,
  unreadCount,
  userMenuOpen,
  mainContent,
  accountDropdown,
  authDialog,
}: AppShellState) {
  return `
    <div class="window theme-${theme}">
      <aside class="icon-rail" aria-label="主导航">
        <div class="rail-brand">
          <div class="brand-mark" aria-hidden="true">M</div>
        </div>
        <nav class="rail-nav">
          <button class="rail-btn ${activeMenuId === "channels" ? "active" : ""}" type="button" data-menu="channels" title="${escapeAttribute(accountManagementLabel)}" aria-label="${escapeAttribute(accountManagementLabel)}">
            ${icon("layers")}
          </button>
          <button class="rail-btn ${activeMenuId === "publish" ? "active" : ""}" type="button" data-menu="publish" title="${escapeAttribute(publishLabel)}" aria-label="${escapeAttribute(publishLabel)}">
            ${icon("send")}
          </button>
          <button class="rail-btn ${activeMenuId === "ai" ? "active" : ""}" type="button" data-menu="ai" title="${escapeAttribute(aiLabel)}" aria-label="${escapeAttribute(aiLabel)}">
            ${icon("spark")}
          </button>
          <button class="rail-btn ${activeMenuId === "membership" ? "active" : ""}" type="button" data-menu="membership" title="${escapeAttribute(membershipLabel)}" aria-label="${escapeAttribute(membershipLabel)}">
            ${icon("crown")}
          </button>
          <button class="rail-btn ${activeMenuId === "messages" ? "active" : ""}" type="button" data-menu="messages" title="${escapeAttribute(messagesLabel)}" aria-label="${escapeAttribute(messagesLabel)}">
            ${icon("message")}${unreadCount ? `<span class="rail-badge">${Math.min(unreadCount, 99)}</span>` : ""}
          </button>
        </nav>
        <div class="rail-bottom">
          <div class="rail-version" title="v${escapeAttribute(APP_VERSION)}">v${escapeAttribute(APP_VERSION)}</div>
          <div class="corner-menu-wrap">
            <button class="corner-menu-btn" type="button" data-action="toggle-user-menu" title="${escapeAttribute(currentUser.nickname)}" aria-expanded="${userMenuOpen ? "true" : "false"}">
              ${icon("menu")}
            </button>
            ${userMenuOpen ? accountDropdown : ""}
          </div>
        </div>
      </aside>

      <main class="main ${activeMenuId === "channels" ? "main-channels" : activeMenuId === "publish" ? "main-publish" : activeMenuId === "ai" ? "main-ai" : "main-commerce"}">
        ${mainContent}
      </main>

      ${authDialog}
      <div class="toast" hidden></div>
    </div>
  `;
}
