use super::*;
use chrono::{DateTime, FixedOffset, NaiveDateTime, TimeZone};
use std::{fs::File, io::Read, path::Path};

const COOKIE_DOMAINS: &[DomainRule] = &[DomainRule {
    host: "bilibili.com",
    include_subdomains: true,
}];

const COOKIE_URLS: &[&str] = &[
    "https://www.bilibili.com/",
    "https://bilibili.com/",
    "https://passport.bilibili.com/",
    "https://member.bilibili.com/",
    "https://space.bilibili.com/",
];

const CREATOR_HOME_URL: &str = "https://member.bilibili.com/platform/home";
const NAV_API: &str = "https://api.bilibili.com/x/web-interface/nav";
const RELATION_STAT_API_PREFIX: &str = "https://api.bilibili.com/x/relation/stat?vmid=";
const UPSTAT_API_PREFIX: &str = "https://api.bilibili.com/x/space/upstat?mid=";
const DATA_CENTER_OVERVIEW_API: &str = "https://member.bilibili.com/x/web/data/v2/overview/stat/num";
const VIDEO_WORKS_API: &str = "https://member.bilibili.com/x/web/archives";
const ARTICLE_WORKS_API: &str = "https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/creationlist";
const VIDEO_PREUPLOAD_API: &str = "https://member.bilibili.com/upload/multipart/new";
const VIDEO_UPLOAD_PART_API: &str = "https://member.bilibili.com/upload/multipart/part";
const VIDEO_UPLOAD_COMPLETE_API: &str = "https://member.bilibili.com/upload/multipart/complete";
const VIDEO_SUBMIT_API: &str = "https://member.bilibili.com/x/vu/web/add/v3";
const COVER_UPLOAD_API: &str = "https://member.bilibili.com/x/vu/web/cover/up";
const DRAW_IMAGE_UPLOAD_API: &str = "https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs";
const DRAW_SUBMIT_CHECK_API: &str = "https://api.bilibili.com/x/dynamic/feed/create/submit_check";
const DRAW_SUBMIT_API: &str = "https://api.bilibili.com/x/dynamic/feed/create/dyn";
const VIDEO_UPLOAD_PROFILE: &str = "ugcupos/iv";
const VIDEO_UPLOAD_REFERER: &str = "https://member.bilibili.com/york/videoup?new";
const DRAW_PUBLISH_REFERER: &str = "https://www.bilibili.com/";
const BILI_WORKS_PAGE_SIZE: i64 = 10;
const BILI_PERIOD_HISTORY: u16 = 36500;
const BILI_PERIOD_TOTAL: u16 = 65535;
const BILI_DATA_CENTER_HISTORY_PERIOD: i8 = 3;
const BILI_DEFAULT_TID: i64 = 21;
const BILI_MAX_DRAW_IMAGE_COUNT: usize = 9;
const BILI_MAX_DRAW_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const BILI_UPLOAD_DEFAULT_CHUNK_SIZE: u64 = 10 * 1024 * 1024;
const BILI_MIN_SCHEDULE_DELAY_SECONDS: i64 = 60 * 60;
const BILI_MAX_SCHEDULE_DELAY_SECONDS: i64 = 15 * 24 * 60 * 60;
const API_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://www.bilibili.com"),
    ("Referer", "https://www.bilibili.com/"),
];
const DATA_CENTER_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://member.bilibili.com"),
    (
        "Referer",
        "https://member.bilibili.com/platform/data-up/video/",
    ),
];
const VIDEO_WORKS_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://member.bilibili.com"),
    (
        "Referer",
        "https://member.bilibili.com/platform/upload-manager/article",
    ),
];
const ARTICLE_WORKS_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://member.bilibili.com"),
    ("Referer", "https://member.bilibili.com/opus/management/"),
];
const VIDEO_PUBLISH_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://member.bilibili.com"),
    ("Referer", VIDEO_UPLOAD_REFERER),
];
const DRAW_PUBLISH_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://www.bilibili.com"),
    ("Referer", DRAW_PUBLISH_REFERER),
];

const MID_KEYS: &[&str] = &["mid", "uid", "id"];
const NICKNAME_KEYS: &[&str] = &["uname", "nickname", "name"];
const AVATAR_KEYS: &[&str] = &["face", "avatar", "avatarUrl", "avatar_url"];
const FOLLOWER_COUNT_KEYS: &[&str] = &[
    "follower",
    "fans_count",
    "fansCount",
    "fans",
    "followers",
    "followers_count",
    "followersCount",
];
const FOLLOWING_COUNT_KEYS: &[&str] = &[
    "following",
    "following_count",
    "followingCount",
    "follow_count",
    "followCount",
    "followings",
    "attention_count",
    "attentionCount",
];
const LIKE_COUNT_KEYS: &[&str] = &[
    "likes",
    "like_count",
    "likeCount",
    "liked_count",
    "likedCount",
];
const WORK_COVER_KEYS: &[&str] = &[
    "cover",
    "pic",
    "cover_url",
    "coverUrl",
    "image",
    "images",
    "thumbnail",
    "thumbnail_url",
    "thumbnailUrl",
];

#[derive(Clone, Copy)]
struct BiliOverviewMetricSpec {
    key: &'static str,
    label: &'static str,
    cumulative_label: &'static str,
    data_key: &'static str,
}

const BILI_OVERVIEW_METRICS: &[BiliOverviewMetricSpec] = &[
    BiliOverviewMetricSpec {
        key: "views",
        label: "播放量",
        cumulative_label: "播放量",
        data_key: "play",
    },
    BiliOverviewMetricSpec {
        key: "followers",
        label: "净增粉丝",
        cumulative_label: "累计粉丝",
        data_key: "fan",
    },
    BiliOverviewMetricSpec {
        key: "likes",
        label: "点赞",
        cumulative_label: "点赞",
        data_key: "like",
    },
    BiliOverviewMetricSpec {
        key: "collects",
        label: "收藏",
        cumulative_label: "收藏",
        data_key: "fav",
    },
    BiliOverviewMetricSpec {
        key: "coins",
        label: "硬币",
        cumulative_label: "硬币",
        data_key: "coin",
    },
    BiliOverviewMetricSpec {
        key: "comments",
        label: "评论",
        cumulative_label: "评论",
        data_key: "comment",
    },
    BiliOverviewMetricSpec {
        key: "danmaku",
        label: "弹幕",
        cumulative_label: "弹幕",
        data_key: "dm",
    },
    BiliOverviewMetricSpec {
        key: "shares",
        label: "分享",
        cumulative_label: "分享",
        data_key: "share",
    },
];

