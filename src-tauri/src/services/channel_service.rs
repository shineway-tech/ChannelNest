use crate::*;

mod auth;
mod publish;
mod sync;

pub(crate) use auth::{get_auth_task_status, save_auth_settings, start_channel_login};
pub(crate) use publish::publish_channel_work;
pub(crate) use sync::{
    load_channel_account_works_page,
    refresh_channel_account,
    sync_channel_account_content,
};

pub(crate) async fn get_bootstrap(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    user_id: String,
) -> Result<Bootstrap, String> {
    let user_id = normalize_user_id(&user_id)?;
    let (settings, accounts) = {
        let mut store = state.store.lock().map_err(lock_error)?;
        if claim_legacy_accounts_for_user(&mut store, &user_id) {
            persist_store(&app, &store)?;
        }
        (store.settings.clone(), user_accounts(&store, &user_id))
    };
    Ok(Bootstrap {
        platforms: default_platforms(),
        accounts,
        settings,
        callback_base_url: None,
    })
}

pub(crate) async fn list_channel_accounts(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    user_id: String,
) -> Result<Vec<ChannelAccount>, String> {
    let user_id = normalize_user_id(&user_id)?;
    let mut store = state.store.lock().map_err(lock_error)?;
    if claim_legacy_accounts_for_user(&mut store, &user_id) {
        persist_store(&app, &store)?;
    }
    Ok(user_accounts(&store, &user_id))
}

async fn creator_session_for_data_sync(
    account: &ChannelAccount,
    saved_login_cookie: Option<&str>,
    saved_webview_session_id: Option<&str>,
) -> Result<CreatorSessionStatus, String> {
    let login_cookie = saved_login_cookie
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{}登录已失效，请重新登录后再同步。", platform_name(&account.platform_id)))?
        .to_string();
    let cookie_header = plugin_cookie_header(&login_cookie);
    if cookie_header.trim().is_empty() {
        return Err(format!("{}登录已失效，请重新登录后再同步。", platform_name(&account.platform_id)));
    }

    let platform_id = normalize_platform_id(&account.platform_id);
    if platform_id == "douyin" && !has_douyin_login_cookie(&login_cookie) {
        return Err("抖音网页登录态已失效，请重新登录后再同步。".to_string());
    }
    if platform_id == "kuaishou" && !has_kuaishou_creator_login_cookie_header(&cookie_header) {
        return Err("快手网页登录态已失效，请重新登录后再同步。".to_string());
    }

    Ok(CreatorSessionStatus {
        login_cookie: Some(login_cookie.clone()),
        webview_session_id: saved_webview_session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        profile: Some(local_account_profile(account, login_cookie)),
    })
}

fn normalize_works_work_type(platform_id: &str, value: Option<&str>) -> Option<String> {
    let platform_id = normalize_platform_id(platform_id);
    let normalized = match platform_id.as_str() {
        _ if crate::platforms::supports_typed_works(&platform_id) => match value.unwrap_or_default().trim() {
            "article" | "photo" | "photos" | "picture" | "image" | "images" | "atlas" | "new-life" | "newlife" => "article",
            _ => "video",
        },
        _ => return None,
    };
    Some(normalized.to_string())
}

fn raw_works_page_key(page_key: &str, work_type: Option<&str>) -> String {
    let page_key = page_key.trim();
    let Some(work_type) = work_type else {
        return page_key.to_string();
    };
    page_key
        .strip_prefix(&format!("{work_type}:"))
        .or_else(|| strip_known_works_type_prefix(page_key))
        .unwrap_or(page_key)
        .to_string()
}

fn works_cache_page_key(page_key: &str, work_type: Option<&str>) -> String {
    match work_type {
        Some(work_type) => format!("{work_type}:{}", raw_works_page_key(page_key, Some(work_type))),
        None => page_key.trim().to_string(),
    }
}

fn strip_known_works_type_prefix(page_key: &str) -> Option<&str> {
    ["video", "article"]
        .into_iter()
        .find_map(|work_type| page_key.strip_prefix(&format!("{work_type}:")))
}

fn apply_works_cache_keys(page: &mut ChannelWorksPage, work_type: Option<&str>) {
    page.page_key = works_cache_page_key(&page.page_key, work_type);
    page.work_type = work_type.map(ToString::to_string);
    if let Some(next_page_key) = page.next_page_key.take() {
        page.next_page_key = Some(works_cache_page_key(&next_page_key, work_type));
    }
}

