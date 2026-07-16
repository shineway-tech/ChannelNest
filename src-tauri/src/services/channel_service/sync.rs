use super::*;

struct SyncLogin {
    login_cookie: String,
    cookie_header: String,
    profile: Option<PluginAccountInfo>,
}

pub(crate) async fn refresh_channel_account(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    account_id: String,
    user_id: String,
) -> Result<ChannelAccount, String> {
    let user_id = normalize_user_id(&user_id)?;
    let existing = {
        let store = state.store.lock().map_err(lock_error)?;
        store
            .accounts
            .iter()
            .find(|item| item.id == account_id && account_belongs_to_user(item, &user_id))
            .cloned()
            .ok_or_else(|| "账号不存在".to_string())?
    };
    let (secret_cookie, webview_session_id) = {
        let mut store = state.store.lock().map_err(lock_error)?;
        let migrated = migrate_account_secret_for_account(&mut store, &existing);
        let secret = account_secret_for_account(&store, &existing);
        let value = (
            secret.as_ref().and_then(|item| item.login_cookie.clone()),
            secret.and_then(|item| item.webview_session_id),
        );
        if migrated {
            persist_store(&app, &store)?;
        }
        value
    };
    let creator_status = refresh_account_creator_session(
        &existing,
        secret_cookie.as_deref(),
        webview_session_id.as_deref(),
    )
    .await
    .map_err(|error| {
        let _ = mark_account_expired(&app, &existing.id);
        error
    })?;

    let mut store = state.store.lock().map_err(lock_error)?;
    if creator_status.login_cookie.is_some() || creator_status.webview_session_id.is_some() {
        let secret = store.account_secrets.entry(account_id.clone()).or_default();
        if let Some(value) = creator_status.login_cookie.as_ref().filter(|value| !value.trim().is_empty()) {
            secret.login_cookie = Some(value.clone());
        }
        if let Some(value) = creator_status
            .webview_session_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            secret.webview_session_id = Some(value.clone());
        }
    }
    let account = store
        .accounts
        .iter_mut()
        .find(|item| item.id == account_id && account_belongs_to_user(item, &user_id))
        .ok_or_else(|| "账号不存在".to_string())?;
    if let Some(profile) = creator_status.profile.as_ref() {
        if !profile.nickname.trim().is_empty() && should_update_account_nickname(account, &profile.nickname) {
            account.nickname = profile.nickname.clone();
        }
        if !profile.avatar.trim().is_empty() {
            account.avatar = profile.avatar.clone();
        }
        account.followers = profile.fans_count.or(account.followers);
        account.following = profile.following_count.or(account.following);
        account.likes = profile.like_count.or(account.likes);
        if account.uid.trim().is_empty()
            || matches!(normalize_platform_id(&account.platform_id).as_str(), "douyin" | "xiaohongshu")
        {
            account.uid = profile.uid.clone();
        }
    }
    account.status = AccountStatus::Active;
    account.last_sync_at = Some(Utc::now());
    account.updated_at = Utc::now();
    let account = account.clone();
    persist_store(&app, &store)?;
    Ok(account)
}

pub(crate) async fn sync_channel_account_content(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    request: ChannelAccountContentRequest,
) -> Result<ChannelAccountContent, String> {
    let user_id = normalize_user_id(&request.user_id)?;
    let (account, saved_cookie, saved_session) =
        account_with_secrets(&app, &state, &request.account_id, &user_id)?;
    let cached = read_channel_account_content_cache(&app, &account.id, &account.platform_id)?;
    if !request.force && account_content_cache_is_fresh(&cached) {
        return Ok(cached);
    }
    if !crate::platforms::supports_account_content(&account.platform_id) {
        return Ok(cached_with_error_for_account(cached, &account, "当前平台的数据看板暂未接入。"));
    }
    let login = match resolve_sync_login(&account, saved_cookie, saved_session).await {
        Ok(login) => login,
        Err(error) => return Ok(sync_content_error(&app, cached, &account, &error)),
    };
    match fetch_account_content_for_data_sync(&account, &login).await {
        Ok(content) => {
            write_channel_account_content_cache(&app, &content)?;
            if let Some(profile) = content.profile.as_ref() {
                update_account_from_content_profile(&app, &user_id, &account.id, profile)?;
            }
            Ok(content)
        }
        Err(error) => Ok(sync_content_error(&app, cached, &account, &error)),
    }
}