const BILI_OVERVIEW_TAB_KEYS: &[&[&str]] = &[
    &["play", "fan"],
    &["like", "fav", "coin"],
    &["comment", "dm", "share"],
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum BiliWorkKind {
    Video,
    Article,
}

struct BiliMediaMeta {
    name: String,
    size: u64,
}

struct BiliUploadedVideo {
    filename: String,
    cid: i64,
}

struct BiliUploadedCover {
    cover: String,
    cover43: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BiliPublishSettings {
    visibility: i64,
    publish_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct BiliUploadedDrawImage {
    url: String,
    width: i64,
    height: i64,
    size: u64,
    ai_gen_pic: Option<i64>,
}

struct BiliPreuploadInfo {
    uri: String,
    upload_token: String,
    filename: String,
    cid: i64,
    chunk_size: u64,
}

impl BiliWorkKind {
    fn from_option(value: Option<&str>) -> Self {
        match value.unwrap_or_default().trim() {
            "article" | "image" | "photo" | "opus" => BiliWorkKind::Article,
            _ => BiliWorkKind::Video,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            BiliWorkKind::Video => "video",
            BiliWorkKind::Article => "article",
        }
    }
}

pub(super) static SPEC: ChannelPlatform = ChannelPlatform {
    id: "bilibili",
    name: "哔哩哔哩",
    slug: "BILI",
    color: "#00a1d6",
    description: "添加并管理多个 B 站账号。",
    creator_home_url: CREATOR_HOME_URL,
    cookie_urls: COOKIE_URLS,
    default_cookie_domain: ".bilibili.com",
    cookie_domains: COOKIE_DOMAINS,
    login_cookie_names: &[],
    homepage_kind: HomepageKind::BilibiliSpaceOrSearch,
    plugin_auth: true,
    materialize_avatar: true,
    avatar_referer: Some("https://www.bilibili.com/"),
    avatar_origin: Some("https://www.bilibili.com"),
};

fn first_bilibili_mid(data: &Value) -> Option<String> {
    first_i64(data, MID_KEYS)
        .filter(|value| *value > 0)
        .map(|value| value.to_string())
        .or_else(|| {
            first_string(data, MID_KEYS)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

pub(super) async fn fetch_bilibili_creator_session(
    cookie_header: &str,
    login_cookie: String,
) -> Result<PluginAccountInfo, String> {
    let value = request_plugin_json(
        "GET",
        NAV_API,
        cookie_header,
        API_HEADERS,
    )
    .await
    .map_err(|error| format!("B 站登录已失效，请重新登录后再打开创作中心。{error}"))?;
    let data = value.get("data");
    let is_login = data
        .and_then(|data| data.get("isLogin"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if first_i64(&value, &["code"]).unwrap_or(-1) != 0 || !is_login {
        return Err("B 站登录已失效，请重新登录后再打开创作中心。".to_string());
    }

    let uid = data
        .and_then(first_bilibili_mid)
        .unwrap_or_default();
    let nickname = data
        .and_then(|data| first_string(data, NICKNAME_KEYS))
        .unwrap_or_else(|| platform_name("bilibili").to_string());
    let avatar = data
        .and_then(|data| first_profile_image(data, AVATAR_KEYS))
        .unwrap_or_default();
    let avatar = materialize_account_avatar("bilibili", avatar).await;
    let account = if uid.trim().is_empty() {
        nickname.clone()
    } else {
        uid.clone()
    };
    let mut fans_count = data.and_then(|data| first_count(data, FOLLOWER_COUNT_KEYS));
    let mut following_count = data.and_then(|data| first_count(data, FOLLOWING_COUNT_KEYS));
    let mut like_count = data.and_then(|data| first_count(data, LIKE_COUNT_KEYS));
    if fans_count.is_none() || following_count.is_none() {
        if let Some((relation_fans_count, relation_following_count)) =
            fetch_bilibili_relation_counts(cookie_header, &uid).await
        {
            if fans_count.is_none() {
                fans_count = relation_fans_count;
            }
            if following_count.is_none() {
                following_count = relation_following_count;
            }
        }
    }
    if like_count.is_none() {
        like_count = fetch_bilibili_like_count(cookie_header, &uid).await;
    }
    Ok(PluginAccountInfo {
        uid: account.clone(),
        account,
        nickname,
        avatar,
        fans_count,
        following_count,
        like_count,
        login_cookie,
    })
}

async fn fetch_bilibili_relation_counts(cookie_header: &str, uid: &str) -> Option<(Option<u64>, Option<u64>)> {
    let uid = uid.trim();
    if uid.is_empty() || !uid.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let value = request_plugin_json(
        "GET",
        &format!("{RELATION_STAT_API_PREFIX}{uid}"),
        cookie_header,
        API_HEADERS,
    )
    .await
    .ok()?;
    if first_i64(&value, &["code"]).unwrap_or(-1) != 0 {
        return None;
    }
    let data = value.get("data").or(Some(&value));
    Some((
        data.and_then(|data| first_count(data, FOLLOWER_COUNT_KEYS)),
        data.and_then(|data| first_count(data, FOLLOWING_COUNT_KEYS)),
    ))
}

async fn fetch_bilibili_like_count(cookie_header: &str, uid: &str) -> Option<u64> {
    let uid = uid.trim();
    if uid.is_empty() || !uid.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let value = request_plugin_json(
        "GET",
        &format!("{UPSTAT_API_PREFIX}{uid}"),
        cookie_header,
        API_HEADERS,
    )
    .await
    .ok()?;
    if first_i64(&value, &["code"]).unwrap_or(-1) != 0 {
        return None;
    }
    value
        .get("data")
        .or(Some(&value))
        .and_then(|data| first_count(data, LIKE_COUNT_KEYS))
}

pub(super) async fn fetch_bilibili_account_content(
    cookie_header: &str,
    login_cookie: String,
    account_id: &str,
) -> Result<ChannelAccountContent, String> {
    let profile = fetch_bilibili_creator_session(cookie_header, login_cookie).await?;
    fetch_bilibili_account_content_with_profile_snapshot(
        cookie_header,
        account_id,
        &profile.uid,
        plugin_account_profile_snapshot(account_id, "bilibili", &profile),
    )
    .await
}

pub(crate) async fn fetch_bilibili_account_content_with_profile_snapshot(
    cookie_header: &str,
    account_id: &str,
    uid: &str,
    profile_snapshot: ChannelAccountProfileSnapshot,
) -> Result<ChannelAccountContent, String> {
    let now = Utc::now();
    let (
        overview_yesterday_result,
        overview_seven_result,
        overview_thirty_result,
        overview_ninety_result,
        overview_total_result,
        latest_video_work_result,
        latest_article_work_result,
    ) = tokio::join!(
        fetch_bilibili_data_center_overview(cookie_header, uid, -1),
        fetch_bilibili_data_center_overview(cookie_header, uid, 0),
        fetch_bilibili_data_center_overview(cookie_header, uid, 1),
        fetch_bilibili_data_center_overview(cookie_header, uid, 2),
        fetch_bilibili_data_center_overview(cookie_header, uid, BILI_DATA_CENTER_HISTORY_PERIOD),
        fetch_bilibili_latest_work(cookie_header, account_id, BiliWorkKind::Video),
        fetch_bilibili_latest_work(cookie_header, account_id, BiliWorkKind::Article),
    );
    let overview_yesterday_data = overview_yesterday_result?;
    let overview_seven_data = overview_seven_result?;
    let overview_thirty_data = overview_thirty_result?;
    let overview_ninety_data = overview_ninety_result?;
    let overview_total_data = overview_total_result?;
    let latest_video_work = latest_video_work_result.unwrap_or(None);
    let latest_article_work = latest_article_work_result.unwrap_or(None);

    Ok(ChannelAccountContent {
        account_id: account_id.to_string(),
        platform_id: "bilibili".to_string(),
        profile: Some(channel_profile_snapshot(
            account_id,
            "bilibili",
            count_key(&overview_total_data, "fan").or(profile_snapshot.followers),
            profile_snapshot.following,
            count_key(&overview_total_data, "like").or(profile_snapshot.likes),
        )),
        overview_yesterday: Some(build_bilibili_overview(
            account_id,
            1,
            &overview_yesterday_data,
            false,
            now,
        )),
        overview_seven: Some(build_bilibili_overview(
            account_id,
            7,
            &overview_seven_data,
            false,
            now,
        )),
        overview_thirty: Some(build_bilibili_overview(
            account_id,
            30,
            &overview_thirty_data,
            false,
            now,
        )),
        overview_ninety: Some(build_bilibili_overview(
            account_id,
            90,
            &overview_ninety_data,
            false,
            now,
        )),
        overview_history: Some(build_bilibili_overview(
            account_id,
            BILI_PERIOD_HISTORY,
            &overview_total_data,
            true,
            now,
        )),
        overview_total: Some(build_bilibili_overview(
            account_id,
            BILI_PERIOD_TOTAL,
            &overview_total_data,
            true,
            now,
        )),
        latest_work: latest_video_work,
        latest_work_seven: latest_article_work,
        latest_work_thirty: None,
        sync_status: "synced".to_string(),
        ..Default::default()
    })
}

pub(super) async fn fetch_bilibili_works_page(
    cookie_header: &str,
    account_id: &str,
    page_key: &str,
    work_type: Option<&str>,
) -> Result<ChannelWorksPage, String> {
    match BiliWorkKind::from_option(work_type) {
        BiliWorkKind::Article => {
            fetch_bilibili_article_works_page(cookie_header, account_id, page_key).await
        }
        BiliWorkKind::Video => {
            fetch_bilibili_video_works_page(cookie_header, account_id, page_key).await
        }
    }
}

async fn fetch_bilibili_latest_work(
    cookie_header: &str,
    account_id: &str,
    kind: BiliWorkKind,
) -> Result<Option<ChannelContentWork>, String> {
    let page = match kind {
        BiliWorkKind::Video => fetch_bilibili_video_works_page(cookie_header, account_id, "").await?,
        BiliWorkKind::Article => fetch_bilibili_article_works_page(cookie_header, account_id, "").await?,
    };
    Ok(page.works.into_iter().next())
}

async fn fetch_bilibili_data_center_overview(
    cookie_header: &str,
    uid: &str,
    period: i8,
) -> Result<Value, String> {
    let uid = uid.trim();
    if uid.is_empty() || !uid.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("B 站账号缺少创作中心 UID，无法读取核心数据。".to_string());
    }
    let mut merged = serde_json::Map::new();
    let (tab0, tab1, tab2) = tokio::try_join!(
        fetch_bilibili_data_center_overview_tab(cookie_header, uid, period, 0),
        fetch_bilibili_data_center_overview_tab(cookie_header, uid, period, 1),
        fetch_bilibili_data_center_overview_tab(cookie_header, uid, period, 2),
    )?;
    for (value, keys) in [
        (tab0, BILI_OVERVIEW_TAB_KEYS[0]),
        (tab1, BILI_OVERVIEW_TAB_KEYS[1]),
        (tab2, BILI_OVERVIEW_TAB_KEYS[2]),
    ] {
        merge_bilibili_overview_tab(&mut merged, &value, keys);
    }
    Ok(Value::Object(merged))
}

async fn fetch_bilibili_data_center_overview_tab(
    cookie_header: &str,
    uid: &str,
    period: i8,
    tab: usize,
) -> Result<Value, String> {
    let params = vec![
        ("period", period.to_string()),
        ("tab", tab.to_string()),
        ("tmid", uid.to_string()),
        ("t", Utc::now().timestamp_millis().to_string()),
    ];
    let url = Url::parse_with_params(DATA_CENTER_OVERVIEW_API, params)
        .map_err(|error| format!("B 站数据中心地址无效: {error}"))?;
    let value = request_plugin_json("GET", url.as_str(), cookie_header, DATA_CENTER_HEADERS)
        .await
        .map_err(|error| format!("B 站数据中心核心数据接口不可用: {error}"))?;
    if !bilibili_response_success(&value) {
        return Err(bilibili_error_message(&value, "B 站数据中心核心数据读取失败"));
    }
    Ok(value.get("data").unwrap_or(&value).clone())
}

fn merge_bilibili_overview_tab(
    merged: &mut serde_json::Map<String, Value>,
    data: &Value,
    keys: &[&str],
) {
    if let Some(log_date) = data.get("log_date") {
        merged.insert("log_date".to_string(), log_date.clone());
    }
    for key in keys {
        if let Some(value) = data.get(*key) {
            merged.insert((*key).to_string(), value.clone());
        }
        let last_key = format!("{key}_last");
        if let Some(value) = data.get(last_key.as_str()) {
            merged.insert(last_key, value.clone());
        }
    }
}

fn build_bilibili_overview(
    account_id: &str,
    period_days: u16,
    data: &Value,
    cumulative: bool,
    now: DateTime<Utc>,
) -> ChannelAccountOverview {
    let metrics = BILI_OVERVIEW_METRICS
        .iter()
        .map(|spec| build_bilibili_metric(spec, data, cumulative))
        .collect();
    ChannelAccountOverview {
        account_id: account_id.to_string(),
        platform_id: "bilibili".to_string(),
        period_days,
        metrics,
        summary: bilibili_overview_summary(data),
        updated_at: Some(now),
        sync_status: "synced".to_string(),
        error: None,
    }
}

fn build_bilibili_metric(
    spec: &BiliOverviewMetricSpec,
    data: &Value,
    cumulative: bool,
) -> ChannelOverviewMetric {
    let value = signed_key(data, spec.data_key);
    let last_value = signed_key(data, &format!("{}_last", spec.data_key));
    let delta = value.zip(last_value).map(|(value, last_value)| value - last_value);
    ChannelOverviewMetric {
        key: spec.key.to_string(),
        label: if cumulative {
            spec.cumulative_label
        } else {
            spec.label
        }
        .to_string(),
        value: value.map(|value| value.to_string()),
        compare_label: None,
        trend: delta.and_then(format_bilibili_delta),
        tone: delta.map(delta_tone),
    }
}

fn bilibili_overview_summary(stat: &Value) -> Option<String> {
    let log_date = count_key(stat, "log_date")?;
    let text = log_date.to_string();
    if text.len() != 8 {
        return None;
    }
    Some(format!("更新至 {}-{}-{}", &text[0..4], &text[4..6], &text[6..8]))
}

async fn fetch_bilibili_video_works_page(
    cookie_header: &str,
    account_id: &str,
    page_key: &str,
) -> Result<ChannelWorksPage, String> {
    let page = bilibili_page_number(page_key);
    let params = vec![
        ("status", "pubed".to_string()),
        ("pn", page.to_string()),
        ("ps", BILI_WORKS_PAGE_SIZE.to_string()),
    ];
    let url = Url::parse_with_params(VIDEO_WORKS_API, params)
        .map_err(|error| format!("B 站视频列表地址无效: {error}"))?;
    let value = request_plugin_json("GET", url.as_str(), cookie_header, VIDEO_WORKS_HEADERS)
        .await
        .map_err(|error| format!("B 站视频列表接口不可用: {error}"))?;
    if !bilibili_response_success(&value) {
        return Err(bilibili_error_message(&value, "B 站视频列表读取失败"));
    }
    let data = value.get("data").unwrap_or(&value);
    let mut works = data
        .get("arc_audits")
        .or_else(|| data.get("archives"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| parse_bilibili_video_work(item, account_id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    materialize_platform_work_covers("bilibili", &mut works).await;
    let total = data
        .get("page")
        .and_then(|page| count_key(page, "count"))
        .unwrap_or(works.len() as u64);
    let has_more = (page * BILI_WORKS_PAGE_SIZE) < total as i64;
    Ok(ChannelWorksPage {
        account_id: account_id.to_string(),
        platform_id: "bilibili".to_string(),
        page_key: page.to_string(),
        work_type: Some(BiliWorkKind::Video.as_str().to_string()),
        next_page_key: has_more.then(|| (page + 1).to_string()),
        has_more,
        works,
        updated_at: Some(Utc::now()),
        sync_status: "synced".to_string(),
        error: None,
    })
}

async fn fetch_bilibili_article_works_page(
    cookie_header: &str,
    account_id: &str,
    page_key: &str,
) -> Result<ChannelWorksPage, String> {
    let page = bilibili_page_number(page_key);
    let params = vec![
        ("ps", BILI_WORKS_PAGE_SIZE.to_string()),
        ("pn", page.to_string()),
        ("classification_type", "0".to_string()),
        ("creation_type", "0".to_string()),
    ];
    let url = Url::parse_with_params(ARTICLE_WORKS_API, params)
        .map_err(|error| format!("B 站图文列表地址无效: {error}"))?;
    let value = request_plugin_json("GET", url.as_str(), cookie_header, ARTICLE_WORKS_HEADERS)
        .await
        .map_err(|error| format!("B 站图文列表接口不可用: {error}"))?;
    if !bilibili_response_success(&value) {
        return Err(bilibili_error_message(&value, "B 站图文列表读取失败"));
    }
    let data = value.get("data").unwrap_or(&value);
    let mut works = data
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| parse_bilibili_article_work(item, account_id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    materialize_platform_work_covers("bilibili", &mut works).await;
    let has_more = data
        .get("has_more")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            count_key(data, "total")
                .map(|total| (page * BILI_WORKS_PAGE_SIZE) < total as i64)
                .unwrap_or(false)
        });
    Ok(ChannelWorksPage {
        account_id: account_id.to_string(),
        platform_id: "bilibili".to_string(),
        page_key: page.to_string(),
        work_type: Some(BiliWorkKind::Article.as_str().to_string()),
        next_page_key: has_more.then(|| (page + 1).to_string()),
        has_more,
        works,
        updated_at: Some(Utc::now()),
        sync_status: "synced".to_string(),
        error: None,
    })
}

fn parse_bilibili_video_work(item: &Value, account_id: &str) -> Option<ChannelContentWork> {
    let archive = item.get("Archive").or_else(|| item.get("archive")).unwrap_or(item);
    let aid = count_key(archive, "aid")
        .map(|value| value.to_string())
        .or_else(|| text_key(archive, "aid"))?;
    let bvid = text_key(archive, "bvid");
    let title = text_key(archive, "title").unwrap_or_else(|| "未命名视频".to_string());
    let stat = item.get("stat").or_else(|| item.get("Stat"));
    let cover_url = first_profile_image(item, WORK_COVER_KEYS).map(bilibili_cover_thumbnail_url);
    let views = stat.and_then(|stat| count_key(stat, "view").or_else(|| count_key(stat, "vv")));
    let likes = stat.and_then(|stat| count_key(stat, "like"));
    let comments = stat.and_then(|stat| count_key(stat, "reply"));
    let collects = stat.and_then(|stat| count_key(stat, "favorite").or_else(|| count_key(stat, "fav")));
    let shares = stat.and_then(|stat| count_key(stat, "share"));
    let metrics = video_work_metrics(item, stat);
    Some(ChannelContentWork {
        id: format!("bilibili-video-{}", bvid.clone().unwrap_or_else(|| aid.clone())),
        platform_id: "bilibili".to_string(),
        account_id: account_id.to_string(),
        title,
        cover_url,
        link: Some(match bvid {
            Some(bvid) if !bvid.is_empty() => format!("https://www.bilibili.com/video/{bvid}"),
            _ => format!("https://www.bilibili.com/video/av{aid}"),
        }),
        published_at: count_key(archive, "ptime")
            .or_else(|| count_key(archive, "ctime"))
            .and_then(|value| DateTime::from_timestamp(value as i64, 0)),
        status: bilibili_archive_status(archive).to_string(),
        views,
        impressions: None,
        likes,
        collects,
        comments,
        shares,
        cover_click_rate: None,
        avg_view_time: None,
        gained_followers: None,
        data_updated_at: None,
        metrics,
        badges: bilibili_video_badges(archive),
        work_type: Some(BiliWorkKind::Video.as_str().to_string()),
    })
}

fn parse_bilibili_article_work(item: &Value, account_id: &str) -> Option<ChannelContentWork> {
    let dyn_id = text_key(item, "dyn_id")
        .or_else(|| text_key(item, "rid"))
        .or_else(|| text_key(item, "id"))?;
    let title = text_key(item, "title")
        .or_else(|| text_key(item, "summary"))
        .unwrap_or_else(|| "未命名图文".to_string());
    let stat = item.get("stat");
    let cover_url = first_profile_image(item, WORK_COVER_KEYS).map(bilibili_cover_thumbnail_url);
    let status = bilibili_article_status(item);
    let metrics = article_work_metrics(stat);
    Some(ChannelContentWork {
        id: format!("bilibili-article-{dyn_id}"),
        platform_id: "bilibili".to_string(),
        account_id: account_id.to_string(),
        title,
        cover_url,
        link: Some(format!("https://www.bilibili.com/opus/{dyn_id}")),
        published_at: text_key(item, "pub_time").and_then(|value| parse_bilibili_datetime(&value)),
        status: status.to_string(),
        views: stat.and_then(|stat| count_key(stat, "view")),
        impressions: None,
        likes: stat.and_then(|stat| count_key(stat, "like")),
        collects: stat.and_then(|stat| count_key(stat, "favorite")),
        comments: stat.and_then(|stat| count_key(stat, "reply")),
        shares: None,
        cover_click_rate: None,
        avg_view_time: None,
        gained_followers: None,
        data_updated_at: None,
        metrics,
        badges: bilibili_article_badges(item),
        work_type: Some(BiliWorkKind::Article.as_str().to_string()),
    })
}

fn bilibili_cover_thumbnail_url(value: String) -> String {
    let value = normalize_platform_image_url("bilibili", value);
    if value.starts_with("data:image") || !is_bilibili_image_host(&value) || value.contains('@') {
        return value;
    }
    format!("{value}@156w_98h_1c.webp")
}

fn is_bilibili_image_host(value: &str) -> bool {
    Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
        .is_some_and(|host| host.ends_with(".hdslb.com"))
}

fn video_work_metrics(item: &Value, stat: Option<&Value>) -> Vec<ChannelWorkMetric> {
    if let Some(fields) = item.get("display_fields").and_then(Value::as_array) {
        let metrics = fields
            .iter()
            .filter_map(|field| {
                let label = text_key(field, "desc")?;
                Some(ChannelWorkMetric {
                    key: text_key(field, "name").unwrap_or_else(|| label.clone()),
                    label,
                    value: field.get("value").and_then(value_text),
                })
            })
            .collect::<Vec<_>>();
        if !metrics.is_empty() {
            return metrics;
        }
    }
    let specs = [
        ("view", "播放", "view"),
        ("like", "点赞", "like"),
        ("danmaku", "弹幕", "danmaku"),
        ("reply", "评论", "reply"),
        ("coin", "硬币", "coin"),
        ("favorite", "收藏", "favorite"),
        ("share", "分享", "share"),
    ];
    specs
        .iter()
        .map(|(key, label, stat_key)| ChannelWorkMetric {
            key: (*key).to_string(),
            label: (*label).to_string(),
            value: stat.and_then(|stat| count_key(stat, stat_key)).map(|value| value.to_string()),
        })
        .collect()
}

fn article_work_metrics(stat: Option<&Value>) -> Vec<ChannelWorkMetric> {
    let specs = [
        ("view", "浏览", "view"),
        ("like", "点赞", "like"),
        ("reply", "评论", "reply"),
        ("favorite", "收藏", "favorite"),
        ("coin", "硬币", "coin"),
    ];
    specs
        .iter()
        .map(|(key, label, stat_key)| ChannelWorkMetric {
            key: (*key).to_string(),
            label: (*label).to_string(),
            value: stat.and_then(|stat| count_key(stat, stat_key)).map(|value| value.to_string()),
        })
        .collect()
}

fn bilibili_archive_status(archive: &Value) -> &'static str {
    match signed_key(archive, "state").unwrap_or(0) {
        0 => "published",
        -1 | -4 | -30 | -40 => "reviewing",
        _ => "draft",
    }
}

fn bilibili_article_status(item: &Value) -> &'static str {
    match item
        .get("filter_group")
        .and_then(|value| signed_key(value, "filter_type"))
        .unwrap_or(2)
    {
        2 => "published",
        1 => "reviewing",
        _ => "draft",
    }
}

fn bilibili_video_badges(archive: &Value) -> Vec<String> {
    let mut badges = Vec::new();
    if archive.get("porder").is_some_and(|value| !value.is_null())
        || signed_key(archive, "is_top").unwrap_or(0) > 0
    {
        badges.push("置顶".to_string());
    }
    if signed_key(archive, "no_public").unwrap_or(0) > 0
        || archive
            .get("attrs")
            .and_then(|attrs| signed_key(attrs, "no_public"))
            .unwrap_or(0)
            > 0
        || signed_key(archive, "is_only_self").unwrap_or(0) > 0
    {
        badges.push("仅自己可见".to_string());
    } else if let Some(state_desc) = text_key(archive, "state_desc").filter(|value| !value.is_empty()) {
        badges.push(state_desc);
    }
    badges
}

fn bilibili_article_badges(item: &Value) -> Vec<String> {
    let mut badges = Vec::new();
    if let Some(reason) = item
        .get("filter_group")
        .and_then(|value| text_key(value, "reason"))
        .filter(|value| !value.is_empty() && value != "审核通过")
    {
        badges.push(reason);
    }
    if item
        .get("filter_group")
        .and_then(|value| text_key(value, "timing_waiting_pub"))
        .is_some_and(|value| value != "0")
    {
        badges.push("定时发布".to_string());
    }
    badges
}

pub(crate) async fn publish_bilibili_work(
    cookie_header: &str,
    content_type: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    match content_type.trim() {
        "video" => publish_bilibili_video_work(cookie_header, target).await,
        "article" => publish_bilibili_draw_work(cookie_header, target).await,
        _ => Err("B 站暂不支持当前作品类型。".to_string()),
    }
}

async fn publish_bilibili_video_work(
    cookie_header: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    let settings = bilibili_publish_settings(target, BiliWorkKind::Video)?;
    let csrf = bilibili_cookie_value(cookie_header, "bili_jct")
        .ok_or_else(|| "B 站 Cookie 缺少 bili_jct，请重新登录后再发布。".to_string())?;
    let media = bilibili_video_media(target)?;
    let meta = bilibili_media_meta(media)?;
    let cover = upload_bilibili_cover(cookie_header, &csrf, media).await?;
    let uploaded = upload_bilibili_video(cookie_header, media, &meta).await?;
    let payload = bilibili_video_submit_payload(target, &uploaded, &cover, &csrf, settings);
    let url = Url::parse_with_params(
        VIDEO_SUBMIT_API,
        [
            ("web_location", "333.1024".to_string()),
            ("t", Utc::now().timestamp_millis().to_string()),
            ("csrf", csrf),
        ],
    )
    .map_err(|error| format!("B 站发布地址无效: {error}"))?;
    let value = request_bilibili_publish_json("POST", url.as_str(), cookie_header, Some(payload)).await?;
    ensure_bilibili_publish_success(&value, "B 站视频发布失败")?;
    Ok(bilibili_publish_remote_id(&value).or_else(|| Some(uploaded.cid.to_string())))
}

async fn publish_bilibili_draw_work(
    cookie_header: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    let settings = bilibili_publish_settings(target, BiliWorkKind::Article)?;
    let csrf = bilibili_cookie_value(cookie_header, "bili_jct")
        .ok_or_else(|| "B 站 Cookie 缺少 bili_jct，请重新登录后再发布。".to_string())?;
    let medias = bilibili_draw_image_media(target)?;
    let caption = bilibili_draw_caption(target)?;
    let uploaded = upload_bilibili_draw_images(cookie_header, &csrf, medias).await?;
    let dyn_req = bilibili_draw_submit_payload(
        &caption,
        &uploaded,
        &bilibili_dynamic_upload_id(cookie_header),
        settings.visibility,
        settings.publish_at,
    );
    let check_url = Url::parse_with_params(DRAW_SUBMIT_CHECK_API, [("csrf", csrf.as_str())])
        .map_err(|error| format!("B 站图文校验地址无效: {error}"))?;
    let check = request_bilibili_dynamic_json(
        check_url.as_str(),
        cookie_header,
        bilibili_draw_submit_check_payload(&dyn_req),
    )
    .await?;
    ensure_bilibili_publish_success(&check, "B 站图文提交前校验失败")?;

    let submit_url = Url::parse_with_params(
        DRAW_SUBMIT_API,
        [("platform", "web"), ("csrf", csrf.as_str())],
    )
    .map_err(|error| format!("B 站图文发布地址无效: {error}"))?;
    let value = request_bilibili_dynamic_json(
        submit_url.as_str(),
        cookie_header,
        serde_json::json!({ "dyn_req": dyn_req }),
    )
    .await?;
    ensure_bilibili_publish_success(&value, "B 站图文提交失败")?;
    Ok(bilibili_dynamic_remote_id(&value))
}

async fn upload_bilibili_draw_images(
    cookie_header: &str,
    csrf: &str,
    medias: &[PublishWorkMediaRequest],
) -> Result<Vec<BiliUploadedDrawImage>, String> {
    let cookie_header = cookie_header.to_string();
    let csrf = csrf.to_string();
    upload_publish_media_in_order(
        medias,
        PublishUploadLabels {
            platform: "B 站",
            item: "张图文图片",
            collection: "图文图片",
        },
        move |media| {
            let cookie_header = cookie_header.clone();
            let csrf = csrf.clone();
            async move { upload_bilibili_draw_image(&cookie_header, &csrf, &media).await }
        },
    )
    .await
}

async fn upload_bilibili_video(
    cookie_header: &str,
    media: &PublishWorkMediaRequest,
    meta: &BiliMediaMeta,
) -> Result<BiliUploadedVideo, String> {
    let pre = request_bilibili_publish_json(
        "POST",
        VIDEO_PREUPLOAD_API,
        cookie_header,
        Some(serde_json::json!({
            "name": meta.name,
            "size": meta.size,
            "profile": VIDEO_UPLOAD_PROFILE,
            "init_params": {},
        })),
    )
    .await?;
    ensure_bilibili_publish_success(&pre, "B 站视频上传初始化失败")?;
    let info = parse_bilibili_preupload_info(bilibili_response_data(&pre))?;
    let parts = upload_bilibili_video_parts(cookie_header, media, &info, meta.size).await?;

    let complete = request_bilibili_publish_json(
        "POST",
        VIDEO_UPLOAD_COMPLETE_API,
        cookie_header,
        Some(serde_json::json!({
            "uri": info.uri,
            "upload_token": info.upload_token,
            "parts": parts,
            "upload_params": {
                "biz_id": info.cid,
                "profile": VIDEO_UPLOAD_PROFILE,
            },
        })),
    )
    .await?;
    ensure_bilibili_publish_success(&complete, "B 站视频合片失败")?;
    Ok(BiliUploadedVideo {
        filename: info.filename,
        cid: info.cid,
    })
}

async fn upload_bilibili_draw_image(
    cookie_header: &str,
    csrf: &str,
    media: &PublishWorkMediaRequest,
) -> Result<BiliUploadedDrawImage, String> {
    let meta = bilibili_draw_image_meta(media)?;
    let path = Path::new(media.path.trim());
    let bytes = std::fs::read(path).map_err(|error| format!("读取 B 站图文图片失败: {error}"))?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(meta.name)
        .mime_str(&bilibili_image_mime(path))
        .map_err(|error| format!("B 站图文图片类型无效: {error}"))?;
    let form = reqwest::multipart::Form::new()
        .part("file_up", part)
        .text("biz", "dyn".to_string())
        .text("category", "daily".to_string())
        .text("csrf", csrf.to_string());
    let response = platform_http_client()
        .post(DRAW_IMAGE_UPLOAD_API)
        .header("Cookie", cookie_header)
        .header("User-Agent", PLATFORM_DESKTOP_USER_AGENT)
        .header("Accept", PLATFORM_JSON_ACCEPT)
        .header("Accept-Language", PLATFORM_ACCEPT_LANGUAGE)
        .header("Origin", "https://www.bilibili.com")
        .header("Referer", DRAW_PUBLISH_REFERER)
        .multipart(form)
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|error| format!("B 站图文图片上传失败: {error}"))?;
    let value = parse_bilibili_json_response(response, "B 站图文图片上传").await?;
    ensure_bilibili_publish_success(&value, "B 站图文图片上传失败")?;
    parse_bilibili_draw_image_upload(bilibili_response_data(&value), meta.size)
}

async fn upload_bilibili_cover(
    cookie_header: &str,
    csrf: &str,
    media: &PublishWorkMediaRequest,
) -> Result<BiliUploadedCover, String> {
    let cover = bilibili_cover_data_url(media)?;
    let form = [("cover", cover), ("csrf", csrf.to_string())];
    let response = platform_http_client()
        .post(COVER_UPLOAD_API)
        .header("Cookie", cookie_header)
        .header("User-Agent", PLATFORM_DESKTOP_USER_AGENT)
        .header("Accept", PLATFORM_JSON_ACCEPT)
        .header("Accept-Language", PLATFORM_ACCEPT_LANGUAGE)
        .header("Origin", "https://member.bilibili.com")
        .header("Referer", VIDEO_UPLOAD_REFERER)
        .form(&form)
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|error| format!("B 站封面上传失败: {error}"))?;
    let value = parse_bilibili_json_response(response, "B 站封面上传").await?;
    ensure_bilibili_publish_success(&value, "B 站封面上传失败")?;
    parse_bilibili_cover_upload(bilibili_response_data(&value))
}

async fn upload_bilibili_video_parts(
    cookie_header: &str,
    media: &PublishWorkMediaRequest,
    info: &BiliPreuploadInfo,
    size: u64,
) -> Result<Vec<Value>, String> {
    let mut file = File::open(&media.path).map_err(|error| format!("打开 B 站视频素材失败: {error}"))?;
    let chunk_size = info.chunk_size.max(1);
    let chunk_count = (size + chunk_size - 1) / chunk_size;
    let mut parts = Vec::with_capacity(chunk_count as usize);
    let mut buffer = vec![0_u8; chunk_size.min(BILI_UPLOAD_DEFAULT_CHUNK_SIZE * 4) as usize];
    for index in 0..chunk_count {
        let remaining = size - index * chunk_size;
        let chunk_len = remaining.min(chunk_size) as usize;
        if buffer.len() < chunk_len {
            buffer.resize(chunk_len, 0);
        }
        file.read_exact(&mut buffer[..chunk_len])
            .map_err(|error| format!("读取 B 站视频分片失败: {error}"))?;
        let part_number = index + 1;
        let part = request_bilibili_publish_json(
            "POST",
            VIDEO_UPLOAD_PART_API,
            cookie_header,
            Some(serde_json::json!({
                "uri": info.uri,
                "upload_token": info.upload_token,
                "part_number": part_number,
            })),
        )
        .await?;
        ensure_bilibili_publish_success(&part, "B 站视频分片上传地址获取失败")?;
        let route = bilibili_upload_route(bilibili_response_data(&part))?;
        let etag = upload_bilibili_video_chunk(route, &buffer[..chunk_len]).await?;
        parts.push(serde_json::json!({
            "part_number": part_number,
            "etag": etag,
        }));
    }
    Ok(parts)
}

async fn upload_bilibili_video_chunk(route: &Value, bytes: &[u8]) -> Result<String, String> {
    let url = first_string(route, &["url"])
        .map(|value| bilibili_absolute_url(&value))
        .ok_or_else(|| "B 站视频分片上传地址为空".to_string())?;
    let method = first_string(route, &["method"])
        .unwrap_or_else(|| "PUT".to_string())
        .to_ascii_uppercase();
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("B 站视频分片上传方法无效: {error}"))?;
    let response = platform_http_client()
        .request(method, url)
        .header("User-Agent", PLATFORM_DESKTOP_USER_AGENT)
        .header("Accept", "*/*")
        .body(bytes.to_vec())
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|error| format!("B 站视频分片上传失败: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("B 站视频分片上传返回 HTTP {status}"));
    }
    response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "B 站视频分片上传缺少 etag".to_string())
}

async fn request_bilibili_publish_json(
    method: &str,
    url: &str,
    cookie_header: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    request_bilibili_json(method, url, cookie_header, body, VIDEO_PUBLISH_HEADERS).await
}

async fn request_bilibili_dynamic_json(
    url: &str,
    cookie_header: &str,
    body: Value,
) -> Result<Value, String> {
    request_bilibili_json(
        "POST",
        url,
        cookie_header,
        Some(body),
        DRAW_PUBLISH_HEADERS,
    )
    .await
}

async fn request_bilibili_json(
    method: &str,
    url: &str,
    cookie_header: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> Result<Value, String> {
    let mut request = if method.eq_ignore_ascii_case("POST") {
        platform_http_client().post(url)
    } else {
        platform_http_client().get(url)
    };
    request = request
        .header("Cookie", cookie_header)
        .header("User-Agent", PLATFORM_DESKTOP_USER_AGENT)
        .header("Accept", PLATFORM_JSON_ACCEPT)
        .header("Accept-Language", PLATFORM_ACCEPT_LANGUAGE)
        .timeout(std::time::Duration::from_secs(60));
    for (key, value) in headers {
        request = request.header(*key, *value);
    }
    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json;charset=UTF-8")
            .json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("B 站发布接口请求失败: {error}"))?;
    parse_bilibili_json_response(response, "B 站发布").await
}

async fn parse_bilibili_json_response(
    response: reqwest::Response,
    context: &str,
) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{context}返回 HTTP {status}"));
    }
    response
        .json()
        .await
        .map_err(|error| format!("{context}接口不是 JSON: {error}"))
}

fn parse_bilibili_preupload_info(value: &Value) -> Result<BiliPreuploadInfo, String> {
    let uri = first_string(value, &["uri"])
        .ok_or_else(|| "B 站视频上传初始化失败: 缺少 uri".to_string())?;
    let upload_token = first_string(value, &["upload_token", "uploadToken"])
        .ok_or_else(|| "B 站视频上传初始化失败: 缺少 upload_token".to_string())?;
    let filename = first_string(value, &["filename", "file_name", "fileName"])
        .ok_or_else(|| "B 站视频上传初始化失败: 缺少 filename".to_string())?;
    let cid = first_i64(value, &["biz_id", "cid"])
        .ok_or_else(|| "B 站视频上传初始化失败: 缺少 cid".to_string())?;
    let chunk_size = first_i64(value, &["chunk_size", "chunkSize"])
        .filter(|value| *value > 0)
        .map(|value| value as u64)
        .unwrap_or(BILI_UPLOAD_DEFAULT_CHUNK_SIZE);
    Ok(BiliPreuploadInfo {
        uri,
        upload_token,
        filename,
        cid,
        chunk_size,
    })
}

fn bilibili_upload_route(value: &Value) -> Result<&Value, String> {
    value
        .get("reqs")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| "B 站视频分片上传地址为空".to_string())
}

