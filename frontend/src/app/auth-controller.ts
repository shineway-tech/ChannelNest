import type { AuthSession, AuthViewMode, CaptchaResponse, ThemeMode } from "../domain/types";
import type { CopyText } from "../i18n/copy";
import { renderAuthPage } from "../pages/auth";
import { ApiError, type ApiRequest } from "../services/api";
import { INPUT_HINTS_OFF } from "../config/app";
import { Countdown } from "../utils/countdown";
import { clearFieldError, formValue, reportFieldError } from "../utils/forms";

interface AuthControllerDependencies {
  getText: () => CopyText;
  getTheme: () => ThemeMode;
  apiRequest: ApiRequest;
  onAuthenticated: (session: AuthSession) => Promise<void>;
  render: () => void;
  showToast: (message: string) => void;
  normalizeError: (error: unknown) => string;
}

const emptyAuthDraft = () => ({
  account: "",
  password: "",
  nickname: "",
  captchaCode: "",
  emailCode: "",
  emailCodeId: "",
});

export class AuthController {
  private viewMode: AuthViewMode = "login";
  private captcha: CaptchaResponse | null = null;
  private busy = false;
  private draft = emptyAuthDraft();
  private readonly emailCodeCooldown = new Countdown();
  private resendCaptchaReady = false;

  constructor(private readonly deps: AuthControllerDependencies) {}

  renderPage() {
    return renderAuthPage({
      text: this.deps.getText(),
      theme: this.deps.getTheme(),
      authViewMode: this.viewMode,
      authDraft: this.draft,
      captcha: this.captcha,
      authBusy: this.busy,
      emailCodeCooldownSeconds: this.emailCodeCooldown.remainingSeconds,
      inputHints: INPUT_HINTS_OFF,
    });
  }