pub(crate) async fn load_channel_account_works_page(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    request: ChannelWorksPageRequest,
) -> Result<ChannelWorksPage, String> {
    let user_id = normalize_user_id(&request.user_id)?;
    let (account, saved_cookie, saved_session) =
        account_with_secrets(&app, &state, &request.account_id, &user_id)?;
    let work_type = normalize_works_work_type(&account.platform_id, request.work_type.as_deref());
    let requested_key = request.page_key.as_deref().unwrap_or_default().trim();
    let page_key = raw_works_page_key(requested_key, work_type.as_deref());
    let cache_key = works_cache_page_key(&page_key, work_type.as_deref());
    let cached = normalize_works_page_for_request(
        read_channel_works_page_cache(&app, &account.id, &account.platform_id, &cache_key)?,
        work_type.as_deref(),
    );
    if !request.force && works_page_cache_is_fresh(&cached) {
        return Ok(cached);
    }
    if !crate::platforms::supports_works_pages(&account.platform_id) {
        return Ok(works_page_with_error(cached, "当前平台的作品列表暂未接入。"));
    }
    let login = match resolve_sync_login(&account, saved_cookie, saved_session).await {
        Ok(login) => login,
        Err(error) => return Ok(sync_works_error(&app, cached, &account, &error)),
    };
    let result = fetch_platform_works_page(
        &account.platform_id,
        &login.cookie_header,
        &login.login_cookie,
        &account.id,
        &page_key,
        work_type.as_deref(),
    )
    .await;
    match result {
        Ok(mut page) => {
            apply_works_cache_keys(&mut page, work_type.as_deref());
            write_channel_works_page_cache(&app, &page)?;
            Ok(page)
        }
        Err(error) => Ok(sync_works_error(&app, cached, &account, &error)),
    }
}

async fn resolve_sync_login(
    account: &ChannelAccount,
    saved_cookie: Option<String>,
    saved_session: Option<String>,
) -> Result<SyncLogin, String> {
    let session = creator_session_for_data_sync(
        account,
        saved_cookie.as_deref(),
        saved_session.as_deref(),
    )
    .await?;
    let login_cookie = session.login_cookie.or(saved_cookie).ok_or_else(|| {
        format!("{}登录已失效，请重新登录后再同步。", platform_name(&account.platform_id))
    })?;
    let cookie_header = plugin_cookie_header(&login_cookie);
    if cookie_header.trim().is_empty() {
        return Err(format!("{}登录已失效，请重新登录后再同步。", platform_name(&account.platform_id)));
    }
    Ok(SyncLogin {
        login_cookie,
        cookie_header,
        profile: session.profile,
    })
}

async fn fetch_account_content_for_data_sync(
    account: &ChannelAccount,
    login: &SyncLogin,
) -> Result<ChannelAccountContent, String> {
    let platform_id = normalize_platform_id(&account.platform_id);
    let profile_snapshot = account_profile_snapshot_from_account(account);
    match platform_id.as_str() {
        "xiaohongshu" => fetch_xhs_account_content_with_profile_snapshot(
            &login.cookie_header,
            login.login_cookie.clone(),
            &account.id,
            profile_snapshot,
        )
        .await,
        "wechat-channels" => fetch_wx_channels_account_content_with_profile_snapshot(
            &login.cookie_header,
            &account.id,
            profile_snapshot,
        )
        .await,
        "douyin" => fetch_douyin_account_content_with_profile_snapshot(
            &login.cookie_header,
            &account.id,
            profile_snapshot,
        )
        .await,
        "bilibili" if account.uid.trim().chars().all(|ch| ch.is_ascii_digit())
            && !account.uid.trim().is_empty() =>
        {
            fetch_bilibili_account_content_with_profile_snapshot(
                &login.cookie_header,
                &account.id,
                account.uid.trim(),
                profile_snapshot,
            )
            .await
        }
        "kuaishou" => fetch_kuaishou_account_content_with_profile(
            &login.cookie_header,
            login.login_cookie.clone(),
            &account.id,
            login.profile.clone(),
        )
        .await,
        _ => fetch_platform_account_content(
            &account.platform_id,
            &login.cookie_header,
            login.login_cookie.clone(),
            &account.id,
        )
        .await,
    }
}

fn sync_content_error(
    app: &AppHandle,
    cached: ChannelAccountContent,
    account: &ChannelAccount,
    error: &str,
) -> ChannelAccountContent {
    expire_account_for_sync_error(app, account, error);
    cached_with_error_for_account(cached, account, error)
}

fn sync_works_error(
    app: &AppHandle,
    cached: ChannelWorksPage,
    account: &ChannelAccount,
    error: &str,
) -> ChannelWorksPage {
    expire_account_for_sync_error(app, account, error);
    works_page_with_error(cached, error)
}

fn expire_account_for_sync_error(app: &AppHandle, account: &ChannelAccount, error: &str) {
    if is_login_expired_message(error) {
        let _ = mark_account_expired(app, &account.id);
    }
}
