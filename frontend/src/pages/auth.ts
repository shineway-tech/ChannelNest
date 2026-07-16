import type { AuthViewMode, CaptchaResponse, ThemeMode } from "../domain/types";
import type { CopyText } from "../i18n/copy";
import { icon } from "../ui/icons";
import { escapeAttribute } from "../utils/html";

export interface AuthDraftState {
  account: string;
  password: string;
  nickname: string;
  captchaCode: string;
  emailCode: string;
  emailCodeId: string;
}

export interface AuthPageState {
  text: CopyText;
  theme: ThemeMode;
  authViewMode: AuthViewMode;
  authDraft: AuthDraftState;
  captcha: CaptchaResponse | null;
  authBusy: boolean;
  emailCodeCooldownSeconds: number;
  inputHints: string;
}

export function renderAuthPage({
  text,
  theme,
  authViewMode,
  authDraft,
  captcha,
  authBusy,
  emailCodeCooldownSeconds,
  inputHints,
}: AuthPageState) {
  const isRegister = authViewMode === "register";
  const isReset = authViewMode === "reset";
  const usesEmailCode = isRegister || isReset;
  const sendEmailCodeLabel = emailCodeCooldownSeconds > 0
    ? text.resendEmailCode.replace("{seconds}", String(emailCodeCooldownSeconds))
    : text.sendEmailCode;

  return `
    <div class="auth-shell theme-${theme}">
      <section class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark" aria-hidden="true">M</div>
          <div>
            <strong>${text.appName}</strong>
          </div>
        </div>
        <form class="login-form" data-auth-form="${authViewMode}">
          <div class="auth-form-head">
            <h1>${isRegister ? text.registerTitle : isReset ? text.resetPasswordTitle : text.loginTitle}</h1>
          </div>
          <label>
            <span>${usesEmailCode ? text.email : text.account}</span>
            <input name="account" ${usesEmailCode ? 'type="email" maxlength="191"' : ""} ${inputHints} placeholder="${usesEmailCode ? text.authEmailPlaceholder : text.authAccountPlaceholder}" value="${escapeAttribute(authDraft.account)}" required />
          </label>
          ${
            isRegister
              ? `<label>
                  <span>${text.nickname}</span>
                  <input name="nickname" ${inputHints} placeholder="${text.authNicknamePlaceholder}" value="${escapeAttribute(authDraft.nickname)}" />
                </label>`
              : ""
          }
          <label>
            <span>${isReset ? text.newPassword : text.password}</span>
            <input name="password" type="password" ${inputHints} placeholder="${text.authPasswordPlaceholder}" value="${escapeAttribute(authDraft.password)}" required />
          </label>
          ${usesEmailCode ? `
            <label>
              <span>${text.captcha}</span>
              <div class="captcha-row">
                <input name="captchaCode" minlength="4" maxlength="8" ${inputHints} placeholder="${text.authCaptchaPlaceholder}" value="${escapeAttribute(authDraft.captchaCode)}" required />
                <button class="captcha-img" type="button" data-auth-action="refresh-captcha" title="${text.captchaRefresh}">
                  ${captcha ? `<img src="${escapeAttribute(captcha.image)}" alt="${text.captcha}" />` : icon("refresh")}
                </button>
              </div>
            </label>
            <label>
              <span>${text.emailCode}</span>
              <div class="email-code-row">
                <input name="emailCode" inputmode="numeric" maxlength="6" ${inputHints} placeholder="${text.emailCodePlaceholder}" value="${escapeAttribute(authDraft.emailCode)}" required />
                <button class="ghost-btn" type="button" data-auth-action="send-email-code" ${authBusy || emailCodeCooldownSeconds > 0 ? "disabled" : ""}>${sendEmailCodeLabel}</button>
              </div>
            </label>` : ""}
          <button class="primary-btn auth-submit" type="submit" ${authBusy ? "disabled" : ""}>
            <span class="auth-submit-icon ${authBusy ? "is-visible" : ""}">${icon("refresh")}</span>
            <span>${isRegister ? text.registerSubmit : isReset ? text.resetPasswordSubmit : text.loginSubmit}</span>
          </button>
          <div class="auth-switch-row">
            <button class="auth-switch" type="button" data-auth-action="${usesEmailCode ? "show-login" : "show-register"}">${usesEmailCode ? text.switchToLogin : text.switchToRegister}</button>
            ${!usesEmailCode ? `<button class="auth-switch" type="button" data-auth-action="show-reset">${text.forgotPassword}</button>` : ""}
          </div>
        </form>
      </section>
    </div>
  `;
}