fn normalize_works_page_for_request(
    mut page: ChannelWorksPage,
    work_type: Option<&str>,
) -> ChannelWorksPage {
    apply_works_cache_keys(&mut page, work_type);
    page
}

fn account_with_secrets(
    app: &AppHandle,
    state: &State<'_, RuntimeState>,
    account_id: &str,
    user_id: &str,
) -> Result<(ChannelAccount, Option<String>, Option<String>), String> {
    let mut store = state.store.lock().map_err(lock_error)?;
    let account = store
        .accounts
        .iter()
        .find(|item| item.id == account_id && account_belongs_to_user(item, user_id))
        .cloned()
        .ok_or_else(|| "账号不存在".to_string())?;
    let migrated = migrate_account_secret_for_account(&mut store, &account);
    let secret = account_secret_for_account(&store, &account);
    let saved_login_cookie = secret.as_ref().and_then(|secret| secret.login_cookie.clone());
    let saved_webview_session_id = secret.as_ref().and_then(|secret| secret.webview_session_id.clone());
    if migrated {
        persist_store(app, &store)?;
    }
    Ok((account, saved_login_cookie, saved_webview_session_id))
}

fn account_profile_snapshot_from_account(account: &ChannelAccount) -> ChannelAccountProfileSnapshot {
    channel_profile_snapshot(
        &account.id,
        &account.platform_id,
        account.followers,
        account.following,
        account.likes,
    )
}

const CHANNEL_CACHE_TTL_SECONDS: i64 = 300;

fn account_content_cache_is_fresh(content: &ChannelAccountContent) -> bool {
    if !is_usable_cache_status(&content.sync_status) || !account_content_has_core_data(content) {
        return false;
    }
    if content.platform_id == "xiaohongshu"
        && content.latest_work.is_some()
        && content.latest_work_thirty.is_none()
    {
        return false;
    }
    if content.platform_id == "xiaohongshu" && !xhs_latest_work_metrics_are_fresh(content) {
        return false;
    }
    if content.platform_id == "douyin" && !douyin_account_content_cache_is_current(content) {
        return false;
    }
    if content.platform_id == "wechat-channels"
        && content.latest_work.is_none()
        && content.latest_work_seven.is_none()
    {
        return false;
    }
    if content.platform_id == "bilibili"
        && (content.overview_ninety.is_none()
            || content.overview_history.is_none()
            || content.overview_total.is_none()
            || (content.latest_work.is_none() && content.latest_work_seven.is_none()))
    {
        return false;
    }
    if content.platform_id == "kuaishou" && content.overview_ninety.is_none() {
        return false;
    }
    account_content_oldest_updated_at(content)
        .map(is_cache_time_fresh)
        .unwrap_or(false)
}

fn account_content_has_core_data(content: &ChannelAccountContent) -> bool {
    content.profile.is_some()
        || content.overview_yesterday.is_some()
        || content.overview_seven.is_some()
        || content.overview_thirty.is_some()
        || content.overview_ninety.is_some()
        || content.overview_history.is_some()
        || content.overview_total.is_some()
        || content.latest_work.is_some()
        || content.latest_work_seven.is_some()
        || content.latest_work_thirty.is_some()
}

fn account_content_oldest_updated_at(content: &ChannelAccountContent) -> Option<DateTime<Utc>> {
    [
        content.profile.as_ref().and_then(|value| value.updated_at),
        content.overview_yesterday.as_ref().and_then(|value| value.updated_at),
        content.overview_seven.as_ref().and_then(|value| value.updated_at),
        content.overview_thirty.as_ref().and_then(|value| value.updated_at),
        content.overview_ninety.as_ref().and_then(|value| value.updated_at),
        content.overview_history.as_ref().and_then(|value| value.updated_at),
        content.overview_total.as_ref().and_then(|value| value.updated_at),
    ]
    .into_iter()
    .flatten()
    .min()
}

fn xhs_latest_work_metrics_are_fresh(content: &ChannelAccountContent) -> bool {
    let has_latest = content.latest_work.is_some()
        || content.latest_work_seven.is_some()
        || content.latest_work_thirty.is_some();
    if !has_latest {
        return true;
    }
    [
        &content.latest_work,
        &content.latest_work_seven,
        &content.latest_work_thirty,
    ]
        .into_iter()
        .flatten()
        .any(xhs_work_has_detail_metrics)
}

