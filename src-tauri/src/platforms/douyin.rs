use super::*;
use chrono::{Duration, FixedOffset, NaiveDateTime, TimeZone};
use hmac::{Hmac, Mac};
use sha2::{Digest as Sha2Digest, Sha256};
use std::{collections::BTreeMap, fmt::Write as _};

const COOKIE_DOMAINS: &[DomainRule] = &[DomainRule {
    host: "douyin.com",
    include_subdomains: true,
}];

const COOKIE_URLS: &[&str] = &[
    "https://www.douyin.com/",
    "https://douyin.com/",
    "https://creator.douyin.com/",
    "https://passport.douyin.com/",
    "https://sso.douyin.com/",
];

const LOGIN_COOKIE_NAMES: &[&str] = &[
    "sessionid",
    "sessionid_ss",
    "sid_guard",
    "sid_tt",
    "uid_tt",
    "uid_tt_ss",
    "sso_uid_tt",
    "sso_uid_tt_ss",
    "passport_auth_status",
    "passport_auth_status_ss",
];

const CREATOR_HOME_URL: &str = "https://creator.douyin.com/creator-micro/home?enter_from=dou_web";
const CREATOR_PUBLISH_UPLOAD_URL: &str =
    "https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web";
const CREATOR_DATA_OVERVIEW_URL: &str = "https://creator.douyin.com/creator-micro/data-center/operation";
const CREATOR_DATA_WORKS_URL: &str = "https://creator.douyin.com/creator-micro/content/manage";
const PC_USER_INFO_API: &str = "https://creator.douyin.com/aweme/v1/creator/pc/user/info/";
const USER_INFO_API: &str = "https://creator.douyin.com/aweme/v1/creator/user/info/";
const OVERVIEW_DASHBOARD_API: &str = "https://creator.douyin.com/janus/douyin/creator/data/overview/dashboard";
const HOMEPAGE_LATEST_WORKS_API: &str = "https://creator.douyin.com/web/api/creator/item/list";
const WORKS_LIST_API: &str = "https://creator.douyin.com/janus/douyin/creator/pc/work_list";
const WORK_DETAIL_API: &str = "https://creator.douyin.com/janus/douyin/creator/pc/work_detail";
const DOUYIN_UPLOAD_AUTH_API: &str = "https://creator.douyin.com/web/api/media/upload/auth/v5/";
const DOUYIN_CREATE_V2_API: &str =
    "https://creator.douyin.com/web/api/media/aweme/create_v2/?read_aid=2906";
const DOUYIN_UPLOAD_APP_ID: &str = "2906";
const DOUYIN_UPLOAD_REGION: &str = "cn-north-1";
const DOUYIN_VIDEO_SPACE_NAME: &str = "aweme";
const DOUYIN_IMAGE_SERVICE_ID: &str = "jm8ajry58r";
const DOUYIN_DIRECT_UPLOAD_LIMIT_BYTES: u64 = 3 * 1024 * 1024;
const DOUYIN_CHUNK_UPLOAD_BYTES: usize = 5 * 1024 * 1024;
const DOUYIN_VIDEO_MEDIA_TYPE: i64 = 4;
const DOUYIN_IMAGE_MEDIA_TYPE: i64 = 2;
const DOUYIN_EMPTY_JSON_ARRAY: &str = "[]";
const CREATOR_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://creator.douyin.com"),
    ("Referer", CREATOR_HOME_URL),
];
const CREATOR_PUBLISH_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://creator.douyin.com"),
    ("Referer", CREATOR_PUBLISH_UPLOAD_URL),
];
const DATA_OVERVIEW_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://creator.douyin.com"),
    ("Referer", CREATOR_DATA_OVERVIEW_URL),
];
const DATA_WORKS_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://creator.douyin.com"),
    ("Referer", CREATOR_DATA_WORKS_URL),
];
const WORK_DETAIL_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://creator.douyin.com"),
    (
        "Referer",
        "https://creator.douyin.com/creator-micro/work-management/work-detail/",
    ),
    ("Agw-Js-Conv", "str"),
];

const PC_USER_ID_KEYS: &[&str] = &["uid", "user_id", "userId", "sec_uid", "secUid"];
const CREATOR_USER_ID_KEYS: &[&str] = &[
    "douyin_unique_id",
    "unique_id",
    "uniqueId",
    "uid",
    "user_id",
    "userId",
    "sec_uid",
    "secUid",
];
const NICKNAME_KEYS: &[&str] = &[
    "nick_name",
    "nickName",
    "nickname",
    "name",
    "display_name",
    "displayName",
];
const AVATAR_KEYS: &[&str] = &[
    "avatar_url",
    "avatarUrl",
    "avatar",
    "avatar_thumb",
    "avatarThumb",
    "head_img",
    "headImg",
];
const FOLLOWER_COUNT_KEYS: &[&str] = &[
    "fans_count",
    "fansCount",
    "fans",
    "fan_count",
    "fanCount",
    "follower_count",
    "followerCount",
    "followers",
    "followers_count",
    "followersCount",
    "displayFans",
    "fansDisplay",
];
const FOLLOWING_COUNT_KEYS: &[&str] = &[
    "following_count",
    "followingCount",
    "follow_count",
    "followCount",
    "follow_num",
    "followNum",
    "following",
    "followings",
    "attention_count",
    "attentionCount",
];
const LIKE_COUNT_KEYS: &[&str] = &[
    "total_favorited",
    "totalFavorited",
    "favorited_count",
    "favoritedCount",
    "liked_count",
    "likedCount",
    "like_count",
    "likeCount",
    "digg_count",
    "diggCount",
    "total_like_count",
    "totalLikeCount",
];
const WORK_ID_KEYS: &[&str] = &["item_id_plain", "aweme_id", "awemeId", "item_id", "itemId", "id"];
const WORK_TITLE_KEYS: &[&str] = &["title", "desc", "description"];
const WORK_COVER_KEYS: &[&str] = &[
    "Cover",
    "cover_image_url",
    "cover_url",
    "coverUrl",
    "cover",
    "image",
    "images",
    "url_list",
];
const WORK_LINK_KEYS: &[&str] = &["item_link", "share_url", "shareUrl", "url", "link"];
const WORK_TIME_KEYS: &[&str] = &["create_time", "publish_time", "publishTime"];
const WORK_VIEW_KEYS: &[&str] = &["play_count", "playCount", "play_cnt", "playCnt", "view_count", "viewCount"];
const WORK_LIKE_KEYS: &[&str] = &["like_count", "likeCount", "like_cnt", "likeCnt", "digg_count", "diggCount"];
const WORK_COMMENT_KEYS: &[&str] = &["comment_count", "commentCount", "comment_cnt", "commentCnt"];
const WORK_SHARE_KEYS: &[&str] = &["share_count", "shareCount", "share_cnt", "shareCnt"];
const WORK_COLLECT_KEYS: &[&str] = &["collect_count", "collectCount", "favorite_count", "favoriteCount"];

pub(super) static SPEC: ChannelPlatform = ChannelPlatform {
    id: "douyin",
    name: "抖音",
    slug: "DY",
    color: "#111111",
    description: "添加并管理多个抖音账号。",
    creator_home_url: CREATOR_HOME_URL,
    cookie_urls: COOKIE_URLS,
    default_cookie_domain: ".douyin.com",
    cookie_domains: COOKIE_DOMAINS,
    login_cookie_names: LOGIN_COOKIE_NAMES,
    homepage_kind: HomepageKind::Creator,
    plugin_auth: true,
    materialize_avatar: false,
    avatar_referer: None,
    avatar_origin: None,
};

pub(crate) fn validate_douyin_publish_target(
    content_type: &str,
    target: &PublishWorkTargetRequest,
) -> Result<(), String> {
    if target.title.trim().is_empty() && target.body.trim().is_empty() {
        return Err("请输入抖音作品标题或正文。".to_string());
    }
    if target.schedule_mode.trim() == "scheduled" {
        return Err("抖音定时发布链路还未接入，请先使用立即发布。".to_string());
    }

    match content_type.trim() {
        "video" => {
            let videos = target
                .media
                .iter()
                .filter(|media| media.media_type.trim() == "video")
                .count();
            if videos != 1 || target.media.len() != 1 {
                return Err("抖音视频发布需要且只能选择 1 个视频素材。".to_string());
            }
            Ok(())
        }
        "article" => {
            if target.media.is_empty() {
                return Err("抖音图文发布请至少选择 1 张图片。".to_string());
            }
            if target
                .media
                .iter()
                .any(|media| media.media_type.trim() != "image")
            {
                return Err("抖音图文发布只能选择图片素材。".to_string());
            }
            Ok(())
        }
        _ => Err("抖音暂不支持当前作品类型。".to_string()),
    }
}

fn douyin_video_create_payload(
    target: &PublishWorkTargetRequest,
    video_id: &str,
    cover_uri: Option<&str>,
) -> Result<Value, String> {
    let video_id = video_id.trim();
    if video_id.is_empty() {
        return Err("抖音视频发布缺少上传后的视频 ID。".to_string());
    }
    let caption = douyin_combined_caption(target);
    let mut common = serde_json::Map::from_iter([
        ("media_type".to_string(), serde_json::json!(DOUYIN_VIDEO_MEDIA_TYPE)),
        ("video_id".to_string(), serde_json::json!(video_id)),
        ("text".to_string(), serde_json::json!(caption)),
        ("text_extra".to_string(), serde_json::json!(DOUYIN_EMPTY_JSON_ARRAY)),
        ("challenges".to_string(), serde_json::json!(DOUYIN_EMPTY_JSON_ARRAY)),
        ("mentions".to_string(), serde_json::json!(DOUYIN_EMPTY_JSON_ARRAY)),
        ("activity".to_string(), serde_json::json!(DOUYIN_EMPTY_JSON_ARRAY)),
        ("download".to_string(), serde_json::json!(1)),
        ("visibility_type".to_string(), serde_json::json!(douyin_visibility_type(&target.visibility))),
    ]);
    if let Some(cover_uri) = cover_uri.map(str::trim).filter(|value| !value.is_empty()) {
        common.insert("poster".to_string(), serde_json::json!(cover_uri));
    }
    Ok(serde_json::json!({ "item": { "common": common } }))
}