  bindEvents() {
    document.querySelectorAll<HTMLElement>("[data-auth-action]").forEach((element) => {
      element.addEventListener("click", () => {
        const action = element.dataset.authAction;
        if (action === "refresh-captcha") {
          this.captureDraft();
          void this.loadCaptchaAndRender();
        } else if (action === "send-email-code") {
          this.captureDraft();
          void this.sendEmailCode();
        } else if (action === "show-register" || action === "show-login" || action === "show-reset") {
          this.captureDraft();
          this.viewMode = action === "show-register" ? "register" : action === "show-reset" ? "reset" : "login";
          void this.loadCaptchaAndRender();
        }
      });
    });

    document.querySelector<HTMLFormElement>("[data-auth-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLFormElement) {
        void this.submit(event.currentTarget);
      }
    });

    document.querySelectorAll<HTMLInputElement>(".login-form input").forEach((input) => {
      input.addEventListener("input", () => clearFieldError(input));
    });
  }

  async loadCaptcha() {
    try {
      this.captcha = await this.deps.apiRequest<CaptchaResponse>("/v1/auth/captcha", { skipAuth: true });
    } catch (error) {
      this.captcha = null;
      console.warn("Failed to load captcha", error);
    }
  }

  loadCaptchaAndRender() {
    return this.loadCaptcha().then(() => this.deps.render());
  }

  reset() {
    this.emailCodeCooldown.clear();
    this.resendCaptchaReady = false;
    this.viewMode = "login";
    this.busy = false;
    this.draft = emptyAuthDraft();
  }

  private captureDraft(form = document.querySelector<HTMLFormElement>("[data-auth-form]")) {
    if (!form) return;
    this.draft = {
      account: formValue(form, "account"),
      password: formValue(form, "password"),
      nickname: formValue(form, "nickname"),
      captchaCode: formValue(form, "captchaCode"),
      emailCode: formValue(form, "emailCode"),
      emailCodeId: this.draft.emailCodeId,
    };
  }

  private async submit(form: HTMLFormElement) {
    if (this.busy) return;
    this.captureDraft(form);
    const isRegister = this.viewMode === "register";
    const isReset = this.viewMode === "reset";
    this.busy = true;
    this.deps.render();

    try {
      if (isReset) {
        await this.deps.apiRequest("/v1/auth/password/reset", {
          method: "POST",
          body: {
            email: this.draft.account,
            new_password: this.draft.password,
            email_code_id: this.draft.emailCodeId,
            email_code: this.draft.emailCode,
          },
        });
        this.draft = emptyAuthDraft();
        this.viewMode = "login";
        this.busy = false;
        this.deps.render();
        this.deps.showToast(this.deps.getText().passwordResetSuccess);
        return;
      }
      const session = await this.deps.apiRequest<AuthSession>(
        isRegister ? "/v1/auth/register" : "/v1/auth/login",
        {
          method: "POST",
          body: {
            ...(isRegister
              ? {
                  email: this.draft.account,
                  email_code_id: this.draft.emailCodeId,
                  email_code: this.draft.emailCode,
                }
              : {
                  identifier: this.draft.account,
                  account: this.draft.account,
                }),
            password: this.draft.password,
            nickname: this.draft.nickname,
          },
        },
      );
      this.draft = emptyAuthDraft();
      await this.deps.onAuthenticated(session);
      this.deps.render();
      this.deps.showToast(isRegister ? this.deps.getText().registerSuccess : this.deps.getText().loginSuccess);
    } catch (error) {
      const message = this.deps.normalizeError(error);
      if (isRegister || isReset) await this.loadCaptcha();
      this.busy = false;
      this.deps.render();
      window.setTimeout(() => this.reportFieldError(message), 0);
    } finally {
      this.busy = false;
    }
  }

  private async sendEmailCode() {
    if (!this.captcha || this.busy || this.emailCodeCooldown.remainingSeconds > 0) return;
    if (this.draft.emailCodeId && !this.resendCaptchaReady) {
      this.draft.captchaCode = "";
      await this.loadCaptcha();
      this.resendCaptchaReady = true;
      this.deps.render();
      this.deps.showToast(this.deps.getText().resendCaptchaReady);
      return;
    }
    if (!this.validateEmailCodeRequest()) return;
    this.busy = true;
    this.deps.render();
    try {
      const isReset = this.viewMode === "reset";
      const result = await this.deps.apiRequest<{ codeId: string; retryAfter: number }>(
        isReset ? "/v1/auth/password/reset-codes" : "/v1/auth/email-codes",
        {
        method: "POST",
        body: {
          email: this.draft.account,
          scene: isReset ? "reset_password" : "register",
          captcha_id: this.captcha.captchaId,
          captcha_code: this.draft.captchaCode,
        },
        },
      );
      this.draft.emailCodeId = result.codeId;
      this.resendCaptchaReady = false;
      this.emailCodeCooldown.start(result.retryAfter, () => this.syncEmailCodeButton());
      this.deps.showToast(this.deps.getText().emailCodeSent);
      this.deps.render();
    } catch (error) {
      const message = this.deps.normalizeError(error);
      this.draft.captchaCode = "";
      await this.loadCaptcha();
      this.resendCaptchaReady = true;
      this.deps.render();
      if (error instanceof ApiError && [21004, 21006].includes(error.code)) {
        this.deps.showToast(message);
      } else {
        window.setTimeout(() => this.reportFieldError(message), 0);
      }
    } finally {
      this.busy = false;
      this.deps.render();
      this.syncEmailCodeButton();
    }
  }

  private validateEmailCodeRequest() {
    const form = document.querySelector<HTMLFormElement>("[data-auth-form]");
    const email = form?.elements.namedItem("account");
    const captcha = form?.elements.namedItem("captchaCode");
    if (!(email instanceof HTMLInputElement) || !email.reportValidity()) return false;
    if (!(captcha instanceof HTMLInputElement) || !captcha.reportValidity()) return false;
    return true;
  }

  private syncEmailCodeButton() {
    const button = document.querySelector<HTMLButtonElement>('[data-auth-action="send-email-code"]');
    if (!button) return;
    const seconds = this.emailCodeCooldown.remainingSeconds;
    const text = this.deps.getText();
    button.disabled = this.busy || seconds > 0;
    button.textContent = seconds > 0
      ? text.resendEmailCode.replace("{seconds}", String(seconds))
      : text.sendEmailCode;
  }

  private reportFieldError(message: string) {
    const form = document.querySelector<HTMLFormElement>("[data-auth-form]");
    if (!form) return;
    reportFieldError(this.errorField(message, form), message);
  }

  private errorField(message: string, form: HTMLFormElement) {
    const normalized = message.toLowerCase();
    const fieldName = message.includes("邮件验证码") || normalized.includes("email code")
      ? "emailCode"
      : message.includes("验证码") || normalized.includes("captcha")
        ? "captchaCode"
      : message.includes("密码") || normalized.includes("password")
        ? "password"
        : "account";
    const field = form.elements.namedItem(fieldName);
    return field instanceof HTMLInputElement
      ? field
      : form.querySelector<HTMLInputElement>("input") || document.createElement("input");
  }
}
