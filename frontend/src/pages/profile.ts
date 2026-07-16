import type { AuthUser, CaptchaResponse } from "../domain/types";
import type { CopyText } from "../i18n/copy";
import { icon } from "../ui/icons";
import { escapeAttribute } from "../utils/html";

export interface ProfilePageState {
  text: CopyText;
  currentUser: AuthUser | null;
  profileNickname: string;
  profileBusy: boolean;
  inputHints: string;
  emailBindDraft: {
    email: string;
    currentPassword: string;
    captchaCode: string;
    emailCode: string;
  };
  emailCaptcha: CaptchaResponse | null;
  emailBindBusy: boolean;
  emailCodeCooldownSeconds: number;
}

export function renderProfilePage({
  text,
  currentUser,
  profileNickname,
  profileBusy,
  inputHints,
  emailBindDraft,
  emailCaptcha,
  emailBindBusy,
  emailCodeCooldownSeconds,
}: ProfilePageState) {
  const sendEmailCodeLabel = emailCodeCooldownSeconds > 0
    ? text.resendEmailCode.replace("{seconds}", String(emailCodeCooldownSeconds))
    : text.sendEmailCode;

  return `
    <section class="page-head">
      <div>
        <h1>${text.profileSettings}</h1>
      </div>
    </section>
    <section class="single-form-page">
      <article class="settings-card settings-card-form">
        <form class="settings-form" data-settings-form="profile">
          <div class="form-grid">
            <label>
              <span>${text.account}</span>
              <input name="account" ${inputHints} value="${escapeAttribute(currentUser?.account || "")}" readonly aria-label="${text.accountReadonly}" />
            </label>
            <label>
              <span>${text.nickname}</span>
              <input name="nickname" ${inputHints} maxlength="32" value="${escapeAttribute(profileNickname)}" required />
            </label>
          </div>
          <div class="settings-form-actions">
            <button class="primary-btn" type="submit" ${profileBusy ? "disabled" : ""}>${icon("save")}${text.saveProfile}</button>
          </div>
        </form>
      </article>
      ${currentUser?.needsEmailBinding ? `
        <article class="settings-card settings-card-form email-bind-card">
          <div class="settings-section-head"><h2>${text.bindEmail}</h2><span>${text.emailUnbound}</span></div>
          <form class="settings-form" data-settings-form="email-bind">
            <div class="form-grid compact">
              <label><span>${text.email}</span><input name="email" type="email" ${inputHints} maxlength="191" value="${escapeAttribute(emailBindDraft.email)}" required /></label>
              <label><span>${text.currentPassword}</span><input name="currentPassword" type="password" ${inputHints} minlength="6" maxlength="64" value="${escapeAttribute(emailBindDraft.currentPassword)}" required /></label>
              <label><span>${text.captcha}</span><div class="captcha-row"><input name="captchaCode" minlength="4" maxlength="8" ${inputHints} value="${escapeAttribute(emailBindDraft.captchaCode)}" required /><button class="captcha-img" type="button" data-email-bind-action="refresh-captcha">${emailCaptcha ? `<img src="${escapeAttribute(emailCaptcha.image)}" alt="${text.captcha}" />` : icon("refresh")}</button></div></label>
              <label><span>${text.emailCode}</span><div class="email-code-row"><input name="emailCode" inputmode="numeric" maxlength="6" ${inputHints} value="${escapeAttribute(emailBindDraft.emailCode)}" required /><button class="ghost-btn" type="button" data-email-bind-action="send-code" ${emailBindBusy || emailCodeCooldownSeconds > 0 ? "disabled" : ""}>${sendEmailCodeLabel}</button></div></label>
            </div>
            <div class="settings-form-actions"><button class="primary-btn" type="submit" ${emailBindBusy ? "disabled" : ""}>${icon("check")}${text.bindEmail}</button></div>
          </form>
        </article>` : `
        <article class="settings-card email-status-card"><div><h2>${text.email}</h2><span>${escapeAttribute(currentUser?.email || "")}</span></div><strong>${text.emailVerified}</strong></article>`}
    </section>
  `;
}