fn douyin_article_create_payload(
    target: &PublishWorkTargetRequest,
    uploaded_images: &[DouyinUploadedImage],
) -> Result<Value, String> {
    if uploaded_images.is_empty() {
        return Err("抖音图文发布缺少上传后的图片信息。".to_string());
    }
    let caption = douyin_combined_caption(target);
    let images = uploaded_images
        .iter()
        .map(|image| {
            serde_json::json!({
                "uri": image.uri,
                "width": image.width,
                "height": image.height,
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "item": {
            "common": {
                "media_type": DOUYIN_IMAGE_MEDIA_TYPE,
                "images": images,
                "text": caption,
                "text_extra": DOUYIN_EMPTY_JSON_ARRAY,
                "activity": DOUYIN_EMPTY_JSON_ARRAY,
                "challenges": DOUYIN_EMPTY_JSON_ARRAY,
                "hashtag_source": DOUYIN_EMPTY_JSON_ARRAY,
                "mentions": DOUYIN_EMPTY_JSON_ARRAY,
                "visibility_type": douyin_visibility_type(&target.visibility),
                "download": 1,
            }
        }
    }))
}

#[derive(Debug)]
struct DouyinUploadedImage {
    uri: String,
    width: u32,
    height: u32,
}

fn douyin_combined_caption(target: &PublishWorkTargetRequest) -> String {
    let title = target.title.trim();
    let body = target.body.trim();
    match (title.is_empty(), body.is_empty()) {
        (false, false) => format!("{title}\n{body}"),
        (false, true) => title.to_string(),
        (true, false) => body.to_string(),
        (true, true) => String::new(),
    }
}

fn douyin_visibility_type(visibility: &str) -> i64 {
    match visibility.trim() {
        "private" => 1,
        "friends" => 2,
        _ => 0,
    }
}

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
struct DouyinUploadSts {
    access_key_id: String,
    secret_access_key: String,
    session_token: String,
    current_time: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct DouyinUploadNode {
    upload_host: String,
    session_key: String,
    store_infos: Vec<DouyinStoreInfo>,
    upload_headers: Vec<(String, String)>,
}

#[derive(Debug)]
struct DouyinStoreInfo {
    auth: String,
    store_uri: String,
    upload_id: Option<String>,
}

#[derive(Debug)]
struct DouyinUploadedVideo {
    video_id: String,
    cover_uri: Option<String>,
}

pub(crate) async fn publish_douyin_work(
    cookie_header: &str,
    login_cookie: &str,
    content_type: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    validate_douyin_publish_target(content_type, target)?;
    if !has_douyin_login_cookie(login_cookie) {
        return Err("抖音网页登录态已失效，请重新登录后再发布。".to_string());
    }

    let profile = fetch_douyin_creator_account_from_cookie(cookie_header, login_cookie.to_string()).await?;
    let uid = profile.uid.trim();
    if uid.is_empty() {
        return Err("抖音账号缺少上传所需的 UID，请重新登录后再发布。".to_string());
    }
    let sts = request_douyin_upload_sts(cookie_header).await?;
    let payload = match content_type.trim() {
        "video" => {
            let media = douyin_video_media(target)?;
            let uploaded = upload_douyin_video(&sts, uid, media).await?;
            douyin_video_create_payload(target, &uploaded.video_id, uploaded.cover_uri.as_deref())?
        }
        "article" => {
            let uploaded = upload_douyin_images(&sts, uid, &target.media).await?;
            douyin_article_create_payload(target, &uploaded)?
        }
        _ => return Err("抖音暂不支持当前作品类型。".to_string()),
    };

    let submitted_at = Utc::now();
    let value = request_plugin_json_with_body(
        "POST",
        DOUYIN_CREATE_V2_API,
        cookie_header,
        CREATOR_PUBLISH_HEADERS,
        Some(payload),
    )
    .await
    .map_err(|error| format!("抖音作品提交失败: {error}"))?;
    ensure_douyin_response_success(&value, "抖音作品提交失败")?;
    if let Some(remote_id) = douyin_publish_remote_id(&value) {
        return Ok(Some(remote_id));
    }
    Ok(fetch_douyin_publish_remote_id_fallback(
        cookie_header,
        &target.account_id,
        content_type,
        target,
        submitted_at,
    )
    .await)
}

async fn request_douyin_upload_sts(cookie_header: &str) -> Result<DouyinUploadSts, String> {
    let value = request_plugin_json(
        "GET",
        DOUYIN_UPLOAD_AUTH_API,
        cookie_header,
        CREATOR_PUBLISH_HEADERS,
    )
    .await
    .map_err(|error| format!("抖音上传授权获取失败: {error}"))?;
    ensure_douyin_response_success(&value, "抖音上传授权获取失败")?;
    parse_douyin_upload_sts(&value)
}

fn parse_douyin_upload_sts(value: &Value) -> Result<DouyinUploadSts, String> {
    let auth = value
        .get("auth")
        .or_else(|| value.get("data").and_then(|data| data.get("auth")))
        .ok_or_else(|| "抖音上传授权缺少 auth 字段。".to_string())?;
    let auth_value = match auth {
        Value::String(text) => serde_json::from_str::<Value>(text)
            .map_err(|error| format!("抖音上传授权 auth 不是有效 JSON: {error}"))?,
        other => other.clone(),
    };
    let access_key_id = first_string_deep(
        &auth_value,
        &["AccessKeyID", "AccessKeyId", "access_key_id", "accessKeyId"],
    )
    .unwrap_or_default();
    let secret_access_key = first_string_deep(
        &auth_value,
        &[
            "SecretAccessKey",
            "secret_access_key",
            "secretAccessKey",
        ],
    )
    .unwrap_or_default();
    let session_token = first_string_deep(
        &auth_value,
        &["SessionToken", "session_token", "sessionToken"],
    )
    .unwrap_or_default();
    if access_key_id.trim().is_empty()
        || secret_access_key.trim().is_empty()
        || session_token.trim().is_empty()
    {
        return Err("抖音上传授权缺少临时密钥，请重新登录后再发布。".to_string());
    }
    let current_time = first_string_deep(
        &auth_value,
        &["CurrentTime", "current_time", "currentTime"],
    )
    .and_then(|text| DateTime::parse_from_rfc3339(&text).ok())
    .map(|time| time.with_timezone(&Utc));
    Ok(DouyinUploadSts {
        access_key_id,
        secret_access_key,
        session_token,
        current_time,
    })
}

fn douyin_video_media(target: &PublishWorkTargetRequest) -> Result<&PublishWorkMediaRequest, String> {
    if target.media.len() != 1 {
        return Err("抖音视频发布需要且只能选择 1 个视频素材。".to_string());
    }
    let media = &target.media[0];
    if media.media_type.trim() != "video" {
        return Err("抖音视频发布需要选择视频素材。".to_string());
    }
    Ok(media)
}

async fn upload_douyin_images(
    sts: &DouyinUploadSts,
    uid: &str,
    medias: &[PublishWorkMediaRequest],
) -> Result<Vec<DouyinUploadedImage>, String> {
    let mut uploaded = Vec::with_capacity(medias.len());
    for (index, media) in medias.iter().enumerate() {
        uploaded.push(
            upload_douyin_image(sts, uid, media)
                .await
                .map_err(|error| format!("抖音第 {} 张图片上传失败: {error}", index + 1))?,
        );
    }
    Ok(uploaded)
}

async fn upload_douyin_video(
    sts: &DouyinUploadSts,
    uid: &str,
    media: &PublishWorkMediaRequest,
) -> Result<DouyinUploadedVideo, String> {
    let (size, bytes) = douyin_media_bytes(media)?;
    let mut params = douyin_common_upload_params(uid);
    params.insert("Action".to_string(), "ApplyUploadInner".to_string());
    params.insert("Version".to_string(), "2020-11-19".to_string());
    params.insert("SpaceName".to_string(), DOUYIN_VIDEO_SPACE_NAME.to_string());
    params.insert("FileType".to_string(), "video".to_string());
    params.insert("IsInner".to_string(), "1".to_string());
    params.insert("FileSize".to_string(), size.to_string());
    let pre = request_douyin_upload_action_json(
        "GET",
        "https://vod.bytedanceapi.com/",
        "vod",
        params,
        sts,
        None,
    )
    .await
    .map_err(|error| format!("抖音视频上传初始化失败: {error}"))?;
    ensure_douyin_upload_action_success(&pre, "抖音视频上传初始化失败")?;
    let node = parse_douyin_upload_node(&pre, true)?;
    let store = douyin_first_store(&node)?;
    upload_douyin_storage_file(&node, store, uid, bytes)
        .await
        .map_err(|error| format!("抖音视频文件上传失败: {error}"))?;

    let mut params = douyin_common_upload_params(uid);
    params.insert("Action".to_string(), "CommitUploadInner".to_string());
    params.insert("Version".to_string(), "2020-11-19".to_string());
    params.insert("SpaceName".to_string(), DOUYIN_VIDEO_SPACE_NAME.to_string());
    let commit = request_douyin_upload_action_json(
        "POST",
        "https://vod.bytedanceapi.com/",
        "vod",
        params,
        sts,
        Some(serde_json::json!({
            "SessionKey": node.session_key,
            "Functions": [
                { "name": "GetMeta" },
                { "name": "Snapshot", "input": { "SnapshotTime": 0 } },
            ],
        })),
    )
    .await
    .map_err(|error| format!("抖音视频上传确认失败: {error}"))?;
    ensure_douyin_upload_action_success(&commit, "抖音视频上传确认失败")?;
    parse_douyin_uploaded_video(&commit, &store.store_uri)
}

async fn upload_douyin_image(
    sts: &DouyinUploadSts,
    uid: &str,
    media: &PublishWorkMediaRequest,
) -> Result<DouyinUploadedImage, String> {
    let (_, bytes) = douyin_media_bytes(media)?;
    let mut params = douyin_common_upload_params(uid);
    params.insert("Action".to_string(), "ApplyImageUpload".to_string());
    params.insert("Version".to_string(), "2018-08-01".to_string());
    params.insert("ServiceId".to_string(), DOUYIN_IMAGE_SERVICE_ID.to_string());
    params.insert("UploadNum".to_string(), "1".to_string());
    let pre = request_douyin_upload_action_json(
        "GET",
        "https://imagex.bytedanceapi.com/",
        "imagex",
        params,
        sts,
        None,
    )
    .await
    .map_err(|error| format!("抖音图片上传初始化失败: {error}"))?;
    ensure_douyin_upload_action_success(&pre, "抖音图片上传初始化失败")?;
    let node = parse_douyin_upload_node(&pre, false)?;
    let store = douyin_first_store(&node)?;
    upload_douyin_storage_file(&node, store, uid, bytes)
        .await
        .map_err(|error| format!("抖音图片文件上传失败: {error}"))?;

    let mut params = douyin_common_upload_params(uid);
    params.insert("Action".to_string(), "CommitImageUpload".to_string());
    params.insert("Version".to_string(), "2018-08-01".to_string());
    params.insert("ServiceId".to_string(), DOUYIN_IMAGE_SERVICE_ID.to_string());
    let commit = request_douyin_upload_action_json(
        "POST",
        "https://imagex.bytedanceapi.com/",
        "imagex",
        params,
        sts,
        Some(serde_json::json!({ "SessionKey": node.session_key })),
    )
    .await
    .map_err(|error| format!("抖音图片上传确认失败: {error}"))?;
    ensure_douyin_upload_action_success(&commit, "抖音图片上传确认失败")?;
    parse_douyin_uploaded_image(&commit, &store.store_uri, media)
}

fn douyin_media_bytes(media: &PublishWorkMediaRequest) -> Result<(u64, Vec<u8>), String> {
    let local = local_publish_media(media, "抖音")?;
    let bytes = std::fs::read(local.path)
        .map_err(|error| format!("读取抖音素材文件失败: {error}"))?;
    Ok((local.size, bytes))
}

fn douyin_common_upload_params(uid: &str) -> BTreeMap<String, String> {
    BTreeMap::from_iter([
        ("app_id".to_string(), DOUYIN_UPLOAD_APP_ID.to_string()),
        ("user_id".to_string(), uid.to_string()),
        ("s".to_string(), Uuid::new_v4().simple().to_string()),
    ])
}

async fn request_douyin_upload_action_json(
    method: &str,
    endpoint: &str,
    service: &str,
    params: BTreeMap<String, String>,
    sts: &DouyinUploadSts,
    body: Option<Value>,
) -> Result<Value, String> {
    let body_bytes = body
        .as_ref()
        .map(serde_json::to_vec)
        .transpose()
        .map_err(|error| format!("抖音上传参数序列化失败: {error}"))?;
    let (url, headers) = douyin_signed_upload_action(
        method,
        endpoint,
        service,
        &params,
        sts,
        body_bytes.as_deref(),
        body_bytes.as_ref().map(|_| "application/json"),
    )?;
    let mut request = if method.eq_ignore_ascii_case("POST") {
        platform_http_client().post(&url)
    } else {
        platform_http_client().get(&url)
    };
    request = request
        .header("User-Agent", PLATFORM_DESKTOP_USER_AGENT)
        .header("Accept", PLATFORM_JSON_ACCEPT)
        .timeout(std::time::Duration::from_secs(60));
    for (key, value) in headers {
        request = request.header(key.as_str(), value.as_str());
    }
    if let Some(bytes) = body_bytes {
        request = request.body(bytes);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("抖音上传接口请求失败: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("抖音上传接口响应读取失败: {error}"))?;
    if !status.is_success() {
        return Err(format!("抖音上传接口返回 HTTP {status}: {}", compact_http_body(&text, 240)));
    }
    serde_json::from_str::<Value>(&text)
        .map_err(|error| format!("抖音上传接口不是 JSON: {error}: {}", compact_http_body(&text, 240)))
}

fn douyin_signed_upload_action(
    method: &str,
    endpoint: &str,
    service: &str,
    params: &BTreeMap<String, String>,
    sts: &DouyinUploadSts,
    body: Option<&[u8]>,
    content_type: Option<&str>,
) -> Result<(String, Vec<(String, String)>), String> {
    let mut url = Url::parse(endpoint).map_err(|error| format!("抖音上传地址无效: {error}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| "抖音上传地址缺少 host。".to_string())?
        .to_string();
    let host_header = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    };
    let canonical_query = douyin_canonical_query(params);
    url.set_query(Some(&canonical_query));
    let amz_date = douyin_signing_time(sts).format("%Y%m%dT%H%M%SZ").to_string();
    let date_scope = amz_date[..8].to_string();
    let body_hash = sha256_hex(body.unwrap_or_default());

    let mut canonical_headers = BTreeMap::from_iter([
        ("host".to_string(), host_header.clone()),
        ("x-amz-date".to_string(), amz_date.clone()),
        (
            "x-amz-security-token".to_string(),
            sts.session_token.clone(),
        ),
    ]);
    if let Some(content_type) = content_type {
        canonical_headers.insert("content-type".to_string(), content_type.to_string());
        canonical_headers.insert("x-amz-content-sha256".to_string(), body_hash.clone());
    }
    let signed_headers = canonical_headers
        .keys()
        .cloned()
        .collect::<Vec<_>>()
        .join(";");
    let canonical_header_text = canonical_headers
        .iter()
        .map(|(key, value)| format!("{key}:{}\n", canonical_header_value(value)))
        .collect::<String>();
    let canonical_uri = if url.path().is_empty() { "/" } else { url.path() };
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method.to_ascii_uppercase(),
        canonical_uri,
        canonical_query,
        canonical_header_text,
        signed_headers,
        body_hash
    );
    let credential_scope = format!("{date_scope}/{DOUYIN_UPLOAD_REGION}/{service}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = douyin_aws4_signing_key(&sts.secret_access_key, &date_scope, service)?;
    let signature = hmac_sha256_hex(&signing_key, string_to_sign.as_bytes())?;
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        sts.access_key_id, credential_scope, signed_headers, signature
    );

    let mut headers = vec![
        ("Authorization".to_string(), authorization),
        ("X-Amz-Date".to_string(), amz_date),
        (
            "X-Amz-Security-Token".to_string(),
            sts.session_token.clone(),
        ),
    ];
    if let Some(content_type) = content_type {
        headers.push(("Content-Type".to_string(), content_type.to_string()));
        headers.push(("X-Amz-Content-Sha256".to_string(), body_hash));
    }
    Ok((url.to_string(), headers))
}

async fn upload_douyin_storage_file(
    node: &DouyinUploadNode,
    store: &DouyinStoreInfo,
    uid: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.len() as u64 <= DOUYIN_DIRECT_UPLOAD_LIMIT_BYTES {
        upload_douyin_direct_file(node, store, uid, bytes).await
    } else {
        upload_douyin_chunked_file(node, store, uid, &bytes).await
    }
}

async fn upload_douyin_direct_file(
    node: &DouyinUploadNode,
    store: &DouyinStoreInfo,
    uid: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let crc = crc32_hex(&bytes);
    let value = post_douyin_storage_json(
        douyin_storage_upload_url(&node.upload_host, &store.store_uri, None),
        node,
        store,
        uid,
        bytes,
        Some(crc),
    )
    .await?;
    ensure_douyin_storage_success(&value, "抖音文件直传失败")
}

async fn upload_douyin_chunked_file(
    node: &DouyinUploadNode,
    store: &DouyinStoreInfo,
    uid: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let init = post_douyin_storage_json(
        douyin_storage_upload_url(
            &node.upload_host,
            &store.store_uri,
            Some("uploadmode=part&phase=init"),
        ),
        node,
        store,
        uid,
        Vec::new(),
        None,
    )
    .await
    .map_err(|error| format!("分片上传初始化失败: {error}"))?;
    ensure_douyin_storage_success(&init, "抖音分片上传初始化失败")?;
    let upload_id = first_string_deep(
        &init,
        &[
            "UploadID",
            "UploadId",
            "upload_id",
            "uploadId",
            "uploadID",
        ],
    )
    .or_else(|| store.upload_id.clone())
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| "抖音分片上传初始化缺少 upload_id。".to_string())?;

    let mut parts = Vec::new();
    for (index, chunk) in bytes.chunks(DOUYIN_CHUNK_UPLOAD_BYTES).enumerate() {
        let part_number = index + 1;
        let part_offset = index * DOUYIN_CHUNK_UPLOAD_BYTES;
        let crc = crc32_hex(chunk);
        let query = format!(
            "uploadid={}&part_number={part_number}&phase=transfer&part_offset={part_offset}",
            douyin_uri_component(&upload_id)
        );
        let value = post_douyin_storage_json(
            douyin_storage_upload_url(&node.upload_host, &store.store_uri, Some(&query)),
            node,
            store,
            uid,
            chunk.to_vec(),
            Some(crc.clone()),
        )
        .await
        .map_err(|error| format!("第 {part_number} 个分片上传失败: {error}"))?;
        ensure_douyin_storage_success(&value, "抖音分片上传失败")?;
        parts.push(format!("{part_number}:{crc}"));
    }

    let finish_body = parts.join(",").into_bytes();
    let finish_query = format!(
        "uploadmode=part&phase=finish&uploadid={}",
        douyin_uri_component(&upload_id)
    );
    let finish = post_douyin_storage_json(
        douyin_storage_upload_url(&node.upload_host, &store.store_uri, Some(&finish_query)),
        node,
        store,
        uid,
        finish_body,
        None,
    )
    .await
    .map_err(|error| format!("分片上传合并失败: {error}"))?;
    ensure_douyin_storage_success(&finish, "抖音分片上传合并失败")
}

async fn post_douyin_storage_json(
    url: String,
    node: &DouyinUploadNode,
    store: &DouyinStoreInfo,
    uid: &str,
    body: Vec<u8>,
    content_crc32: Option<String>,
) -> Result<Value, String> {
    let mut request = platform_http_client()
        .post(url)
        .header("User-Agent", PLATFORM_DESKTOP_USER_AGENT)
        .header("Accept", PLATFORM_JSON_ACCEPT)
        .header("Authorization", store.auth.as_str())
        .header("X-Storage-U", douyin_uri_component(uid))
        .timeout(std::time::Duration::from_secs(180))
        .body(body);
    if let Some(crc) = content_crc32 {
        request = request.header("Content-CRC32", crc);
    }
    for (key, value) in &node.upload_headers {
        request = request.header(key.as_str(), value.as_str());
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("抖音存储上传请求失败: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("抖音存储上传响应读取失败: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "抖音存储上传返回 HTTP {status}: {}",
            compact_http_body(&text, 240)
        ));
    }
    serde_json::from_str::<Value>(&text).map_err(|error| {
        format!(
            "抖音存储上传响应不是 JSON: {error}: {}",
            compact_http_body(&text, 240)
        )
    })
}

fn ensure_douyin_storage_success(value: &Value, fallback: &str) -> Result<(), String> {
    let code = first_i64(value, &["code"]).unwrap_or_default();
    if code != 2000 {
        return Err(douyin_error_message(value, fallback));
    }
    Ok(())
}

fn parse_douyin_upload_node(value: &Value, video: bool) -> Result<DouyinUploadNode, String> {
    let address = if video {
        value
            .get("Result")
            .and_then(|result| result.get("InnerUploadAddress"))
            .and_then(douyin_upload_address_node)
    } else {
        value
            .get("Result")
            .and_then(|result| result.get("UploadAddress"))
            .and_then(douyin_upload_address_node)
    }
    .ok_or_else(|| "抖音上传初始化缺少上传地址。".to_string())?;
    let upload_host = douyin_upload_host(address)
        .ok_or_else(|| "抖音上传初始化缺少 UploadHost。".to_string())?;
    let session_key = first_string_deep(address, &["SessionKey", "session_key", "sessionKey"])
        .ok_or_else(|| "抖音上传初始化缺少 SessionKey。".to_string())?;
    let stores = address
        .get("StoreInfos")
        .or_else(|| address.get("store_infos"))
        .or_else(|| address.get("storeInfos"))
        .and_then(Value::as_array)
        .ok_or_else(|| "抖音上传初始化缺少 StoreInfos。".to_string())?;
    let store_infos = stores
        .iter()
        .map(parse_douyin_store_info)
        .collect::<Result<Vec<_>, _>>()?;
    let upload_headers = address
        .get("UploadHeader")
        .or_else(|| address.get("upload_header"))
        .or_else(|| address.get("uploadHeader"))
        .and_then(Value::as_object)
        .map(|headers| {
            headers
                .iter()
                .filter_map(|(key, value)| value_to_text(value).map(|value| (key.clone(), value)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(DouyinUploadNode {
        upload_host,
        session_key,
        store_infos,
        upload_headers,
    })
}

fn douyin_upload_address_node(address: &Value) -> Option<&Value> {
    address
        .get("UploadNodes")
        .or_else(|| address.get("upload_nodes"))
        .or_else(|| address.get("uploadNodes"))
        .and_then(Value::as_array)
        .and_then(|nodes| nodes.first())
        .or(Some(address))
}

fn douyin_upload_host(address: &Value) -> Option<String> {
    [
        "UploadHost",
        "upload_host",
        "uploadHost",
        "UploadHosts",
        "upload_hosts",
        "uploadHosts",
    ]
    .iter()
    .find_map(|key| address.get(*key).and_then(douyin_first_text_value))
    .or_else(|| first_string_deep(address, &["UploadHost", "upload_host", "uploadHost"]))
    .filter(|value| !value.trim().is_empty())
}

fn douyin_first_text_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_string())
        }
        Value::Array(items) => items.iter().find_map(douyin_first_text_value),
        Value::Object(map) => map.values().find_map(douyin_first_text_value),
        _ => value_to_text(value),
    }
}

fn parse_douyin_store_info(value: &Value) -> Result<DouyinStoreInfo, String> {
    let auth = first_string_deep(value, &["Auth", "auth"])
        .ok_or_else(|| "抖音上传初始化缺少 StoreInfo.Auth。".to_string())?;
    let store_uri = first_string_deep(
        value,
        &["StoreUri", "StoreURI", "store_uri", "storeUri", "Uri", "uri"],
    )
    .ok_or_else(|| "抖音上传初始化缺少 StoreInfo.StoreUri。".to_string())?;
    let upload_id = first_string_deep(
        value,
        &[
            "UploadID",
            "UploadId",
            "upload_id",
            "uploadId",
            "uploadID",
        ],
    )
    .filter(|value| !value.trim().is_empty());
    Ok(DouyinStoreInfo {
        auth,
        store_uri,
        upload_id,
    })
}

fn douyin_first_store(node: &DouyinUploadNode) -> Result<&DouyinStoreInfo, String> {
    node.store_infos
        .first()
        .ok_or_else(|| "抖音上传初始化没有可用 StoreInfo。".to_string())
}

fn parse_douyin_uploaded_video(value: &Value, fallback_store_uri: &str) -> Result<DouyinUploadedVideo, String> {
    let video_id = first_string_deep(
        value,
        &[
            "Vid",
            "VID",
            "vid",
            "VideoId",
            "VideoID",
            "video_id",
            "videoId",
        ],
    )
    .or_else(|| {
        let trimmed = fallback_store_uri.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
    .ok_or_else(|| "抖音视频上传确认缺少视频 ID。".to_string())?;
    let cover_uri = first_string_deep(
        value,
        &[
            "PosterUri",
            "PosterURI",
            "poster_uri",
            "posterUri",
            "SnapshotUri",
            "SnapshotURI",
            "snapshot_uri",
            "snapshotUri",
            "CoverUri",
            "CoverURI",
            "cover_uri",
            "coverUri",
        ],
    )
    .filter(|value| !value.trim().is_empty());
    Ok(DouyinUploadedVideo {
        video_id,
        cover_uri,
    })
}

fn parse_douyin_uploaded_image(
    value: &Value,
    fallback_store_uri: &str,
    media: &PublishWorkMediaRequest,
) -> Result<DouyinUploadedImage, String> {
    let uri = first_string_deep(
        value,
        &[
            "Uri",
            "URI",
            "uri",
            "ImageUri",
            "ImageURI",
            "image_uri",
            "imageUri",
            "StoreUri",
            "StoreURI",
            "store_uri",
            "storeUri",
        ],
    )
    .or_else(|| {
        let trimmed = fallback_store_uri.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
    .ok_or_else(|| "抖音图片上传确认缺少图片 URI。".to_string())?;
    let width = first_count(value, &["Width", "width", "ImageWidth", "image_width", "imageWidth"])
        .and_then(|value| u32::try_from(value).ok())
        .or(media.width)
        .filter(|value| *value > 0)
        .ok_or_else(|| "抖音图文图片缺少宽度信息，请重新选择素材后再发布。".to_string())?;
    let height = first_count(
        value,
        &["Height", "height", "ImageHeight", "image_height", "imageHeight"],
    )
    .and_then(|value| u32::try_from(value).ok())
    .or(media.height)
    .filter(|value| *value > 0)
    .ok_or_else(|| "抖音图文图片缺少高度信息，请重新选择素材后再发布。".to_string())?;
    Ok(DouyinUploadedImage { uri, width, height })
}

fn ensure_douyin_upload_action_success(value: &Value, fallback: &str) -> Result<(), String> {
    if let Some(error) = value
        .get("ResponseMetadata")
        .and_then(|metadata| metadata.get("Error"))
    {
        let message = first_string_deep(error, &["Message", "message", "Code", "code"])
            .unwrap_or_else(|| fallback.to_string());
        return Err(message);
    }
    if first_i64(value, &["status_code"]).is_some_and(|code| code != 0) {
        return Err(douyin_error_message(value, fallback));
    }
    Ok(())
}

fn douyin_publish_remote_id(value: &Value) -> Option<String> {
    first_text_deep(
        value,
        &[
            "item_id",
            "itemId",
            "item_id_plain",
            "aweme_id",
            "awemeId",
            "id",
        ],
    )
}

async fn fetch_douyin_publish_remote_id_fallback(
    cookie_header: &str,
    account_id: &str,
    content_type: &str,
    target: &PublishWorkTargetRequest,
    submitted_at: DateTime<Utc>,
) -> Option<String> {
    let work = fetch_douyin_latest_work(cookie_header, account_id).await.ok()??;
    if douyin_latest_work_matches_publish(&work, content_type, target, submitted_at) {
        Some(work.id)
    } else {
        None
    }
}

fn douyin_latest_work_matches_publish(
    work: &ChannelContentWork,
    content_type: &str,
    target: &PublishWorkTargetRequest,
    submitted_at: DateTime<Utc>,
) -> bool {
    if work.id.trim().is_empty() {
        return false;
    }
    if !douyin_work_type_matches_publish(work.work_type.as_deref(), content_type) {
        return false;
    }
    if let Some(published_at) = work.published_at {
        if published_at < submitted_at - Duration::minutes(5) {
            return false;
        }
    }
    let expected = douyin_publish_match_text(content_type, target);
    expected.is_empty() || douyin_text_matches(&work.title, &expected)
}

fn douyin_work_type_matches_publish(work_type: Option<&str>, content_type: &str) -> bool {
    let Some(work_type) = work_type.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    match content_type.trim() {
        "video" => matches!(work_type, "video"),
        "article" => matches!(work_type, "article" | "image" | "note"),
        _ => true,
    }
}

fn douyin_publish_match_text(content_type: &str, target: &PublishWorkTargetRequest) -> String {
    match content_type.trim() {
        "article" | "video" => douyin_combined_caption(target),
        _ => douyin_combined_caption(target),
    }
}

fn douyin_text_matches(actual: &str, expected: &str) -> bool {
    let actual = actual.trim();
    let expected = expected.trim();
    !actual.is_empty()
        && !expected.is_empty()
        && (actual == expected || actual.contains(expected) || expected.contains(actual))
}

fn first_text_deep(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(text) = map.get(*key).and_then(value_to_text) {
                    return Some(text);
                }
            }
            map.values().find_map(|value| first_text_deep(value, keys))
        }
        Value::Array(items) => items.iter().find_map(|value| first_text_deep(value, keys)),
        _ => None,
    }
}

fn douyin_storage_upload_url(host: &str, store_uri: &str, query: Option<&str>) -> String {
    let host = host.trim().trim_end_matches('/');
    let base = if host.starts_with("http://") || host.starts_with("https://") {
        host.to_string()
    } else if host.starts_with("//") {
        format!("https:{host}")
    } else {
        format!("https://{host}")
    };
    let url = format!("{base}/upload/v1/{}", store_uri.trim().trim_start_matches('/'));
    match query.map(str::trim).filter(|value| !value.is_empty()) {
        Some(query) => format!("{url}?{query}"),
        None => url,
    }
}

fn douyin_signing_time(sts: &DouyinUploadSts) -> DateTime<Utc> {
    sts.current_time.unwrap_or_else(Utc::now)
}

fn douyin_canonical_query(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(key, value)| format!("{}={}", douyin_uri_component(key), douyin_uri_component(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn canonical_header_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn douyin_uri_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(char::from(*byte));
            }
            _ => {
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }
    encoded
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

fn douyin_aws4_signing_key(secret: &str, date_scope: &str, service: &str) -> Result<Vec<u8>, String> {
    let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), date_scope.as_bytes())?;
    let k_region = hmac_sha256(&k_date, DOUYIN_UPLOAD_REGION.as_bytes())?;
    let k_service = hmac_sha256(&k_region, service.as_bytes())?;
    hmac_sha256(&k_service, b"aws4_request")
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|error| format!("抖音上传签名初始化失败: {error}"))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn hmac_sha256_hex(key: &[u8], data: &[u8]) -> Result<String, String> {
    hmac_sha256(key, data).map(|bytes| hex_lower(&bytes))
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

fn crc32_hex(bytes: &[u8]) -> String {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    format!("{:08x}", !crc)
}

pub(super) async fn fetch_douyin_creator_account_from_cookie(
    cookie_header: &str,
    login_cookie: String,
) -> Result<PluginAccountInfo, String> {
    let pc_user = request_plugin_json(
        "GET",
        PC_USER_INFO_API,
        cookie_header,
        CREATOR_HEADERS,
    )
    .await
    .map_err(|error| format!("抖音创作者中心账号接口不可用: {error}"))?;
    if !douyin_response_success(&pc_user) {
        return Err("抖音网页登录态已失效，请重新登录后再打开创作中心。".to_string());
    }

    let user = match request_plugin_json(
        "GET",
        USER_INFO_API,
        cookie_header,
        CREATOR_HEADERS,
    )
    .await
    {
        Ok(value) if douyin_response_success(&value) => Some(value),
        Ok(value) => {
            eprintln!(
                "[douyin-auth] creator detail profile ignored: {}",
                douyin_error_message(&value, "抖音创作者中心资料读取失败")
            );
            None
        }
        Err(error) => {
            eprintln!("[douyin-auth] creator detail profile unavailable: {error}");
            None
        }
    };

    let verify_info = user
        .as_ref()
        .and_then(|value| value.get("douyin_user_verify_info").or_else(|| value.get("user_profile")));
    let uid = verify_info
        .and_then(|value| first_string_deep(value, CREATOR_USER_ID_KEYS))
        .or_else(|| user.as_ref().and_then(|value| first_string_deep(value, CREATOR_USER_ID_KEYS)))
        .or_else(|| first_string_deep(&pc_user, PC_USER_ID_KEYS))
        .unwrap_or_else(|| stable_label_fragment(cookie_header));
    let nickname = verify_info
        .and_then(|value| first_string_deep(value, NICKNAME_KEYS))
        .or_else(|| user.as_ref().and_then(|value| first_string_deep(value, NICKNAME_KEYS)))
        .or_else(|| first_string_deep(&pc_user, NICKNAME_KEYS))
        .unwrap_or_else(|| platform_name("douyin").to_string());
    let avatar = verify_info
        .and_then(|value| first_profile_image(value, AVATAR_KEYS))
        .or_else(|| user.as_ref().and_then(|value| first_profile_image(value, AVATAR_KEYS)))
        .or_else(|| first_profile_image(&pc_user, AVATAR_KEYS))
        .unwrap_or_default();
    let fans_count = verify_info
        .and_then(|value| first_count(value, FOLLOWER_COUNT_KEYS))
        .or_else(|| user.as_ref().and_then(|value| first_count(value, FOLLOWER_COUNT_KEYS)));
    let following_count = verify_info
        .and_then(|value| first_count(value, FOLLOWING_COUNT_KEYS))
        .or_else(|| user.as_ref().and_then(|value| first_count(value, FOLLOWING_COUNT_KEYS)));
    let like_count = verify_info
        .and_then(|value| first_count(value, LIKE_COUNT_KEYS))
        .or_else(|| user.as_ref().and_then(|value| first_count(value, LIKE_COUNT_KEYS)));

    Ok(PluginAccountInfo {
        uid: uid.clone(),
        account: uid,
        nickname,
        avatar,
        fans_count,
        following_count,
        like_count,
        login_cookie,
    })
}

pub(super) async fn fetch_douyin_account_content(
    cookie_header: &str,
    login_cookie: String,
    account_id: &str,
) -> Result<ChannelAccountContent, String> {
    let profile = fetch_douyin_creator_account_from_cookie(cookie_header, login_cookie).await?;
    fetch_douyin_account_content_with_profile_snapshot(
        cookie_header,
        account_id,
        plugin_account_profile_snapshot(account_id, "douyin", &profile),
    )
    .await
}

pub(crate) async fn fetch_douyin_account_content_with_profile_snapshot(
    cookie_header: &str,
    account_id: &str,
    profile_snapshot: ChannelAccountProfileSnapshot,
) -> Result<ChannelAccountContent, String> {
    let now = Utc::now();
    let (overview_yesterday_result, overview_seven_result, overview_thirty_result, latest_work_result) = tokio::join!(
        fetch_douyin_overview(cookie_header, account_id, 1, now),
        fetch_douyin_overview(cookie_header, account_id, 7, now),
        fetch_douyin_overview(cookie_header, account_id, 30, now),
        fetch_douyin_latest_work(cookie_header, account_id),
    );
    let overview_yesterday = overview_yesterday_result?;
    let overview_seven = overview_seven_result?;
    let overview_thirty = overview_thirty_result?;
    let latest_work = latest_work_result.unwrap_or(None);

    Ok(ChannelAccountContent {
        account_id: account_id.to_string(),
        platform_id: "douyin".to_string(),
        profile: Some(profile_snapshot),
        overview_yesterday: Some(overview_yesterday),
        overview_seven: Some(overview_seven),
        overview_thirty: Some(overview_thirty),
        latest_work: latest_work.clone(),
        latest_work_seven: latest_work.clone(),
        latest_work_thirty: latest_work,
        sync_status: "synced".to_string(),
        ..Default::default()
    })
}

async fn fetch_douyin_latest_work(
    cookie_header: &str,
    account_id: &str,
) -> Result<Option<ChannelContentWork>, String> {
    let (start_time, end_time) = douyin_latest_work_window_millis();
    let params = vec![
        ("count", "10".to_string()),
        ("fields", "visibility,metrics,review".to_string()),
        ("status_list[]", "102".to_string()),
        ("status_list[]", "143".to_string()),
        ("start_time", start_time.to_string()),
        ("end_time", end_time.to_string()),
        ("need_long_article", "true".to_string()),
    ];
    let url = Url::parse_with_params(HOMEPAGE_LATEST_WORKS_API, params)
        .map_err(|error| format!("抖音最新作品地址无效: {error}"))?;
    let value = request_plugin_json(
        "GET",
        url.as_str(),
        cookie_header,
        CREATOR_HEADERS,
    )
    .await
    .map_err(|error| format!("抖音最新作品接口不可用: {error}"))?;
    ensure_douyin_response_success(&value, "抖音最新作品读取失败")?;

    let Some(item) = value
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
    else {
        return Ok(None);
    };
    let Some(mut work) = parse_douyin_work(item, account_id) else {
        return Ok(None);
    };
    apply_douyin_list_metrics(&mut work, Some(item));
    let _ = apply_douyin_work_detail(cookie_header, &mut work).await;
    Ok(Some(work))
}

fn douyin_latest_work_window_millis() -> (i64, i64) {
    let timezone = FixedOffset::east_opt(8 * 3600).expect("valid timezone");
    let today = Utc::now().with_timezone(&timezone).date_naive();
    let start_day = today.checked_sub_signed(Duration::days(30)).unwrap_or(today);
    let start_time = timezone
        .from_local_datetime(&start_day.and_hms_opt(0, 0, 0).expect("valid midnight"))
        .single()
        .expect("valid local time")
        .timestamp_millis();
    (start_time, Utc::now().timestamp_millis())
}

pub(super) async fn fetch_douyin_works_page(
    cookie_header: &str,
    account_id: &str,
    page_key: &str,
) -> Result<ChannelWorksPage, String> {
    let cursor = page_key.trim();
    let cursor = if cursor.is_empty() { "0" } else { cursor };
    let url = Url::parse_with_params(
        WORKS_LIST_API,
        [
            ("status", "0"),
            ("count", "12"),
            ("max_cursor", cursor),
            ("scene", "star_atlas"),
            ("device_platform", "android"),
            ("aid", "1128"),
        ],
    )
    .map_err(|error| format!("抖音作品列表地址无效: {error}"))?;
    let value = request_plugin_json(
        "GET",
        url.as_str(),
        cookie_header,
        DATA_WORKS_HEADERS,
    )
    .await
    .map_err(|error| format!("抖音作品列表接口不可用: {error}"))?;
    ensure_douyin_response_success(&value, "抖音作品列表读取失败")?;

    let detail_items = value.get("items").and_then(Value::as_array);
    let works = value
        .get("aweme_list")
        .or_else(|| value.get("items"))
        .or_else(|| value.get("item_list"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .filter_map(|(index, item)| {
                    let mut work = parse_douyin_work(item, account_id)?;
                    apply_douyin_list_metrics(
                        &mut work,
                        detail_items.and_then(|items| items.get(index)),
                    );
                    Some(work)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let has_more = value
        .get("has_more")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let next_page_key = if has_more {
        value
            .get("max_cursor")
            .and_then(value_to_text)
            .or_else(|| first_string_deep(&value, &["cursor"]))
            .filter(|value| !value.trim().is_empty() && value != "0")
    } else {
        None
    };

    Ok(ChannelWorksPage {
        account_id: account_id.to_string(),
        platform_id: "douyin".to_string(),
        page_key: page_key.trim().to_string(),
        work_type: None,
        next_page_key,
        has_more,
        works,
        updated_at: Some(Utc::now()),
        sync_status: "synced".to_string(),
        error: None,
    })
}

async fn fetch_douyin_overview(
    cookie_header: &str,
    account_id: &str,
    period_days: u16,
    now: DateTime<Utc>,
) -> Result<ChannelAccountOverview, String> {
    let value = request_plugin_json_with_body(
        "POST",
        OVERVIEW_DASHBOARD_API,
        cookie_header,
        DATA_OVERVIEW_HEADERS,
        Some(serde_json::json!({ "recent_days": period_days })),
    )
    .await
    .map_err(|error| format!("抖音总览接口不可用: {error}"))?;
    ensure_douyin_response_success(&value, "抖音总览读取失败")?;

    let data = value.get("data").unwrap_or(&value);
    Ok(ChannelAccountOverview {
        account_id: account_id.to_string(),
        platform_id: "douyin".to_string(),
        period_days,
        metrics: douyin_overview_metrics(data),
        summary: None,
        updated_at: Some(now),
        sync_status: "synced".to_string(),
        error: None,
    })
}

fn douyin_overview_metrics(data: &Value) -> Vec<ChannelOverviewMetric> {
    let metrics = data
        .get("metrics")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    [
        ("play_cnt", "播放量"),
        ("homepage_view_cnt", "主页访问"),
        ("digg_cnt", "作品点赞"),
        ("share_count", "作品分享"),
        ("comment_cnt", "作品评论"),
        ("cover_click_ratio", "封面点击率"),
        ("net_fans_cnt", "净增粉丝"),
        ("cancel_fans_cnt", "取关粉丝"),
        ("total_fans_cnt", "总粉丝量"),
    ]
    .into_iter()
    .map(|(key, label)| ChannelOverviewMetric {
        key: key.to_string(),
        label: metrics
            .iter()
            .find(|item| item.get("english_metric_name").and_then(Value::as_str) == Some(key))
            .and_then(|item| item.get("metric_name").and_then(Value::as_str))
            .filter(|text| !text.trim().is_empty())
            .unwrap_or(label)
            .to_string(),
        value: metrics
            .iter()
            .find(|item| item.get("english_metric_name").and_then(Value::as_str) == Some(key))
            .and_then(|item| douyin_dashboard_metric_value(item, key)),
        compare_label: None,
        trend: None,
        tone: None,
    })
    .collect()
}

fn douyin_dashboard_metric_value(metric: &Value, key: &str) -> Option<String> {
    let value = metric.get("metric_value")?;
    if key == "cover_click_ratio" {
        return value.as_f64().map(format_douyin_percent);
    }
    value_to_text(value)
}

fn format_douyin_percent(value: f64) -> String {
    if !value.is_finite() || value.abs() < f64::EPSILON {
        return "0".to_string();
    }
    let text = format!("{:.2}", value * 100.0);
    format!("{}%", text.trim_end_matches('0').trim_end_matches('.'))
}

async fn apply_douyin_work_detail(
    cookie_header: &str,
    work: &mut ChannelContentWork,
) -> Result<(), String> {
    let item_id = work.id.trim();
    if item_id.is_empty() {
        return Ok(());
    }
    let url = Url::parse_with_params(WORK_DETAIL_API, [("item_id", item_id)])
        .map_err(|error| format!("抖音作品详情地址无效: {error}"))?;
    let value = request_plugin_json(
        "GET",
        url.as_str(),
        cookie_header,
        WORK_DETAIL_HEADERS,
    )
    .await
    .map_err(|error| format!("抖音作品详情接口不可用: {error}"))?;
    ensure_douyin_response_success(&value, "抖音作品详情读取失败")?;

    let detail = value
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first());
    let legacy_detail = value
        .get("item_list")
        .and_then(Value::as_array)
        .and_then(|items| items.first());
    let metrics = detail.and_then(|value| value.get("metrics"));
    let statistics = legacy_detail.and_then(|value| value.get("statistics"));
    let summarize_data = legacy_detail.and_then(|value| value.get("summarize_data"));

    work.views = douyin_metric_count(metrics, "view_count")
        .or_else(|| first_count_optional(statistics, &["play_count"]))
        .or(work.views);
    work.likes = douyin_metric_count(metrics, "like_count")
        .or_else(|| first_count_optional(statistics, &["digg_count"]))
        .or(work.likes);
    work.comments = douyin_metric_count(metrics, "comment_count")
        .or_else(|| first_count_optional(statistics, &["comment_count"]))
        .or(work.comments);
    work.shares = douyin_metric_count(metrics, "share_count")
        .or_else(|| first_count_optional(statistics, &["share_count"]))
        .or(work.shares);
    work.collects = douyin_metric_count(metrics, "favorite_count")
        .or_else(|| first_count_optional(statistics, &["collect_count"]))
        .or(work.collects);
    work.cover_click_rate = douyin_metric_percent(metrics, "cover_click_rate")
        .or_else(|| work.cover_click_rate.clone());
    work.avg_view_time = douyin_seconds_value(metrics, "avg_view_second")
        .or_else(|| douyin_seconds_value(summarize_data, "play_avg_time"))
        .or_else(|| work.avg_view_time.clone());
    let gained_followers = douyin_metric_count(metrics, "subscribe_count")
        .or_else(|| first_count_optional(summarize_data, &["new_fans_count"]))
        .and_then(|value| i64::try_from(value).ok());
    work.gained_followers = gained_followers.or(work.gained_followers);
    work.data_updated_at = Some(Utc::now());
    if work.work_type.is_none() {
        work.work_type = detail
            .and_then(douyin_work_type)
            .or_else(|| legacy_detail.and_then(douyin_work_type));
    }
    work.metrics = douyin_latest_work_detail_metrics(
        work.work_type.as_deref(),
        metrics,
        statistics,
        summarize_data,
    );
    Ok(())
}

fn douyin_latest_work_detail_metrics(
    work_type: Option<&str>,
    metrics: Option<&Value>,
    statistics: Option<&Value>,
    summarize_data: Option<&Value>,
) -> Vec<ChannelWorkMetric> {
    let mut items = douyin_metrics_from_specs(metrics, statistics, DOUYIN_LATEST_WORK_BASE_METRICS);
    match work_type {
        Some("video") => items.extend(douyin_metrics_from_specs(
            metrics,
            summarize_data,
            DOUYIN_LATEST_VIDEO_METRICS,
        )),
        Some("article") | Some("image") | Some("note") => {
            items.extend(douyin_metrics_from_specs(
                metrics,
                summarize_data,
                DOUYIN_LATEST_ARTICLE_METRICS,
            ));
        }
        _ => items.extend(douyin_metrics_from_specs(
            metrics,
            None,
            DOUYIN_LATEST_FALLBACK_METRICS,
        )),
    }
    items
}

#[derive(Clone, Copy)]
enum DouyinMetricValueKind {
    Count,
    Percent,
    Number,
    Seconds,
}

#[derive(Clone, Copy)]
struct DouyinMetricSpec {
    key: &'static str,
    label: &'static str,
    metric_key: &'static str,
    value_kind: DouyinMetricValueKind,
    fallback_key: Option<&'static str>,
}

impl DouyinMetricSpec {
    const fn count(
        key: &'static str,
        label: &'static str,
        metric_key: &'static str,
        fallback_key: Option<&'static str>,
    ) -> Self {
        Self {
            key,
            label,
            metric_key,
            value_kind: DouyinMetricValueKind::Count,
            fallback_key,
        }
    }

    const fn percent(
        key: &'static str,
        label: &'static str,
        metric_key: &'static str,
        fallback_key: Option<&'static str>,
    ) -> Self {
        Self {
            key,
            label,
            metric_key,
            value_kind: DouyinMetricValueKind::Percent,
            fallback_key,
        }
    }

    const fn number(
        key: &'static str,
        label: &'static str,
        metric_key: &'static str,
    ) -> Self {
        Self {
            key,
            label,
            metric_key,
            value_kind: DouyinMetricValueKind::Number,
            fallback_key: None,
        }
    }

    const fn seconds(
        key: &'static str,
        label: &'static str,
        metric_key: &'static str,
        fallback_key: Option<&'static str>,
    ) -> Self {
        Self {
            key,
            label,
            metric_key,
            value_kind: DouyinMetricValueKind::Seconds,
            fallback_key,
        }
    }
}

const DOUYIN_LATEST_WORK_BASE_METRICS: &[DouyinMetricSpec] = &[
    DouyinMetricSpec::count("play", "播放量", "view_count", Some("play_count")),
    DouyinMetricSpec::count("like", "点赞量", "like_count", Some("digg_count")),
    DouyinMetricSpec::count("comment", "评论量", "comment_count", Some("comment_count")),
    DouyinMetricSpec::count("share", "分享量", "share_count", Some("share_count")),
    DouyinMetricSpec::count("favorite", "收藏量", "favorite_count", Some("collect_count")),
];

const DOUYIN_LATEST_VIDEO_METRICS: &[DouyinMetricSpec] = &[
    DouyinMetricSpec::count("danmaku", "弹幕量", "danmaku_count", None),
    DouyinMetricSpec::percent("completionRate", "完播率", "completion_rate", Some("play_finish_ratio")),
    DouyinMetricSpec::percent("bounceRate", "2s跳出率", "bounce_rate_2s", None),
    DouyinMetricSpec::seconds("avgViewSecond", "平均播放时长", "avg_view_second", Some("play_avg_time")),
    DouyinMetricSpec::percent("completionRate5s", "5s完播率", "completion_rate_5s", None),
    DouyinMetricSpec::percent("avgViewProportion", "平均播放占比", "avg_view_proportion", None),
    DouyinMetricSpec::count("subscribe", "涨粉量", "subscribe_count", Some("new_fans_count")),
    DouyinMetricSpec::percent("subscribeRate", "涨粉率", "subscribe_rate", None),
    DouyinMetricSpec::count("unsubscribe", "脱粉量", "unsubscribe_count", None),
    DouyinMetricSpec::percent("unsubscribeRate", "脱粉率", "unsubscribe_rate", None),
    DouyinMetricSpec::count("dislike", "不感兴趣量", "dislike_count", None),
    DouyinMetricSpec::percent("dislikeRate", "不感兴趣率", "dislike_rate", None),
];

const DOUYIN_LATEST_ARTICLE_METRICS: &[DouyinMetricSpec] = &[
    DouyinMetricSpec::percent("descriptionSpreadRate", "文案展开率", "description_spread_rate", None),
    DouyinMetricSpec::number("imageAvgViewCount", "平均浏览图片数", "image_avg_view_count"),
    DouyinMetricSpec::percent("coverClickRate", "封面点击率", "cover_click_rate", None),
    DouyinMetricSpec::percent(
        "descriptionCompletionRate",
        "文案完读率",
        "description_completion_rate",
        None,
    ),
    DouyinMetricSpec::percent("commentEntryRate", "评论进入率", "comment_entry_rate", None),
    DouyinMetricSpec::percent("likeRate", "点赞率", "like_rate", None),
    DouyinMetricSpec::percent("commentRate", "评论率", "comment_rate", None),
    DouyinMetricSpec::count("download", "下载量", "download_count", None),
    DouyinMetricSpec::percent("favoriteRate", "收藏率", "favorite_rate", None),
    DouyinMetricSpec::percent("shareRate", "分享率", "share_rate", None),
    DouyinMetricSpec::percent("dislikeRate", "不感兴趣率", "dislike_rate", None),
    DouyinMetricSpec::count("subscribe", "涨粉量", "subscribe_count", Some("new_fans_count")),
];

const DOUYIN_LATEST_FALLBACK_METRICS: &[DouyinMetricSpec] = &[
    DouyinMetricSpec::percent("descriptionSpreadRate", "文案展开率", "description_spread_rate", None),
    DouyinMetricSpec::percent("bounceRate", "划走率", "bounce_rate_2s", None),
];

const DOUYIN_WORK_ARTICLE_METRICS: &[DouyinMetricSpec] = &[
    DouyinMetricSpec::percent("descriptionSpreadRate", "文案展开率", "description_spread_rate", None),
    DouyinMetricSpec::number("imageAvgViewCount", "平均浏览图片", "image_avg_view_count"),
];

const DOUYIN_WORK_VIDEO_METRICS: &[DouyinMetricSpec] = &[
    DouyinMetricSpec::seconds("avgViewSecond", "平均播放时长", "avg_view_second", None),
    DouyinMetricSpec::percent("completionRate", "完播率", "completion_rate", None),
];

const DOUYIN_WORK_FALLBACK_METRICS: &[DouyinMetricSpec] = &[
    DouyinMetricSpec::percent("descriptionSpreadRate", "文案展开率", "description_spread_rate", None),
];

fn douyin_metrics_from_specs(
    metrics: Option<&Value>,
    fallback: Option<&Value>,
    specs: &[DouyinMetricSpec],
) -> Vec<ChannelWorkMetric> {
    specs
        .iter()
        .map(|spec| douyin_metric_from_spec(metrics, fallback, spec))
        .collect()
}

fn douyin_metric_from_spec(
    metrics: Option<&Value>,
    fallback: Option<&Value>,
    spec: &DouyinMetricSpec,
) -> ChannelWorkMetric {
    let value = match spec.value_kind {
        DouyinMetricValueKind::Count => douyin_metric_count(metrics, spec.metric_key)
            .or_else(|| spec.fallback_key.and_then(|key| first_count_optional(fallback, &[key])))
            .map(|value| value.to_string()),
        DouyinMetricValueKind::Percent => douyin_metric_percent(metrics, spec.metric_key)
            .or_else(|| spec.fallback_key.and_then(|key| douyin_metric_percent(fallback, key))),
        DouyinMetricValueKind::Number => douyin_metric_number_text(metrics, spec.metric_key)
            .or_else(|| spec.fallback_key.and_then(|key| douyin_metric_number_text(fallback, key))),
        DouyinMetricValueKind::Seconds => douyin_seconds_value(metrics, spec.metric_key)
            .or_else(|| spec.fallback_key.and_then(|key| douyin_seconds_value(fallback, key))),
    };
    douyin_work_metric(spec.key, spec.label, value)
}

fn douyin_work_metric(key: &str, label: &str, value: Option<String>) -> ChannelWorkMetric {
    ChannelWorkMetric {
        key: key.to_string(),
        label: label.to_string(),
        value,
    }
}

fn douyin_metric_count(metrics: Option<&Value>, key: &str) -> Option<u64> {
    metrics
        .and_then(|value| value.get(key))
        .and_then(douyin_metric_number)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value.round() as u64)
}

fn douyin_metric_percent(metrics: Option<&Value>, key: &str) -> Option<String> {
    metrics
        .and_then(|value| value.get(key))
        .and_then(douyin_metric_number)
        .map(format_douyin_detail_percent)
}

fn douyin_metric_number_text(metrics: Option<&Value>, key: &str) -> Option<String> {
    metrics
        .and_then(|value| value.get(key))
        .and_then(douyin_metric_number)
        .map(format_douyin_number)
}

fn douyin_seconds_value(metrics: Option<&Value>, key: &str) -> Option<String> {
    metrics
        .and_then(|value| value.get(key))
        .and_then(douyin_metric_number)
        .map(format_douyin_seconds)
}

fn douyin_metric_number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse::<f64>().ok())
}

fn first_count_optional(value: Option<&Value>, keys: &[&str]) -> Option<u64> {
    value.and_then(|value| first_count(value, keys))
}

fn format_douyin_detail_percent(value: f64) -> String {
    if !value.is_finite() {
        return "-".to_string();
    }
    format!("{:.2}%", value * 100.0)
}

fn format_douyin_seconds(value: f64) -> String {
    if !value.is_finite() {
        return "-".to_string();
    }
    let text = if value >= 1.0 {
        format_douyin_number(value.round())
    } else {
        format_douyin_number(value)
    };
    format!("{text}秒")
}

fn format_douyin_number(value: f64) -> String {
    if !value.is_finite() {
        return "-".to_string();
    }
    if (value.fract()).abs() < 0.000_001 {
        return format!("{}", value.round() as i64);
    }
    let text = format!("{:.2}", value);
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn parse_douyin_work(value: &Value, account_id: &str) -> Option<ChannelContentWork> {
    let id = first_string_or_number_deep(value, WORK_ID_KEYS)?;
    let title = first_string_deep(value, WORK_TITLE_KEYS)
        .unwrap_or_else(|| "未命名作品".to_string());
    let views = first_count(value, WORK_VIEW_KEYS);
    let likes = first_count(value, WORK_LIKE_KEYS);
    let comments = first_count(value, WORK_COMMENT_KEYS);
    let shares = first_count(value, WORK_SHARE_KEYS);
    let collects = first_count(value, WORK_COLLECT_KEYS);
    let work_type = douyin_work_type(value);

    Some(ChannelContentWork {
        id: id.clone(),
        platform_id: "douyin".to_string(),
        account_id: account_id.to_string(),
        title,
        cover_url: first_profile_image(value, WORK_COVER_KEYS)
            .map(|url| normalize_platform_image_url("douyin", url)),
        link: first_string_deep(value, WORK_LINK_KEYS),
        published_at: first_time_deep(value, WORK_TIME_KEYS),
        status: "published".to_string(),
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
        metrics: douyin_work_metrics(
            work_type.as_deref(),
            views,
            likes,
            comments,
            collects,
            shares,
            None,
        ),
        badges: douyin_work_badges(value),
        work_type,
    })
}

fn apply_douyin_list_metrics(work: &mut ChannelContentWork, detail: Option<&Value>) {
    if work.work_type.is_none() {
        work.work_type = detail.and_then(douyin_work_type);
    }
    let metrics = detail.and_then(|value| value.get("metrics"));
    work.views = douyin_metric_count(metrics, "view_count").or(work.views);
    work.likes = douyin_metric_count(metrics, "like_count").or(work.likes);
    work.comments = douyin_metric_count(metrics, "comment_count").or(work.comments);
    work.shares = douyin_metric_count(metrics, "share_count").or(work.shares);
    work.collects = douyin_metric_count(metrics, "favorite_count").or(work.collects);
    work.cover_click_rate = douyin_metric_percent(metrics, "cover_click_rate")
        .or_else(|| work.cover_click_rate.clone());
    work.metrics = douyin_work_metrics(
        work.work_type.as_deref(),
        work.views,
        work.likes,
        work.comments,
        work.collects,
        work.shares,
        metrics,
    );
    if let Some(detail) = detail {
        for badge in douyin_work_badges(detail) {
            push_unique_badge(&mut work.badges, badge);
        }
    }
}

fn douyin_work_badges(value: &Value) -> Vec<String> {
    let mut badges = Vec::new();
    if first_bool_deep(value, &["is_top", "isTop", "is_pinned", "isPinned", "is_stick", "isStick", "top"])
        .unwrap_or(false)
    {
        push_unique_badge(&mut badges, "置顶");
    }
    if let Some(label) = first_string_deep(
        value,
        &["label_top_text", "labelTopText", "top_label", "topLabel", "tag_text", "tagText"],
    )
    .filter(|label| label.contains("置顶"))
    {
        push_unique_badge(&mut badges, label);
    }
    if let Some(label) = douyin_visibility_badge(value) {
        push_unique_badge(&mut badges, label);
    }
    badges
}

fn douyin_visibility_badge(value: &Value) -> Option<String> {
    first_string_or_number_deep(
        value,
        &[
            "visibility",
            "visible_status",
            "visibleStatus",
            "private_status",
            "privateStatus",
            "private_type",
            "privateType",
        ],
    )
    .and_then(|value| visibility_label(&value))
}

fn first_bool_deep(value: &Value, keys: &[&str]) -> Option<bool> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(value) = map.get(*key).and_then(value_to_bool) {
                    return Some(value);
                }
            }
            map.values().find_map(|value| first_bool_deep(value, keys))
        }
        Value::Array(items) => items.iter().find_map(|value| first_bool_deep(value, keys)),
        _ => None,
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

fn visibility_label(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let lower = value.to_ascii_lowercase();
    if value.contains("公开") || lower.contains("public") {
        return Some("公开".to_string());
    }
    if value.contains("仅自己") || value.contains("私密") || lower.contains("private") {
        return Some("仅自己可见".to_string());
    }
    if value.contains("好友") || lower.contains("friend") {
        return Some("好友可见".to_string());
    }
    match value {
        "0" => Some("公开".to_string()),
        "1" => Some("仅自己可见".to_string()),
        "2" => Some("好友可见".to_string()),
        "3" => Some("部分可见".to_string()),
        _ if value.chars().count() <= 12 => Some(value.to_string()),
        _ => None,
    }
}

fn push_unique_badge(badges: &mut Vec<String>, label: impl Into<String>) {
    let label = label.into().trim().to_string();
    if !label.is_empty() && !badges.iter().any(|item| item == &label) {
        badges.push(label);
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

fn douyin_work_metrics(
    work_type: Option<&str>,
    views: Option<u64>,
    likes: Option<u64>,
    comments: Option<u64>,
    collects: Option<u64>,
    shares: Option<u64>,
    detail_metrics: Option<&Value>,
) -> Vec<ChannelWorkMetric> {
    let mut metrics = vec![
        douyin_count_value_metric("play", "播放", views),
        douyin_count_value_metric("like", "点赞", likes),
        douyin_count_value_metric("comment", "评论", comments),
        douyin_count_value_metric("collect", "收藏", collects),
    ];

    match work_type {
        Some("article") | Some("image") | Some("note") => {
            metrics.extend(douyin_metrics_from_specs(
                detail_metrics,
                None,
                DOUYIN_WORK_ARTICLE_METRICS,
            ));
        }
        Some("video") => {
            metrics.extend(douyin_metrics_from_specs(
                detail_metrics,
                None,
                DOUYIN_WORK_VIDEO_METRICS,
            ));
        }
        _ => {
            metrics.push(douyin_count_value_metric("share", "分享", shares));
            metrics.extend(douyin_metrics_from_specs(
                detail_metrics,
                None,
                DOUYIN_WORK_FALLBACK_METRICS,
            ));
        }
    }

    metrics
}

fn douyin_count_value_metric(key: &str, label: &str, value: Option<u64>) -> ChannelWorkMetric {
    douyin_work_metric(key, label, value.map(|value| value.to_string()))
}

fn douyin_work_type(value: &Value) -> Option<String> {
    if first_bool_deep(value, &["is_pic_word", "isPicWord", "is_slides", "isSlides"])
        .unwrap_or(false)
    {
        return Some("article".to_string());
    }

    if let Some(media_type) = first_i64(value, &["media_type", "mediaType"]) {
        return match media_type {
            2 => Some("article".to_string()),
            0 | 1 | 4 => Some("video".to_string()),
            _ => None,
        };
    }

    if let Some(content_type) = first_i64(
        value,
        &["content_type", "contentType", "item_type", "itemType", "type"],
    ) {
        return match content_type {
            1 | 68 => Some("article".to_string()),
            0 | 2 | 4 => Some("video".to_string()),
            _ => None,
        };
    }

    if let Some(aweme_type) = first_i64(value, &["aweme_type", "awemeType"]) {
        return match aweme_type {
            2 => Some("article".to_string()),
            0 | 4 => Some("video".to_string()),
            _ => None,
        };
    }

    if first_count(value, &["picture_count", "pictureCount"])
        .or_else(|| value.get("picture_info").and_then(|value| first_count(value, &["count"])))
        .unwrap_or(0)
        > 0
    {
        return Some("article".to_string());
    }

    if value.get("video").is_some() || value.get("video_info").is_some() {
        return Some("video".to_string());
    }

    None
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
        _ => None,
    }
}

fn first_time_deep(value: &Value, keys: &[&str]) -> Option<DateTime<Utc>> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(time) = map.get(*key).and_then(time_from_value) {
                    return Some(time);
                }
            }
            map.values().find_map(|value| first_time_deep(value, keys))
        }
        Value::Array(items) => items.iter().find_map(|value| first_time_deep(value, keys)),
        _ => None,
    }
}