fn xhs_work_has_detail_metrics(work: &ChannelContentWork) -> bool {
    work.views.is_some()
        && work.impressions.is_some()
        && work.cover_click_rate.is_some()
        && work.data_updated_at.is_some()
        && work.avg_view_time.is_some()
        && [
            work.likes,
            work.comments,
            work.collects,
            work.shares,
        ]
        .into_iter()
        .any(|value| value.is_some())
}

const DOUYIN_LATEST_VIDEO_REQUIRED_METRICS: &[&str] = &[
    "danmaku",
    "avgViewSecond",
    "completionRate",
    "bounceRate",
    "completionRate5s",
    "avgViewProportion",
    "subscribe",
    "subscribeRate",
    "unsubscribe",
    "unsubscribeRate",
    "dislike",
    "dislikeRate",
];
const DOUYIN_ARTICLE_DETAIL_METRICS: &[&str] = &["descriptionSpreadRate", "imageAvgViewCount"];
const DOUYIN_WORK_PAGE_VIDEO_DETAIL_METRICS: &[&str] = &["avgViewSecond", "completionRate"];

fn douyin_account_content_cache_is_current(content: &ChannelAccountContent) -> bool {
    let Some(work) = content.latest_work.as_ref() else {
        return false;
    };
    let Some(work_type) = work.work_type.as_deref() else {
        return false;
    };
    if work
        .published_at
        .map(|published_at| Utc::now().signed_duration_since(published_at) > chrono::Duration::days(35))
        .unwrap_or(false)
    {
        return false;
    }
    let has_type_metric = match work_type {
        "video" => work_has_all_metrics(work, DOUYIN_LATEST_VIDEO_REQUIRED_METRICS),
        "article" | "image" | "note" => work_has_any_metric(work, DOUYIN_ARTICLE_DETAIL_METRICS),
        _ => false,
    };
    has_type_metric && work.views.is_some()
}

fn work_has_all_metrics(work: &ChannelContentWork, keys: &[&str]) -> bool {
    keys.iter().all(|key| work_has_metric(work, key))
}

fn work_has_any_metric(work: &ChannelContentWork, keys: &[&str]) -> bool {
    keys.iter().any(|key| work_has_metric(work, key))
}

fn work_has_metric(work: &ChannelContentWork, key: &str) -> bool {
    work.metrics.iter().any(|metric| metric.key == key)
}

fn works_page_cache_is_fresh(page: &ChannelWorksPage) -> bool {
    if !is_usable_cache_status(&page.sync_status) {
        return false;
    }
    if page.platform_id == "douyin" && !douyin_works_page_cache_is_current(page) {
        return false;
    }
    page.updated_at.map(is_cache_time_fresh).unwrap_or(false)
}

fn douyin_works_page_cache_is_current(page: &ChannelWorksPage) -> bool {
    page.works.is_empty()
        || page.works.iter().any(douyin_work_page_item_has_detail_metrics)
}

fn douyin_work_page_item_has_detail_metrics(work: &ChannelContentWork) -> bool {
    match work.work_type.as_deref() {
        Some("video") => work_has_any_metric(work, DOUYIN_WORK_PAGE_VIDEO_DETAIL_METRICS),
        Some("article" | "image" | "note") => work_has_any_metric(work, DOUYIN_ARTICLE_DETAIL_METRICS),
        _ => false,
    }
}

fn is_cache_time_fresh(updated_at: DateTime<Utc>) -> bool {
    Utc::now()
        .signed_duration_since(updated_at)
        .num_seconds()
        < CHANNEL_CACHE_TTL_SECONDS
}

fn is_usable_cache_status(status: &str) -> bool {
    matches!(status, "synced" | "cached")
}

fn cached_with_error(mut content: ChannelAccountContent, error: &str) -> ChannelAccountContent {
    content.sync_status = "failed".to_string();
    content.error = Some(error.to_string());
    if let Some(profile) = content.profile.as_mut() {
        profile.sync_status = "failed".to_string();
        profile.error = Some(error.to_string());
    }
    for overview in [
        &mut content.overview_yesterday,
        &mut content.overview_seven,
        &mut content.overview_thirty,
        &mut content.overview_ninety,
        &mut content.overview_history,
        &mut content.overview_total,
    ]
        .into_iter()
        .flatten()
    {
        overview.sync_status = "failed".to_string();
        overview.error = Some(error.to_string());
    }
    content
}

fn cached_with_error_for_account(
    mut content: ChannelAccountContent,
    account: &ChannelAccount,
    error: &str,
) -> ChannelAccountContent {
    content.account_id = account.id.clone();
    content.platform_id = normalize_platform_id(&account.platform_id);
    if content.profile.is_none() {
        content.profile = Some(account_profile_snapshot_from_account(account));
    }
    cached_with_error(content, error)
}

