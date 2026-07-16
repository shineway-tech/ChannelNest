use super::*;
use base64::engine::general_purpose;
use chrono::{FixedOffset, NaiveDateTime, TimeZone};
use hmac::{Hmac, Mac};
use rquickjs::{context::EvalOptions, function::Func, CatchResultExt, Context, Function, Runtime};
use serde::Deserialize;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

const COOKIE_DOMAINS: &[DomainRule] = &[DomainRule {
    host: "xiaohongshu.com",
    include_subdomains: true,
}];

const COOKIE_URLS: &[&str] = &[
    "https://www.xiaohongshu.com/",
    "https://creator.xiaohongshu.com/",
    "https://edith.xiaohongshu.com/",
];

const CREATOR_HOME_URL: &str = "https://creator.xiaohongshu.com/new/home";
const CREATOR_USER_INFO_API: &str = "https://creator.xiaohongshu.com/api/galaxy/user/info";
const CREATOR_PERSONAL_INFO_API: &str =
    "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info";
const CREATOR_LATEST_NOTE_API: &str =
    "https://creator.xiaohongshu.com/api/galaxy/creator/home/latest_note_data";
const CREATOR_FANS_OVERALL_API: &str =
    "https://creator.xiaohongshu.com/api/galaxy/creator/data/fans/overall_new";
const CREATOR_ACCOUNT_BASE_API: &str =
    "https://creator.xiaohongshu.com/api/galaxy/v2/creator/datacenter/account/base";
const CREATOR_NOTE_DETAIL_API: &str =
    "https://creator.xiaohongshu.com/api/galaxy/creator/data/note_detail_new";
const CREATOR_NOTE_BASE_API: &str =
    "https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/base";
const CREATOR_POSTED_NOTES_API: &str =
    "https://creator.xiaohongshu.com/api/galaxy/v2/creator/note/user/posted";
const EDITH_USER_ME_API: &str = "https://edith.xiaohongshu.com/api/sns/web/v2/user/me";
const XHS_UPLOAD_PERMIT_API: &str =
    "https://creator.xiaohongshu.com/api/media/v1/upload/creator/permit";
const XHS_POST_NOTE_API: &str = "https://edith.xiaohongshu.com/web_api/sns/v2/note";
const XHS_VIDEO_ID_API: &str = "https://edith.xiaohongshu.com/web_api/sns/capa/postgw/videoid";
const XHS_QUERY_TRANSCODE_API: &str =
    "https://edith.xiaohongshu.com/web_api/sns/capa/postgw/query_transcode";
const XHS_PUBLISH_REFERER: &str = "https://creator.xiaohongshu.com/publish/publish";
const XHS_CREATOR_ROOT_URL: &str = "https://creator.xiaohongshu.com/";
const XHS_CREATOR_SIGNER_JS: &str = include_str!("../../resources/xhs-signer/xhs_creator_260411.js");
const XHS_RAP_SIGNER_JS: &str = include_str!("../../resources/xhs-signer/xhs_rap.js");
const XHS_CREATOR_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0";
const XHS_CREATOR_SEC_CH_UA: &str =
    "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"";
const XHS_TRANSCODE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const XHS_TRANSCODE_SEC_CH_UA: &str =
    "\"Chromium\";v=\"124\", \"Microsoft Edge\";v=\"124\", \"Not-A.Brand\";v=\"99\"";
const XHS_UPLOAD_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0";
const XHS_UPLOAD_SEC_CH_UA: &str =
    "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\", \"Microsoft Edge\";v=\"122\"";
const XHS_MAX_IMAGE_COUNT: usize = 18;
const XHS_MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const XHS_SINGLE_UPLOAD_LIMIT_BYTES: u64 = 200 * 1024 * 1024;
const XHS_TRANSCODE_MAX_ATTEMPTS: usize = 20;
const XHS_TRANSCODE_RETRY_DELAY: Duration = Duration::from_secs(3);
const XHS_MIN_SCHEDULE_DELAY_SECONDS: i64 = 60 * 60;
const XHS_MAX_SCHEDULE_DELAY_SECONDS: i64 = 14 * 24 * 60 * 60;

struct XhsCreatorSignerRuntime {
    _runtime: Runtime,
    context: Context,
}

struct XhsRapSignerRuntime {
    _runtime: Runtime,
    context: Context,
}

enum XhsSignerOperation {
    Creator(String),
    Rap { api: String, data: String },
}

struct XhsCreatorSignerJob {
    operation: XhsSignerOperation,
    reply: mpsc::Sender<Result<String, String>>,
}

static XHS_CREATOR_SIGNER_WORKER: OnceLock<Mutex<mpsc::Sender<XhsCreatorSignerJob>>> = OnceLock::new();
static XHS_RAP_SIGNER_WORKER: OnceLock<Mutex<mpsc::Sender<XhsCreatorSignerJob>>> = OnceLock::new();

const CREATOR_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://creator.xiaohongshu.com"),
    ("Referer", CREATOR_HOME_URL),
];
const EDITH_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://www.xiaohongshu.com"),
    ("Referer", "https://www.xiaohongshu.com/"),
];

const USER_UID_KEYS: &[&str] = &["redId", "red_id", "red_num", "redNum", "user_id", "userId", "id"];
const EDITH_UID_KEYS: &[&str] = &["redId", "red_id", "red_num", "redNum", "user_id", "userId", "id"];
const CREATOR_UID_KEYS: &[&str] = &[
    "redId",
    "red_id",
    "red_num",
    "redNum",
    "user_id",
    "userId",
    "id",
    "creator_id",
    "creatorId",
    "author_id",
    "authorId",
];
const USER_NICKNAME_KEYS: &[&str] = &[
    "userName",
    "user_name",
    "nickname",
    "nickName",
    "name",
    "red_id",
    "redId",
];
const CREATOR_NICKNAME_KEYS: &[&str] = &[
    "name",
    "nickname",
    "nickName",
    "user_name",
    "userName",
    "creator_name",
    "creatorName",
];
const EDITH_NICKNAME_KEYS: &[&str] = &["name", "nickname", "nickName", "user_name", "userName", "red_id"];
const USER_AVATAR_KEYS: &[&str] = &[
    "userAvatar",
    "user_avatar",
    "avatar",
    "avatar_url",
    "avatarUrl",
    "head_img",
    "headImg",
    "headImgUrl",
];
const CREATOR_AVATAR_KEYS: &[&str] = &[
    "avatar",
    "avatar_url",
    "avatarUrl",
    "head_img",
    "headImg",
    "headImgUrl",
    "image",
    "image_url",
    "imageUrl",
    "profile_image_url",
    "profilePicture",
];
const EDITH_AVATAR_KEYS: &[&str] = CREATOR_AVATAR_KEYS;
const FOLLOWER_COUNT_KEYS: &[&str] = &[
    "fans_count",
    "fansCount",
    "fans",
    "fan_count",
    "fanCount",
    "fans_num",
    "fansNum",
    "followers",
    "followers_count",
    "followersCount",
    "fans_count_show",
    "fansCountShow",
    "fansNumShow",
];
const FOLLOWING_COUNT_KEYS: &[&str] = &[
    "following_count",
    "followingCount",
    "follow_count",
    "followCount",
    "follow_num",
    "followNum",
    "follows",
    "follows_count",
    "followsCount",
    "followings",
    "attention_count",
    "attentionCount",
];
const LIKE_COUNT_KEYS: &[&str] = &[
    "liked_count",
    "likedCount",
    "like_count",
    "likeCount",
    "likes",
    "liked",
    "faved_count",
    "favedCount",
    "like_collect_count",
    "likeCollectCount",
    "liked_collect_count",
    "likedCollectCount",
    "liked_num_show",
    "likedNumShow",
    "total_liked",
    "totalLiked",
];
const NOTE_ID_KEYS: &[&str] = &["id", "note_id", "noteId", "item_id", "itemId"];
const NOTE_TITLE_KEYS: &[&str] = &["title", "display_title", "displayTitle", "desc", "content"];
const NOTE_COVER_KEYS: &[&str] = &[
    "coverUrl",
    "cover_url",
    "cover",
    "image",
    "image_url",
    "imageUrl",
    "url",
];
const NOTE_LINK_KEYS: &[&str] = &["link", "url", "share_url", "shareUrl"];
const NOTE_TIME_KEYS: &[&str] = &["postTime", "post_time", "publishTime", "publish_time", "time"];
const NOTE_VIEW_KEYS: &[&str] = &["view_count", "viewCount", "views", "read_count", "readCount"];
const NOTE_IMPRESSION_KEYS: &[&str] = &[
    "impl_count",
    "exposure_count",
    "exposureCount",
    "impression_count",
    "impressionCount",
];
const NOTE_LIKE_KEYS: &[&str] = &["likes", "like_count", "likeCount", "liked_count", "likedCount"];
const NOTE_COLLECT_KEYS: &[&str] = &[
    "collected_count",
    "collect_count",
    "collectCount",
    "collects",
    "fav_count",
    "favCount",
];
const NOTE_COMMENT_KEYS: &[&str] = &[
    "comments_count",
    "comment_count",
    "commentCount",
    "comments",
];
const NOTE_SHARE_KEYS: &[&str] = &["shared_count", "share_count", "shareCount", "shares"];
const NOTE_DETAIL_IMPRESSION_KEYS: &[&str] = &[
    "implCount",
    "impl_count",
    "impCount",
    "imp_count",
    "exposureCount",
    "exposure_count",
];
const NOTE_DETAIL_VIEW_KEYS: &[&str] = &["viewCount", "view_count", "views"];
const NOTE_DETAIL_COVER_CLICK_RATE_KEYS: &[&str] = &["coverClickRate", "cover_click_rate"];
const NOTE_DETAIL_AVG_VIEW_TIME_KEYS: &[&str] = &[
    "viewTimeAvgWithDouble",
    "avg_view_time",
    "avgViewTimeWithDouble",
    "view_time_avg_with_double",
    "viewTimeAvg",
    "view_time_avg",
    "avgViewTime",
];
const NOTE_DETAIL_GAINED_FOLLOWER_KEYS: &[&str] = &[
    "riseFansCount",
    "rise_fans_count",
    "followFromDiscovery",
    "netRiseFansCount",
];
const NOTE_DETAIL_UPDATED_AT_KEYS: &[&str] = &[
    "basicDataLastUpdateTime",
    "analyseInfosLastUpdateTime",
    "dataLastUpdateTime",
    "data_update_time",
    "dataUpdateTime",
    "lastUpdateTime",
    "basic_data_last_update_time",
    "analyse_infos_last_update_time",
    "data_last_update_time",
    "end_time",
];

pub(super) static SPEC: ChannelPlatform = ChannelPlatform {
    id: "xiaohongshu",
    name: "小红书",
    slug: "XHS",
    color: "#ff2442",
    description: "添加并管理多个小红书账号。",
    creator_home_url: CREATOR_HOME_URL,
    cookie_urls: COOKIE_URLS,
    default_cookie_domain: ".xiaohongshu.com",
    cookie_domains: COOKIE_DOMAINS,
    login_cookie_names: &[],
    homepage_kind: HomepageKind::Creator,
    plugin_auth: true,
    materialize_avatar: true,
    avatar_referer: Some("https://creator.xiaohongshu.com/"),
    avatar_origin: Some("https://creator.xiaohongshu.com"),
};

pub(super) async fn refresh_xhs_account_profile(
    saved_login_cookie: Option<&str>,
) -> Result<Option<PluginAccountInfo>, String> {
    if let Some(login_cookie) = saved_login_cookie {
        let cookie_header = login_cookie_to_header(login_cookie);
        if !cookie_header.trim().is_empty() {
            match fetch_xhs_plugin_account_from_cookie(
                &cookie_header,
                login_cookie.to_string(),
                Some("creator"),
            )
            .await
            {
                Ok(profile) => return Ok(Some(profile)),
                Err(error) => eprintln!("[refresh:xhs] saved cookie refresh failed: {}", plugin_error_message(&error)),
            }
        }
    }

    Err("小红书登录已失效，请重新登录后再打开创作中心。".to_string())
}

pub(super) fn xhs_profile_matches_account(profile: &PluginAccountInfo, account: &ChannelAccount) -> bool {
    let profile_values = [&profile.uid, &profile.account, &profile.nickname]
        .into_iter()
        .map(|value| normalize_match_key(value))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    xhs_account_match_values(account)
        .into_iter()
        .any(|value| profile_values.iter().any(|profile_value| profile_value == &value))
}