fn bilibili_video_submit_payload(
    target: &PublishWorkTargetRequest,
    uploaded: &BiliUploadedVideo,
    cover: &BiliUploadedCover,
    csrf: &str,
    settings: BiliPublishSettings,
) -> Value {
    let title = bilibili_title(target);
    let desc = target.body.trim();
    let mut payload = serde_json::json!({
        "title": title,
        "copyright": 1,
        "tid": BILI_DEFAULT_TID,
        "tag": bilibili_tags(target),
        "desc": desc,
        "desc_format_id": 0,
        "dynamic": desc,
        "recreate": 0,
        "interactive": 0,
        "is_only_self": settings.visibility,
        "cover": cover.cover,
        "cover43": cover.cover43,
        "videos": [{
            "filename": uploaded.filename,
            "title": title,
            "desc": "",
            "cid": uploaded.cid,
        }],
        "web_os": bilibili_web_os(),
        "csrf": csrf,
    });
    if let Some(dtime) = settings.publish_at {
        payload["dtime"] = serde_json::json!(dtime);
    }
    payload
}

fn bilibili_visibility_value(target: &PublishWorkTargetRequest) -> Result<i64, String> {
    match target.visibility.trim() {
        "public" => Ok(0),
        "private" => Ok(1),
        _ => Err("B 站可见范围仅支持公开或仅自己可见。".to_string()),
    }
}

