use crate::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const SETTINGS_KEY: &str = "auth_settings";
const LEGACY_STORE_FILE: &str = "channel-auth-store.json";
const LEGACY_BACKUP_FILE: &str = "channel-auth-store.legacy.json";
const LOCAL_DB_FILE: &str = "local.db";

pub(crate) fn upsert_account_secret(app: &AppHandle, account_id: &str, login_cookie: &str) -> Result<(), String> {
    if login_cookie.trim().is_empty() {
        return Ok(());
    }
    let runtime = app.state::<RuntimeState>();
    let mut store = runtime.store.lock().map_err(lock_error)?;
    let secret = store.account_secrets.entry(account_id.to_string()).or_default();
    secret.login_cookie = Some(login_cookie.to_string());
    persist_store(app, &store)
}

pub(crate) fn upsert_account_webview_session(
    app: &AppHandle,
    account_id: &str,
    webview_session_id: &str,
) -> Result<(), String> {
    if webview_session_id.trim().is_empty() {
        return Ok(());
    }
    let runtime = app.state::<RuntimeState>();
    let mut store = runtime.store.lock().map_err(lock_error)?;
    let secret = store.account_secrets.entry(account_id.to_string()).or_default();
    secret.webview_session_id = Some(webview_session_id.to_string());
    persist_store(app, &store)
}

pub(crate) fn emit_account_updated(app: &AppHandle, account: &ChannelAccount) {
    let _ = app.emit(CHANNEL_ACCOUNT_UPDATED_EVENT, account);
}

pub(crate) fn mark_account_expired(app: &AppHandle, account_id: &str) -> Result<ChannelAccount, String> {
    let runtime = app.state::<RuntimeState>();
    let mut store = runtime.store.lock().map_err(lock_error)?;
    let now = Utc::now();
    let account = store
        .accounts
        .iter_mut()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "账号不存在".to_string())?;

    account.status = AccountStatus::Expired;
    account.last_sync_at = Some(now);
    account.updated_at = now;
    let cloned = account.clone();
    persist_store(app, &store)?;
    emit_account_updated(app, &cloned);
    Ok(cloned)
}