fn xhs_account_match_values(account: &ChannelAccount) -> Vec<String> {
    let mut values = vec![
        account.uid.clone(),
        account.nickname.clone(),
        account.id.clone(),
    ];
    values.extend(values.clone().into_iter().map(|value| {
        value
            .strip_prefix("xhs_")
            .unwrap_or(&value)
            .strip_suffix("_web")
            .unwrap_or_else(|| value.strip_prefix("xhs_").unwrap_or(&value))
            .to_string()
    }));
    values
        .into_iter()
        .map(|value| normalize_match_key(&value))
        .filter(|value| !value.is_empty())
        .collect()
}

pub(super) async fn fetch_xhs_plugin_account_from_cookie(
    cookie_header: &str,
    login_cookie: String,
    login_target: Option<&str>,
) -> Result<PluginAccountInfo, PluginAuthError> {
    let user_future = async {
        let started = Instant::now();
        let result = request_plugin_json(
            "GET",
            CREATOR_USER_INFO_API,
            cookie_header,
            CREATOR_HEADERS,
        )
        .await;
        trace_xhs_stage("profile.creator_user", "request", started);
        result
    };
    let edith_future = async {
        let started = Instant::now();
        let result = request_plugin_json(
            "GET",
            EDITH_USER_ME_API,
            cookie_header,
            EDITH_HEADERS,
        )
        .await;
        trace_xhs_stage("profile.edith_user", "request", started);
        result
    };
    let creator_future = async {
        let started = Instant::now();
        let result = request_plugin_json(
            "GET",
            CREATOR_PERSONAL_INFO_API,
            cookie_header,
            CREATOR_HEADERS,
        )
        .await;
        trace_xhs_stage("profile.creator_personal", "request", started);
        result
    };
    let (user_result, edith_result, creator_result) =
        tokio::join!(user_future, edith_future, creator_future);
    if let Err(error) = &user_result {
        eprintln!("[plugin-auth:xhs] creator user request failed: {error}");
    }
    if let Err(error) = &edith_result {
        eprintln!("[plugin-auth:xhs] edith profile request failed: {error}");
    }
    if let Err(error) = &creator_result {
        eprintln!("[plugin-auth:xhs] creator profile request failed: {error}");
    }
    let user = user_result.ok();
    let edith = edith_result.ok();
    let creator = creator_result.ok();
    let user_data = user.as_ref().and_then(xhs_response_payload);
    let edith_data = edith.as_ref().and_then(xhs_response_payload);
    let creator_data = creator.as_ref().and_then(xhs_response_payload);
    let user_uid = user_data.and_then(|data| first_string_deep(data, USER_UID_KEYS));
    let edith_uid = edith_data.and_then(|data| first_string_deep(data, EDITH_UID_KEYS));
    let creator_uid = creator_data.and_then(|data| first_string_deep(data, CREATOR_UID_KEYS));
    let user_nickname = user_data.and_then(|data| first_string_deep(data, USER_NICKNAME_KEYS));
    let creator_nickname = creator_data.and_then(|data| first_string_deep(data, CREATOR_NICKNAME_KEYS));
    let user_avatar = user_data.and_then(|data| first_profile_image(data, USER_AVATAR_KEYS));
    let creator_avatar = creator_data.and_then(|data| first_profile_image(data, CREATOR_AVATAR_KEYS));
    let creator_fans_count = creator_data.and_then(|data| first_count(data, FOLLOWER_COUNT_KEYS));
    let creator_following_count = creator_data.and_then(|data| first_count(data, FOLLOWING_COUNT_KEYS));
    let creator_like_count = creator_data.and_then(|data| first_count(data, LIKE_COUNT_KEYS));
    let user_ok = user
        .as_ref()
        .map(|value| response_success(value) && user_uid.is_some())
        .unwrap_or(false);
    let creator_has_profile = creator_uid.is_some()
        || creator_nickname.is_some()
        || creator_avatar.is_some()
        || creator_fans_count.is_some()
        || creator_following_count.is_some()
        || creator_like_count.is_some();
    let creator_ok = creator
        .as_ref()
        .map(|value| response_success(value) && creator_has_profile)
        .unwrap_or(false);
    eprintln!("[plugin-auth:xhs] user_ok={user_ok} creator_ok={creator_ok}");
    if !user_ok || !creator_ok {
        return Err(PluginAuthError::NotLoggedIn(match login_target {
            Some("home") => "请先在打开的小红书主页完成登录。".to_string(),
            _ => "请先在打开的小红书创作中心完成登录。".to_string(),
        }));
    }

    let uid = user_uid.or(creator_uid).or(edith_uid).unwrap_or_default();
    let nickname = creator_nickname
        .or(user_nickname)
        .or_else(|| {
            edith_data.and_then(|data| first_string_deep(data, EDITH_NICKNAME_KEYS))
        })
        .unwrap_or_default();
    let avatar = creator_avatar
        .or(user_avatar)
        .or_else(|| {
            edith_data.and_then(|data| first_profile_image(data, EDITH_AVATAR_KEYS))
        })
        .map(normalize_image_url)
        .unwrap_or_default();
    let avatar_started = Instant::now();
    let avatar = materialize_account_avatar("xiaohongshu", avatar).await;
    trace_xhs_stage("profile.avatar", "materialize", avatar_started);
    let account = if uid.trim().is_empty() {
        nickname.clone()
    } else {
        uid.clone()
    };
    if account.trim().is_empty() || account == platform_name("xiaohongshu") {
        return Err(PluginAuthError::NotLoggedIn(
            "小红书已登录，但没有读取到账号 ID，请进入创作者中心后再检查状态。".to_string(),
        ));
    }

    Ok(PluginAccountInfo {
        uid: account.clone(),
        account,
        nickname,
        avatar,
        fans_count: creator_fans_count
            .or_else(|| first_count_from_values(&[user_data, edith_data], FOLLOWER_COUNT_KEYS)),
        following_count: creator_following_count
            .or_else(|| first_count_from_values(&[user_data, edith_data], FOLLOWING_COUNT_KEYS)),
        like_count: creator_like_count
            .or_else(|| first_count_from_values(&[user_data, edith_data], LIKE_COUNT_KEYS)),
        login_cookie,
    })
}

fn xhs_response_payload(value: &Value) -> Option<&Value> {
    value
        .get("data")
        .filter(|data| !data.is_null())
        .or(Some(value))
}

#[derive(Debug, Deserialize)]
struct XhsCreatorSignature {
    #[serde(rename = "x-s")]
    x_s: String,
    #[serde(rename = "x-t")]
    x_t: String,
    #[serde(rename = "x-s-common")]
    x_s_common: String,
    #[serde(rename = "x-b3-traceid")]
    x_b3_traceid: String,
    #[serde(rename = "x-xray-traceid")]
    x_xray_traceid: String,
}

async fn request_xhs_creator_signed_json(
    method: &str,
    url: &str,
    cookie_header: &str,
    login_cookie: &str,
) -> Result<Value, String> {
    request_xhs_creator_signed_json_with_body(
        method,
        url,
        cookie_header,
        login_cookie,
        None,
        CREATOR_HOME_URL,
        "https://creator.xiaohongshu.com",
        false,
    )
    .await
}

async fn request_xhs_creator_signed_json_with_body(
    method: &str,
    url: &str,
    cookie_header: &str,
    login_cookie: &str,
    body: Option<&str>,
    referer: &str,
    origin: &str,
    include_x_rap: bool,
) -> Result<Value, String> {
    let total_started = Instant::now();
    let request_label = xhs_request_label(method, url);
    let a1 = xhs_cookie_value(login_cookie, cookie_header, "a1")
        .ok_or_else(|| "小红书 Cookie 缺少 a1，无法生成创作中心接口签名，请重新登录。".to_string())?;
    let api = xhs_creator_signature_api(url)?;
    let body_text = body.unwrap_or(if method.eq_ignore_ascii_case("POST") { "{}" } else { "" });
    let sign_started = Instant::now();
    let signature = generate_xhs_creator_signature(&api, body_text, &a1)?;
    let x_rap = include_x_rap
        .then(|| generate_xhs_rap_param(&api, body_text))
        .transpose()?;
    trace_xhs_stage(&request_label, "sign", sign_started);
    let (user_agent, sec_ch_ua) = xhs_request_browser_profile(url);
    let mut request = if method.eq_ignore_ascii_case("POST") {
        platform_http_client().post(url)
    } else {
        platform_http_client().get(url)
    };
    request = request
        .header("Cookie", cookie_header)
        .header("User-Agent", user_agent)
        .header("Accept", PLATFORM_JSON_ACCEPT)
        .header("Accept-Language", PLATFORM_ACCEPT_LANGUAGE)
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header("Origin", origin)
        .header("Referer", referer)
        .header("sec-ch-ua", sec_ch_ua)
        .header("sec-ch-ua-mobile", "?0")
        .header("sec-ch-ua-platform", "\"Windows\"")
        .header("sec-fetch-dest", "empty")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-site", xhs_sec_fetch_site(url, origin))
        .header("x-s", signature.x_s)
        .header("x-t", signature.x_t)
        .header("x-s-common", signature.x_s_common)
        .header("x-b3-traceid", signature.x_b3_traceid)
        .header("x-xray-traceid", signature.x_xray_traceid)
        .timeout(std::time::Duration::from_secs(18));
    if let Some(x_rap) = x_rap {
        request = request.header("x-rap-param", x_rap);
    }
    if method.eq_ignore_ascii_case("POST") {
        request = request
            .header(
                "Content-Type",
                if include_x_rap {
                    "application/json"
                } else {
                    "application/json;charset=utf-8"
                },
            )
            .body(body_text.to_string());
    }
    let send_started = Instant::now();
    let response = match request.send().await {
        Ok(response) => {
            trace_xhs_stage(&request_label, "send", send_started);
            response
        }
        Err(error) => {
            trace_xhs_stage(&request_label, "send.failed", send_started);
            return Err(format!("小红书创作中心接口请求失败: {error}"));
        }
    };
    let status = response.status();
    if !status.is_success() {
        trace_xhs_message(&format!("{request_label} status={status}"));
        let body = response.text().await.unwrap_or_default();
        let body = compact_http_body(&body, 300);
        if body.is_empty() {
            return Err(format!("小红书创作中心接口返回 HTTP {status}"));
        }
        return Err(format!("小红书创作中心接口返回 HTTP {status}: {body}"));
    }
    let json_started = Instant::now();
    let value = response
        .json()
        .await
        .map_err(|error| format!("小红书创作中心接口不是 JSON: {error}"))?;
    trace_xhs_stage(&request_label, "json", json_started);
    trace_xhs_stage(&request_label, "total", total_started);
    Ok(value)
}

fn xhs_request_browser_profile(url: &str) -> (&'static str, &'static str) {
    if url.starts_with(XHS_QUERY_TRANSCODE_API) {
        (XHS_TRANSCODE_USER_AGENT, XHS_TRANSCODE_SEC_CH_UA)
    } else {
        (XHS_CREATOR_USER_AGENT, XHS_CREATOR_SEC_CH_UA)
    }
}

async fn request_xhs_creator_payload(
    method: &str,
    url: &str,
    cookie_header: &str,
    login_cookie: &str,
) -> Result<Option<Value>, String> {
    request_xhs_creator_signed_json(method, url, cookie_header, login_cookie)
        .await
        .map(|value| xhs_response_payload(&value).cloned())
}

fn record_xhs_sync_result(
    label: &str,
    result: Result<Option<Value>, String>,
    sync_errors: &mut Vec<String>,
) -> Option<Value> {
    match result {
        Ok(value) => value,
        Err(error) => {
            sync_errors.push(format!("{label}: {error}"));
            None
        }
    }
}

fn xhs_creator_api_url(base: &str, params: &[(&str, &str)]) -> String {
    let mut url = base.to_string();
    for (index, (key, value)) in params.iter().enumerate() {
        url.push(if index == 0 { '?' } else { '&' });
        url.push_str(key);
        url.push('=');
        url.push_str(&encode_query(value));
    }
    url
}

fn xhs_creator_signature_api(url: &str) -> Result<String, String> {
    let parsed = Url::parse(url).map_err(|error| format!("小红书创作中心接口 URL 无效: {error}"))?;
    let mut api = parsed.path().to_string();
    if let Some(query) = parsed.query().filter(|value| !value.trim().is_empty()) {
        api.push('?');
        api.push_str(query);
    }
    Ok(api)
}