fn bilibili_publish_settings(
    target: &PublishWorkTargetRequest,
    kind: BiliWorkKind,
) -> Result<BiliPublishSettings, String> {
    let settings = BiliPublishSettings {
        visibility: bilibili_visibility_value(target)?,
        publish_at: bilibili_publish_time(target)?,
    };
    if kind == BiliWorkKind::Article && settings.visibility == 1 && settings.publish_at.is_some() {
        return Err("B 站图文定时发布仅支持公开可见，请改为公开或使用立即发布。".to_string());
    }
    Ok(settings)
}

fn bilibili_publish_time(target: &PublishWorkTargetRequest) -> Result<Option<i64>, String> {
    if target.schedule_mode.trim() != "scheduled" {
        return Ok(None);
    }
    let value = target
        .scheduled_at
        .as_deref()
        .unwrap_or_default()
        .trim();
    if value.is_empty() {
        return Err("请选择 B 站定时发布时间。".to_string());
    }
    let timestamp = parse_bilibili_datetime(value)
        .ok_or_else(|| "B 站定时发布时间格式不正确。".to_string())?
        .timestamp();
    let now = Utc::now().timestamp();
    let earliest = now + BILI_MIN_SCHEDULE_DELAY_SECONDS;
    let latest = now + BILI_MAX_SCHEDULE_DELAY_SECONDS;
    if timestamp < earliest {
        return Err(format!(
            "B 站定时发布时间至少需要晚于当前 1 小时，最早可选 {}。",
            format_bilibili_publish_time(earliest)
        ));
    }
    if timestamp > latest {
        return Err(format!(
            "B 站定时发布时间不能超过 15 天，最晚可选 {}。",
            format_bilibili_publish_time(latest)
        ));
    }
    Ok(Some(timestamp))
}

