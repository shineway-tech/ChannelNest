use chrono::{DateTime, Utc};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    process::Command,
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use url::{form_urlencoded, Url};
use uuid::Uuid;

mod channel_urls;
mod browser;
mod commands;
mod common;
mod domain;
mod json_ext;
mod platforms;
mod services;
mod settings;
mod state;
mod storage;

use channel_urls::*;
use browser::*;
use common::*;
use domain::*;
use json_ext::*;
use platforms::*;
use settings::*;
use state::*;
use storage::local_store::*;

const CHANNEL_ACCOUNT_UPDATED_EVENT: &str = "channel-account-updated";

pub fn run() {
    configure_process_locale();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let store = load_store(&app.handle())?;
            if store
                .accounts
                .iter()
                .any(|account| normalize_platform_id(&account.platform_id) == "xiaohongshu")
            {
                if let Err(error) = warm_xhs_creator_signer() {
                    eprintln!("[xhs-sync] signer warmup failed: {error}");
                }
            }
            app.manage(RuntimeState {
                store: Mutex::new(store),
                pending_auth: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::save_generated_image_output_from_url,
            commands::ai::save_generated_image_to_downloads,
            commands::resource::create_local_resource,
            commands::resource::list_local_resources,
            commands::resource::delete_local_resource,
            commands::channel::get_bootstrap,
            commands::channel::list_channel_accounts,
            commands::channel::save_auth_settings,
            commands::channel::start_channel_login,
            commands::channel::get_auth_task_status,
            commands::channel::refresh_channel_account,
            commands::channel::sync_channel_account_content,
            commands::channel::load_channel_account_works_page,
            commands::channel::publish_channel_work,
            commands::channel::inspect_local_media,
            commands::channel::mark_channel_account_unavailable,
            commands::channel::open_account_homepage,
            commands::channel::delete_channel_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running marketing master");
}

#[cfg(target_os = "macos")]
fn configure_process_locale() {
    let lang = std::env::var("LANG").unwrap_or_default();
    let lc_all = std::env::var("LC_ALL").unwrap_or_default();
    if !is_neutral_locale(&lang) && !is_neutral_locale(&lc_all) {
        return;
    }

    if let Some(locale) = read_macos_preferred_locale() {
        std::env::set_var("LANG", &locale);
        std::env::set_var("LC_ALL", &locale);
        std::env::set_var("LC_MESSAGES", &locale);
    }
}

#[cfg(not(target_os = "macos"))]
fn configure_process_locale() {}

#[cfg(target_os = "macos")]
fn is_neutral_locale(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.is_empty() || normalized == "c" || normalized == "c.utf-8" || normalized == "posix"
}

#[cfg(target_os = "macos")]
fn read_macos_preferred_locale() -> Option<&'static str> {
    let output = Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        .ok()?;
    let languages = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();

    if languages.contains("zh-hans") || languages.contains("zh_cn") || languages.contains("zh-cn") {
        return Some("zh_CN.UTF-8");
    }
    if languages.contains("zh-hant") || languages.contains("zh_tw") || languages.contains("zh-tw") {
        return Some("zh_TW.UTF-8");
    }
    if languages.contains("en") {
        return Some("en_US.UTF-8");
    }
    None
}