fn generate_xhs_creator_signature(api: &str, data: &str, a1: &str) -> Result<XhsCreatorSignature, String> {
    let input_json = serde_json::to_string(&serde_json::json!({
        "api": api,
        "data": data,
        "a1": a1,
    }))
    .map_err(|error| format!("小红书签名参数序列化失败: {error}"))?;
    let signature_json = run_xhs_creator_signer(&input_json)
        .map_err(|error| format!("小红书签名执行失败，请稍后重试或更新客户端: {error}"))?;
    serde_json::from_str::<XhsCreatorSignature>(&signature_json)
        .map_err(|error| format!("解析小红书签名结果失败: {error}"))
}

fn generate_xhs_rap_param(api: &str, data: &str) -> Result<String, String> {
    run_xhs_signer(XhsSignerOperation::Rap {
        api: api.to_string(),
        data: data.to_string(),
    })
    .map_err(|error| format!("小红书 x-rap-param 生成失败: {error}"))
}

fn run_xhs_creator_signer(input_json: &str) -> Result<String, String> {
    run_xhs_signer(XhsSignerOperation::Creator(input_json.to_string()))
}

fn run_xhs_signer(operation: XhsSignerOperation) -> Result<String, String> {
    let worker = match &operation {
        XhsSignerOperation::Creator(_) => {
            warm_xhs_creator_signer()?;
            &XHS_CREATOR_SIGNER_WORKER
        }
        XhsSignerOperation::Rap { .. } => {
            warm_xhs_rap_signer()?;
            &XHS_RAP_SIGNER_WORKER
        }
    };
    let (reply, result) = mpsc::channel();
    let sender = worker
        .get()
        .ok_or_else(|| "小红书签名 worker 未初始化".to_string())?;
    sender
        .lock()
        .map_err(|_| "小红书签名 worker 已不可用".to_string())?
        .send(XhsCreatorSignerJob {
            operation,
            reply,
        })
        .map_err(|_| "小红书签名 worker 已退出".to_string())?;
    result
        .recv()
        .map_err(|_| "小红书签名 worker 没有返回结果".to_string())?
}

fn xhs_sec_fetch_site(url: &str, origin: &str) -> &'static str {
    let target_host = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(ToString::to_string));
    let origin_host = Url::parse(origin)
        .ok()
        .and_then(|url| url.host_str().map(ToString::to_string));
    match (target_host.as_deref(), origin_host.as_deref()) {
        (Some(target), Some(source)) if target == source => "same-origin",
        (Some(target), Some(source))
            if target.ends_with(".xiaohongshu.com") && source.ends_with(".xiaohongshu.com") =>
        {
            "same-site"
        }
        _ => "cross-site",
    }
}

pub(crate) fn warm_xhs_creator_signer() -> Result<(), String> {
    if XHS_CREATOR_SIGNER_WORKER.get().is_some() {
        return Ok(());
    }
    let (sender, receiver) = mpsc::channel();
    std::thread::Builder::new()
        .name("xhs-creator-signer".to_string())
        .spawn(move || run_xhs_creator_signer_worker(receiver))
        .map_err(|error| format!("启动小红书签名 worker 失败: {error}"))?;
    let _ = XHS_CREATOR_SIGNER_WORKER.set(Mutex::new(sender));
    Ok(())
}

fn run_xhs_creator_signer_worker(receiver: mpsc::Receiver<XhsCreatorSignerJob>) {
    let mut creator_runtime = None;
    for job in receiver {
        let result = match job.operation {
            XhsSignerOperation::Creator(input_json) => {
                let runtime = creator_runtime.get_or_insert_with(XhsCreatorSignerRuntime::new);
                match runtime.as_ref() {
                    Ok(runtime) => runtime.sign(&input_json),
                    Err(error) => Err(error.clone()),
                }
            }
            XhsSignerOperation::Rap { .. } => Err("小红书签名任务路由错误".to_string()),
        };
        let _ = job.reply.send(result);
    }
}

fn warm_xhs_rap_signer() -> Result<(), String> {
    if XHS_RAP_SIGNER_WORKER.get().is_some() {
        return Ok(());
    }
    let (sender, receiver) = mpsc::channel();
    std::thread::Builder::new()
        .name("xhs-rap-signer".to_string())
        .spawn(move || run_xhs_rap_signer_worker(receiver))
        .map_err(|error| format!("启动小红书 x-rap worker 失败: {error}"))?;
    let _ = XHS_RAP_SIGNER_WORKER.set(Mutex::new(sender));
    Ok(())
}

fn run_xhs_rap_signer_worker(receiver: mpsc::Receiver<XhsCreatorSignerJob>) {
    let mut runtime = None;
    for job in receiver {
        let result = match job.operation {
            XhsSignerOperation::Rap { api, data } => {
                let runtime = runtime.get_or_insert_with(XhsRapSignerRuntime::new);
                match runtime.as_ref() {
                    Ok(runtime) => runtime.sign(&api, &data),
                    Err(error) => Err(error.clone()),
                }
            }
            XhsSignerOperation::Creator(_) => Err("小红书 x-rap 任务路由错误".to_string()),
        };
        let _ = job.reply.send(result);
    }
}

fn prewarm_xhs_rap_signer() {
    if XHS_RAP_SIGNER_WORKER.get().is_some() {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("xhs-rap-prewarm".to_string())
        .spawn(|| {
            if let Err(error) = generate_xhs_rap_param(XHS_POST_NOTE_API, "{}") {
                trace_xhs_message(&format!("rap_signer.prewarm.failed error={error}"));
            }
        });
}

fn xhs_request_label(method: &str, url: &str) -> String {
    let endpoint = Url::parse(url)
        .map(|url| url.path().trim_start_matches('/').to_string())
        .unwrap_or_else(|_| url.to_string());
    format!("{} {}", method.to_ascii_uppercase(), endpoint)
}

fn trace_xhs_stage(label: &str, stage: &str, started: Instant) {
    trace_xhs_message(&format!(
        "{label}.{stage} elapsed={}ms",
        started.elapsed().as_millis()
    ));
}

fn trace_xhs_timing(label: &str, started: Instant) {
    trace_xhs_message(&format!("{label} elapsed={}ms", started.elapsed().as_millis()));
}

fn trace_xhs_message(message: &str) {
    if xhs_trace_enabled() {
        eprintln!("[xhs-sync] {message}");
    }
}

fn xhs_trace_enabled() -> bool {
    std::env::var("CHANNEL_NEST_TRACE_XHS")
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !value.is_empty() && value != "0" && value != "false" && value != "off"
        })
        .unwrap_or(cfg!(debug_assertions))
}

impl XhsCreatorSignerRuntime {
    fn new() -> Result<Self, String> {
        let started = Instant::now();
        let runtime = Runtime::new().map_err(|error| format!("创建内置签名运行时失败: {error}"))?;
        let context = Context::full(&runtime)
            .map_err(|error| format!("初始化内置签名运行时失败: {error}"))?;
        context.with(|ctx| {
            let globals = ctx.globals();
            globals
                .set("__xhsMd5", Func::from(|value: String| xhs_md5_hex(&value)))
                .map_err(|error| format!("注入 MD5 函数失败: {error}"))?;
            globals
                .set(
                    "__xhsTraceHexRust",
                    Func::from(|length: i32| xhs_trace_hex(length.max(0) as usize)),
                )
                .map_err(|error| format!("注入 trace 函数失败: {error}"))?;

            let mut script = String::with_capacity(
                XHS_CREATOR_SIGNER_SHIM.len()
                    + XHS_CREATOR_SIGNER_JS.len()
                    + XHS_CREATOR_SIGNER_FUNCTION.len(),
            );
            script.push_str(XHS_CREATOR_SIGNER_SHIM);
            script.push_str(XHS_CREATOR_SIGNER_JS);
            script.push_str(XHS_CREATOR_SIGNER_FUNCTION);
            let mut eval_options = EvalOptions::default();
            eval_options.strict = false;
            ctx.eval_with_options::<(), _>(script, eval_options)
                .catch(&ctx)
                .map_err(|error| error.to_string())
        })?;
        trace_xhs_timing("signer.bootstrap", started);
        Ok(Self {
            _runtime: runtime,
            context,
        })
    }

    fn sign(&self, input_json: &str) -> Result<String, String> {
        self.context.with(|ctx| {
            let sign: Function = ctx
                .globals()
                .get("__xhsSignJson")
                .catch(&ctx)
                .map_err(|error| error.to_string())?;
            sign.call((input_json.to_string(),))
                .catch(&ctx)
                .map_err(|error| error.to_string())
        })
    }
}

impl XhsRapSignerRuntime {
    fn new() -> Result<Self, String> {
        let started = Instant::now();
        let runtime = Runtime::new().map_err(|error| format!("创建 x-rap 运行时失败: {error}"))?;
        let context = Context::full(&runtime)
            .map_err(|error| format!("初始化 x-rap 运行时失败: {error}"))?;
        context.with(|ctx| {
            ctx.globals()
                .set(
                    "__xhsRapRandomHexRust",
                    Func::from(|length: i32| xhs_trace_hex(length.max(0) as usize)),
                )
                .map_err(|error| format!("注入 x-rap 随机数函数失败: {error}"))?;

            let mut script =
                String::with_capacity(XHS_RAP_SIGNER_SHIM.len() + XHS_RAP_SIGNER_JS.len());
            script.push_str(XHS_RAP_SIGNER_SHIM);
            script.push_str(XHS_RAP_SIGNER_JS);
            let mut eval_options = EvalOptions::default();
            eval_options.strict = false;
            ctx.eval_with_options::<(), _>(script, eval_options)
                .catch(&ctx)
                .map_err(|error| error.to_string())
        })?;
        trace_xhs_timing("rap_signer.bootstrap", started);
        Ok(Self {
            _runtime: runtime,
            context,
        })
    }

    fn sign(&self, api: &str, data: &str) -> Result<String, String> {
        self.context.with(|ctx| {
            let sign: Function = ctx
                .globals()
                .get("generate_x_rap_param")
                .catch(&ctx)
                .map_err(|error| error.to_string())?;
            sign.call((api.to_string(), data.to_string(), "creator-platform".to_string()))
                .catch(&ctx)
                .map_err(|error| error.to_string())
        })
    }
}

const XHS_CREATOR_SIGNER_FUNCTION: &str =
    include_str!("../../resources/xhs-signer/xhs_creator_entry.js");

fn xhs_md5_hex(value: &str) -> String {
    format!("{:x}", md5::compute(value.as_bytes()))
}

fn xhs_trace_hex(length: usize) -> String {
    let mut output = String::new();
    while output.len() < length {
        output.push_str(&Uuid::new_v4().simple().to_string());
    }
    output.truncate(length);
    output
}