fn bilibili_video_media(target: &PublishWorkTargetRequest) -> Result<&PublishWorkMediaRequest, String> {
    if target.media.is_empty() {
        return Err("请选择一个 B 站视频素材。".to_string());
    }
    if target.media.len() != 1 {
        return Err("B 站视频模式只能选择 1 个视频素材，多 P 稿件后续再接。".to_string());
    }
    let media = &target.media[0];
    if media.media_type.trim() != "video" {
        return Err("B 站视频模式请上传视频素材。".to_string());
    }
    Ok(media)
}

fn bilibili_cover_data_url(media: &PublishWorkMediaRequest) -> Result<String, String> {
    let Some(data_url) = media.cover_data_url.as_deref().map(str::trim).filter(|value| !value.is_empty()) else {
        return Err("B 站视频封面生成失败，请重新选择视频后再发布。".to_string());
    };
    let (metadata, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "B 站视频封面数据无效。".to_string())?;
    metadata
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/"))
        .ok_or_else(|| "B 站视频封面类型无效。".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("B 站视频封面解码失败: {error}"))?;
    if bytes.is_empty() {
        return Err("B 站视频封面为空。".to_string());
    }
    Ok(data_url.to_string())
}

fn parse_bilibili_cover_upload(value: &Value) -> Result<BiliUploadedCover, String> {
    let cover = value
        .as_str()
        .map(ToString::to_string)
        .or_else(|| first_string_deep(value, &["url", "cover", "cover_url", "coverUrl", "image", "location"]))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "B 站封面上传结果缺少 url".to_string())?;
    let cover43 = first_string_deep(value, &["cover43", "cover_43", "cover43Url", "pic43"])
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| cover.clone());
    Ok(BiliUploadedCover { cover, cover43 })
}

