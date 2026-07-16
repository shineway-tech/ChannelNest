use super::*;

pub(crate) fn save_auth_settings(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    request: SaveSettingsRequest,
) -> Result<AuthSettings, String> {
    let mut store = state.store.lock().map_err(lock_error)?;
    store.settings = normalize_settings(request.settings);
    persist_store(&app, &store)?;
    Ok(store.settings.clone())
}

pub(crate) async fn start_channel_login(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    request: StartLoginRequest,
) -> Result<StartLoginResponse, String> {
    let user_id = normalize_user_id(&request.user_id)?;
    let task_id = Uuid::new_v4().to_string();
    let platform_id = normalize_platform_id(&request.platform_id);
    let account_id = request
        .account_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let platform_settings = {
        let store = state.store.lock().map_err(lock_error)?;
        if let Some(account_id) = account_id.as_deref() {
            let account = store
                .accounts
                .iter()
                .find(|item| item.id == account_id && account_belongs_to_user(item, &user_id))
                .ok_or_else(|| "账号不存在".to_string())?;
            if normalize_platform_id(&account.platform_id) != platform_id {
                return Err("登录账号与当前平台不匹配。".to_string());
            }
        }
        store
            .settings
            .platforms
            .iter()
            .find(|item| normalize_platform_id(&item.platform_id) == platform_id)
            .cloned()
            .ok_or_else(|| "未找到平台授权参数".to_string())?
    };
    if !is_plugin_auth_platform(&platform_settings.platform_id) {
        return Err("当前平台暂不支持创作中心登录".to_string());
    }

    let login_target = platforms::normalize_plugin_login_target(
        &platform_settings.platform_id,
        request.login_target.as_deref(),
    );
    let session = open_managed_browser_login_session(
        &app,
        &platform_settings.platform_id,
        &task_id,
        login_target,
    )?;
    state.pending_auth.lock().map_err(lock_error)?.insert(
        task_id.clone(),
        PendingAuth {
            user_id,
            platform_id: request.platform_id.clone(),
            account_id,
            managed_browser_session: session.managed_browser_session.clone(),
            plugin_login_target: login_target.map(ToString::to_string),
            created_at: Utc::now(),
        },
    );

    Ok(StartLoginResponse {
        task_id: task_id.clone(),
        url: session.url,
        callback_url: format!(
            "creator://channel-auth/creator-callback?platform={}&taskId={}",
            encode_query(&request.platform_id),
            encode_query(&task_id),
        ),
        mode: AuthMode::Creator,
        auth_type: session.auth_type,
        session_id: Some(session.session_id),
        expires_at: session.expires_at,
        instructions: session.instructions,
    })
}

pub(crate) async fn get_auth_task_status(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    task_id: String,
    user_id: String,
) -> Result<AuthTaskStatus, String> {
    let user_id = normalize_user_id(&user_id)?;
    let pending_task = state
        .pending_auth
        .lock()
        .map_err(lock_error)?
        .get(&task_id)
        .filter(|task| task.user_id == user_id)
        .cloned();

    if let Some(task) = pending_task.as_ref() {
        if let Some(session) = task.managed_browser_session.as_ref() {
            return poll_managed_auth(&app, &state, &task_id, task, session).await;
        }
    }

    let store = state.store.lock().map_err(lock_error)?;
    let account = user_accounts(&store, &user_id)
        .into_iter()
        .find(|item| {
            item.id == task_id
                || pending_task
                    .as_ref()
                    .is_some_and(|task| item.platform_id == task.platform_id && item.created_at >= task.created_at)
        });
    Ok(AuthTaskStatus {
        task_id,
        status: if account.is_some() {
            "success"
        } else if pending_task.is_some() {
            "pending"
        } else {
            "unknown"
        }
        .to_string(),
        account,
        message: None,
    })
}

async fn poll_managed_auth(
    app: &AppHandle,
    state: &State<'_, RuntimeState>,
    task_id: &str,
    task: &PendingAuth,
    session: &ManagedBrowserAuthSession,
) -> Result<AuthTaskStatus, String> {
    let snapshot = match managed_browser_cookie_snapshot(session) {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => return Ok(auth_task_status(task_id, "pending", None, "请先在打开的浏览器窗口完成登录。")),
        Err(message) => {
            let browser_closed = message.contains("授权浏览器已关闭")
                || message.contains("没有找到可控制的浏览器页面");
            if browser_closed && Utc::now().signed_duration_since(task.created_at).num_seconds() > 8 {
                return finish_managed_auth(state, task_id, session, "failed", None, Some(message));
            }
            return Ok(auth_task_status(task_id, "pending", None, &message));
        }
    };
    let profile_result = if normalize_platform_id(&task.platform_id) == "kuaishou" {
        collect_kuaishou_account_from_cookie_snapshot(snapshot.clone()).await
    } else {
        collect_plugin_account_info_from_cookie(
            &task.platform_id,
            snapshot.cookie_header.clone(),
            snapshot.login_cookie.clone(),
            task.plugin_login_target.as_deref(),
        )
        .await
    };

    match profile_result {
        Ok(profile) => {
            let account = save_authenticated_profile(app, state, task, session, &profile)?;
            finish_managed_auth(state, task_id, session, "success", Some(account), None)
        }
        Err(PluginAuthError::NotLoggedIn(message)) => {
            if let Some(account) = restore_target_douyin_login_from_browser_page(app, task, &snapshot)? {
                return finish_managed_auth(state, task_id, session, "success", Some(account), None);
            }
            Ok(auth_task_status(task_id, "pending", None, &message))
        }
        Err(PluginAuthError::Failed(message)) => {
            if let Some(account) = restore_target_douyin_login_from_browser_page(app, task, &snapshot)? {
                return finish_managed_auth(state, task_id, session, "success", Some(account), None);
            }
            finish_managed_auth(state, task_id, session, "failed", None, Some(message))
        }
    }
}