fn works_page_with_error(mut page: ChannelWorksPage, error: &str) -> ChannelWorksPage {
    page.sync_status = "failed".to_string();
    page.error = Some(error.to_string());
    page
}

fn update_account_from_content_profile(
    app: &AppHandle,
    user_id: &str,
    account_id: &str,
    profile: &ChannelAccountProfileSnapshot,
) -> Result<ChannelAccount, String> {
    let runtime = app.state::<RuntimeState>();
    let mut store = runtime.store.lock().map_err(lock_error)?;
    let account = store
        .accounts
        .iter_mut()
        .find(|item| item.id == account_id && account_belongs_to_user(item, user_id))
        .ok_or_else(|| "账号不存在".to_string())?;
    let preserve_missing_metrics = normalize_platform_id(&account.platform_id) == "kuaishou";
    if profile.followers.is_some() || !preserve_missing_metrics {
        account.followers = profile.followers;
    }
    if profile.following.is_some() || !preserve_missing_metrics {
        account.following = profile.following;
    }
    if profile.likes.is_some() || !preserve_missing_metrics {
        account.likes = profile.likes;
    }
    account.status = AccountStatus::Active;
    account.last_sync_at = profile.last_sync_at.or(Some(Utc::now()));
    account.updated_at = Utc::now();
    let cloned = account.clone();
    persist_store(app, &store)?;
    emit_account_updated(app, &cloned);
    Ok(cloned)
}

fn is_login_expired_message(message: &str) -> bool {
    message.contains("登录已失效")
        || message.contains("登录已过期")
        || message.contains("请重新登录")
        || message.contains("请先在打开的")
}