fn parse_bilibili_draw_image_upload(value: &Value, fallback_size: u64) -> Result<BiliUploadedDrawImage, String> {
    let url = first_string_deep(value, &["image_url", "imageUrl", "url", "location", "src", "img_src", "imgSrc"])
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "B 站图文图片上传结果缺少 image_url".to_string())?;
    let width = first_i64(value, &["image_width", "imageWidth", "img_width", "imgWidth", "width"])
        .filter(|value| *value > 0)
        .unwrap_or(0);
    let height = first_i64(value, &["image_height", "imageHeight", "img_height", "imgHeight", "height"])
        .filter(|value| *value > 0)
        .unwrap_or(0);
    Ok(BiliUploadedDrawImage {
        url: bilibili_absolute_url(&url),
        width,
        height,
        size: fallback_size,
        ai_gen_pic: first_i64(value, &["ai_gen_pic", "aiGenPic"]),
    })
}

fn bilibili_media_meta(media: &PublishWorkMediaRequest) -> Result<BiliMediaMeta, String> {
    bilibili_file_meta(media, "B 站素材", "video.mp4", None)
}

fn bilibili_draw_image_meta(media: &PublishWorkMediaRequest) -> Result<BiliMediaMeta, String> {
    bilibili_file_meta(
        media,
        "B 站图文图片",
        "image.jpg",
        Some(BILI_MAX_DRAW_IMAGE_BYTES),
    )
}

