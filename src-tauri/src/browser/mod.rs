use super::*;

mod cdp;
mod system_browser;

use cdp::{
    browser_debug_port_closed,
    browser_websocket_url,
    page_websocket_url,
    wait_for_page_websocket,
    DevtoolsClient,
};
use system_browser::{allocate_local_port, find_chromium_browser};
use std::{
    io::{ErrorKind, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Debug, Clone)]
struct ManagedBrowserLaunch {
    browser_path: PathBuf,
    user_data_dir: PathBuf,
    url: String,
    platform_id: String,
    login_cookie: Option<String>,
    remote_debugging_port: u16,
}

#[derive(Debug, Clone)]
pub(crate) struct ManagedBrowserAuthSession {
    pub(crate) session_id: String,
    pub(crate) profile_id: String,
    pub(crate) platform_id: String,
    pub(crate) login_url: String,
    pub(crate) remote_debugging_port: u16,
    pub(crate) process_id: u32,
}

#[derive(Debug, Clone)]
pub(crate) struct ManagedBrowserCookieSnapshot {
    pub(crate) cookie_header: String,
    pub(crate) login_cookie: String,
    pub(crate) page_url: String,
}

pub(crate) fn creator_home_uses_managed_browser(platform_id: &str) -> bool {
    platforms::platform(platform_id).is_some()
}

pub(crate) fn open_managed_browser_login_session(
    app: &AppHandle,
    platform_id: &str,
    task_id: &str,
    login_target: Option<&str>,
) -> Result<CreatorLoginSession, String> {
    let platform_id = normalize_platform_id(platform_id);
    let login_url = platforms::plugin_login_url(&platform_id, login_target)
        .ok_or_else(|| "当前平台不支持浏览器授权".to_string())?;
    let platform = platforms::platform(&platform_id).ok_or_else(|| "当前平台暂不支持".to_string())?;
    let browser_path = find_chromium_browser()
        .ok_or_else(|| "未找到 Chrome、Edge 或 Chromium，无法使用浏览器模式登录。".to_string())?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法创建浏览器授权目录: {error}"))?;
    let user_data_dir = app_data_dir
        .join("playwright-auth")
        .join(platform.id)
        .join(task_id);
    fs::create_dir_all(&user_data_dir).map_err(|error| format!("创建浏览器授权目录失败: {error}"))?;
    let remote_debugging_port = allocate_local_port()?;
    let session_id = format!(
        "managed-auth-{}-{}",
        platform.id.replace('-', "_"),
        task_suffix(task_id)
    );
    let title = match (platform.id, login_target) {
        ("xiaohongshu", Some("home")) => "登录小红书主页 - 营销大师",
        ("xiaohongshu", Some("creator")) => "登录小红书创作中心 - 营销大师",
        _ => "登录营销平台 - 营销大师",
    };

    let mut command = Command::new(&browser_path);
    command
        .arg(format!("--user-data-dir={}", user_data_dir.display()))
        .arg(format!("--remote-debugging-port={remote_debugging_port}"))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate")
        .arg("--new-window")
        .arg(login_url);
    suppress_command_window(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("启动浏览器登录窗口失败: {error}"))?;
    let process_id = child.id();

    eprintln!(
        "[managed-auth:{}] opened session={} pid={} port={} url={}",
        platform.id,
        session_id,
        process_id,
        remote_debugging_port,
        login_url
    );
    if let Err(error) = ensure_managed_browser_login_page(remote_debugging_port, login_url) {
        eprintln!(
            "[managed-auth:{}] login page target ensure failed: {error}",
            platform.id
        );
    }

    let managed_browser_session = ManagedBrowserAuthSession {
        session_id: session_id.clone(),
        profile_id: task_id.to_string(),
        platform_id: platform.id.to_string(),
        login_url: login_url.to_string(),
        remote_debugging_port,
        process_id,
    };

    Ok(CreatorLoginSession {
        url: login_url.to_string(),
        session_id,
        managed_browser_session: Some(managed_browser_session),
        expires_at: None,
        instructions: Some(format!(
            "{title}。请在打开的浏览器窗口完成登录，登录成功后客户端会自动同步账号资料。"
        )),
        auth_type: "managed-browser".to_string(),
    })
}

