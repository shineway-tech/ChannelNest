const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? "http://127.0.0.1:3100"
  : "https://market-api.honeykid.cn";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;
export const APP_VERSION = __APP_VERSION__;
export const AUTH_TOKEN_KEY = "channel_nest_api-token";
export const AUTO_UPDATE_KEY = "channel-nest-auto-update";
export const INPUT_HINTS_OFF = 'autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true"';