fn bilibili_file_meta(
    media: &PublishWorkMediaRequest,
    label: &str,
    default_name: &str,
    max_bytes: Option<u64>,
) -> Result<BiliMediaMeta, String> {
    let path = Path::new(media.path.trim());
    let metadata = std::fs::metadata(path).map_err(|error| format!("读取 {label}失败: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(format!("{label}为空，无法发布。"));
    }
    if max_bytes.is_some_and(|limit| metadata.len() > limit) {
        return Err(format!("{label}单张最大支持 20M：{}", media.name));
    }
    let name = media
        .name
        .trim()
        .strip_suffix('\0')
        .unwrap_or(media.name.trim())
        .to_string();
    let name = if name.is_empty() {
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(default_name)
            .to_string()
    } else {
        name
    };
    Ok(BiliMediaMeta {
        name,
        size: metadata.len(),
    })
}

fn bilibili_image_mime(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    }
    .to_string()
}

fn bilibili_title(target: &PublishWorkTargetRequest) -> String {
    let title = target.title.trim();
    if !title.is_empty() {
        return title.chars().take(80).collect();
    }
    target
        .media
        .first()
        .map(|media| media.name.trim())
        .filter(|name| !name.is_empty())
        .unwrap_or("未命名视频")
        .chars()
        .take(80)
        .collect()
}

fn bilibili_draw_caption(target: &PublishWorkTargetRequest) -> Result<String, String> {
    let title = target.title.trim();
    let body = target.body.trim();
    let caption = match (title.is_empty(), body.is_empty()) {
        (false, false) => format!("{title}\n{body}"),
        (false, true) => title.to_string(),
        (true, false) => body.to_string(),
        (true, true) => String::new(),
    };
    if caption.is_empty() {
        return Err("请输入 B 站图文标题或正文。".to_string());
    }
    if caption.chars().count() > 2000 {
        return Err("B 站图文正文最多 2000 个字。".to_string());
    }
    Ok(caption)
}