fn xhs_cookie_value(login_cookie: &str, cookie_header: &str, name: &str) -> Option<String> {
    let trimmed = login_cookie.trim();
    if trimmed.starts_with('[') {
        if let Ok(Value::Array(cookies)) = serde_json::from_str::<Value>(trimmed) {
            if let Some(value) = cookies.iter().find_map(|cookie| {
                let cookie_name = cookie.get("name")?.as_str()?;
                if cookie_name == name {
                    cookie.get("value")?.as_str().map(ToString::to_string)
                } else {
                    None
                }
            }) {
                return Some(value);
            }
        }
    }
    cookie_header.split(';').find_map(|part| {
        let (cookie_name, value) = part.trim().split_once('=')?;
        if cookie_name.trim() == name {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

const XHS_RAP_SIGNER_SHIM: &str =
    include_str!("../../resources/xhs-signer/xhs_rap_runtime.js");

const XHS_CREATOR_SIGNER_SHIM: &str =
    include_str!("../../resources/xhs-signer/xhs_creator_runtime.js");

pub(super) async fn fetch_xhs_account_content(
    cookie_header: &str,
    login_cookie: String,
    account_id: &str,
) -> Result<ChannelAccountContent, String> {
    let profile = fetch_xhs_plugin_account_from_cookie(cookie_header, login_cookie.clone(), Some("creator"))
        .await
        .map_err(|error| plugin_error_message(&error))?;
    let profile_snapshot = plugin_account_profile_snapshot(account_id, "xiaohongshu", &profile);
    fetch_xhs_account_content_with_profile_snapshot(cookie_header, login_cookie, account_id, profile_snapshot).await
}

pub(crate) async fn fetch_xhs_account_content_with_profile_snapshot(
    cookie_header: &str,
    login_cookie: String,
    account_id: &str,
    profile_snapshot: ChannelAccountProfileSnapshot,
) -> Result<ChannelAccountContent, String> {
    let total_started = Instant::now();
    let now = Utc::now();
    let (account_base_result, latest_note_result, fans_overall_result) = tokio::join!(
        request_xhs_creator_payload("GET", CREATOR_ACCOUNT_BASE_API, cookie_header, &login_cookie),
        request_xhs_creator_payload("GET", CREATOR_LATEST_NOTE_API, cookie_header, &login_cookie),
        request_xhs_creator_payload("GET", CREATOR_FANS_OVERALL_API, cookie_header, &login_cookie),
    );

    let mut sync_errors = Vec::new();
    let account_base = record_xhs_sync_result(
        "账号数据",
        account_base_result,
        &mut sync_errors,
    );
    let latest_note = record_xhs_sync_result(
        "最新笔记",
        latest_note_result,
        &mut sync_errors,
    );
    let fans_overall = record_xhs_sync_result(
        "粉丝数据",
        fans_overall_result,
        &mut sync_errors,
    );

    let latest_note_info = latest_note.as_ref().and_then(|value| value.get("noteInfo")).cloned();
    let note_id = latest_note_info
        .as_ref()
        .and_then(|value| first_string_deep(value, NOTE_ID_KEYS));
    let (note_base, note_detail) = if let Some(note_id) = note_id.as_deref().filter(|value| !value.trim().is_empty()) {
        let note_base_url = xhs_creator_api_url(CREATOR_NOTE_BASE_API, &[("note_id", note_id)]);
        let note_detail_url = xhs_creator_api_url(CREATOR_NOTE_DETAIL_API, &[("note_id", note_id)]);
        let (note_base_result, note_detail_result) = tokio::join!(
            request_xhs_creator_payload("GET", &note_base_url, cookie_header, &login_cookie),
            request_xhs_creator_payload("GET", &note_detail_url, cookie_header, &login_cookie),
        );
        (
            record_xhs_sync_result("笔记核心数据", note_base_result, &mut sync_errors),
            record_xhs_sync_result("笔记详情", note_detail_result, &mut sync_errors),
        )
    } else {
        (None, None)
    };
    if account_base.is_none() && latest_note.is_none() && note_detail.is_none() {
        let message = if sync_errors.is_empty() {
            "小红书创作中心没有返回可用数据".to_string()
        } else {
            sync_errors.join("；")
        };
        return Err(message);
    }

    let (latest_work, latest_work_seven, latest_work_thirty) = build_xhs_latest_works(
        latest_note_info.as_ref(),
        latest_note.as_ref(),
        note_base.as_ref(),
        note_detail.as_ref(),
        account_id,
    )
    .await;

    let content = ChannelAccountContent {
        account_id: account_id.to_string(),
        platform_id: "xiaohongshu".to_string(),
        profile: Some(profile_snapshot),
        overview_yesterday: None,
        overview_seven: Some(build_xhs_period_overview(
            account_id,
            7,
            account_base.as_ref(),
            note_detail.as_ref(),
            fans_overall.as_ref(),
            now,
        )),
        overview_thirty: Some(build_xhs_period_overview(
            account_id,
            30,
            account_base.as_ref(),
            note_detail.as_ref(),
            fans_overall.as_ref(),
            now,
        )),
        latest_work,
        latest_work_seven,
        latest_work_thirty,
        sync_status: "synced".to_string(),
        error: None,
        ..Default::default()
    };
    trace_xhs_stage("account_content", "total", total_started);
    Ok(content)
}

pub(super) async fn fetch_xhs_works_page(
    cookie_header: &str,
    login_cookie: &str,
    account_id: &str,
    page_key: &str,
) -> Result<ChannelWorksPage, String> {
    let total_started = Instant::now();
    let mut url = format!("{CREATOR_POSTED_NOTES_API}?tab=0");
    if !page_key.trim().is_empty() {
        url.push_str("&page=");
        url.push_str(&encode_query(page_key.trim()));
    }
    let value = request_xhs_creator_signed_json("GET", &url, cookie_header, login_cookie)
        .await
        .map_err(|error| format!("小红书作品列表请求失败: {error}"))?;
    if !response_success(&value) {
        let message = value
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("小红书作品列表同步失败");
        return Err(message.to_string());
    }
    let data = xhs_response_payload(&value).ok_or_else(|| "小红书作品列表没有返回数据".to_string())?;
    let mut works = Vec::new();
    let cover_started = Instant::now();
    for item in data
        .get("notes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(work) = parse_xhs_work(item, account_id, "list") {
            works.push(work);
        }
    }
    let cover_count = materialize_platform_work_covers("xiaohongshu", &mut works).await;
    trace_xhs_message(&format!(
        "works_page.cover_materialize count={cover_count} elapsed={}ms",
        cover_started.elapsed().as_millis()
    ));

    let next_page_key = data.get("page").and_then(page_key_from_value);
    let has_more = next_page_key
        .as_deref()
        .map(|value| value != "-1" && !value.trim().is_empty())
        .unwrap_or(false);

    let page = ChannelWorksPage {
        account_id: account_id.to_string(),
        platform_id: "xiaohongshu".to_string(),
        page_key: page_key.to_string(),
        work_type: None,
        next_page_key: if has_more { next_page_key } else { None },
        has_more,
        works,
        updated_at: Some(Utc::now()),
        sync_status: "synced".to_string(),
        error: None,
    };
    trace_xhs_stage("works_page", "total", total_started);
    Ok(page)
}

pub(crate) async fn publish_xhs_work(
    cookie_header: &str,
    login_cookie: &str,
    content_type: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    prewarm_xhs_rap_signer();
    match content_type.trim() {
        "article" => publish_xhs_image_note(cookie_header, login_cookie, target).await,
        "video" => publish_xhs_video_note(cookie_header, login_cookie, target).await,
        _ => Err("小红书暂不支持当前作品类型。".to_string()),
    }
}

async fn publish_xhs_image_note(
    cookie_header: &str,
    login_cookie: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    let medias = xhs_image_media(target)?;
    let (title, desc) = xhs_note_text(target)?;
    let publish_time = xhs_publish_time(target)?;

    let uploaded = upload_xhs_image_files(cookie_header, login_cookie, medias).await?;
    let payload = xhs_image_note_payload(
        title,
        desc,
        &target.visibility,
        publish_time,
        &uploaded,
    );
    submit_xhs_note_payload(cookie_header, login_cookie, payload, "小红书笔记提交失败").await
}

async fn publish_xhs_video_note(
    cookie_header: &str,
    login_cookie: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    let media = xhs_video_media(target)?;
    let (title, desc) = xhs_note_text(target)?;
    let publish_time = xhs_publish_time(target)?;

    let video = upload_xhs_media_file(cookie_header, login_cookie, media, "video").await?;
    let video_id = match video.video_id.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(video_id) => video_id.to_string(),
        None => request_xhs_video_id(cookie_header, login_cookie, &video.file_id).await?,
    };
    let (cover_path, cover_media) = xhs_cover_media_from_data_url(media)?;
    let cover_upload = upload_xhs_media_file(cookie_header, login_cookie, &cover_media, "image").await;
    let _ = std::fs::remove_file(&cover_path);
    let cover = cover_upload?;
    wait_for_xhs_video_transcode(cookie_header, login_cookie, &video_id).await?;

    let payload = xhs_video_note_payload(
        title,
        desc,
        &target.visibility,
        publish_time,
        media,
        &video,
        &cover,
    );
    submit_xhs_note_payload(cookie_header, login_cookie, payload, "小红书视频笔记提交失败").await
}

fn xhs_note_text(target: &PublishWorkTargetRequest) -> Result<(&str, &str), String> {
    let title = target.title.trim();
    let desc = target.body.trim();
    if title.is_empty() && desc.is_empty() {
        return Err("请输入小红书作品标题或正文。".to_string());
    }
    Ok((title, desc))
}

async fn submit_xhs_note_payload(
    cookie_header: &str,
    login_cookie: &str,
    payload: Value,
    fallback: &str,
) -> Result<Option<String>, String> {
    let body = serde_json::to_string(&payload)
        .map_err(|error| format!("小红书发布参数序列化失败: {error}"))?;
    let value = request_xhs_creator_signed_json_with_body(
        "POST",
        XHS_POST_NOTE_API,
        cookie_header,
        login_cookie,
        Some(&body),
        XHS_CREATOR_ROOT_URL,
        "https://creator.xiaohongshu.com",
        true,
    )
    .await
    .map_err(|error| format!("{fallback}: {error}"))?;
    ensure_xhs_publish_success(&value, fallback)?;
    Ok(xhs_publish_remote_id(&value))
}

async fn upload_xhs_image_files(
    cookie_header: &str,
    login_cookie: &str,
    medias: &[PublishWorkMediaRequest],
) -> Result<Vec<XhsUploadedFile>, String> {
    let mut uploaded = Vec::with_capacity(medias.len());
    for (index, media) in medias.iter().enumerate() {
        let file = upload_xhs_media_file(cookie_header, login_cookie, media, "image")
            .await
            .map_err(|error| format!("小红书第 {} 张图片上传失败: {error}", index + 1))?;
        uploaded.push(file);
    }
    Ok(uploaded)
}

async fn upload_xhs_media_file(
    cookie_header: &str,
    login_cookie: &str,
    media: &PublishWorkMediaRequest,
    scene: &str,
) -> Result<XhsUploadedFile, String> {
    let meta = xhs_media_meta(media)?;
    let permit = request_xhs_upload_permit(cookie_header, login_cookie, scene, 1).await?;
    let upload_result = upload_xhs_cos_file(&permit, media, &meta).await?;
    Ok(XhsUploadedFile {
        file_id: permit.file_id,
        mime_type: meta.mime_type,
        size: meta.size,
        width: meta.width,
        height: meta.height,
        video_id: upload_result.video_id,
    })
}

async fn request_xhs_upload_permit(
    cookie_header: &str,
    login_cookie: &str,
    scene: &str,
    file_count: usize,
) -> Result<XhsUploadPermit, String> {
    let url = xhs_creator_api_url(
        XHS_UPLOAD_PERMIT_API,
        &[
            ("biz_name", "spectrum"),
            ("scene", scene),
            ("file_count", &file_count.to_string()),
            ("version", "1"),
            ("source", "web"),
        ],
    );
    let referer = format!(
        "{XHS_PUBLISH_REFERER}?source=official&from=menu&target={scene}"
    );
    let value = request_xhs_creator_signed_json_with_body(
        "GET",
        &url,
        cookie_header,
        login_cookie,
        None,
        &referer,
        "https://creator.xiaohongshu.com",
        false,
    )
        .await
        .map_err(|error| format!("小红书上传许可获取失败: {error}"))?;
    ensure_xhs_publish_success(&value, "小红书上传许可获取失败")?;
    let data = xhs_response_payload(&value).ok_or_else(|| "小红书上传许可缺少数据".to_string())?;
    let permits = data
        .get("uploadTempPermits")
        .or_else(|| data.get("upload_temp_permits"))
        .and_then(Value::as_array)
        .ok_or_else(|| "小红书上传许可缺少 uploadTempPermits".to_string())?;
    let permit = permits
        .iter()
        .max_by_key(|item| first_i64(item, &["qos"]).unwrap_or_default())
        .ok_or_else(|| "小红书上传许可为空".to_string())?;
    XhsUploadPermit::from_value(permit)
}

async fn upload_xhs_cos_file(
    permit: &XhsUploadPermit,
    media: &PublishWorkMediaRequest,
    meta: &XhsPublishMediaMeta,
) -> Result<XhsCosUploadResult, String> {
    if meta.size > XHS_SINGLE_UPLOAD_LIMIT_BYTES {
        return Err("小红书单文件上传当前只接入 200M 以内素材，较大视频的分片上传会继续接入。".to_string());
    }

    let path = Path::new(media.path.trim());
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("打开素材文件失败: {error}"))?;
    let host = xhs_upload_host(&permit.upload_addr);
    let key = permit.file_id.trim().trim_start_matches('/');
    let url = format!("https://{host}/{key}");
    let authorization = xhs_cos_authorization(permit, "put", &format!("/{key}"), &host)?;
    let response = platform_http_client()
        .put(url)
        .header("Authorization", authorization)
        .header("Host", host)
        .header("Accept", "*/*")
        .header("Accept-Language", PLATFORM_ACCEPT_LANGUAGE)
        .header("Content-Type", &meta.mime_type)
        .header("Content-Length", meta.size)
        .header("Origin", "https://creator.xiaohongshu.com")
        .header("Referer", XHS_CREATOR_ROOT_URL)
        .header("sec-ch-ua", XHS_UPLOAD_SEC_CH_UA)
        .header("sec-ch-ua-mobile", "?0")
        .header("sec-ch-ua-platform", "\"Windows\"")
        .header("sec-fetch-dest", "empty")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-site", "same-site")
        .header("User-Agent", XHS_UPLOAD_USER_AGENT)
        .header("x-cos-security-token", &permit.token)
        .timeout(Duration::from_secs(180))
        .body(reqwest::Body::from(file))
        .send()
        .await
        .map_err(|error| format!("小红书素材上传失败: {error}"))?;
    let video_id = response
        .headers()
        .get("x-ros-video-id")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let body = compact_http_body(&body, 300);
        if body.is_empty() {
            return Err(format!("小红书素材上传失败: HTTP {status}"));
        }
        return Err(format!("小红书素材上传失败: HTTP {status}: {body}"));
    }
    Ok(XhsCosUploadResult { video_id })
}