fn ensure_managed_browser_login_page(port: u16, login_url: &str) -> Result<(), String> {
    if wait_for_page_websocket(port, login_url).is_ok() {
        return Ok(());
    }
    let websocket_url = browser_websocket_url(port)?;
    let mut client = DevtoolsClient::connect(&websocket_url)?;
    client.call(
        "Target.createTarget",
        serde_json::json!({
            "url": login_url,
            "newWindow": true,
        }),
    )?;
    let _ = wait_for_page_websocket(port, login_url)?;
    Ok(())
}

pub(crate) fn managed_browser_cookie_snapshot(
    session: &ManagedBrowserAuthSession,
) -> Result<Option<ManagedBrowserCookieSnapshot>, String> {
    let Some(platform) = platforms::platform(&session.platform_id) else {
        return Err("当前平台暂不支持".to_string());
    };
    let websocket_url = match page_websocket_url(session.remote_debugging_port, &session.login_url) {
        Ok(url) => url,
        Err(error) if browser_debug_port_closed(&error) => {
            return Err("授权浏览器已关闭，请重新打开并完成登录。".to_string());
        }
        Err(error) => return Err(error),
    };
    let mut client = DevtoolsClient::connect(&websocket_url)?;
    client.call("Network.enable", serde_json::json!({}))?;
    let page_url = client
        .call(
            "Runtime.evaluate",
            serde_json::json!({
                "expression": "location.href",
                "returnByValue": true,
            }),
        )
        .ok()
        .and_then(|value| {
            value
                .get("result")
                .and_then(|result| result.get("result"))
                .and_then(|result| result.get("value"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_default();
    let value = client.call(
        "Network.getCookies",
        serde_json::json!({ "urls": platform.cookie_urls }),
    )?;
    let cookies = value
        .get("cookies")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|cookie| {
            let Some(name) = cookie.get("name").and_then(Value::as_str) else {
                return false;
            };
            let Some(value) = cookie.get("value").and_then(Value::as_str) else {
                return false;
            };
            if name.trim().is_empty() || value.trim().is_empty() {
                return false;
            }
            cookie
                .get("domain")
                .and_then(Value::as_str)
                .map(|domain| platform.allows_cookie_domain(domain))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    if cookies.is_empty() {
        return Ok(None);
    }

    let cookie_header = cookies
        .iter()
        .filter_map(|cookie| {
            Some(format!(
                "{}={}",
                cookie.get("name")?.as_str()?,
                cookie.get("value")?.as_str()?
            ))
        })
        .collect::<Vec<_>>()
        .join("; ");
    if cookie_header.trim().is_empty() {
        return Ok(None);
    }
    let login_cookie = serde_json::to_string(&cookies)
        .map_err(|error| format!("序列化浏览器 Cookie 失败: {error}"))?;
    let names = cookies
        .iter()
        .filter_map(|cookie| cookie.get("name").and_then(Value::as_str))
        .take(12)
        .collect::<Vec<_>>()
        .join(",");
    eprintln!(
        "[managed-auth:{}] cookie_snapshot count={} names={names}",
        session.platform_id,
        cookies.len()
    );
    Ok(Some(ManagedBrowserCookieSnapshot {
        cookie_header,
        login_cookie,
        page_url,
    }))
}

pub(crate) fn close_managed_browser_auth_session(session: &ManagedBrowserAuthSession) {
    eprintln!(
        "[managed-auth:{}] closing session={} pid={} port={}",
        session.platform_id,
        session.session_id,
        session.process_id,
        session.remote_debugging_port
    );
    if let Ok(websocket_url) = browser_websocket_url(session.remote_debugging_port) {
        if let Ok(mut client) = DevtoolsClient::connect(&websocket_url) {
            let _ = client.call("Browser.close", serde_json::json!({}));
        }
    }
    if wait_for_browser_debug_port_closed(session.remote_debugging_port, Duration::from_secs(4)) {
        return;
    }
    terminate_managed_browser_process(session.process_id, &session.platform_id);
    let _ = wait_for_browser_debug_port_closed(session.remote_debugging_port, Duration::from_secs(2));
}

fn wait_for_browser_debug_port_closed(port: u16, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if browser_websocket_url(port).is_err() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

#[cfg(target_os = "windows")]
fn terminate_managed_browser_process(process_id: u32, platform_id: &str) {
    if process_id == 0 {
        return;
    }
    let mut command = Command::new("taskkill");
    command.args(["/PID", &process_id.to_string(), "/T", "/F"]);
    suppress_command_window(&mut command);
    let status = command.status();
    eprintln!("[managed-auth:{platform_id}] taskkill pid={process_id} status={status:?}");
}

#[cfg(not(target_os = "windows"))]
fn terminate_managed_browser_process(process_id: u32, platform_id: &str) {
    if process_id == 0 {
        return;
    }
    let status = Command::new("kill")
        .args(["-TERM", &process_id.to_string()])
        .status();
    eprintln!("[managed-auth:{platform_id}] kill -TERM pid={process_id} status={status:?}");
    std::thread::sleep(Duration::from_millis(500));
    let _ = Command::new("kill")
        .args(["-KILL", &process_id.to_string()])
        .status();
}

pub(crate) fn open_creator_homepage_managed_browser(
    app: AppHandle,
    account: ChannelAccount,
    saved_login_cookie: Option<String>,
    saved_browser_profile_id: Option<String>,
) -> Result<(), String> {
    let platform_id = normalize_platform_id(&account.platform_id);
    let platform = platforms::platform(&platform_id).ok_or_else(|| "当前平台暂不支持".to_string())?;
    open_creator_url_managed_browser(
        app,
        account,
        saved_login_cookie,
        saved_browser_profile_id,
        platform.creator_home_url,
    )
}

pub(crate) fn open_creator_url_managed_browser(
    app: AppHandle,
    account: ChannelAccount,
    saved_login_cookie: Option<String>,
    saved_browser_profile_id: Option<String>,
    target_url: &str,
) -> Result<(), String> {
    let platform_id = normalize_platform_id(&account.platform_id);
    let platform = platforms::platform(&platform_id).ok_or_else(|| "当前平台暂不支持".to_string())?;
    let target_url = managed_browser_platform_url(platform, target_url)?;
    let browser_path = find_chromium_browser()
        .ok_or_else(|| "未找到 Chrome、Edge 或 Chromium，无法使用浏览器模式打开主页。".to_string())?;
    let profile_dir = saved_browser_profile_id
        .as_deref()
        .and_then(|profile_id| managed_browser_auth_profile_dir(&app, platform, profile_id).ok())
        .filter(|path| path.exists());
    let profile_reused = profile_dir.is_some();
    let user_data_dir = match profile_dir {
        Some(path) => path,
        None => managed_browser_runtime_dir(&app, platform, &account)?,
    };
    fs::create_dir_all(&user_data_dir).map_err(|error| format!("创建浏览器用户目录失败: {error}"))?;

    let launch = ManagedBrowserLaunch {
        browser_path,
        user_data_dir,
        url: target_url,
        platform_id,
        login_cookie: if profile_reused {
            None
        } else {
            saved_login_cookie.filter(|value| !value.trim().is_empty())
        },
        remote_debugging_port: allocate_local_port()?,
    };

    std::thread::spawn(move || {
        if let Err(error) = launch_managed_browser(launch) {
            eprintln!("[managed-browser] open creator homepage failed: {error}");
        }
    });

    Ok(())
}

fn managed_browser_platform_url(
    platform: &platforms::ChannelPlatform,
    target_url: &str,
) -> Result<String, String> {
    let url = Url::parse(target_url).map_err(|error| format!("创作者页面地址无效: {error}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| "创作者页面地址缺少域名".to_string())?;
    if !platform.allows_cookie_domain(host) {
        return Err(format!("目标页面不属于{}创作者平台。", platform.name));
    }
    Ok(url.to_string())
}

fn managed_browser_auth_profile_dir(
    app: &AppHandle,
    platform: &platforms::ChannelPlatform,
    profile_id: &str,
) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法读取浏览器授权目录: {error}"))?;
    Ok(app_data_dir
        .join("playwright-auth")
        .join(platform.id)
        .join(profile_id))
}

pub(crate) fn delete_managed_browser_account_data(
    app: &AppHandle,
    account: &ChannelAccount,
    profile_ids: &[String],
) -> Result<(), String> {
    let platform_id = normalize_platform_id(&account.platform_id);
    let Some(platform) = platforms::platform(&platform_id) else {
        return Ok(());
    };

    let mut paths = Vec::new();
    for profile_id in profile_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        push_unique_path(
            &mut paths,
            managed_browser_auth_profile_dir(app, platform, profile_id)?,
        );
    }
    push_unique_path(
        &mut paths,
        managed_browser_runtime_account_dir(app, platform, account)?,
    );

    for path in paths {
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|error| {
                format!("清理{}浏览器本地数据失败: {error}", platform.name)
            })?;
        }
    }
    Ok(())
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|item| item == &path) {
        paths.push(path);
    }
}

fn managed_browser_runtime_account_dir(
    app: &AppHandle,
    platform: &platforms::ChannelPlatform,
    account: &ChannelAccount,
) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法创建浏览器数据目录: {error}"))?;
    Ok(app_data_dir
        .join("playwright-browser-runtime")
        .join(platform.id)
        .join(stable_label_fragment(&account.id)))
}

fn managed_browser_runtime_dir(
    app: &AppHandle,
    platform: &platforms::ChannelPlatform,
    account: &ChannelAccount,
) -> Result<PathBuf, String> {
    Ok(managed_browser_runtime_account_dir(app, platform, account)?
        .join(Uuid::new_v4().to_string()))
}

fn launch_managed_browser(launch: ManagedBrowserLaunch) -> Result<(), String> {
    eprintln!(
        "[managed-browser:{}] open url={} cookie_present={} cookie_chars={}",
        launch.platform_id,
        launch.url,
        launch.login_cookie.is_some(),
        launch.login_cookie.as_ref().map(|value| value.len()).unwrap_or(0)
    );
    let mut command = Command::new(&launch.browser_path);
    command
        .arg(format!("--user-data-dir={}", launch.user_data_dir.display()))
        .arg(format!("--remote-debugging-port={}", launch.remote_debugging_port))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate")
        .arg("--new-window")
        .arg(&launch.url);
    suppress_command_window(&mut command);

    command
        .spawn()
        .map_err(|error| format!("启动浏览器失败: {error}"))?;

    if let Some(login_cookie) = launch.login_cookie.as_deref() {
        inject_cookies_and_navigate(&launch, login_cookie)?;
    }

    Ok(())
}

fn inject_cookies_and_navigate(launch: &ManagedBrowserLaunch, login_cookie: &str) -> Result<(), String> {
    let websocket_url = wait_for_page_websocket(launch.remote_debugging_port, &launch.url)?;
    let mut client = DevtoolsClient::connect(&websocket_url)?;
    let cookies = login_cookie_to_cdp_cookies(&launch.platform_id, login_cookie)?;
    eprintln!(
        "[managed-browser:{}] cdp connected cookie_candidates={}",
        launch.platform_id,
        cookies.len()
    );

    client.call("Network.enable", serde_json::json!({}))?;
    if !cookies.is_empty() {
        let (written, failed) = set_cdp_cookies(&mut client, &cookies);
        eprintln!(
            "[managed-browser:{}] cookie_write written={} failed={}",
            launch.platform_id,
            written,
            failed
        );
        if written == 0 {
            return Err("登录 Cookie 写入浏览器失败".to_string());
        }
        log_browser_cookie_snapshot(&mut client, &launch.platform_id);
    }
    client.call("Page.navigate", serde_json::json!({ "url": launch.url }))?;
    let _ = client.call("Page.bringToFront", serde_json::json!({}));
    Ok(())
}

fn set_cdp_cookies(client: &mut DevtoolsClient, cookies: &[Value]) -> (usize, usize) {
    let mut written = 0;
    let mut failed = 0;
    for cookie in cookies {
        match client.call("Network.setCookie", cookie.clone()) {
            Ok(result) if result.get("success").and_then(Value::as_bool).unwrap_or(true) => {
                written += 1;
            }
            Ok(_) | Err(_) => {
                failed += 1;
            }
        }
    }
    (written, failed)
}

fn log_browser_cookie_snapshot(client: &mut DevtoolsClient, platform_id: &str) {
    let Some(platform) = platforms::platform(platform_id) else {
        return;
    };
    let result = client.call(
        "Network.getCookies",
        serde_json::json!({ "urls": platform.cookie_urls }),
    );
    let Ok(value) = result else {
        eprintln!("[managed-browser:{platform_id}] cookie_snapshot failed");
        return;
    };
    let names = value
        .get("cookies")
        .and_then(Value::as_array)
        .map(|items| {
            let mut names = Vec::new();
            for item in items {
                let Some(name) = item.get("name").and_then(Value::as_str) else {
                    continue;
                };
                if !names.iter().any(|existing| existing == name) {
                    names.push(name.to_string());
                }
            }
            names
        })
        .unwrap_or_default();
    let preview = names.iter().take(12).cloned().collect::<Vec<_>>().join(",");
    eprintln!(
        "[managed-browser:{platform_id}] cookie_snapshot count={} names={preview}",
        names.len()
    );
}

fn login_cookie_to_cdp_cookies(platform_id: &str, login_cookie: &str) -> Result<Vec<Value>, String> {
    let Some(platform) = platforms::platform(platform_id) else {
        return Ok(Vec::new());
    };
    let trimmed = login_cookie.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    if trimmed.starts_with('[') {
        let Value::Array(cookies) =
            serde_json::from_str::<Value>(trimmed).map_err(|error| format!("登录态 Cookie 格式无效: {error}"))?
        else {
            return Ok(Vec::new());
        };

        let mut result = Vec::new();
        for cookie in cookies {
            let Some(name) = cookie.get("name").and_then(Value::as_str) else {
                continue;
            };
            let Some(value) = cookie.get("value").and_then(Value::as_str) else {
                continue;
            };
            if name.trim().is_empty() {
                continue;
            }
            let raw_domain = cookie.get("domain").and_then(Value::as_str).unwrap_or("");
            if !raw_domain.trim().is_empty() && !platform.allows_cookie_domain(raw_domain) {
                continue;
            }
            let mut item = serde_json::json!({
                "url": platform.creator_home_url,
                "name": name,
                "value": value,
                "domain": if raw_domain.trim().is_empty() { platform.default_cookie_domain } else { raw_domain },
                "path": cookie.get("path").and_then(Value::as_str).unwrap_or("/"),
                "secure": cookie.get("secure").and_then(Value::as_bool).unwrap_or(true),
                "httpOnly": cookie
                    .get("httpOnly")
                    .or_else(|| cookie.get("http_only"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            });
            if let Some(expires) = cookie_number(&cookie, &["expires", "expirationDate", "expiry"]) {
                if let Some(expires) = normalize_cookie_expires(expires) {
                    item["expires"] = serde_json::json!(expires);
                }
            }
            result.push(item);
        }
        return Ok(result);
    }

    let mut result = Vec::new();
    for pair in trimmed.split(';') {
        let pair = pair.trim();
        let Some((name, value)) = pair.split_once('=') else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }
        result.push(serde_json::json!({
            "url": platform.creator_home_url,
            "name": name.trim(),
            "value": value.trim(),
            "domain": platform.default_cookie_domain,
            "path": "/",
            "secure": true,
            "httpOnly": false,
        }));
    }
    Ok(result)
}

fn normalize_cookie_expires(value: f64) -> Option<f64> {
    if value <= 0.0 {
        return None;
    }
    let seconds = if value > 10_000_000_000.0 { value / 1000.0 } else { value };
    if seconds > 0.0 && seconds < 253_402_300_799.0 {
        Some(seconds)
    } else {
        None
    }
}

fn cookie_number(cookie: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        cookie
            .get(*key)
            .and_then(|value| value.as_f64().or_else(|| value.as_i64().map(|item| item as f64)))
    })
}