fn bilibili_draw_image_media(target: &PublishWorkTargetRequest) -> Result<&[PublishWorkMediaRequest], String> {
    if target.media.is_empty() {
        return Err("B 站图文发布需要至少选择一张图片。".to_string());
    }
    if target.media.len() > BILI_MAX_DRAW_IMAGE_COUNT {
        return Err(format!("B 站图文最多支持 {BILI_MAX_DRAW_IMAGE_COUNT} 张图片。"));
    }
    if target.media.iter().any(|media| media.media_type.trim() != "image") {
        return Err("B 站图文发布只支持图片素材。".to_string());
    }
    Ok(&target.media)
}

fn bilibili_draw_submit_payload(
    caption: &str,
    images: &[BiliUploadedDrawImage],
    upload_id: &str,
    private_pub: i64,
    timer_pub_time: Option<i64>,
) -> Value {
    let aigc = if images.iter().any(|image| image.ai_gen_pic.unwrap_or(0) > 0) {
        1
    } else {
        2
    };
    let pictures = images
        .iter()
        .map(|image| {
            serde_json::json!({
                "img_src": image.url,
                "img_width": image.width,
                "img_height": image.height,
                "img_size": image.size as f64 / 1024.0,
                "ai_gen_pic": image.ai_gen_pic.unwrap_or(0),
            })
        })
        .collect::<Vec<_>>();
    let mut option = serde_json::json!({
        "aigc": aigc,
        "pic_mode": 0,
        "private_pub": private_pub,
    });
    if let Some(timer_pub_time) = timer_pub_time {
        option["timer_pub_time"] = serde_json::json!(timer_pub_time);
    }
    serde_json::json!({
        "content": {
            "contents": [{
                "raw_text": caption,
                "type": 1,
                "biz_id": "",
            }],
        },
        "pics": pictures,
        "scene": 2,
        "upload_id": upload_id,
        "meta": {
            "app_meta": {
                "from": "create.dynamic.web",
                "mobi_app": "web",
            },
        },
        "option": option,
    })
}

fn bilibili_draw_submit_check_payload(dyn_req: &Value) -> Value {
    serde_json::json!({
        "content": dyn_req["content"].clone(),
        "pics": dyn_req["pics"].clone(),
        "scene": dyn_req["scene"].clone(),
        "create_option": dyn_req["option"].clone(),
    })
}

fn bilibili_dynamic_upload_id(cookie_header: &str) -> String {
    let mid = bilibili_cookie_value(cookie_header, "DedeUserID").unwrap_or_else(|| "0".to_string());
    let now = Utc::now().timestamp_millis();
    format!("{mid}_{}_{}", now / 1000, now.rem_euclid(10_000))
}

fn bilibili_tags(target: &PublishWorkTargetRequest) -> String {
    let mut tags = Vec::new();
    for token in target.body.split_whitespace() {
        let tag = token
            .trim_matches(|ch: char| ch == '#' || ch == '＃' || ch == ',' || ch == '，')
            .trim();
        if !tag.is_empty() && (token.starts_with('#') || token.starts_with('＃')) {
            tags.push(tag.chars().take(20).collect::<String>());
        }
        if tags.len() >= 10 {
            break;
        }
    }
    if tags.is_empty() {
        tags.push("生活".to_string());
    }
    tags.join(",")
}

fn bilibili_web_os() -> i64 {
    if cfg!(target_os = "windows") {
        1
    } else if cfg!(target_os = "macos") {
        2
    } else {
        3
    }
}

fn bilibili_response_data(value: &Value) -> &Value {
    if bilibili_response_success(value) {
        value.get("data").unwrap_or(value)
    } else {
        value
    }
}

fn ensure_bilibili_publish_success(value: &Value, fallback: &str) -> Result<(), String> {
    if bilibili_response_success(value) {
        Ok(())
    } else {
        Err(bilibili_error_message(value, fallback))
    }
}

fn bilibili_publish_remote_id(value: &Value) -> Option<String> {
    let data = value.get("data").unwrap_or(value);
    first_string(data, &["bvid", "aid", "id"]).or_else(|| {
        first_i64(data, &["aid", "id"])
            .filter(|value| *value > 0)
            .map(|value| value.to_string())
    })
}

fn bilibili_dynamic_remote_id(value: &Value) -> Option<String> {
    let data = value.get("data").unwrap_or(value);
    first_string(data, &["dyn_id_str", "dynamic_id_str", "dynamicIdStr", "dynamic_id", "dynamicId", "id"]).or_else(|| {
        first_i64(data, &["dyn_id", "dynamic_id", "dynamicId", "id"])
            .filter(|value| *value > 0)
            .map(|value| value.to_string())
    })
}

fn bilibili_cookie_value(cookie_header: &str, expected_name: &str) -> Option<String> {
    cookie_header.split(';').find_map(|item| {
        let mut parts = item.trim().splitn(2, '=');
        let name = parts.next()?.trim();
        let value = parts.next()?.trim();
        (name == expected_name && !value.is_empty()).then(|| value.to_string())
    })
}

fn bilibili_absolute_url(value: &str) -> String {
    if value.starts_with("//") {
        format!("https:{value}")
    } else {
        value.to_string()
    }
}

fn bilibili_response_success(value: &Value) -> bool {
    first_i64(value, &["code"]).unwrap_or(-1) == 0
}

fn bilibili_error_message(value: &Value, fallback: &str) -> String {
    first_string(value, &["message", "msg"])
        .filter(|message| !message.trim().is_empty() && message.trim() != "0")
        .map(|message| format!("{fallback}: {message}"))
        .unwrap_or_else(|| fallback.to_string())
}

fn bilibili_page_number(page_key: &str) -> i64 {
    page_key
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(1)
}

fn parse_bilibili_datetime(value: &str) -> Option<DateTime<Utc>> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(seconds) = value.parse::<i64>() {
        return DateTime::from_timestamp(seconds, 0);
    }
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Some(parsed.with_timezone(&Utc));
    }
    let parsed = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M"))
        .ok()?;
    FixedOffset::east_opt(8 * 3600)?
        .from_local_datetime(&parsed)
        .single()
        .map(|value| value.with_timezone(&Utc))
}

fn format_bilibili_publish_time(timestamp_seconds: i64) -> String {
    DateTime::from_timestamp(timestamp_seconds, 0)
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "合法时间范围内的时间".to_string())
}

fn text_key(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(value_text)
}

fn count_key(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(value_u64)
}

fn signed_key(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(value_i64)
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if text.is_empty() || text == "-" {
                None
            } else {
                Some(text.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn value_u64(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number
            .as_u64()
            .or_else(|| number.as_i64().filter(|value| *value >= 0).map(|value| value as u64)),
        Value::String(text) => text
            .trim()
            .replace(',', "")
            .parse::<u64>()
            .ok(),
        _ => None,
    }
}

fn value_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().and_then(|value| i64::try_from(value).ok())),
        Value::String(text) => text
            .trim()
            .replace(',', "")
            .parse::<i64>()
            .ok(),
        _ => None,
    }
}

fn format_bilibili_delta(value: i64) -> Option<String> {
    if value == 0 {
        None
    } else if value > 0 {
        Some(format!("▲ {}", value))
    } else {
        Some(format!("▼ {}", value.abs()))
    }
}

fn delta_tone(value: i64) -> String {
    if value >= 0 {
        "up".to_string()
    } else {
        "down".to_string()
    }
}