async fn request_xhs_video_id(
    cookie_header: &str,
    login_cookie: &str,
    file_id: &str,
) -> Result<String, String> {
    let url = xhs_creator_api_url(
        XHS_VIDEO_ID_API,
        &[("fileKey", file_id), ("bizName", "217")],
    );
    let value = request_xhs_creator_signed_json_with_body(
        "GET",
        &url,
        cookie_header,
        login_cookie,
        None,
        XHS_PUBLISH_REFERER,
        "https://creator.xiaohongshu.com",
        false,
    )
    .await
    .map_err(|error| format!("小红书视频 ID 获取失败: {error}"))?;
    ensure_xhs_publish_success(&value, "小红书视频 ID 获取失败")?;
    xhs_value_text_deep(&value, &["videoId", "video_id"])
        .ok_or_else(|| {
            let body = serde_json::to_string(&value)
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect::<String>();
            format!(
                "小红书视频 ID 获取失败: {} {}",
                xhs_value_key_summary(&value),
                body
            )
        })
}

enum XhsVideoTranscodeState {
    Ready,
    Pending(Option<String>),
    Failed(String),
}

async fn wait_for_xhs_video_transcode(
    cookie_header: &str,
    login_cookie: &str,
    video_id: &str,
) -> Result<(), String> {
    let url = xhs_creator_api_url(
        XHS_QUERY_TRANSCODE_API,
        &[
            ("video_id", video_id),
            ("need_transcode", "false"),
            ("resource_type", "0"),
        ],
    );
    let mut last_status = None;
    for attempt in 0..XHS_TRANSCODE_MAX_ATTEMPTS {
        let value = request_xhs_creator_signed_json_with_body(
            "GET",
            &url,
            cookie_header,
            login_cookie,
            None,
            XHS_CREATOR_ROOT_URL,
            "https://creator.xiaohongshu.com",
            false,
        )
        .await
        .map_err(|error| format!("小红书视频转码状态读取失败: {error}"))?;
        ensure_xhs_publish_success(&value, "小红书视频转码状态读取失败")?;
        match xhs_video_transcode_state(&value) {
            XhsVideoTranscodeState::Ready => return Ok(()),
            XhsVideoTranscodeState::Failed(status) => {
                return Err(format!("小红书视频转码失败: {status}"));
            }
            XhsVideoTranscodeState::Pending(status) => last_status = status,
        }
        if attempt + 1 < XHS_TRANSCODE_MAX_ATTEMPTS {
            tokio::time::sleep(XHS_TRANSCODE_RETRY_DELAY).await;
        }
    }
    Err(match last_status {
        Some(status) => format!("小红书视频转码等待超时，最后状态为 {status}，请稍后重试。"),
        None => "小红书视频转码等待超时，请稍后重试。".to_string(),
    })
}

fn xhs_video_transcode_state(value: &Value) -> XhsVideoTranscodeState {
    let Some(data) = value.get("data").filter(|data| !data.is_null()) else {
        return XhsVideoTranscodeState::Ready;
    };
    if data.as_object().map(|object| object.is_empty()).unwrap_or(false) {
        return XhsVideoTranscodeState::Ready;
    }
    let ready = ["hasFirstFrame", "has_first_frame"]
        .iter()
        .any(|key| data.get(*key).and_then(Value::as_bool).unwrap_or(false))
        || first_string_deep(data, &["firstFrameFileId", "first_frame_file_id"])
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        || first_i64(data, &["status"]) == Some(2)
        || first_string_deep(data, &["status"])
            .map(|status| status.eq_ignore_ascii_case("success"))
            .unwrap_or(false);
    if ready {
        return XhsVideoTranscodeState::Ready;
    }

    let status = xhs_value_text_deep(data, &["status", "transcodeStatus", "transcode_status"]);
    let failed = status
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .map(|status| {
            status.contains("fail")
                || status.contains("error")
                || status.contains("cancel")
                || status.contains("reject")
        })
        .unwrap_or(false);
    if failed {
        XhsVideoTranscodeState::Failed(status.unwrap_or_else(|| "unknown".to_string()))
    } else {
        XhsVideoTranscodeState::Pending(status)
    }
}

fn xhs_value_text_deep(value: &Value, keys: &[&str]) -> Option<String> {
    first_string_deep(value, keys)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| first_count(value, keys).map(|value| value.to_string()))
}

fn xhs_upload_host(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string()
}

fn xhs_cos_authorization(
    permit: &XhsUploadPermit,
    method: &str,
    uri: &str,
    host: &str,
) -> Result<String, String> {
    let now = Utc::now().timestamp();
    let start_time = permit.start_time.unwrap_or(now.saturating_sub(60));
    let expire_time = permit.expire_time.unwrap_or(now.saturating_add(1800));
    let key_time = format!("{start_time};{expire_time}");
    let sign_key = hmac_sha1_hex(permit.secret_key.as_bytes(), &key_time)?;
    let header_list = "host;x-cos-security-token";
    let header_string = format!(
        "host={}&x-cos-security-token={}",
        encode_query(host),
        encode_query(&permit.token)
    );
    let http_string = format!("{}\n{}\n\n{}\n", method.to_ascii_lowercase(), uri, header_string);
    let http_string_sha1 = sha1_hex(http_string.as_bytes());
    let string_to_sign = format!("sha1\n{key_time}\n{http_string_sha1}\n");
    let signature = hmac_sha1_hex(sign_key.as_bytes(), &string_to_sign)?;
    Ok(format!(
        "q-sign-algorithm=sha1&q-ak={}&q-sign-time={}&q-key-time={}&q-header-list={}&q-url-param-list=&q-signature={}",
        encode_query(&permit.secret_id),
        key_time,
        key_time,
        header_list,
        signature
    ))
}

fn hmac_sha1_hex(key: &[u8], value: &str) -> Result<String, String> {
    let mut mac = Hmac::<Sha1>::new_from_slice(key)
        .map_err(|error| format!("小红书 COS 签名初始化失败: {error}"))?;
    mac.update(value.as_bytes());
    Ok(hex_lower(&mac.finalize().into_bytes()))
}

fn sha1_hex(value: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(value);
    hex_lower(&hasher.finalize())
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}

fn xhs_image_note_payload(
    title: &str,
    desc: &str,
    visibility: &str,
    publish_time: Option<i64>,
    uploaded: &[XhsUploadedFile],
) -> Value {
    serde_json::json!({
        "common": {
            "type": "normal",
            "note_id": "",
            "title": title,
            "desc": desc,
            "ats": [],
            "hash_tag": [],
            "source": xhs_note_source(),
            "business_binds": xhs_business_binds(publish_time),
            "post_loc": {},
            "privacy_info": {
                "op_type": 1,
                "type": xhs_privacy_type(visibility),
                "user_ids": [],
            },
            "goods_info": {},
            "biz_relations": [],
            "capa_trace_info": {
                "contextJson": xhs_capa_context_json(),
            },
        },
        "image_info": {
            "images": uploaded.iter().map(|item| {
                serde_json::json!({
                    "file_id": item.file_id,
                    "width": item.width,
                    "height": item.height,
                    "metadata": { "source": -1 },
                    "stickers": { "version": 2, "floating": [] },
                    "extra_info_json": serde_json::json!({
                        "mimeType": item.mime_type,
                        "image_metadata": {
                            "bg_color": "",
                            "origin_size": item.size as f64 / 1024.0,
                        },
                    }).to_string(),
                })
            }).collect::<Vec<_>>(),
        },
        "video_info": null,
    })
}

fn xhs_video_note_payload(
    title: &str,
    desc: &str,
    visibility: &str,
    publish_time: Option<i64>,
    media: &PublishWorkMediaRequest,
    video: &XhsUploadedFile,
    cover: &XhsUploadedFile,
) -> Value {
    let width = media.width.unwrap_or_default();
    let height = media.height.unwrap_or_default();
    let duration = media.duration.unwrap_or_default();
    let duration_millis = (duration * 1000.0).round().max(0.0) as u64;
    let video_metadata = serde_json::json!({
        "bitrate": null,
        "colour_primaries": "BT.709",
        "duration": duration_millis,
        "format": "AVC",
        "frame_rate": 0,
        "height": height,
        "matrix_coefficients": "BT.709",
        "rotation": 0,
        "transfer_characteristics": "BT.709",
        "width": width,
    });
    let audio_metadata = serde_json::json!({
        "bitrate": null,
        "channels": 2,
        "duration": duration_millis,
        "format": "AAC",
        "sampling_rate": 48000,
    });
    serde_json::json!({
        "common": {
            "type": "video",
            "note_id": "",
            "title": title,
            "desc": desc,
            "ats": [],
            "hash_tag": [],
            "source": xhs_note_source(),
            "business_binds": xhs_business_binds(publish_time),
            "post_loc": {},
            "privacy_info": {
                "op_type": 1,
                "type": xhs_privacy_type(visibility),
                "user_ids": [],
            },
            "goods_info": {},
            "biz_relations": [],
            "capa_trace_info": {
                "contextJson": xhs_capa_context_json(),
            },
        },
        "image_info": null,
        "video_info": {
            "fileid": video.file_id,
            "file_id": video.file_id,
            "format_width": width,
            "format_height": height,
            "video_preview_type": "",
            "composite_metadata": {
                "video": video_metadata.clone(),
                "audio": audio_metadata.clone(),
            },
            "timelines": [],
            "cover": {
                "fileid": cover.file_id,
                "file_id": cover.file_id,
                "height": cover.height,
                "width": cover.width,
                "frame": {
                    "ts": 0,
                    "is_user_select": false,
                    "is_upload": false,
                },
                "stickers": {
                    "version": 2,
                    "neptune": [],
                },
                "fonts": [],
                "extra_info_json": "{}",
            },
            "chapters": [],
            "chapter_sync_text": false,
            "segments": {
                "count": 1,
                "need_slice": false,
                "items": [{
                    "mute": 0,
                    "speed": 1,
                    "start": 0,
                    "duration": duration,
                    "transcoded": 0,
                    "media_source": 1,
                    "original_metadata": {
                        "video": video_metadata,
                        "audio": audio_metadata,
                    },
                }],
            },
            "entrance": "web",
        },
    })
}

fn xhs_note_source() -> &'static str {
    r#"{"type":"web","ids":"","extraInfo":"{\"subType\":\"official\",\"systemId\":\"web\"}"}"#
}

fn xhs_capa_context_json() -> &'static str {
    r#"{"recommend_title":{"recommend_title_id":"","is_use":3,"used_index":-1},"recommendTitle":[],"recommend_topics":{"used":[]}}"#
}

fn xhs_business_binds(publish_time: Option<i64>) -> String {
    let note_post_timing = publish_time
        .map(|post_time| serde_json::json!({ "postTime": post_time.to_string() }))
        .unwrap_or_else(|| serde_json::json!({}));
    serde_json::json!({
        "version": 1,
        "noteId": 0,
        "bizType": if publish_time.is_some() { 13 } else { 0 },
        "noteOrderBind": {},
        "notePostTiming": note_post_timing,
        "noteCollectionBind": { "id": "" },
        "noteSketchCollectionBind": { "id": "" },
        "coProduceBind": { "enable": true },
        "noteCopyBind": { "copyable": true },
        "interactionPermissionBind": { "commentPermission": 0 },
        "optionRelationList": [],
    })
    .to_string()
}

