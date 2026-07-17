const fs = require('fs');
const path = require('path');
const lodash = require('lodash');

const configPath = path.resolve(__dirname, 'config.json');

const defaultConfig = {
  env: 'dev',
  host: '127.0.0.1',
  port: 3100,
  sign_token: 'channel-nest-local-sign',
  jwt_secret: 'channel-nest-local-secret',
  auth: {
    allow_anonymous_desktop: false,
  },
  mysql: {
    db: {
      database: 'channel_nest',
      userName: 'root',
      password: '',
      conn: {
        host: '127.0.0.1',
        port: 3306,
        dialect: 'mysql',
        logging: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        timezone: '+08:00',
        define: {
          charset: 'utf8mb4',
          collate: 'utf8mb4_unicode_ci',
        },
      },
    },
  },
  desktop_update: {
    enabled: true,
    release_token: '',
    latest_version: '1.1.2',
    pub_date: '2026-07-16T00:00:00Z',
    notes: '1.1.2：优化 AI 图片生成结果分发，生成图片改为 OSS 临时文件直传客户端；客户端下载成功后自动 ack 并删除 OSS 临时图片；移除业务服务器本地图片输出下载链路，降低服务器带宽占用并提升失败提示。',
    manifest_path: 'storage/desktop-update-manifest.json',
    download_dir: 'public/desktop-updates',
    platforms: {},
  },
  email: {
    smtp: {
      host: '',
      port: 465,
      secure: true,
      user: '',
      password: '',
    },
    from: {
      address: '',
      name: '',
    },
    code_hmac_pepper: '',
    verification: {
      ttl_seconds: 600,
      resend_seconds: 60,
      max_attempts: 5,
      email_hourly_limit: 5,
      email_daily_limit: 10,
      ip_hourly_limit: 20,
      ip_daily_limit: 50,
      retention_days: 2,
    },
  },
  openai: {
    api_key: '',
    base_url: 'https://api.openai.com/v1',
    organization_id: '',
    project_id: '',
    safety_identifier_hmac_pepper: '',
    sdk_max_retries: 0,
    text: {
      provider: 'openai',
      api_key: '',
      base_url: '',
      api: 'responses',
      model: 'gpt-5.4',
      enable_thinking: false,
      evaluation_model: 'gpt-5.6-luna',
      evaluation_enabled: false,
      reasoning_effort: 'none',
      max_output_tokens: 3000,
      store: false,
      service_tier: 'default',
      timeout_ms: 30000,
      application_max_retries: 1,
      global_concurrency: 20,
      per_user_concurrency: 2,
      prompt_version: 'marketing-copy-v4',
    },
    image: {
      api: 'images',
      api_dialect: 'openai-native',
      model: 'gpt-image-2',
      quality: 'low',
      moderation: 'auto',
      background: 'opaque',
      output_format: 'jpeg',
      response_format: 'url',
      output_compression: 90,
      images_per_provider_call: 1,
      timeout_ms: 840000,
      application_max_retries: 1,
      global_concurrency: 2,
      per_user_active_tasks: 1,
      max_reference_images: 4,
      prompt_profile_version: 'baoyu-social-image-v2',
      prompt_source_repository: 'JimLiu/baoyu-skills',
      prompt_source_commit: '6b7a2e417500561a5ecdd0b168332f4142584617',
    },
    pricing: {
      version: 'openai-2026-07-14-standard',
      text_input_usd_per_million_tokens: 0.2,
      text_cached_input_usd_per_million_tokens: 0.02,
      text_output_usd_per_million_tokens: 1.25,
      image_text_input_usd_per_million_tokens: 5,
      image_cached_input_usd_per_million_tokens: 1.25,
      image_output_usd_per_million_tokens: 30,
    },
  },
  payment: {
    provider: '',
    callback_base_url: '',
    order_ttl_seconds: 900,
    reconcile_interval_seconds: 3,
    alipay: {
      gateway: 'https://openapi.alipay.com/gateway.do',
      app_id: '',
      merchant_id: '',
      signing_private_key: '',
      provider_public_key_or_cert: '',
      charset: 'utf-8',
      sign_type: 'RSA2',
      format: 'JSON',
    },
  },
  messages: {
    retention_days: 180,
  },
  ai_temp_storage: {
    path: '/tmp/market_tool',
    ttl_seconds: 3600,
    oss: {
      enabled: false,
      region: '',
      bucket: '',
      access_key_id: '',
      access_key_secret: '',
      internal_endpoint: '',
      public_endpoint: '',
      prefix: 'tmp/channel-nest/ai-images',
      signed_url_ttl_seconds: 900,
    },
  },
  dingtalk: {
    token: '',
  },
};

function readConfigFile() {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function normalizeConfig(config) {
  const normalized = config;
  const mysqlLogging = lodash.get(normalized, 'mysql.db.conn.logging', false);

  lodash.set(normalized, 'mysql.db.conn.logging', mysqlLogging ? console.log : false);

  return normalized;
}

module.exports = normalizeConfig(lodash.defaultsDeep({}, readConfigFile(), defaultConfig));