async fn refresh_account_creator_session(
    account: &ChannelAccount,
    saved_login_cookie: Option<&str>,
    saved_webview_session_id: Option<&str>,
) -> Result<CreatorSessionStatus, String> {
    if normalize_platform_id(&account.platform_id) == "kuaishou" {
        let fallback_status = match check_creator_session(
            account,
            saved_login_cookie,
            saved_webview_session_id,
        )
        .await
        {
            Ok(status) => status,
            Err(error) if !is_login_expired_message(&error) => {
                if let Some(login_cookie) = saved_login_cookie
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
                {
                    eprintln!(
                        "[creator-session:kuaishou] using local account profile after direct probe failed: {error}"
                    );
                    return Ok(CreatorSessionStatus {
                        login_cookie: Some(login_cookie.clone()),
                        webview_session_id: saved_webview_session_id.map(ToString::to_string),
                        profile: Some(local_account_profile(account, login_cookie)),
                    });
                }
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        if fallback_status
            .profile
            .as_ref()
            .map(|profile| is_kuaishou_cookie_fallback_nickname(&profile.nickname))
            .unwrap_or(false)
        {
            if let Some(login_cookie) = fallback_status
                .login_cookie
                .clone()
                .or_else(|| saved_login_cookie.map(ToString::to_string))
            {
                return Ok(CreatorSessionStatus {
                    login_cookie: Some(login_cookie.clone()),
                    webview_session_id: fallback_status.webview_session_id,
                    profile: Some(local_account_profile(account, login_cookie)),
                });
            }
            return Err("快手账号资料未能读取到真实昵称，请重新登录后再同步。".to_string());
        }
        return Ok(fallback_status);
    }

    check_creator_session(account, saved_login_cookie, saved_webview_session_id).await
}

fn local_account_profile(account: &ChannelAccount, login_cookie: String) -> PluginAccountInfo {
    PluginAccountInfo {
        uid: account.uid.clone(),
        account: account.uid.clone(),
        nickname: account.nickname.clone(),
        avatar: account.avatar.clone(),
        fans_count: account.followers,
        following_count: account.following,
        like_count: account.likes,
        login_cookie,
    }
}

fn should_update_account_nickname(account: &ChannelAccount, nickname: &str) -> bool {
    let nickname = nickname.trim();
    if nickname.is_empty() {
        return false;
    }
    if normalize_platform_id(&account.platform_id) == "kuaishou"
        && !account.nickname.trim().is_empty()
        && is_kuaishou_cookie_fallback_nickname(nickname)
    {
        return false;
    }
    true
}

fn is_kuaishou_cookie_fallback_nickname(nickname: &str) -> bool {
    nickname == "快手账号"
        || nickname
            .strip_prefix("快手账号 ")
            .map(|suffix| suffix.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(false)
}

pub(crate) async fn mark_channel_account_unavailable(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    account_id: String,
    user_id: String,
) -> Result<ChannelAccount, String> {
    let user_id = normalize_user_id(&user_id)?;
    {
        let store = state.store.lock().map_err(lock_error)?;
        store
            .accounts
            .iter()
            .find(|item| item.id == account_id && account_belongs_to_user(item, &user_id))
            .ok_or_else(|| "账号不存在".to_string())?;
    }
    mark_account_expired(&app, &account_id)
}

pub(crate) async fn open_account_homepage(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    account_id: String,
    user_id: String,
) -> Result<ChannelAccount, String> {
    let user_id = normalize_user_id(&user_id)?;
    let (mut account, mut saved_login_cookie, mut saved_webview_session_id) = {
        let mut store = state.store.lock().map_err(lock_error)?;
        let account = store
            .accounts
            .iter()
            .find(|item| item.id == account_id && account_belongs_to_user(item, &user_id))
            .cloned()
            .ok_or_else(|| "账号不存在".to_string())?;
        let migrated = migrate_account_secret_for_account(&mut store, &account);
        let secret = account_secret_for_account(&store, &account);
        let saved_login_cookie = secret.as_ref().and_then(|secret| secret.login_cookie.clone());
        let saved_webview_session_id = secret.as_ref().and_then(|secret| secret.webview_session_id.clone());
        if migrated {
            persist_store(&app, &store)?;
        }
        Ok::<_, String>((account, saved_login_cookie, saved_webview_session_id))
    }
    ?;

    if creator_home_uses_managed_browser(&account.platform_id) {
        match check_creator_session(
            &account,
            saved_login_cookie.as_deref(),
            saved_webview_session_id.as_deref(),
        )
        .await
        {
            Ok(session) => {
                if let Some(profile) = session.profile.as_ref() {
                    account = update_plugin_account_profile(&app, &user_id, &account.id, profile)?;
                }
                if let Some(login_cookie) = session.login_cookie {
                    saved_login_cookie = Some(login_cookie);
                }
                if let Some(webview_session_id) = session.webview_session_id {
                    saved_webview_session_id = Some(webview_session_id.clone());
                    let _ = upsert_account_webview_session(&app, &account.id, &webview_session_id);
                }
            }
            Err(error) => {
                let _ = mark_account_expired(&app, &account.id);
                return Err(error);
            }
        }
        open_creator_homepage_managed_browser(
            app.clone(),
            account.clone(),
            saved_login_cookie,
            saved_webview_session_id,
        )?;
        Ok(account)
    } else {
        let url = account_homepage_url(&account)?;
        open_external_url(&url)?;
        Ok(account)
    }
}

pub(crate) async fn delete_channel_account(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    account_id: String,
    user_id: String,
) -> Result<(), String> {
    let user_id = normalize_user_id(&user_id)?;
    let (account, secret_keys, browser_profile_ids) = {
        let store = state.store.lock().map_err(lock_error)?;
        let account = store
            .accounts
            .iter()
            .find(|item| item.id == account_id && account_belongs_to_user(item, &user_id))
            .cloned()
            .ok_or_else(|| "账号不存在".to_string())?;
        let secret_keys = account_secret_candidates(&account);
        let mut browser_profile_ids = Vec::new();
        for secret_key in &secret_keys {
            if let Some(profile_id) = store
                .account_secrets
                .get(secret_key)
                .and_then(|secret| secret.webview_session_id.as_deref())
            {
                push_unique(&mut browser_profile_ids, profile_id.to_string());
            }
        }
        (account, secret_keys, browser_profile_ids)
    };

    delete_channel_account_local_data(&app, &account.id, &secret_keys)?;

    let mut store = state.store.lock().map_err(lock_error)?;
    let original_len = store.accounts.len();
    store
        .accounts
        .retain(|item| !(item.id == account_id && account_belongs_to_user(item, &user_id)));
    if store.accounts.len() == original_len {
        return Err("账号不存在".to_string());
    }
    for secret_key in &secret_keys {
        store.account_secrets.remove(secret_key);
    }
    persist_store(&app, &store)?;
    drop(store);
    if let Err(error) = delete_managed_browser_account_data(&app, &account, &browser_profile_ids) {
        eprintln!("[channel-account] failed to clean browser data for {}: {error}", account.id);
    }
    Ok(())
}