fn xhs_publish_time(target: &PublishWorkTargetRequest) -> Result<Option<i64>, String> {
    if target.schedule_mode.trim() != "scheduled" {
        return Ok(None);
    }
    let value = target
        .scheduled_at
        .as_deref()
        .unwrap_or_default()
        .trim();
    if value.is_empty() {
        return Err("请选择小红书定时发布时间。".to_string());
    }
    let publish_at = time_from_value(&Value::String(value.to_string()))
        .ok_or_else(|| "小红书定时发布时间格式不正确。".to_string())?;
    let publish_seconds = publish_at.timestamp();
    let now = Utc::now().timestamp();
    let earliest = now + XHS_MIN_SCHEDULE_DELAY_SECONDS;
    let latest = now + XHS_MAX_SCHEDULE_DELAY_SECONDS;
    if publish_seconds < earliest {
        return Err(format!(
            "小红书定时发布时间至少需要选择当前 1 小时后，最早可选 {}。",
            format_xhs_publish_time(earliest)
        ));
    }
    if publish_seconds > latest {
        return Err(format!(
            "小红书定时发布时间不能超过 14 天，最晚可选 {}。",
            format_xhs_publish_time(latest)
        ));
    }
    Ok(Some(publish_at.timestamp_millis()))
}

fn format_xhs_publish_time(timestamp_seconds: i64) -> String {
    DateTime::from_timestamp(timestamp_seconds, 0)
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "合法时间范围内的时间".to_string())
}

fn xhs_privacy_type(visibility: &str) -> i64 {
    match visibility.trim() {
        "private" => 1,
        "friends" => 4,
        _ => 0,
    }
}

fn xhs_image_media(target: &PublishWorkTargetRequest) -> Result<&[PublishWorkMediaRequest], String> {
    if target.media.is_empty() {
        return Err("小红书图文发布需要至少选择一张图片。".to_string());
    }
    if target.media.len() > XHS_MAX_IMAGE_COUNT {
        return Err(format!("小红书图文最多支持 {XHS_MAX_IMAGE_COUNT} 张图片。"));
    }
    if target.media.iter().any(|media| media.media_type != "image") {
        return Err("小红书图文发布只支持图片素材。".to_string());
    }
    Ok(&target.media)
}

fn xhs_video_media(target: &PublishWorkTargetRequest) -> Result<&PublishWorkMediaRequest, String> {
    if target.media.is_empty() {
        return Err("小红书视频发布需要选择一个视频素材。".to_string());
    }
    if target.media.len() != 1 {
        return Err("小红书视频发布当前只支持 1 个视频素材。".to_string());
    }
    let media = &target.media[0];
    if media.media_type != "video" {
        return Err("小红书视频发布只支持视频素材。".to_string());
    }
    if media.width.unwrap_or_default() == 0 || media.height.unwrap_or_default() == 0 {
        return Err("无法读取小红书视频尺寸，请重新选择视频后再发布。".to_string());
    }
    if media.duration.filter(|value| *value > 0.0).is_none() {
        return Err("无法读取小红书视频时长，请重新选择视频后再发布。".to_string());
    }
    if media
        .cover_data_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err("小红书视频封面生成失败，请重新选择视频后再发布。".to_string());
    }
    Ok(media)
}

fn xhs_cover_media_from_data_url(media: &PublishWorkMediaRequest) -> Result<(PathBuf, PublishWorkMediaRequest), String> {
    let data_url = media
        .cover_data_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "小红书视频封面生成失败，请重新选择视频后再发布。".to_string())?;
    let (metadata, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "小红书视频封面数据无效。".to_string())?;
    let mime_type = metadata
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let extension = match mime_type.as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("小红书视频封面解码失败: {error}"))?;
    if bytes.is_empty() {
        return Err("小红书视频封面为空。".to_string());
    }
    let path = std::env::temp_dir().join(format!(
        "channel-nest-xhs-cover-{}-{}.{}",
        std::process::id(),
        Uuid::new_v4(),
        extension
    ));
    std::fs::write(&path, bytes).map_err(|error| format!("写入小红书视频封面失败: {error}"))?;
    Ok((
        path.clone(),
        PublishWorkMediaRequest {
            name: format!("xhs-video-cover.{extension}"),
            path: path.to_string_lossy().to_string(),
            media_type: "image".to_string(),
            cover_data_url: None,
            width: media.width,
            height: media.height,
            duration: None,
        },
    ))
}

fn xhs_media_meta(media: &PublishWorkMediaRequest) -> Result<XhsPublishMediaMeta, String> {
    let local = local_publish_media(media, "小红书")?;
    if media.media_type == "image" && local.size > XHS_MAX_IMAGE_BYTES {
        return Err(format!("小红书图片单张最大支持 20M：{}", media.name));
    }
    let width = media
        .width
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("无法读取小红书素材宽度，请重新选择素材：{}", media.name))?;
    let height = media
        .height
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("无法读取小红书素材高度，请重新选择素材：{}", media.name))?;
    Ok(XhsPublishMediaMeta {
        mime_type: xhs_media_mime(local.path, &media.media_type),
        size: local.size,
        width,
        height,
    })
}

fn xhs_media_mime(path: &Path, media_type: &str) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ if media_type == "video" => "video/mp4",
        _ => "image/jpeg",
    }
    .to_string()
}

fn ensure_xhs_publish_success(value: &Value, fallback: &str) -> Result<(), String> {
    if response_success(value) {
        Ok(())
    } else {
        Err(xhs_publish_error_message(value, fallback))
    }
}

