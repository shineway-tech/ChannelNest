import type { AuthUser, CaptchaResponse, LanguageMode, MenuId, ThemeMode } from "../domain/types";
import type { CopyText } from "../i18n/copy";
import { renderFeedbackPage } from "../pages/feedback";
import { renderPasswordPage } from "../pages/password";
import { renderProfilePage } from "../pages/profile";
import { renderSettingsPage } from "../pages/settings";
import type { ApiRequest } from "../services/api";
import { INPUT_HINTS_OFF } from "../config/app";
import { Countdown } from "../utils/countdown";
import {
  clearFieldError,
  clearFormFieldErrors,
  formValue,
  reportNamedFieldError,
} from "../utils/forms";

type SettingsPageId = Extract<MenuId, "settings" | "profile" | "password" | "feedback">;

interface SettingsControllerDependencies {
  getText: () => CopyText;
  getLanguage: () => LanguageMode;
  setLanguage: (language: LanguageMode) => void;
  getTheme: () => ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  getCurrentUser: () => AuthUser | null;
  setCurrentUser: (user: AuthUser) => void;
  apiRequest: ApiRequest;
  render: () => void;
  showToast: (message: string) => void;
  normalizeError: (error: unknown) => string;
}

const emptyPasswordDraft = () => ({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const emptyEmailBindDraft = () => ({
  email: "",
  currentPassword: "",
  captchaCode: "",
  emailCode: "",
  emailCodeId: "",
});

export class SettingsController {
  private profileBusy = false;
  private passwordBusy = false;
  private feedbackBusy = false;
  private profileDraft = { nickname: "" };
  private passwordDraft = emptyPasswordDraft();
  private feedbackDraft = { content: "", contact: "" };
  private emailBindDraft = emptyEmailBindDraft();
  private emailCaptcha: CaptchaResponse | null = null;
  private emailBindBusy = false;
  private emailCaptchaLoading = false;
  private readonly emailCodeCooldown = new Countdown();
  private resendCaptchaReady = false;

  constructor(private readonly deps: SettingsControllerDependencies) {}

  setCurrentUser(user: AuthUser) {
    this.profileDraft.nickname = user.nickname;
  }

  reset() {
    this.emailCodeCooldown.clear();
    this.resendCaptchaReady = false;
    this.profileBusy = false;
    this.passwordBusy = false;
    this.feedbackBusy = false;
    this.profileDraft = { nickname: "" };
    this.passwordDraft = emptyPasswordDraft();
    this.feedbackDraft = { content: "", contact: "" };
    this.emailBindDraft = emptyEmailBindDraft();
    this.emailCaptcha = null;
    this.emailBindBusy = false;
  }

  renderPage(page: SettingsPageId) {
    const text = this.deps.getText();

    if (page === "settings") {
      return renderSettingsPage({
        text,
        language: this.deps.getLanguage(),
        theme: this.deps.getTheme(),
      });
    }

    if (page === "profile") {
      const currentUser = this.deps.getCurrentUser();
      return renderProfilePage({
        text,
        currentUser,
        profileNickname: this.profileDraft.nickname || currentUser?.nickname || "",
        profileBusy: this.profileBusy,
        inputHints: INPUT_HINTS_OFF,
        emailBindDraft: this.emailBindDraft,
        emailCaptcha: this.emailCaptcha,
        emailBindBusy: this.emailBindBusy,
        emailCodeCooldownSeconds: this.emailCodeCooldown.remainingSeconds,
      });
    }

    if (page === "password") {
      return renderPasswordPage({
        text,
        passwordDraft: this.passwordDraft,
        passwordBusy: this.passwordBusy,
        inputHints: INPUT_HINTS_OFF,
      });
    }

    return renderFeedbackPage({
      text,
      feedbackDraft: this.feedbackDraft,
      feedbackBusy: this.feedbackBusy,
      inputHints: INPUT_HINTS_OFF,
    });
  }

  bindEvents() {
    document.querySelectorAll<HTMLSelectElement>("[data-system-setting]").forEach((element) => {
      element.addEventListener("change", () => this.changeSystemSetting(element));
    });

    document.querySelectorAll<HTMLFormElement>("[data-settings-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!(event.currentTarget instanceof HTMLFormElement)) return;
        if (event.currentTarget.dataset.settingsForm === "profile") {
          void this.submitProfileForm(event.currentTarget);
        } else if (event.currentTarget.dataset.settingsForm === "password") {
          void this.submitPasswordForm(event.currentTarget);
        } else if (event.currentTarget.dataset.settingsForm === "email-bind") {
          void this.submitEmailBindForm(event.currentTarget);
        }
      });
    });

    document.querySelectorAll<HTMLElement>("[data-email-bind-action]").forEach((button) => {
      button.addEventListener("click", () => {
        this.captureDrafts();
        if (button.dataset.emailBindAction === "refresh-captcha") {
          void this.loadEmailCaptcha();
        } else {
          void this.sendEmailBindCode();
        }
      });
    });

    if (document.querySelector('[data-settings-form="email-bind"]')
      && !this.emailCaptcha && !this.emailCaptchaLoading) {
      void this.loadEmailCaptcha();
    }

    document.querySelectorAll<HTMLInputElement>(".settings-form input").forEach((input) => {
      input.addEventListener("input", () => {
        if (input.form?.dataset.settingsForm === "password") {
          clearFormFieldErrors(input.form);
        } else {
          clearFieldError(input);
        }
      });
    });

    document.querySelector<HTMLFormElement>("[data-feedback-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLFormElement) {
        void this.submitFeedbackForm(event.currentTarget);
      }
    });

    document
      .querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
        "[data-feedback-form] textarea, [data-feedback-form] input",
      )
      .forEach((field) => field.addEventListener("input", () => clearFieldError(field)));
  }

  captureDrafts() {
    const profileForm = document.querySelector<HTMLFormElement>('[data-settings-form="profile"]');
    if (profileForm) {
      this.profileDraft = { nickname: formValue(profileForm, "nickname") };
    }

    const passwordForm = document.querySelector<HTMLFormElement>('[data-settings-form="password"]');
    if (passwordForm) {
      this.passwordDraft = {
        currentPassword: formValue(passwordForm, "currentPassword"),
        newPassword: formValue(passwordForm, "newPassword"),
        confirmPassword: formValue(passwordForm, "confirmPassword"),
      };
    }

    const feedbackForm = document.querySelector<HTMLFormElement>("[data-feedback-form]");
    if (feedbackForm) {
      this.feedbackDraft = {
        content: formValue(feedbackForm, "content"),
        contact: formValue(feedbackForm, "contact"),
      };
    }

    const emailBindForm = document.querySelector<HTMLFormElement>('[data-settings-form="email-bind"]');
    if (emailBindForm) {
      this.emailBindDraft = {
        email: formValue(emailBindForm, "email"),
        currentPassword: formValue(emailBindForm, "currentPassword"),
        captchaCode: formValue(emailBindForm, "captchaCode"),
        emailCode: formValue(emailBindForm, "emailCode"),
        emailCodeId: this.emailBindDraft.emailCodeId,
      };
    }
  }

  private async loadEmailCaptcha() {
    this.emailCaptchaLoading = true;
    try {
      this.emailCaptcha = await this.deps.apiRequest<CaptchaResponse>("/v1/auth/captcha", {
        skipAuth: true,
      });
    } catch (error) {
      this.deps.showToast(this.deps.normalizeError(error));
    } finally {
      this.emailCaptchaLoading = false;
      this.deps.render();
    }
  }

  private async sendEmailBindCode() {
    if (!this.emailCaptcha || this.emailBindBusy || this.emailCodeCooldown.remainingSeconds > 0) return;
    if (this.emailBindDraft.emailCodeId && !this.resendCaptchaReady) {
      this.emailBindDraft.captchaCode = "";
      await this.loadEmailCaptcha();
      this.resendCaptchaReady = true;
      this.deps.showToast(this.deps.getText().resendCaptchaReady);
      return;
    }
    if (!this.validateEmailCodeRequest()) return;
    this.emailBindBusy = true;
    this.deps.render();
    try {
      const result = await this.deps.apiRequest<{ codeId: string; retryAfter: number }>("/v1/auth/email-codes", {
        method: "POST",
        body: {
          email: this.emailBindDraft.email,
          scene: "bind_email",
          captcha_id: this.emailCaptcha.captchaId,
          captcha_code: this.emailBindDraft.captchaCode,
        },
      });
      this.emailBindDraft.emailCodeId = result.codeId;
      this.resendCaptchaReady = false;
      this.emailCodeCooldown.start(result.retryAfter, () => this.syncEmailCodeButton());
      this.deps.showToast(this.deps.getText().emailCodeSent);
    } catch (error) {
      this.emailBindDraft.captchaCode = "";
      this.deps.showToast(this.deps.normalizeError(error));
      await this.loadEmailCaptcha();
      this.resendCaptchaReady = true;
    } finally {
      this.emailBindBusy = false;
      this.deps.render();
      this.syncEmailCodeButton();
    }
  }

  private validateEmailCodeRequest() {
    const form = document.querySelector<HTMLFormElement>('[data-settings-form="email-bind"]');
    const email = form?.elements.namedItem("email");
    const captcha = form?.elements.namedItem("captchaCode");
    if (!(email instanceof HTMLInputElement) || !email.reportValidity()) return false;
    if (!(captcha instanceof HTMLInputElement) || !captcha.reportValidity()) return false;
    return true;
  }

  private syncEmailCodeButton() {
    const button = document.querySelector<HTMLButtonElement>('[data-email-bind-action="send-code"]');
    if (!button) return;
    const seconds = this.emailCodeCooldown.remainingSeconds;
    const text = this.deps.getText();
    button.disabled = this.emailBindBusy || seconds > 0;
    button.textContent = seconds > 0
      ? text.resendEmailCode.replace("{seconds}", String(seconds))
      : text.sendEmailCode;
  }

  private async submitEmailBindForm(form: HTMLFormElement) {
    if (this.emailBindBusy) return;
    this.captureDrafts();
    this.emailBindBusy = true;
    this.deps.render();
    try {
      const user = await this.deps.apiRequest<AuthUser>("/v1/auth/email/bind", {
        method: "POST",
        body: {
          email: this.emailBindDraft.email,
          current_password: this.emailBindDraft.currentPassword,
          email_code_id: this.emailBindDraft.emailCodeId,
          email_code: this.emailBindDraft.emailCode,
        },
      });
      this.deps.setCurrentUser(user);
      this.emailBindDraft = emptyEmailBindDraft();
      this.emailCaptcha = null;
      this.deps.showToast(this.deps.getText().emailBound);
    } catch (error) {
      this.deps.showToast(this.deps.normalizeError(error));
    } finally {
      this.emailBindBusy = false;
      this.deps.render();
    }
  }

  private changeSystemSetting(element: HTMLSelectElement) {
    this.captureDrafts();
    if (element.dataset.systemSetting === "language") {
      const language = element.value === "en" ? "en" : "zh";
      this.deps.setLanguage(language);
      localStorage.setItem("channel-nest-language", language);
    } else if (element.dataset.systemSetting === "theme") {
      const theme = element.value === "light" ? "light" : "dark";
      this.deps.setTheme(theme);
      localStorage.setItem("channel-nest-theme", theme);
    }
    this.deps.showToast(this.deps.getText().settingsSaved);
    this.deps.render();
  }

  private async submitFeedbackForm(form: HTMLFormElement) {
    if (this.feedbackBusy) return;
    this.feedbackDraft = {
      content: formValue(form, "content"),
      contact: formValue(form, "contact"),
    };
    this.feedbackBusy = true;
    this.deps.render();

    try {
      await this.deps.apiRequest<{ id: string }>("/v1/feedback", {
        method: "POST",
        body: this.feedbackDraft,
      });
      this.feedbackDraft = { content: "", contact: "" };
      this.feedbackBusy = false;
      this.deps.render();
      this.deps.showToast(this.deps.getText().feedbackSubmitted);
    } catch (error) {
      const message = this.deps.normalizeError(error);
      this.feedbackBusy = false;
      this.deps.render();
      window.setTimeout(() => this.reportFeedbackFieldError(message), 0);
    }
  }

  private reportFeedbackFieldError(message: string) {
    const form = document.querySelector<HTMLFormElement>("[data-feedback-form]");
    if (form) {
      reportNamedFieldError(form, message.includes("联系方式") ? "contact" : "content", message);
    }
  }

  private async submitProfileForm(form: HTMLFormElement) {
    if (this.profileBusy) return;
    this.profileDraft = { nickname: formValue(form, "nickname") };
    this.profileBusy = true;
    this.deps.render();

    try {
      const user = await this.deps.apiRequest<AuthUser>("/v1/auth/profile", {
        method: "PUT",
        body: { nickname: this.profileDraft.nickname },
      });
      this.deps.setCurrentUser(user);
      this.profileDraft.nickname = user.nickname;
      this.profileBusy = false;
      this.deps.render();
      this.deps.showToast(this.deps.getText().profileSaved);
    } catch (error) {
      const message = this.deps.normalizeError(error);
      this.profileBusy = false;
      this.deps.render();
      window.setTimeout(() => this.reportFieldError("profile", "nickname", message), 0);
    }
  }

  private async submitPasswordForm(form: HTMLFormElement) {
    if (this.passwordBusy) return;
    this.passwordDraft = {
      currentPassword: formValue(form, "currentPassword"),
      newPassword: formValue(form, "newPassword"),
      confirmPassword: formValue(form, "confirmPassword"),
    };

    if (this.passwordDraft.newPassword !== this.passwordDraft.confirmPassword) {
      this.reportFieldError("password", "confirmPassword", this.deps.getText().passwordMismatch);
      return;
    }

    this.passwordBusy = true;
    this.deps.render();
    try {
      await this.deps.apiRequest<AuthUser>("/v1/auth/password", {
        method: "PUT",
        body: {
          current_password: this.passwordDraft.currentPassword,
          new_password: this.passwordDraft.newPassword,
        },
      });
      this.passwordDraft = emptyPasswordDraft();
      this.passwordBusy = false;
      this.deps.render();
      this.deps.showToast(this.deps.getText().passwordChanged);
    } catch (error) {
      const message = this.deps.normalizeError(error);
      this.passwordBusy = false;
      this.deps.render();
      window.setTimeout(() => this.reportFieldError("password", this.passwordErrorField(message), message), 0);
    }
  }

  private reportFieldError(formName: string, fieldName: string, message: string) {
    const form = document.querySelector<HTMLFormElement>(`[data-settings-form="${formName}"]`);
    reportNamedFieldError(form, fieldName, message);
  }

  private passwordErrorField(message: string) {
    const normalized = message.toLowerCase();
    return message.includes("新密码") || normalized.includes("new password")
      ? "newPassword"
      : "currentPassword";
  }
}