fn time_from_value(value: &Value) -> Option<DateTime<Utc>> {
    if let Some(seconds) = value.as_i64() {
        let seconds = if seconds > 10_000_000_000 { seconds / 1000 } else { seconds };
        return DateTime::from_timestamp(seconds, 0);
    }

    let text = value.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    let text = text.strip_prefix("发布于").unwrap_or(text).trim();
    if let Ok(value) = NaiveDateTime::parse_from_str(text, "%Y年%m月%d日 %H:%M") {
        return FixedOffset::east_opt(8 * 3600)?
            .from_local_datetime(&value)
            .single()
            .map(|value| value.with_timezone(&Utc));
    }
    if let Ok(value) = NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M"))
    {
        return FixedOffset::east_opt(8 * 3600)?
            .from_local_datetime(&value)
            .single()
            .map(|value| value.with_timezone(&Utc));
    }
    DateTime::parse_from_rfc3339(text)
        .map(|value| value.with_timezone(&Utc))
        .ok()
}

fn douyin_error_message(value: &Value, fallback: &str) -> String {
    first_string_deep(value, &["status_msg", "status_message", "message", "msg"])
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn douyin_response_success(value: &Value) -> bool {
    first_i64(value, &["status_code", "code", "errCode", "errcode"])
        .map(|code| code == 0)
        .unwrap_or(true)
}

fn ensure_douyin_response_success(value: &Value, fallback: &str) -> Result<(), String> {
    if douyin_response_success(value) {
        Ok(())
    } else {
        Err(douyin_error_message(value, fallback))
    }
}

pub(crate) fn has_douyin_login_cookie(login_cookie: &str) -> bool {
    let Some(platform) = crate::platforms::platform("douyin") else {
        return false;
    };
    login_cookie_to_header(login_cookie).split(';').any(|pair| {
        let Some((name, value)) = pair.trim().split_once('=') else {
            return false;
        };
        !value.trim().is_empty() && platform.is_login_cookie_name(name)
    })
}