fn xhs_publish_error_message(value: &Value, fallback: &str) -> String {
    first_string_deep(value, &["msg", "message", "errorMessage", "error_message", "errMsg", "err_msg"])
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn xhs_publish_remote_id(value: &Value) -> Option<String> {
    xhs_response_payload(value).and_then(|data| {
        xhs_value_text(data, &["note_id", "noteId", "id", "noteIdStr", "note_id_str"])
    })
}

fn xhs_value_text(value: &Value, keys: &[&str]) -> Option<String> {
    first_string(value, keys).or_else(|| {
        keys.iter().find_map(|key| {
            value.get(*key).and_then(|value| {
                value
                    .as_i64()
                    .map(|value| value.to_string())
                    .or_else(|| value.as_u64().map(|value| value.to_string()))
            })
        })
    })
}

#[derive(Debug)]
struct XhsUploadPermit {
    upload_addr: String,
    secret_id: String,
    secret_key: String,
    token: String,
    file_id: String,
    start_time: Option<i64>,
    expire_time: Option<i64>,
}

impl XhsUploadPermit {
    fn from_value(value: &Value) -> Result<Self, String> {
        let file_id = xhs_permit_file_id(value)
            .ok_or_else(|| "小红书上传许可缺少 fileId".to_string())?;
        Ok(Self {
            upload_addr: xhs_value_text(value, &["uploadAddr", "upload_addr"])
                .ok_or_else(|| format!("小红书上传许可缺少 uploadAddr: {}", xhs_value_key_summary(value)))?,
            secret_id: xhs_value_text(value, &["secretId", "secret_id"])
                .unwrap_or_else(|| "null".to_string()),
            secret_key: xhs_value_text(value, &["secretKey", "secret_key"])
                .unwrap_or_else(|| "null".to_string()),
            token: xhs_value_text(value, &["token", "sessionToken", "session_token"])
                .ok_or_else(|| format!("小红书上传许可缺少 token: {}", xhs_value_key_summary(value)))?,
            file_id: xhs_spectrum_file_id(&file_id),
            start_time: xhs_permit_seconds(value, &["startTime", "start_time"]),
            expire_time: xhs_permit_seconds(value, &["expireTime", "expire_time"]),
        })
    }
}

fn xhs_spectrum_file_id(value: &str) -> String {
    let value = value.trim().trim_start_matches('/');
    if value.starts_with("spectrum/") {
        value.to_string()
    } else {
        format!("spectrum/{value}")
    }
}

#[derive(Debug)]
struct XhsPublishMediaMeta {
    mime_type: String,
    size: u64,
    width: u32,
    height: u32,
}

#[derive(Debug)]
struct XhsUploadedFile {
    file_id: String,
    mime_type: String,
    size: u64,
    width: u32,
    height: u32,
    video_id: Option<String>,
}

#[derive(Debug, Default)]
struct XhsCosUploadResult {
    video_id: Option<String>,
}

fn xhs_permit_file_id(value: &Value) -> Option<String> {
    value
        .get("fileIds")
        .or_else(|| value.get("file_ids"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| xhs_value_text(value, &["fileId", "file_id"]))
}

fn xhs_permit_seconds(value: &Value, keys: &[&str]) -> Option<i64> {
    first_i64(value, keys).map(|value| if value > 10_000_000_000 { value / 1000 } else { value })
}

fn xhs_value_key_summary(value: &Value) -> String {
    match value {
        Value::Object(map) => map
            .iter()
            .map(|(key, value)| match value {
                Value::Object(inner) => {
                    let inner_keys = inner.keys().take(12).cloned().collect::<Vec<_>>().join(",");
                    format!("{key}{{{inner_keys}}}")
                }
                Value::Array(items) => format!("{key}[{}]", items.len()),
                _ => key.clone(),
            })
            .take(24)
            .collect::<Vec<_>>()
            .join(","),
        _ => "not-object".to_string(),
    }
}

async fn build_xhs_latest_works(
    latest_note_info: Option<&Value>,
    latest_note: Option<&Value>,
    note_base: Option<&Value>,
    note_detail: Option<&Value>,
    account_id: &str,
) -> (
    Option<ChannelContentWork>,
    Option<ChannelContentWork>,
    Option<ChannelContentWork>,
) {
    let started = Instant::now();
    let mut latest_work =
        latest_note_info.and_then(|value| parse_xhs_work(value, account_id, "latest"));
    if let Some(work) = latest_work.as_mut() {
        materialize_xhs_work_cover(work).await;
        apply_note_base_to_work(work, latest_note);
        apply_note_base_to_work(work, note_base);
    }

    let mut latest_work_seven = latest_work.clone();
    if let Some(work) = latest_work_seven.as_mut() {
        apply_note_base_to_work(work, note_detail.and_then(|value| value.get("seven")));
    }

    let mut latest_work_thirty = latest_work.clone();
    if let Some(work) = latest_work_thirty.as_mut() {
        apply_note_base_to_work(work, note_detail.and_then(|value| value.get("thirty")));
    }

    trace_xhs_stage("latest_work", "build", started);
    (latest_work, latest_work_seven, latest_work_thirty)
}

fn build_xhs_period_overview(
    account_id: &str,
    period_days: u16,
    account_base: Option<&Value>,
    note_detail: Option<&Value>,
    fans_overall: Option<&Value>,
    now: DateTime<Utc>,
) -> ChannelAccountOverview {
    let period_key = if period_days == 30 { "thirty" } else { "seven" };
    account_base
        .and_then(|value| value.get(period_key))
        .map(|value| build_xhs_datacenter_overview(account_id, period_days, value, now))
        .unwrap_or_else(|| {
            build_xhs_overview(
                account_id,
                period_days,
                note_detail.and_then(|value| value.get(period_key)),
                fans_overall.and_then(|value| value.get(period_key)),
                now,
            )
        })
}

fn build_xhs_overview(
    account_id: &str,
    period_days: u16,
    note: Option<&Value>,
    fans: Option<&Value>,
    now: DateTime<Utc>,
) -> ChannelAccountOverview {
    ChannelAccountOverview {
        account_id: account_id.to_string(),
        platform_id: "xiaohongshu".to_string(),
        period_days,
        metrics: xhs_fallback_overview_metrics(note, fans),
        summary: note
            .and_then(|value| value.get("summary"))
            .and_then(Value::as_str)
            .map(strip_html)
            .filter(|value| !value.trim().is_empty()),
        updated_at: Some(now),
        sync_status: "synced".to_string(),
        error: None,
    }
}

#[derive(Clone, Copy)]
enum XhsFallbackMetricSource {
    Empty,
    NoteCount,
    NetFans,
    RiseFans,
    LeaveFans,
}

#[derive(Clone, Copy)]
struct XhsFallbackMetricSpec {
    key: &'static str,
    label: &'static str,
    source: XhsFallbackMetricSource,
    value_key: Option<&'static str>,
    trend_key: Option<&'static str>,
}

impl XhsFallbackMetricSpec {
    const fn empty(key: &'static str, label: &'static str) -> Self {
        Self {
            key,
            label,
            source: XhsFallbackMetricSource::Empty,
            value_key: None,
            trend_key: None,
        }
    }

    const fn note_count(
        key: &'static str,
        label: &'static str,
        value_key: &'static str,
        trend_key: &'static str,
    ) -> Self {
        Self {
            key,
            label,
            source: XhsFallbackMetricSource::NoteCount,
            value_key: Some(value_key),
            trend_key: Some(trend_key),
        }
    }

    const fn net_fans(key: &'static str, label: &'static str) -> Self {
        Self {
            key,
            label,
            source: XhsFallbackMetricSource::NetFans,
            value_key: None,
            trend_key: None,
        }
    }

    const fn rise_fans(key: &'static str, label: &'static str) -> Self {
        Self {
            key,
            label,
            source: XhsFallbackMetricSource::RiseFans,
            value_key: None,
            trend_key: None,
        }
    }

    const fn leave_fans(key: &'static str, label: &'static str) -> Self {
        Self {
            key,
            label,
            source: XhsFallbackMetricSource::LeaveFans,
            value_key: None,
            trend_key: None,
        }
    }
}

const XHS_FALLBACK_OVERVIEW_METRICS: &[XhsFallbackMetricSpec] = &[
    XhsFallbackMetricSpec::empty("impressions", "曝光数"),
    XhsFallbackMetricSpec::note_count("views", "观看数", "view_count", "view_count_rate"),
    XhsFallbackMetricSpec::note_count("likes", "点赞数", "like_count", "like_count_rate"),
    XhsFallbackMetricSpec::note_count("comments", "评论数", "comment_count", "comment_count_rate"),
    XhsFallbackMetricSpec::net_fans("netFans", "净涨粉"),
    XhsFallbackMetricSpec::rise_fans("newFollows", "新增关注"),
    XhsFallbackMetricSpec::empty("coverClickRate", "封面点击率"),
    XhsFallbackMetricSpec::empty("completionRate", "视频完播率"),
    XhsFallbackMetricSpec::note_count("collects", "收藏数", "collect_count", "collect_count_rate"),
    XhsFallbackMetricSpec::note_count("shares", "分享数", "share_count", "share_count_rate"),
    XhsFallbackMetricSpec::leave_fans("unfollows", "取消关注"),
    XhsFallbackMetricSpec::note_count("homepageVisitors", "主页访客", "home_view_count", "home_view_count_rate"),
];

fn xhs_fallback_overview_metrics(
    note: Option<&Value>,
    fans: Option<&Value>,
) -> Vec<ChannelOverviewMetric> {
    let rise_fans = fans.and_then(|value| signed_count(value, "rise_fans_count"));
    let leave_fans = fans.and_then(|value| signed_count(value, "leave_fans_count"));
    let net_fans = match (rise_fans, leave_fans) {
        (Some(rise), Some(leave)) => Some(rise - leave),
        (Some(rise), None) => Some(rise),
        _ => None,
    };
    XHS_FALLBACK_OVERVIEW_METRICS
        .iter()
        .map(|spec| xhs_fallback_overview_metric(note, spec, rise_fans, leave_fans, net_fans))
        .collect()
}

fn xhs_fallback_overview_metric(
    note: Option<&Value>,
    spec: &XhsFallbackMetricSpec,
    rise_fans: Option<i64>,
    leave_fans: Option<i64>,
    net_fans: Option<i64>,
) -> ChannelOverviewMetric {
    let value = match spec.source {
        XhsFallbackMetricSource::Empty => None,
        XhsFallbackMetricSource::NoteCount => spec
            .value_key
            .and_then(|key| note.and_then(|value| unsigned_count(value, key)))
            .map(number_text),
        XhsFallbackMetricSource::NetFans => net_fans.map(signed_number_text),
        XhsFallbackMetricSource::RiseFans => rise_fans.map(signed_number_text),
        XhsFallbackMetricSource::LeaveFans => leave_fans.map(signed_number_text),
    };
    let trend = match spec.source {
        XhsFallbackMetricSource::NoteCount => spec
            .trend_key
            .and_then(|key| note.and_then(|value| trend_text(value, key))),
        _ => None,
    };
    overview_metric(spec.key, spec.label, value, trend)
}

fn build_xhs_datacenter_overview(
    account_id: &str,
    period_days: u16,
    data: &Value,
    now: DateTime<Utc>,
) -> ChannelAccountOverview {
    ChannelAccountOverview {
        account_id: account_id.to_string(),
        platform_id: "xiaohongshu".to_string(),
        period_days,
        metrics: xhs_datacenter_metrics(data),
        summary: data
            .get("summary")
            .and_then(Value::as_str)
            .map(strip_html)
            .filter(|value| !value.trim().is_empty()),
        updated_at: Some(now),
        sync_status: "synced".to_string(),
        error: None,
    }
}

#[derive(Clone, Copy)]
enum XhsMetricValueKind {
    Count,
    SignedCount,
    Percent,
}

#[derive(Clone, Copy)]
struct XhsDatacenterMetricSpec {
    key: &'static str,
    label: &'static str,
    value_key: &'static str,
    trend_key: &'static str,
    trend_display_key: &'static str,
    value_kind: XhsMetricValueKind,
}

impl XhsDatacenterMetricSpec {
    const fn count(
        key: &'static str,
        label: &'static str,
        value_key: &'static str,
        trend_key: &'static str,
        trend_display_key: &'static str,
    ) -> Self {
        Self {
            key,
            label,
            value_key,
            trend_key,
            trend_display_key,
            value_kind: XhsMetricValueKind::Count,
        }
    }

    const fn signed_count(
        key: &'static str,
        label: &'static str,
        value_key: &'static str,
        trend_key: &'static str,
        trend_display_key: &'static str,
    ) -> Self {
        Self {
            key,
            label,
            value_key,
            trend_key,
            trend_display_key,
            value_kind: XhsMetricValueKind::SignedCount,
        }
    }

    const fn percent(
        key: &'static str,
        label: &'static str,
        value_key: &'static str,
        trend_key: &'static str,
        trend_display_key: &'static str,
    ) -> Self {
        Self {
            key,
            label,
            value_key,
            trend_key,
            trend_display_key,
            value_kind: XhsMetricValueKind::Percent,
        }
    }
}

const XHS_DATACENTER_METRICS: &[XhsDatacenterMetricSpec] = &[
    XhsDatacenterMetricSpec::count("impressions", "曝光数", "impl_count", "impl_count_rate", "impl_count_rate_display"),
    XhsDatacenterMetricSpec::count("views", "观看数", "view_count", "view_count_rate", "view_count_rate_display"),
    XhsDatacenterMetricSpec::count("likes", "点赞数", "like_count", "like_count_rate", "like_count_rate_display"),
    XhsDatacenterMetricSpec::count("comments", "评论数", "comment_count", "comment_count_rate", "comment_count_rate_display"),
    XhsDatacenterMetricSpec::signed_count(
        "netFans",
        "净涨粉",
        "net_rise_fans_count",
        "net_rise_fans_count_rate",
        "net_rise_fans_count_rate_display",
    ),
    XhsDatacenterMetricSpec::count(
        "newFollows",
        "新增关注",
        "rise_fans_count",
        "rise_fans_count_rate",
        "rise_fans_count_rate_display",
    ),
    XhsDatacenterMetricSpec::percent(
        "coverClickRate",
        "封面点击率",
        "cover_click_rate",
        "cover_click_cycle_rate",
        "cover_click_cycle_rate_display",
    ),
    XhsDatacenterMetricSpec::percent(
        "completionRate",
        "视频完播率",
        "video_full_view_rate",
        "video_full_view_cycle_rate",
        "video_full_view_cycle_rate_display",
    ),
    XhsDatacenterMetricSpec::count("collects", "收藏数", "collect_count", "collect_count_rate", "collect_count_rate_display"),
    XhsDatacenterMetricSpec::count("shares", "分享数", "share_count", "share_count_rate", "share_count_rate_display"),
    XhsDatacenterMetricSpec::count(
        "unfollows",
        "取消关注",
        "loss_fans_count",
        "loss_fans_count_rate",
        "loss_fans_count_rate_display",
    ),
    XhsDatacenterMetricSpec::count(
        "homepageVisitors",
        "主页访客",
        "home_view_count",
        "home_view_count_rate",
        "home_view_count_rate_display",
    ),
];

fn xhs_datacenter_metrics(data: &Value) -> Vec<ChannelOverviewMetric> {
    XHS_DATACENTER_METRICS
        .iter()
        .map(|spec| xhs_datacenter_metric(data, spec))
        .collect()
}

fn xhs_datacenter_metric(data: &Value, spec: &XhsDatacenterMetricSpec) -> ChannelOverviewMetric {
    let value = match spec.value_kind {
        XhsMetricValueKind::Count => unsigned_count(data, spec.value_key).map(number_text),
        XhsMetricValueKind::SignedCount => signed_count(data, spec.value_key).map(signed_number_text),
        XhsMetricValueKind::Percent => decimal_value(data, spec.value_key).map(percent_text),
    };
    overview_metric(
        spec.key,
        spec.label,
        value,
        datacenter_trend_text(data, spec.trend_key, spec.trend_display_key),
    )
}

fn datacenter_trend_text(data: &Value, key: &str, display_key: &str) -> Option<String> {
    if data
        .get(display_key)
        .and_then(Value::as_bool)
        .map(|display| !display)
        .unwrap_or(false)
    {
        return Some("-".to_string());
    }
    decimal_value(data, key).map(trend_number_text)
}

fn overview_metric(
    key: &str,
    label: &str,
    value: Option<String>,
    trend: Option<String>,
) -> ChannelOverviewMetric {
    let tone = trend.as_deref().and_then(|trend| {
        if trend.starts_with('-') {
            Some("down".to_string())
        } else if trend.starts_with('+') {
            Some("up".to_string())
        } else {
            None
        }
    });
    ChannelOverviewMetric {
        key: key.to_string(),
        label: label.to_string(),
        value,
        compare_label: Some("环比".to_string()),
        trend,
        tone,
    }
}

async fn materialize_xhs_work_cover(work: &mut ChannelContentWork) {
    let Some(cover_url) = work.cover_url.clone() else {
        return;
    };
    if cover_url.trim().is_empty() || cover_url.starts_with("data:image") {
        return;
    }
    work.cover_url = Some(materialize_platform_image("xiaohongshu", cover_url).await);
}

fn parse_xhs_work(value: &Value, account_id: &str, source: &str) -> Option<ChannelContentWork> {
    let id = first_string_deep(value, NOTE_ID_KEYS)?;
    let title = first_string_deep(value, NOTE_TITLE_KEYS).unwrap_or_else(|| "未命名作品".to_string());
    let cover_url = first_profile_image(value, NOTE_COVER_KEYS)
        .map(normalize_image_url)
        .map(|value| normalize_platform_image_url("xiaohongshu", value));
    let link = first_string_deep(value, NOTE_LINK_KEYS);
    let published_at = first_time(value, NOTE_TIME_KEYS);
    Some(ChannelContentWork {
        id: format!("xiaohongshu-{source}-{id}"),
        platform_id: "xiaohongshu".to_string(),
        account_id: account_id.to_string(),
        title,
        cover_url,
        link,
        published_at,
        status: "published".to_string(),
        views: first_count(value, NOTE_VIEW_KEYS),
        impressions: first_count(value, NOTE_IMPRESSION_KEYS),
        likes: first_count(value, NOTE_LIKE_KEYS),
        collects: first_count(value, NOTE_COLLECT_KEYS),
        comments: first_count(value, NOTE_COMMENT_KEYS),
        shares: first_count(value, NOTE_SHARE_KEYS),
        cover_click_rate: None,
        avg_view_time: None,
        gained_followers: None,
        data_updated_at: None,
        metrics: Vec::new(),
        badges: xhs_work_badges(value),
        work_type: None,
    })
}

fn xhs_work_badges(value: &Value) -> Vec<String> {
    let mut badges = Vec::new();
    if any_truthy_deep(value, XHS_PINNED_BOOL_KEYS)
        || any_text_contains_deep(value, XHS_PINNED_TEXT_KEYS, "置顶")
    {
        push_unique_badge(&mut badges, "置顶");
    }
    if let Some(label) = xhs_visibility_badge(value) {
        push_unique_badge(&mut badges, label);
    }
    badges
}

const XHS_PINNED_BOOL_KEYS: &[&str] = &[
    "is_top",
    "isTop",
    "top",
    "is_pinned",
    "isPinned",
    "pinned",
    "is_sticky",
    "isSticky",
    "sticky",
    "is_stick",
    "isStick",
    "stick",
    "is_top_note",
    "isTopNote",
    "top_note",
    "topNote",
    "top_status",
    "topStatus",
    "sticky_status",
    "stickyStatus",
    "pinned_status",
    "pinnedStatus",
    "pin",
    "is_pin",
    "isPin",
    "is_pinned_note",
    "isPinnedNote",
    "pinned_note",
    "pinnedNote",
    "stick_status",
    "stickStatus",
    "is_note_top",
    "isNoteTop",
    "note_top",
    "noteTop",
    "show_top",
    "showTop",
    "top_flag",
    "topFlag",
    "is_top_flag",
    "isTopFlag",
];
const XHS_PINNED_TEXT_KEYS: &[&str] = &[
    "label_top_text",
    "labelTopText",
    "top_label",
    "topLabel",
    "top_text",
    "topText",
    "tag_text",
    "tagText",
    "tag_name",
    "tagName",
    "tag_title",
    "tagTitle",
    "label",
    "label_text",
    "labelText",
    "label_name",
    "labelName",
    "status_text",
    "statusText",
    "note_status_text",
    "noteStatusText",
    "type_name",
    "typeName",
];

fn xhs_visibility_badge(value: &Value) -> Option<String> {
    first_string_or_number_deep(
        value,
        &[
            "visibility",
            "visible_type",
            "visibleType",
            "visible_status",
            "visibleStatus",
            "privacy",
            "privacy_type",
            "privacyType",
            "private_status",
            "privateStatus",
            "permission",
            "permission_type",
            "permissionType",
        ],
    )
    .and_then(|value| xhs_visibility_label(&value))
}

fn xhs_visibility_label(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let lower = value.to_ascii_lowercase();
    if value.contains("公开") || lower.contains("public") {
        return Some("公开".to_string());
    }
    if value.contains("仅自己")
        || value.contains("私密")
        || value.contains("隐藏")
        || lower.contains("private")
        || lower.contains("only_me")
    {
        return Some("仅自己可见".to_string());
    }
    if value.contains("关注") || lower.contains("follow") {
        return Some("关注可见".to_string());
    }
    if value.contains("好友") || lower.contains("friend") {
        return Some("好友可见".to_string());
    }
    match value {
        "0" => Some("公开".to_string()),
        "1" => Some("仅自己可见".to_string()),
        "2" => Some("关注可见".to_string()),
        "3" => Some("好友可见".to_string()),
        _ if value.chars().count() <= 12 && value.contains("可见") => Some(value.to_string()),
        _ => None,
    }
}

fn any_truthy_deep(value: &Value, keys: &[&str]) -> bool {
    match value {
        Value::Object(map) => {
            for key in keys {
                if map.get(*key).and_then(value_to_bool).unwrap_or(false) {
                    return true;
                }
            }
            map.values().any(|value| any_truthy_deep(value, keys))
        }
        Value::Array(items) => items.iter().any(|value| any_truthy_deep(value, keys)),
        _ => false,
    }
}

fn any_text_contains_deep(value: &Value, keys: &[&str], needle: &str) -> bool {
    match value {
        Value::Object(map) => {
            for key in keys {
                if map
                    .get(*key)
                    .and_then(value_to_text)
                    .map(|value| value.contains(needle))
                    .unwrap_or(false)
                {
                    return true;
                }
            }
            map.values()
                .any(|value| any_text_contains_deep(value, keys, needle))
        }
        Value::Array(items) => items
            .iter()
            .any(|value| any_text_contains_deep(value, keys, needle)),
        _ => false,
    }
}

fn value_to_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::Number(number) => number
            .as_i64()
            .map(|value| value != 0)
            .or_else(|| number.as_u64().map(|value| value != 0))
            .or_else(|| number.as_f64().map(|value| value.abs() > f64::EPSILON)),
        Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "y" => Some(true),
            "false" | "0" | "no" | "n" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn first_string_or_number_deep(value: &Value, keys: &[&str]) -> Option<String> {
    if let Some(value) = first_string_deep(value, keys).filter(|value| !value.trim().is_empty()) {
        return Some(value);
    }
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(text) = map.get(*key).and_then(value_to_text) {
                    return Some(text);
                }
            }
            map.values()
                .find_map(|value| first_string_or_number_deep(value, keys))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|value| first_string_or_number_deep(value, keys)),
        _ => None,
    }
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn push_unique_badge(badges: &mut Vec<String>, label: impl Into<String>) {
    let label = label.into().trim().to_string();
    if !label.is_empty() && !badges.iter().any(|item| item == &label) {
        badges.push(label);
    }
}