fn save_authenticated_profile(
    app: &AppHandle,
    state: &State<'_, RuntimeState>,
    task: &PendingAuth,
    session: &ManagedBrowserAuthSession,
    profile: &PluginAccountInfo,
) -> Result<ChannelAccount, String> {
    let targeted_kuaishou = if normalize_platform_id(&task.platform_id) == "kuaishou" {
        let store = state.store.lock().map_err(lock_error)?;
        task.account_id.as_deref().and_then(|account_id| {
            store
                .accounts
                .iter()
                .find(|item| {
                    item.id == account_id
                        && account_belongs_to_user(item, &task.user_id)
                        && normalize_platform_id(&item.platform_id) == "kuaishou"
                })
                .cloned()
        })
    } else {
        None
    }
    .filter(|account| {
        is_kuaishou_cookie_fallback_nickname(&profile.nickname)
            || plugin_profile_matches_account(profile, account)
    });
    let existing = match targeted_kuaishou {
        Some(account) => Some(account),
        None => existing_plugin_account_for_profile(app, &task.user_id, &task.platform_id, profile)?,
    };
    let account = match existing {
        Some(account) => update_plugin_account_profile(app, &task.user_id, &account.id, profile)?,
        None => upsert_account_for_user(
            app,
            &task.user_id,
            plugin_info_to_channel_account(&task.platform_id, profile),
        )?,
    };
    upsert_account_secret(app, &account.id, &profile.login_cookie)?;
    let _ = upsert_account_webview_session(app, &account.id, &session.profile_id);
    Ok(account)
}

fn finish_managed_auth(
    state: &State<'_, RuntimeState>,
    task_id: &str,
    session: &ManagedBrowserAuthSession,
    status: &str,
    account: Option<ChannelAccount>,
    message: Option<String>,
) -> Result<AuthTaskStatus, String> {
    close_managed_browser_auth_session(session);
    state.pending_auth.lock().map_err(lock_error)?.remove(task_id);
    Ok(AuthTaskStatus {
        task_id: task_id.to_string(),
        status: status.to_string(),
        account,
        message,
    })
}

fn auth_task_status(
    task_id: &str,
    status: &str,
    account: Option<ChannelAccount>,
    message: &str,
) -> AuthTaskStatus {
    AuthTaskStatus {
        task_id: task_id.to_string(),
        status: status.to_string(),
        account,
        message: Some(message.to_string()),
    }
}

async fn collect_kuaishou_account_from_cookie_snapshot(
    snapshot: ManagedBrowserCookieSnapshot,
) -> Result<PluginAccountInfo, PluginAuthError> {
    if !has_kuaishou_creator_login_cookie_header(&snapshot.cookie_header) {
        return Err(PluginAuthError::NotLoggedIn(
            "请先在打开的快手窗口完成登录。".to_string(),
        ));
    }
    collect_plugin_account_info_from_cookie(
        "kuaishou",
        snapshot.cookie_header,
        snapshot.login_cookie.clone(),
        None,
    )
    .await
    .or_else(|error| kuaishou_account_from_login_cookie(&snapshot.login_cookie).ok_or(error))
}

fn restore_target_douyin_login_from_browser_page(
    app: &AppHandle,
    task: &PendingAuth,
    snapshot: &ManagedBrowserCookieSnapshot,
) -> Result<Option<ChannelAccount>, String> {
    if normalize_platform_id(&task.platform_id) != "douyin"
        || !matches!(
            snapshot.page_url.trim(),
            url if url.starts_with("https://creator.douyin.com/creator-micro/home")
                || url.starts_with("https://creator.douyin.com/creator-micro/content")
                || url.starts_with("https://creator.douyin.com/creator-micro/data-center")
        )
        || !has_douyin_login_cookie(&snapshot.login_cookie)
    {
        return Ok(None);
    }
    let Some(account_id) = task.account_id.as_deref().map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let runtime = app.state::<RuntimeState>();
    let mut store = runtime.store.lock().map_err(lock_error)?;
    let account = store
        .accounts
        .iter_mut()
        .find(|item| item.id == account_id && account_belongs_to_user(item, &task.user_id))
        .filter(|item| normalize_platform_id(&item.platform_id) == "douyin")
        .ok_or_else(|| "账号不存在".to_string())?;
    account.status = AccountStatus::Active;
    account.last_sync_at = Some(Utc::now());
    account.updated_at = Utc::now();
    let cloned = account.clone();

    let secret = store.account_secrets.entry(account_id.to_string()).or_default();
    secret.login_cookie = Some(snapshot.login_cookie.clone());
    if !session_profile_id(task).is_empty() {
        secret.webview_session_id = Some(session_profile_id(task).to_string());
    }
    persist_store(app, &store)?;
    emit_account_updated(app, &cloned);
    Ok(Some(cloned))
}

fn session_profile_id(task: &PendingAuth) -> &str {
    task.managed_browser_session
        .as_ref()
        .map(|session| session.profile_id.as_str())
        .unwrap_or_default()
}