pub(crate) fn update_plugin_account_profile(
    app: &AppHandle,
    user_id: &str,
    account_id: &str,
    profile: &PluginAccountInfo,
) -> Result<ChannelAccount, String> {
    let runtime = app.state::<RuntimeState>();
    let mut store = runtime.store.lock().map_err(lock_error)?;
    let now = Utc::now();

    {
        let secret = store.account_secrets.entry(account_id.to_string()).or_default();
        if !profile.login_cookie.trim().is_empty() {
            secret.login_cookie = Some(profile.login_cookie.clone());
        }
    }

    let account = store
        .accounts
        .iter_mut()
        .find(|item| item.id == account_id && account_belongs_to_user(item, user_id))
        .ok_or_else(|| "账号不存在".to_string())?;
    if !profile.nickname.trim().is_empty() && should_update_account_nickname(account, &profile.nickname) {
        account.nickname = profile.nickname.clone();
    }
    if !profile.avatar.trim().is_empty() {
        account.avatar = profile.avatar.clone();
    }
    if let Some(fans_count) = profile.fans_count {
        account.followers = Some(fans_count);
    }
    if let Some(following_count) = profile.following_count {
        account.following = Some(following_count);
    }
    if let Some(like_count) = profile.like_count {
        account.likes = Some(like_count);
    }
    if account.uid.trim().is_empty() || normalize_platform_id(&account.platform_id) == "xiaohongshu" {
        account.uid = profile.uid.clone();
    }
    account.status = AccountStatus::Active;
    account.last_sync_at = Some(now);
    account.updated_at = now;
    let cloned = account.clone();
    persist_store(app, &store)?;
    emit_account_updated(app, &cloned);
    Ok(cloned)
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


pub(crate) fn upsert_account_for_user(
    app: &AppHandle,
    user_id: &str,
    account: ChannelAccount,
) -> Result<ChannelAccount, String> {
    let user_id = normalize_user_id(user_id)?;
    let runtime = app.state::<RuntimeState>();
    let mut store = runtime.store.lock().map_err(lock_error)?;
    let mut source_secret_keys = account_secret_candidates(&account);
    let mut account = scoped_account_for_user(&user_id, account);
    for key in account_secret_candidates(&account) {
        push_unique(&mut source_secret_keys, key);
    }
    if let Some(existing) = store
        .accounts
        .iter_mut()
        .find(|item| {
            account_belongs_to_user(item, &user_id)
                && item.platform_id == account.platform_id
                && item.uid == account.uid
        })
    {
        account.id = existing.id.clone();
        account.created_at = existing.created_at;
        *existing = account.clone();
    } else {
        store.accounts.push(account.clone());
    }
    migrate_account_secret_from_keys(&mut store, &account.id, &source_secret_keys);
    runtime
        .pending_auth
        .lock()
        .map_err(lock_error)?
        .retain(|task_id, task| {
            task.user_id != user_id
                || (task_id != &account.id && task.platform_id != account.platform_id)
        });
    persist_store(app, &store)?;
    Ok(account)
}


pub(crate) fn load_store(app: &AppHandle) -> Result<StoreFile, Box<dyn std::error::Error>> {
    let db_path = local_db_path(app)?;
    let legacy_path = store_path(app)?;
    let is_new_database = !db_path.exists();
    let mut conn = open_local_db(&db_path)?;
    init_local_db(&conn)?;

    if is_new_database && legacy_path.exists() {
        let text = fs::read_to_string(&legacy_path)?;
        let mut store: StoreFile = serde_json::from_str(&text)?;
        store.settings = normalize_settings(store.settings);
        write_store_to_db(&mut conn, &store)?;
        backup_legacy_store(&legacy_path)?;
        return Ok(store);
    }

    let mut store = read_store_from_db(&conn)?;
    store.settings = normalize_settings(store.settings);
    Ok(store)
}

pub(crate) fn persist_store(app: &AppHandle, store: &StoreFile) -> Result<(), String> {
    let db_path = local_db_path(app).map_err(|error| error.to_string())?;
    let mut conn = open_local_db(&db_path).map_err(|error| error.to_string())?;
    init_local_db(&conn).map_err(|error| error.to_string())?;
    write_store_to_db(&mut conn, store).map_err(|error| error.to_string())
}

pub(crate) fn read_channel_account_content_cache(
    app: &AppHandle,
    account_id: &str,
    platform_id: &str,
) -> Result<ChannelAccountContent, String> {
    let conn = open_content_db(app)?;
    let profile = read_json_row::<ChannelAccountProfileSnapshot, _>(
        &conn,
        "SELECT profile_json FROM account_profile_snapshots WHERE account_id = ?1",
        params![account_id],
    )?;
    let overview_yesterday = read_overview_cache(&conn, account_id, 1)?;
    let overview_seven = if platform_id == "wechat-channels" {
        overview_yesterday.clone()
    } else {
        read_overview_cache(&conn, account_id, 7)?
    };
    let overview_thirty = read_overview_cache(&conn, account_id, 30)?;
    let overview_ninety = read_overview_cache(&conn, account_id, 90)?;
    let overview_history = read_overview_cache(&conn, account_id, 36500)?;
    let overview_total = read_overview_cache(&conn, account_id, 65535)?;
    let latest_work = read_json_row::<ChannelContentWork, _>(
        &conn,
        "SELECT work_json FROM account_latest_works WHERE account_id = ?1",
        params![account_id],
    )?;
    let latest_work_seven = if platform_id == "wechat-channels" {
        read_latest_work_period_cache(&conn, account_id, 7)?
    } else {
        read_latest_work_period_cache(&conn, account_id, 7)?
            .or_else(|| latest_work.clone())
    };
    let latest_work_thirty = read_latest_work_period_cache(&conn, account_id, 30)?;

    Ok(ChannelAccountContent {
        account_id: account_id.to_string(),
        platform_id: platform_id.to_string(),
        profile,
        overview_yesterday,
        overview_seven,
        overview_thirty,
        overview_ninety,
        overview_history,
        overview_total,
        latest_work,
        latest_work_seven,
        latest_work_thirty,
        sync_status: "cached".to_string(),
        error: None,
    })
}

pub(crate) fn write_channel_account_content_cache(
    app: &AppHandle,
    content: &ChannelAccountContent,
) -> Result<(), String> {
    let mut conn = open_content_db(app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let now = Utc::now().to_rfc3339();

    if let Some(profile) = content.profile.as_ref() {
        tx.execute(
            r#"
            INSERT INTO account_profile_snapshots(account_id, platform_id, profile_json, updated_at)
            VALUES(?1, ?2, ?3, ?4)
            ON CONFLICT(account_id) DO UPDATE SET
              platform_id = excluded.platform_id,
              profile_json = excluded.profile_json,
              updated_at = excluded.updated_at
            "#,
            params![
                &profile.account_id,
                &profile.platform_id,
                serde_json::to_string(profile).map_err(|error| error.to_string())?,
                profile.updated_at.as_ref().map(DateTime::to_rfc3339).unwrap_or_else(|| now.clone()),
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    for overview in [
        &content.overview_yesterday,
        &content.overview_seven,
        &content.overview_thirty,
        &content.overview_ninety,
        &content.overview_history,
        &content.overview_total,
    ]
        .into_iter()
        .flatten()
    {
        tx.execute(
            r#"
            INSERT INTO account_overviews(account_id, platform_id, period_days, overview_json, updated_at)
            VALUES(?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(account_id, period_days) DO UPDATE SET
              platform_id = excluded.platform_id,
              overview_json = excluded.overview_json,
              updated_at = excluded.updated_at
            "#,
            params![
                &overview.account_id,
                &overview.platform_id,
                i64::from(overview.period_days),
                serde_json::to_string(overview).map_err(|error| error.to_string())?,
                overview.updated_at.as_ref().map(DateTime::to_rfc3339).unwrap_or_else(|| now.clone()),
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    if let Some(work) = content.latest_work.as_ref() {
        tx.execute(
            r#"
            INSERT INTO account_latest_works(account_id, platform_id, work_json, updated_at)
            VALUES(?1, ?2, ?3, ?4)
            ON CONFLICT(account_id) DO UPDATE SET
              platform_id = excluded.platform_id,
              work_json = excluded.work_json,
              updated_at = excluded.updated_at
            "#,
            params![
                &work.account_id,
                &work.platform_id,
                serde_json::to_string(work).map_err(|error| error.to_string())?,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    for (period_days, work) in [
        (7_i64, content.latest_work_seven.as_ref()),
        (30_i64, content.latest_work_thirty.as_ref()),
    ]
    .into_iter()
    .filter_map(|(period_days, work)| work.map(|work| (period_days, work)))
    {
        tx.execute(
            r#"
            INSERT INTO account_latest_work_periods(account_id, platform_id, period_days, work_json, updated_at)
            VALUES(?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(account_id, period_days) DO UPDATE SET
              platform_id = excluded.platform_id,
              work_json = excluded.work_json,
              updated_at = excluded.updated_at
            "#,
            params![
                &work.account_id,
                &work.platform_id,
                period_days,
                serde_json::to_string(work).map_err(|error| error.to_string())?,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    tx.commit().map_err(|error| error.to_string())
}

pub(crate) fn read_channel_works_page_cache(
    app: &AppHandle,
    account_id: &str,
    platform_id: &str,
    page_key: &str,
) -> Result<ChannelWorksPage, String> {
    let conn = open_content_db(app)?;
    let cached = read_json_row::<ChannelWorksPage, _>(
        &conn,
        "SELECT works_json FROM account_work_pages WHERE account_id = ?1 AND page_key = ?2",
        (account_id, page_key),
    )?;
    Ok(cached.map(|mut page| {
        page.sync_status = "cached".to_string();
        page
    })
    .unwrap_or_else(|| {
        ChannelWorksPage {
            account_id: account_id.to_string(),
            platform_id: platform_id.to_string(),
            page_key: page_key.to_string(),
            work_type: None,
            next_page_key: None,
            has_more: false,
            works: Vec::new(),
            updated_at: None,
            sync_status: "empty".to_string(),
            error: None,
        }
    }))
}

pub(crate) fn write_channel_works_page_cache(
    app: &AppHandle,
    page: &ChannelWorksPage,
) -> Result<(), String> {
    let conn = open_content_db(app)?;
    conn.execute(
        r#"
        INSERT INTO account_work_pages(account_id, platform_id, page_key, next_page_key, has_more, works_json, updated_at)
        VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(account_id, page_key) DO UPDATE SET
          platform_id = excluded.platform_id,
          next_page_key = excluded.next_page_key,
          has_more = excluded.has_more,
          works_json = excluded.works_json,
          updated_at = excluded.updated_at
        "#,
        params![
            &page.account_id,
            &page.platform_id,
            &page.page_key,
            page.next_page_key.as_deref(),
            if page.has_more { 1_i64 } else { 0_i64 },
            serde_json::to_string(page).map_err(|error| error.to_string())?,
            page.updated_at.as_ref().map(DateTime::to_rfc3339).unwrap_or_else(|| Utc::now().to_rfc3339()),
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn delete_channel_account_local_data(
    app: &AppHandle,
    account_id: &str,
    account_keys: &[String],
) -> Result<(), String> {
    let mut conn = open_content_db(app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;

    let mut keys = Vec::new();
    push_unique(&mut keys, account_id.to_string());
    for key in account_keys {
        push_unique(&mut keys, key.clone());
    }

    for key in keys {
        tx.execute("DELETE FROM platform_sessions WHERE account_id = ?1", params![&key])
            .map_err(|error| error.to_string())?;
        tx.execute("DELETE FROM account_sync_logs WHERE account_id = ?1", params![&key])
            .map_err(|error| error.to_string())?;
        for table in [
            "account_profile_snapshots",
            "account_overviews",
            "account_latest_works",
            "account_latest_work_periods",
            "account_work_pages",
        ] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE account_id = ?1"),
                params![&key],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())
}

pub(crate) fn store_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join(LEGACY_STORE_FILE))
}

fn local_db_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join(LOCAL_DB_FILE))
}

fn open_local_db(path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(Connection::open(path)?)
}

fn init_local_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS app_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS platform_accounts (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          platform_id TEXT NOT NULL,
          uid TEXT NOT NULL,
          nickname TEXT NOT NULL,
          avatar TEXT NOT NULL,
          followers INTEGER,
          following INTEGER,
          likes INTEGER,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_sync_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_platform_accounts_user_platform
          ON platform_accounts(user_id, platform_id, updated_at);

        CREATE TABLE IF NOT EXISTS platform_sessions (
          account_id TEXT PRIMARY KEY,
          login_cookie TEXT,
          browser_profile_id TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account_sync_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          account_id TEXT NOT NULL,
          action TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account_profile_snapshots (
          account_id TEXT PRIMARY KEY,
          platform_id TEXT NOT NULL,
          profile_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account_overviews (
          account_id TEXT NOT NULL,
          platform_id TEXT NOT NULL,
          period_days INTEGER NOT NULL,
          overview_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(account_id, period_days)
        );

        CREATE TABLE IF NOT EXISTS account_latest_works (
          account_id TEXT PRIMARY KEY,
          platform_id TEXT NOT NULL,
          work_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account_latest_work_periods (
          account_id TEXT NOT NULL,
          platform_id TEXT NOT NULL,
          period_days INTEGER NOT NULL,
          work_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(account_id, period_days)
        );

        CREATE TABLE IF NOT EXISTS account_work_pages (
          account_id TEXT NOT NULL,
          platform_id TEXT NOT NULL,
          page_key TEXT NOT NULL,
          next_page_key TEXT,
          has_more INTEGER NOT NULL DEFAULT 0,
          works_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(account_id, page_key)
        );

        CREATE INDEX IF NOT EXISTS idx_account_overviews_account_updated
          ON account_overviews(account_id, updated_at);

        CREATE INDEX IF NOT EXISTS idx_account_work_pages_account_updated
          ON account_work_pages(account_id, updated_at);

        CREATE TABLE IF NOT EXISTS local_resources (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          path TEXT,
          thumbnail_path TEXT,
          mime_type TEXT,
          width INTEGER,
          height INTEGER,
          size INTEGER,
          source TEXT NOT NULL,
          ai_request_id TEXT,
          ai_output_id TEXT,
          tags_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_local_resources_user_type_updated
          ON local_resources(user_id, resource_type, updated_at);
        "#,
    )?;
    ensure_platform_accounts_columns(conn)?;
    conn.execute(
        "INSERT OR IGNORE INTO app_migrations(name, applied_at) VALUES(?1, ?2)",
        params!["initial_sqlite_store", Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub(crate) fn create_local_resource(
    app: &AppHandle,
    request: CreateLocalResourceRequest,
) -> Result<LocalResource, String> {
    let user_id = normalize_user_id(&request.user_id)?;
    let resource_type = normalize_resource_type(&request.resource_type)?;
    let source = normalize_resource_source(&request.source);
    let title = normalize_resource_title(&request.title, request.path.as_deref());
    let now = Utc::now();
    let resource = LocalResource {
        id: Uuid::new_v4().to_string(),
        user_id,
        resource_type,
        title,
        body: normalize_optional_text(request.body),
        path: normalize_optional_text(request.path),
        thumbnail_path: normalize_optional_text(request.thumbnail_path),
        mime_type: normalize_optional_text(request.mime_type),
        width: request.width.filter(|value| *value > 0),
        height: request.height.filter(|value| *value > 0),
        size: request.size.filter(|value| *value > 0),
        source,
        ai_request_id: normalize_optional_text(request.ai_request_id),
        ai_output_id: normalize_optional_text(request.ai_output_id),
        tags: normalize_resource_tags(request.tags),
        created_at: now,
        updated_at: now,
    };

    let conn = open_content_db(app)?;
    conn.execute(
        r#"
        INSERT INTO local_resources(
          id, user_id, resource_type, title, body, path, thumbnail_path, mime_type,
          width, height, size, source, ai_request_id, ai_output_id, tags_json, created_at, updated_at
        ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        "#,
        params![
            &resource.id,
            &resource.user_id,
            &resource.resource_type,
            &resource.title,
            resource.body.as_deref(),
            resource.path.as_deref(),
            resource.thumbnail_path.as_deref(),
            resource.mime_type.as_deref(),
            resource.width.map(u32_to_i64),
            resource.height.map(u32_to_i64),
            resource.size.map(u64_to_i64),
            &resource.source,
            resource.ai_request_id.as_deref(),
            resource.ai_output_id.as_deref(),
            serde_json::to_string(&resource.tags).map_err(|error| error.to_string())?,
            resource.created_at.to_rfc3339(),
            resource.updated_at.to_rfc3339(),
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(resource)
}

pub(crate) fn list_local_resources(
    app: &AppHandle,
    request: ListLocalResourcesRequest,
) -> Result<Vec<LocalResource>, String> {
    let user_id = normalize_user_id(&request.user_id)?;
    let resource_type = request
        .resource_type
        .as_deref()
        .map(normalize_resource_type)
        .transpose()?;
    let conn = open_content_db(app)?;
    let mut statement = conn
        .prepare(
            r#"
            SELECT id, user_id, resource_type, title, body, path, thumbnail_path, mime_type,
                   width, height, size, source, ai_request_id, ai_output_id, tags_json,
                   created_at, updated_at
              FROM local_resources
             WHERE user_id = ?1
             ORDER BY updated_at DESC
            "#,
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![user_id], local_resource_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter(|resource| {
            resource_type
                .as_ref()
                .map(|value| &resource.resource_type == value)
                .unwrap_or(true)
        })
        .collect())
}

pub(crate) fn delete_local_resource(
    app: &AppHandle,
    request: DeleteLocalResourceRequest,
) -> Result<(), String> {
    let user_id = normalize_user_id(&request.user_id)?;
    let id = request.id.trim();
    if id.is_empty() {
        return Err("资源不存在".to_string());
    }
    let conn = open_content_db(app)?;
    conn.execute(
        "DELETE FROM local_resources WHERE id = ?1 AND user_id = ?2",
        params![id, user_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn local_resource_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalResource> {
    let tags_json: String = row.get(14)?;
    Ok(LocalResource {
        id: row.get(0)?,
        user_id: row.get(1)?,
        resource_type: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        path: row.get(5)?,
        thumbnail_path: row.get(6)?,
        mime_type: row.get(7)?,
        width: row.get::<_, Option<i64>>(8)?.and_then(i64_to_u32),
        height: row.get::<_, Option<i64>>(9)?.and_then(i64_to_u32),
        size: row.get::<_, Option<i64>>(10)?.and_then(i64_to_u64),
        source: row.get(11)?,
        ai_request_id: row.get(12)?,
        ai_output_id: row.get(13)?,
        tags: serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default(),
        created_at: parse_db_time(row.get::<_, String>(15)?),
        updated_at: parse_db_time(row.get::<_, String>(16)?),
    })
}

fn normalize_resource_type(value: &str) -> Result<String, String> {
    match value.trim() {
        "copy" | "image" | "video" => Ok(value.trim().to_string()),
        _ => Err("资源类型无效".to_string()),
    }
}

fn normalize_resource_source(value: &str) -> String {
    match value.trim() {
        "import" | "manual" => value.trim().to_string(),
        _ => "ai".to_string(),
    }
}

fn normalize_resource_title(value: &str, fallback_path: Option<&str>) -> String {
    let title = value.trim();
    if !title.is_empty() {
        return title.chars().take(80).collect();
    }
    fallback_path
        .and_then(|path| Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("未命名资源")
        .chars()
        .take(80)
        .collect()
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_resource_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        push_unique(&mut normalized, tag.trim().chars().take(24).collect::<String>());
        if normalized.len() >= 12 {
            break;
        }
    }
    normalized
}

fn ensure_platform_accounts_columns(conn: &Connection) -> rusqlite::Result<()> {
    if !table_has_column(conn, "platform_accounts", "following")? {
        conn.execute("ALTER TABLE platform_accounts ADD COLUMN following INTEGER", [])?;
    }
    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn read_store_from_db(conn: &Connection) -> Result<StoreFile, Box<dyn std::error::Error>> {
    let settings = conn
        .query_row(
            "SELECT value FROM app_kv WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|text| serde_json::from_str::<AuthSettings>(&text).ok())
        .map(normalize_settings)
        .unwrap_or_else(default_auth_settings);

    let mut account_statement = conn.prepare(
        r#"
        SELECT id, user_id, platform_id, uid, nickname, avatar, followers, following, likes,
               status, created_at, updated_at, last_sync_at
          FROM platform_accounts
         ORDER BY platform_id ASC, updated_at DESC
        "#,
    )?;
    let accounts = account_statement
        .query_map([], |row| {
            let followers = row.get::<_, Option<i64>>(6)?.and_then(i64_to_u64);
            let following = row.get::<_, Option<i64>>(7)?.and_then(i64_to_u64);
            let likes = row.get::<_, Option<i64>>(8)?.and_then(i64_to_u64);
            let created_at = parse_db_time(row.get::<_, String>(10)?);
            let updated_at = parse_db_time(row.get::<_, String>(11)?);
            let last_sync_at = row
                .get::<_, Option<String>>(12)?
                .map(parse_db_time);

            Ok(ChannelAccount {
                id: row.get(0)?,
                user_id: row.get(1)?,
                platform_id: row.get(2)?,
                uid: row.get(3)?,
                nickname: row.get(4)?,
                avatar: row.get(5)?,
                followers,
                following,
                likes,
                status: account_status_from_db(row.get::<_, String>(9)?.as_str()),
                created_at,
                updated_at,
                last_sync_at,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut secret_statement = conn.prepare(
        "SELECT account_id, login_cookie, browser_profile_id FROM platform_sessions",
    )?;
    let account_secrets = secret_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                AccountSecret {
                    login_cookie: row.get(1)?,
                    webview_session_id: row.get(2)?,
                },
            ))
        })?
        .collect::<Result<HashMap<_, _>, _>>()?;

    Ok(StoreFile {
        accounts,
        settings,
        account_secrets,
    })
}

fn open_content_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = local_db_path(app).map_err(|error| error.to_string())?;
    let conn = open_local_db(&db_path).map_err(|error| error.to_string())?;
    init_local_db(&conn).map_err(|error| error.to_string())?;
    Ok(conn)
}

fn read_overview_cache(
    conn: &Connection,
    account_id: &str,
    period_days: u16,
) -> Result<Option<ChannelAccountOverview>, String> {
    read_json_row::<ChannelAccountOverview, _>(
        conn,
        "SELECT overview_json FROM account_overviews WHERE account_id = ?1 AND period_days = ?2",
        (account_id, i64::from(period_days)),
    )
}

fn read_latest_work_period_cache(
    conn: &Connection,
    account_id: &str,
    period_days: u16,
) -> Result<Option<ChannelContentWork>, String> {
    read_json_row::<ChannelContentWork, _>(
        conn,
        "SELECT work_json FROM account_latest_work_periods WHERE account_id = ?1 AND period_days = ?2",
        (account_id, i64::from(period_days)),
    )
}

fn read_json_row<T, P>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> Result<Option<T>, String>
where
    T: for<'de> serde::Deserialize<'de>,
    P: rusqlite::Params,
{
    let text = conn
        .query_row(sql, params, |row| row.get::<_, String>(0))
        .optional()
        .map_err(|error| error.to_string())?;
    text.map(|value| serde_json::from_str::<T>(&value).map_err(|error| error.to_string()))
        .transpose()
}

fn write_store_to_db(conn: &mut Connection, store: &StoreFile) -> Result<(), Box<dyn std::error::Error>> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO app_kv(key, value, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![
            SETTINGS_KEY,
            serde_json::to_string(&normalize_settings(store.settings.clone()))?,
            Utc::now().to_rfc3339(),
        ],
    )?;
    tx.execute("DELETE FROM platform_accounts", [])?;
    tx.execute("DELETE FROM platform_sessions", [])?;

    for account in &store.accounts {
        tx.execute(
            r#"
            INSERT INTO platform_accounts(
              id, user_id, platform_id, uid, nickname, avatar, followers, following, likes,
              status, created_at, updated_at, last_sync_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#,
            params![
                &account.id,
                account.user_id.as_deref(),
                &account.platform_id,
                &account.uid,
                &account.nickname,
                &account.avatar,
                account.followers.map(u64_to_i64),
                account.following.map(u64_to_i64),
                account.likes.map(u64_to_i64),
                account_status_to_db(&account.status),
                account.created_at.to_rfc3339(),
                account.updated_at.to_rfc3339(),
                account.last_sync_at.as_ref().map(DateTime::to_rfc3339),
            ],
        )?;
    }

    for (account_id, secret) in &store.account_secrets {
        tx.execute(
            r#"
            INSERT INTO platform_sessions(account_id, login_cookie, browser_profile_id, updated_at)
            VALUES(?1, ?2, ?3, ?4)
            "#,
            params![
                account_id,
                secret.login_cookie.as_deref(),
                secret.webview_session_id.as_deref(),
                Utc::now().to_rfc3339(),
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

fn backup_legacy_store(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let backup_path = path.with_file_name(LEGACY_BACKUP_FILE);
    if !backup_path.exists() {
        fs::copy(path, backup_path)?;
    }
    Ok(())
}

fn parse_db_time(value: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&value)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn account_status_to_db(status: &AccountStatus) -> &'static str {
    match status {
        AccountStatus::Active => "active",
        AccountStatus::Expired => "expired",
        AccountStatus::Pending => "pending",
    }
}

fn account_status_from_db(status: &str) -> AccountStatus {
    match status {
        "expired" => AccountStatus::Expired,
        "pending" => AccountStatus::Pending,
        _ => AccountStatus::Active,
    }
}

fn i64_to_u64(value: i64) -> Option<u64> {
    u64::try_from(value).ok()
}

fn i64_to_u32(value: i64) -> Option<u32> {
    u32::try_from(value).ok()
}

fn u32_to_i64(value: u32) -> i64 {
    i64::from(value)
}

fn u64_to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}


pub(crate) fn normalize_user_id(value: &str) -> Result<String, String> {
    let user_id = value.trim();
    if user_id.is_empty() {
        return Err("当前登录状态无效，请重新登录".to_string());
    }
    Ok(user_id.to_string())
}

pub(crate) fn account_belongs_to_user(account: &ChannelAccount, user_id: &str) -> bool {
    account.user_id.as_deref() == Some(user_id)
}

pub(crate) fn user_accounts(store: &StoreFile, user_id: &str) -> Vec<ChannelAccount> {
    store
        .accounts
        .iter()
        .filter(|account| account_belongs_to_user(account, user_id))
        .cloned()
        .collect()
}

pub(crate) fn claim_legacy_accounts_for_user(store: &mut StoreFile, user_id: &str) -> bool {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return false;
    }
    let mut changed = false;
    for account in &mut store.accounts {
        if account.user_id.is_none() {
            account.user_id = Some(user_id.to_string());
            changed = true;
        }
    }
    changed
}

pub(crate) fn account_secret_for_account(store: &StoreFile, account: &ChannelAccount) -> Option<AccountSecret> {
    account_secret_candidates(account)
        .into_iter()
        .find_map(|key| store.account_secrets.get(&key).cloned())
}

pub(crate) fn migrate_account_secret_for_account(store: &mut StoreFile, account: &ChannelAccount) -> bool {
    let keys = account_secret_candidates(account);
    migrate_account_secret_from_keys(store, &account.id, &keys)
}

pub(crate) fn migrate_account_secret_from_keys(
    store: &mut StoreFile,
    target_id: &str,
    source_keys: &[String],
) -> bool {
    let mut changed = false;
    for key in source_keys {
        if key == target_id {
            continue;
        }
        let Some(source) = store.account_secrets.get(key).cloned() else {
            continue;
        };
        let target = store.account_secrets.entry(target_id.to_string()).or_default();
        if target.login_cookie.is_none() && source.login_cookie.is_some() {
            target.login_cookie = source.login_cookie.clone();
            changed = true;
        }
        if target.webview_session_id.is_none() && source.webview_session_id.is_some() {
            target.webview_session_id = source.webview_session_id.clone();
            changed = true;
        }
    }
    changed
}

pub(crate) fn account_secret_candidates(account: &ChannelAccount) -> Vec<String> {
    let mut values = Vec::new();
    push_unique(&mut values, account.id.clone());
    if let Some(user_id) = account.user_id.as_deref() {
        if let Some(raw_id) = unscoped_account_id(user_id, &account.id) {
            push_unique(&mut values, raw_id);
        }
    }
    values
}

pub(crate) fn push_unique(values: &mut Vec<String>, value: String) {
    if !value.trim().is_empty() && !values.iter().any(|item| item == &value) {
        values.push(value);
    }
}

pub(crate) fn scoped_account_for_user(user_id: &str, mut account: ChannelAccount) -> ChannelAccount {
    account.user_id = Some(user_id.to_string());
    account.id = scoped_account_id(user_id, &account.id);
    account
}

pub(crate) fn scoped_account_id(user_id: &str, account_id: &str) -> String {
    let prefix = format!("u{}_", stable_label_fragment(user_id));
    if account_id.starts_with(&prefix) {
        account_id.to_string()
    } else {
        format!("{prefix}{account_id}")
    }
}

pub(crate) fn unscoped_account_id(user_id: &str, account_id: &str) -> Option<String> {
    let prefix = format!("u{}_", stable_label_fragment(user_id));
    account_id
        .strip_prefix(&prefix)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}