fn apply_note_base_to_work(work: &mut ChannelContentWork, detail: Option<&Value>) {
    let Some(detail) = detail else {
        return;
    };
    let result = detail.get("result").filter(|value| value.is_object());
    let view_data = detail.get("viewData").filter(|value| value.is_object());
    let fans_data = detail.get("fansData").filter(|value| value.is_object());
    let note_info = detail.get("note_info").filter(|value| value.is_object());
    let values = [result, view_data, fans_data, note_info, Some(detail)];

    apply_xhs_work_count_metrics(work, &values);
    apply_optional(
        &mut work.cover_click_rate,
        first_decimal_direct(&values, NOTE_DETAIL_COVER_CLICK_RATE_KEYS).map(percent_text),
    );
    apply_optional(
        &mut work.avg_view_time,
        first_decimal_direct(&values, NOTE_DETAIL_AVG_VIEW_TIME_KEYS).map(duration_text),
    );
    apply_optional(
        &mut work.gained_followers,
        first_signed_direct(&values, NOTE_DETAIL_GAINED_FOLLOWER_KEYS),
    );
    apply_optional(
        &mut work.data_updated_at,
        first_time(detail, NOTE_DETAIL_UPDATED_AT_KEYS),
    );
    if work.data_updated_at.is_none() && xhs_work_has_detail_snapshot(work) {
        work.data_updated_at = Some(Utc::now());
    }
}

fn xhs_work_has_detail_snapshot(work: &ChannelContentWork) -> bool {
    work.views.is_some()
        || work.impressions.is_some()
        || work.likes.is_some()
        || work.collects.is_some()
        || work.comments.is_some()
        || work.shares.is_some()
        || work.cover_click_rate.is_some()
        || work.avg_view_time.is_some()
        || work.gained_followers.is_some()
}

#[derive(Clone, Copy)]
enum XhsWorkCountField {
    Impressions,
    Views,
    Likes,
    Comments,
    Collects,
    Shares,
}

#[derive(Clone, Copy)]
struct XhsWorkCountSpec {
    field: XhsWorkCountField,
    keys: &'static [&'static str],
}

const XHS_WORK_COUNT_SPECS: &[XhsWorkCountSpec] = &[
    XhsWorkCountSpec {
        field: XhsWorkCountField::Impressions,
        keys: NOTE_DETAIL_IMPRESSION_KEYS,
    },
    XhsWorkCountSpec {
        field: XhsWorkCountField::Views,
        keys: NOTE_DETAIL_VIEW_KEYS,
    },
    XhsWorkCountSpec {
        field: XhsWorkCountField::Likes,
        keys: NOTE_LIKE_KEYS,
    },
    XhsWorkCountSpec {
        field: XhsWorkCountField::Comments,
        keys: NOTE_COMMENT_KEYS,
    },
    XhsWorkCountSpec {
        field: XhsWorkCountField::Collects,
        keys: NOTE_COLLECT_KEYS,
    },
    XhsWorkCountSpec {
        field: XhsWorkCountField::Shares,
        keys: NOTE_SHARE_KEYS,
    },
];

fn apply_xhs_work_count_metrics(work: &mut ChannelContentWork, values: &[Option<&Value>]) {
    for spec in XHS_WORK_COUNT_SPECS {
        let value = first_unsigned_direct(values, spec.keys);
        match spec.field {
            XhsWorkCountField::Impressions => apply_optional(&mut work.impressions, value),
            XhsWorkCountField::Views => apply_optional(&mut work.views, value),
            XhsWorkCountField::Likes => apply_optional(&mut work.likes, value),
            XhsWorkCountField::Comments => apply_optional(&mut work.comments, value),
            XhsWorkCountField::Collects => apply_optional(&mut work.collects, value),
            XhsWorkCountField::Shares => apply_optional(&mut work.shares, value),
        }
    }
}

fn apply_optional<T>(target: &mut Option<T>, value: Option<T>) {
    if value.is_some() {
        *target = value;
    }
}

fn first_time(value: &Value, keys: &[&str]) -> Option<DateTime<Utc>> {
    keys.iter().find_map(|key| value.get(*key).and_then(time_from_value))
}

fn time_from_value(value: &Value) -> Option<DateTime<Utc>> {
    if let Some(number) = value.as_i64() {
        let seconds = if number > 9_999_999_999 { number / 1000 } else { number };
        return DateTime::from_timestamp(seconds, 0);
    }
    let text = value.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(number) = text.parse::<i64>() {
        return time_from_value(&Value::from(number));
    }
    if let Ok(value) = NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M"))
    {
        let timezone = FixedOffset::east_opt(8 * 3600)?;
        return timezone
            .from_local_datetime(&value)
            .single()
            .map(|value| value.with_timezone(&Utc));
    }
    DateTime::parse_from_rfc3339(text)
        .map(|value| value.with_timezone(&Utc))
        .ok()
}

fn page_key_from_value(value: &Value) -> Option<String> {
    if let Some(value) = value.as_str() {
        return Some(value.to_string());
    }
    if let Some(value) = value.as_i64() {
        return Some(value.to_string());
    }
    value.as_u64().map(|value| value.to_string())
}

fn first_unsigned_direct(values: &[Option<&Value>], keys: &[&str]) -> Option<u64> {
    values.iter().filter_map(|value| *value).find_map(|value| {
        keys.iter()
            .find_map(|key| value.get(*key).and_then(|value| parse_count_value(value, &[])))
    })
}

fn first_signed_direct(values: &[Option<&Value>], keys: &[&str]) -> Option<i64> {
    values.iter().filter_map(|value| *value).find_map(|value| {
        keys.iter().find_map(|key| {
            let value = value.get(*key)?;
            value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
                .or_else(|| value.as_str()?.trim().parse::<i64>().ok())
        })
    })
}

fn first_decimal_direct(values: &[Option<&Value>], keys: &[&str]) -> Option<f64> {
    values.iter().filter_map(|value| *value).find_map(|value| {
        keys.iter().find_map(|key| decimal_value(value, key))
    })
}

fn unsigned_count(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|value| parse_count_value(value, &[]))
}

fn signed_count(value: &Value, key: &str) -> Option<i64> {
    let value = value.get(key)?;
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_str()?.trim().parse::<i64>().ok())
}

fn decimal_value(value: &Value, key: &str) -> Option<f64> {
    let value = value.get(key)?;
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|value| value as f64))
        .or_else(|| value.as_u64().map(|value| value as f64))
        .or_else(|| value.as_str()?.trim().parse::<f64>().ok())
}

fn trend_text(value: &Value, key: &str) -> Option<String> {
    let value = signed_count(value, key)?;
    if value == 0 {
        return Some("-".to_string());
    }
    if value > 0 {
        Some(format!("+{value}%"))
    } else {
        Some(format!("{value}%"))
    }
}

fn trend_number_text(value: f64) -> String {
    if value.abs() < f64::EPSILON {
        return "-".to_string();
    }
    let text = compact_decimal(value.abs());
    if value > 0.0 {
        format!("+{text}%")
    } else {
        format!("-{text}%")
    }
}

fn percent_text(value: f64) -> String {
    format!("{}%", compact_decimal(value))
}

fn duration_text(value: f64) -> String {
    let seconds = if value > 600.0 { value / 1000.0 } else { value };
    format!("{}秒", compact_decimal(seconds))
}

fn compact_decimal(value: f64) -> String {
    if (value.fract()).abs() < 0.05 {
        format!("{value:.0}")
    } else {
        let text = format!("{value:.1}");
        text.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn number_text(value: u64) -> String {
    value.to_string()
}

fn signed_number_text(value: i64) -> String {
    value.to_string()
}

fn strip_html(value: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.trim().to_string()
}
