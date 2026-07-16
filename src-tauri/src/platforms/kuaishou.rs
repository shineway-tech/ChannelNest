use super::*;
use chrono::{NaiveDateTime, TimeZone};
use rquickjs::{context::EvalOptions, CatchResultExt, Context, Runtime};
use std::{
    cell::RefCell,
    fs::File,
    io::Read,
    path::Path,
    time::Duration,
};

const COOKIE_DOMAINS: &[DomainRule] = &[
    DomainRule {
        host: "kuaishou.com",
        include_subdomains: true,
    },
    DomainRule {
        host: "kwai.com",
        include_subdomains: true,
    },
];

const COOKIE_URLS: &[&str] = &[
    "https://www.kuaishou.com/",
    "https://kuaishou.com/",
    "https://cp.kuaishou.com/",
    "https://id.kuaishou.com/",
    "https://passport.kuaishou.com/",
];

pub(super) const LOGIN_URL: &str = "https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api&indexPage=login-qrcode&callback=https%3A%2F%2Fcp.kuaishou.com%2Frest%2Finfra%2Fsts%3FfollowUrl%3Dhttps%253A%252F%252Fcp.kuaishou.com%252Fprofile%26setRootDomain%3Dtrue";
const HOME_USER_INFO_API: &str = "https://cp.kuaishou.com/rest/cp/creator/pc/home/userInfo";
const HOME_INFO_V2_API: &str = "https://cp.kuaishou.com/rest/cp/creator/pc/home/infoV2";
const CREATOR_HOME_URL: &str = "https://cp.kuaishou.com/profile";
pub(crate) const STATISTICS_WORKS_URL: &str = "https://cp.kuaishou.com/statistics/works";
pub(crate) const STATISTICS_ARTICLE_URL: &str = "https://cp.kuaishou.com/statistics/article";
const ARTICLE_MANAGE_VIDEO_URL: &str = "https://cp.kuaishou.com/article/manage/video";
const ARTICLE_PUBLISH_VIDEO_URL: &str = "https://cp.kuaishou.com/article/publish/video";
const ARTICLE_PUBLISH_ATLAS_URL: &str = "https://cp.kuaishou.com/article/publish/article";
pub(crate) const AUTHOR_OVERVIEW_API: &str = "https://cp.kuaishou.com/rest/cp/creator/analysis/pc/author/overview";
pub(crate) const ARTICLE_PHOTO_LIST_API: &str = "https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/list";
pub(crate) const ARTICLE_SINGLE_INFO_API: &str = "https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/single/info";
pub(crate) const ARTICLE_SINGLE_OVERVIEW_API: &str = "https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/single/overview";
const ARTICLE_MANAGE_VIDEO_LIST_API: &str = "https://cp.kuaishou.com/rest/cp/works/v2/video/pc/photo/list";
const VIDEO_UPLOAD_PRE_API: &str = "https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/pre";
const VIDEO_UPLOAD_FINISH_API: &str =
    "https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/finish";
const VIDEO_SUBMIT_API: &str = "https://cp.kuaishou.com/rest/cp/works/v2/video/pc/submit";
const ATLAS_UPLOAD_PRE_API: &str = "https://cp.kuaishou.com/rest/cp/works/atlas/pc/upload/pre";
const ATLAS_UPLOAD_SINGLE_FINISH_API: &str = "https://cp.kuaishou.com/rest/cp/works/atlas/pc/upload/single/finish";
const ATLAS_UPLOAD_FINISH_API: &str = "https://cp.kuaishou.com/rest/cp/works/atlas/pc/upload/finish";
const ATLAS_PUBLISH_SUBMIT_API: &str = "https://cp.kuaishou.com/rest/cp/works/atlas/pc/publish/submit";
const KUAISHOU_ENCODER_JS: &str =
    include_str!("../../resources/kuaishou-signer/kuaishou_encoder_75407.js");
const KUAISHOU_DIRECT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0";
const KUAISHOU_UPLOAD_CHUNK_SIZE: u64 = 4 * 1024 * 1024;
const KUAISHOU_MAX_IMAGE_COUNT: usize = 31;
const KUAISHOU_MAX_IMAGE_BYTES: u64 = 15 * 1024 * 1024;
const KUAISHOU_MAX_VIDEO_BYTES: u64 = 12 * 1024 * 1024 * 1024;
const KUAISHOU_MAX_VIDEO_DURATION_SECONDS: f64 = 60.0 * 60.0;
const KUAISHOU_MAX_VIDEO_DURATION_MILLIS: i64 = 60 * 60 * 1000;
const KUAISHOU_MIN_SCHEDULE_DELAY_SECONDS: i64 = 60 * 60;
const KUAISHOU_MAX_SCHEDULE_DELAY_SECONDS: i64 = 14 * 24 * 60 * 60;
const KUAISHOU_MANAGEMENT_WORKS_PAGE_SIZE: i64 = 30;
const KUAISHOU_MANAGE_CURSOR_START: i64 = 1_893_456_000_000;
const KUAISHOU_MANAGE_TIME_RANGE_ALL: i64 = 5;
const KUAISHOU_MANAGE_ALL_DAYS: i64 = 365;
const MILLIS_PER_DAY: i64 = 86_400_000;
const KUAISHOU_API_PH_COOKIE_NAME: &str = "kuaishou.web.cp.api_ph";
const KUAISHOU_ENCODER_BOOTSTRAP_PREFIX: &str = r#"
var window = globalThis;
var console = globalThis.console || {
  log: function () {},
  warn: function () {},
  error: function () {}
};
var __ksEncoderModule = { exports: {} };
("#;
const KUAISHOU_ENCODER_BOOTSTRAP_SUFFIX: &str = r#")(__ksEncoderModule);
function __ksEncode(input) {
  var result = null;
  var encodeError = null;
  __ksEncoderModule.exports.call("$encode", [
    String(input),
    {
      suc: function (value) { result = String(value); },
      err: function (error) { encodeError = String(error); }
    }
  ]);
  if (encodeError) {
    throw new Error(encodeError);
  }
  return result;
}
"#;
const HOME_INFO_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://cp.kuaishou.com"),
    ("Referer", CREATOR_HOME_URL),
];
const STATISTICS_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://cp.kuaishou.com"),
    ("Referer", STATISTICS_WORKS_URL),
];
const STATISTICS_ARTICLE_HEADERS: &[(&str, &str)] = &[
    ("Origin", "https://cp.kuaishou.com"),
    ("Referer", STATISTICS_ARTICLE_URL),
];

const LOGIN_COOKIE_NAMES: &[&str] = &[
    "kuaishou.web.cp.api_st",
    "kuaishou.web.cp.api_ph",
    "passToken",
    "userId",
    "bUserId",
];
const LOGIN_REQUIRED_COOKIE_NAME: &str = "kuaishou.web.cp.api_st";
const RESPONSE_CODE_KEYS: &[&str] = &["result", "code", "errCode", "errcode"];
const UID_KEYS: &[&str] = &[
    "userKwaiId",
    "kwaiId",
    "kuaishouId",
    "userId",
    "id",
    "uid",
];
const NICKNAME_KEYS: &[&str] = &[
    "userName",
    "user_name",
    "nickname",
    "nickName",
    "name",
    "displayName",
];
const AVATAR_KEYS: &[&str] = &[
    "userAvatar",
    "userHead",
    "userHeadUrl",
    "avatar",
    "avatarUrl",
    "avatar_url",
    "avatarUri",
    "avatar_uri",
    "head",
    "headUrl",
    "head_url",
    "headurl",
    "headUrls",
    "head_urls",
    "profileImageUrl",
    "profile_image_url",
];
const FOLLOWER_COUNT_KEYS: &[&str] = &["fansCnt", "fansNum", "fansCount", "fans", "followers"];
const FOLLOWING_COUNT_KEYS: &[&str] = &[
    "followCnt",
    "followNum",
    "followCount",
    "followingCount",
    "following",
    "followings",
    "attentionCount",
];
const LIKE_COUNT_KEYS: &[&str] = &["likeCnt", "likeCount", "likes"];
const WORK_COVER_KEYS: &[&str] = &[
    "cover",
    "coverUrl",
    "cover_url",
    "publishCoverUrl",
    "thumbnail",
    "image",
    "images",
];

#[derive(serde::Serialize)]
struct KuaishouManagementWorksBody<'a> {
    #[serde(rename = "queryType")]
    query_type: &'static str,
    cursor: Value,
    #[serde(rename = "startTime")]
    start_time: i64,
    #[serde(rename = "endTime")]
    end_time: i64,
    limit: i64,
    #[serde(rename = "timeRangeType")]
    time_range_type: i64,
    keyword: &'static str,
    #[serde(rename = "kuaishou.web.cp.api_ph")]
    api_ph: &'a str,
}

struct KuaishouEncoderRuntime {
    _runtime: Runtime,
    context: Context,
}

thread_local! {
    static KUAISHOU_ENCODER_RUNTIME: RefCell<Option<KuaishouEncoderRuntime>> = const { RefCell::new(None) };
}

pub(super) static SPEC: ChannelPlatform = ChannelPlatform {
    id: "kuaishou",
    name: "快手",
    slug: "KS",
    color: "#ff4906",
    description: "添加并管理多个快手账号。",
    creator_home_url: CREATOR_HOME_URL,
    cookie_urls: COOKIE_URLS,
    default_cookie_domain: ".kuaishou.com",
    cookie_domains: COOKIE_DOMAINS,
    login_cookie_names: &[],
    homepage_kind: HomepageKind::KuaishouProfileOrSearch,
    plugin_auth: true,
    materialize_avatar: true,
    avatar_referer: Some("https://www.kuaishou.com/"),
    avatar_origin: Some("https://www.kuaishou.com"),
};

pub(crate) fn has_kuaishou_creator_login_cookie_header(cookie_header: &str) -> bool {
    let mut has_login_cookie = false;
    let mut has_required_cookie = false;

    for pair in cookie_header.split(';') {
        let Some((name, value)) = pair.trim().split_once('=') else {
            continue;
        };
        let name = name.trim();
        if value.trim().is_empty() {
            continue;
        }
        if name == LOGIN_REQUIRED_COOKIE_NAME {
            has_required_cookie = true;
        }
        if LOGIN_COOKIE_NAMES.iter().any(|item| item == &name) {
            has_login_cookie = true;
        }
        if has_login_cookie && has_required_cookie {
            return true;
        }
    }

    false
}

pub(super) async fn fetch_kuaishou_creator_account_from_cookie(
    cookie_header: &str,
    login_cookie: String,
) -> Result<PluginAccountInfo, String> {
    let mut primary_profile = None;
    let mut first_error = None;

    match request_kuaishou_home_info_v2(cookie_header).await {
        Ok(value) => match parse_kuaishou_creator_account(value, login_cookie.clone()).await {
            Ok(profile)
                if !profile.avatar.trim().is_empty()
                    && !kuaishou_profile_is_cookie_fallback(&profile) =>
            {
                return Ok(profile);
            }
            Ok(profile) => primary_profile = Some(profile),
            Err(error) => first_error = Some(error),
        },
        Err(error) => first_error = Some(error),
    }

    match request_plugin_json(
        "POST",
        HOME_USER_INFO_API,
        cookie_header,
        HOME_INFO_HEADERS,
    )
    .await
    {
        Ok(value) => match parse_kuaishou_creator_account(value, login_cookie).await {
            Ok(profile) => Ok(match primary_profile {
                Some(primary) => merge_kuaishou_profiles(primary, profile),
                None => profile,
            }),
            Err(error) => primary_profile
                .map(Ok)
                .unwrap_or_else(|| Err(first_error.unwrap_or(error))),
        },
        Err(error) => primary_profile
            .map(Ok)
            .unwrap_or_else(|| Err(first_error.unwrap_or_else(|| {
                format!("快手创作者中心账号接口不可用: {error}")
            }))),
    }
}

async fn request_kuaishou_home_info_v2(cookie_header: &str) -> Result<Value, String> {
    request_kuaishou_signed_json(
        HOME_INFO_V2_API,
        cookie_header,
        CREATOR_HOME_URL,
        serde_json::json!({}),
        Duration::from_secs(12),
        "快手创作者中心账号接口",
    )
    .await
}

pub(super) async fn fetch_kuaishou_account_content(
    cookie_header: &str,
    login_cookie: String,
    account_id: &str,
) -> Result<ChannelAccountContent, String> {
    fetch_kuaishou_account_content_with_profile(cookie_header, login_cookie, account_id, None).await
}

pub(crate) async fn fetch_kuaishou_account_content_with_profile(
    cookie_header: &str,
    login_cookie: String,
    account_id: &str,
    profile: Option<PluginAccountInfo>,
) -> Result<ChannelAccountContent, String> {
    let now = Utc::now();
    let profile = match profile {
        Some(profile) => profile,
        None => fetch_kuaishou_creator_account_from_cookie(cookie_header, login_cookie).await?,
    };
    let (
        overview_seven_result,
        overview_thirty_result,
        overview_ninety_result,
        latest_work_result,
    ) = tokio::join!(
        fetch_kuaishou_overview(cookie_header, account_id, 7, 1, now),
        fetch_kuaishou_overview(cookie_header, account_id, 30, 2, now),
        fetch_kuaishou_overview(cookie_header, account_id, 90, 3, now),
        fetch_kuaishou_latest_work(cookie_header, account_id),
    );
    let overview_seven = overview_seven_result?;
    let overview_thirty = overview_thirty_result?;
    let overview_ninety = overview_ninety_result?;
    let latest_work = latest_work_result.unwrap_or(None);

    Ok(ChannelAccountContent {
        account_id: account_id.to_string(),
        platform_id: "kuaishou".to_string(),
        profile: Some(plugin_account_profile_snapshot(account_id, "kuaishou", &profile)),
        overview_seven: Some(overview_seven),
        overview_thirty: Some(overview_thirty),
        overview_ninety: Some(overview_ninety),
        latest_work: latest_work.clone(),
        latest_work_seven: latest_work.clone(),
        latest_work_thirty: latest_work,
        sync_status: "synced".to_string(),
        ..Default::default()
    })
}

pub(super) async fn fetch_kuaishou_works_page(
    cookie_header: &str,
    account_id: &str,
    page_key: &str,
) -> Result<ChannelWorksPage, String> {
    let value = request_kuaishou_management_json(cookie_header, page_key).await?;
    parse_kuaishou_management_works_page(value, account_id, page_key)
}

pub(crate) async fn publish_kuaishou_work(
    cookie_header: &str,
    content_type: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    match content_type.trim() {
        "video" => publish_kuaishou_video_work(cookie_header, target).await,
        "article" => publish_kuaishou_atlas_work(cookie_header, target).await,
        _ => Err("快手暂不支持当前作品类型。".to_string()),
    }
}

async fn publish_kuaishou_video_work(
    cookie_header: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    let media = kuaishou_video_media(target)?;
    let meta = kuaishou_media_meta(media)?;
    ensure_kuaishou_video_meta(&meta)?;
    let caption = kuaishou_caption(target)?;
    let publish_time = kuaishou_publish_time(target)?;
    let photo_status = kuaishou_photo_status(&target.visibility);

    let pre = request_kuaishou_publish_json(
        VIDEO_UPLOAD_PRE_API,
        cookie_header,
        ARTICLE_PUBLISH_VIDEO_URL,
        serde_json::json!({ "uploadType": 1 }),
    )
    .await?;
    ensure_kuaishou_publish_success(&pre, "快手视频上传初始化失败")?;

    let pre_data = pre.get("data").unwrap_or(&pre);
    let token = kuaishou_value_text(pre_data, &["token", "uploadToken"])
        .ok_or_else(|| "快手视频上传初始化失败: 缺少 upload token".to_string())?;
    let endpoints = kuaishou_upload_endpoints(pre_data)
        .ok_or_else(|| "快手视频上传初始化失败: 缺少上传节点".to_string())?;
    upload_kuaishou_storage_file(&media.path, meta.size, &token, &endpoints).await?;

    let finish = request_kuaishou_publish_json(
        VIDEO_UPLOAD_FINISH_API,
        cookie_header,
        ARTICLE_PUBLISH_VIDEO_URL,
        serde_json::json!({
            "token": token,
            "fileName": meta.name,
            "fileType": meta.mime_type,
            "fileLength": meta.size,
        }),
    )
    .await?;
    ensure_kuaishou_publish_success(&finish, "快手视频上传完成确认失败")?;

    let finish_data = finish.get("data").unwrap_or(&finish);
    let file_id = kuaishou_value_text(finish_data, &["fileId"])
        .or_else(|| kuaishou_value_text(pre_data, &["fileId"]))
        .ok_or_else(|| "快手视频上传完成确认失败: 缺少 fileId".to_string())?;
    let cover_key = kuaishou_value_text(finish_data, &["coverKey"]).unwrap_or_default();
    let media_id = kuaishou_value_text(finish_data, &["mediaId"]).unwrap_or_default();
    let cover_media_id = kuaishou_value_text(finish_data, &["coverMediaId"]).unwrap_or_default();
    let width = first_i64(finish_data, &["width", "videoWidth"]).unwrap_or(0);
    let height = first_i64(finish_data, &["height", "videoHeight"]).unwrap_or(0);
    let duration = first_i64(finish_data, &["videoDuration", "duration"]).unwrap_or(0);
    if duration > KUAISHOU_MAX_VIDEO_DURATION_MILLIS {
        return Err("快手视频时长最长支持 1 小时。".to_string());
    }

    let submit = request_kuaishou_publish_json(
        VIDEO_SUBMIT_API,
        cookie_header,
        ARTICLE_PUBLISH_VIDEO_URL,
        serde_json::json!({
            "fileId": file_id,
            "coverKey": cover_key,
            "coverTimeStamp": 0,
            "caption": caption,
            "photoStatus": photo_status,
            "coverType": 1,
            "coverTitle": "",
            "photoType": 0,
            "collectionId": "",
            "publishTime": publish_time,
            "longitude": "",
            "latitude": "",
            "poiId": 0,
            "notifyResult": 0,
            "domain": "",
            "secondDomain": "",
            "coverCropped": false,
            "pkCoverKey": "",
            "profileCoverKey": "",
            "fileName": meta.name,
            "fileType": meta.mime_type,
            "fileSize": meta.size.to_string(),
            "downloadType": 1,
            "disableNearbyShow": false,
            "allowSameFrame": true,
            "movieId": "",
            "openPrePreview": false,
            "declareInfo": {},
            "activityIds": [],
            "riseQuality": false,
            "chapters": [],
            "mediaId": media_id,
            "coverMediaId": cover_media_id,
            "width": width,
            "height": height,
            "videoDuration": duration,
        }),
    )
    .await?;
    ensure_kuaishou_publish_success(&submit, "快手视频发布失败")?;
    Ok(kuaishou_publish_remote_id(&submit).or(Some(file_id)))
}

async fn publish_kuaishou_atlas_work(
    cookie_header: &str,
    target: &PublishWorkTargetRequest,
) -> Result<Option<String>, String> {
    let media = kuaishou_image_media(target)?;
    let metas = media
        .iter()
        .map(kuaishou_media_meta)
        .collect::<Result<Vec<_>, _>>()?;
    ensure_kuaishou_image_metas(&metas)?;
    let caption = kuaishou_caption(target)?;
    let publish_time = kuaishou_publish_time(target)?;
    let photo_status = kuaishou_photo_status(&target.visibility);
    let file_extend_names = metas
        .iter()
        .map(|meta| serde_json::json!({ "fileExtendName": meta.mime_type }))
        .collect::<Vec<_>>();
    let file_extend_names = serde_json::to_string(&file_extend_names)
        .map_err(|error| format!("快手图文上传参数序列化失败: {error}"))?;

    let pre = request_kuaishou_publish_json(
        ATLAS_UPLOAD_PRE_API,
        cookie_header,
        ARTICLE_PUBLISH_ATLAS_URL,
        serde_json::json!({
            "uploadType": 10,
            "pictureCount": media.len(),
            "fileExtendNames": file_extend_names,
        }),
    )
    .await?;
    ensure_kuaishou_publish_success(&pre, "快手图文上传初始化失败")?;

    let pre_data = pre.get("data").unwrap_or(&pre);
    let file_id = kuaishou_value_text(pre_data, &["fileId"])
        .ok_or_else(|| "快手图文上传初始化失败: 缺少 fileId".to_string())?;
    let atlas_id = kuaishou_value_text(pre_data, &["atlasId"])
        .ok_or_else(|| "快手图文上传初始化失败: 缺少 atlasId".to_string())?;
    let upload_info = pre_data
        .get("uploadInfo")
        .and_then(Value::as_array)
        .ok_or_else(|| "快手图文上传初始化失败: 缺少 uploadInfo".to_string())?;
    if upload_info.len() < media.len() {
        return Err("快手图文上传初始化失败: 上传凭证数量不足".to_string());
    }

    let mut blob_keys = Vec::with_capacity(media.len());
    for (index, item) in media.iter().enumerate() {
        let upload = &upload_info[index];
        let token = kuaishou_value_text(upload, &["token", "uploadToken"])
            .ok_or_else(|| format!("快手第 {} 张图片缺少 upload token", index + 1))?;
        let endpoints = kuaishou_upload_endpoints(upload)
            .ok_or_else(|| format!("快手第 {} 张图片缺少上传节点", index + 1))?;
        let blob_key = kuaishou_value_text(upload, &["blobKey"])
            .ok_or_else(|| format!("快手第 {} 张图片缺少 blobKey", index + 1))?;
        upload_kuaishou_storage_file(&item.path, metas[index].size, &token, &endpoints).await?;

        let single_finish = request_kuaishou_publish_json(
            ATLAS_UPLOAD_SINGLE_FINISH_API,
            cookie_header,
            ARTICLE_PUBLISH_ATLAS_URL,
            serde_json::json!({
                "fileId": file_id,
                "atlasId": atlas_id,
                "blobKey": blob_key,
            }),
        )
        .await?;
        ensure_kuaishou_publish_success(
            &single_finish,
            &format!("快手第 {} 张图片上传完成确认失败", index + 1),
        )?;
        blob_keys.push(blob_key);
    }

    let finish = request_kuaishou_publish_json(
        ATLAS_UPLOAD_FINISH_API,
        cookie_header,
        ARTICLE_PUBLISH_ATLAS_URL,
        serde_json::json!({
            "fileId": file_id,
            "atlasId": atlas_id,
            "blobKey": blob_keys,
        }),
    )
    .await?;
    ensure_kuaishou_publish_success(&finish, "快手图文上传完成确认失败")?;

    let submit = request_kuaishou_publish_json(
        ATLAS_PUBLISH_SUBMIT_API,
        cookie_header,
        ARTICLE_PUBLISH_ATLAS_URL,
        serde_json::json!({
            "fileId": file_id,
            "atlasId": atlas_id,
            "caption": caption,
            "photoStatus": photo_status,
            "longitude": "",
            "latitude": "",
            "publishTime": publish_time,
            "declareInfo": {},
            "activityIds": [],
            "coverType": 1,
        }),
    )
    .await?;
    ensure_kuaishou_publish_success(&submit, "快手图文发布失败")?;
    Ok(kuaishou_publish_remote_id(&submit).or(Some(atlas_id)))
}

async fn request_kuaishou_publish_json(
    url: &str,
    cookie_header: &str,
    referer: &str,
    body: Value,
) -> Result<Value, String> {
    request_kuaishou_signed_json(
        url,
        cookie_header,
        referer,
        body,
        Duration::from_secs(30),
        "快手发布接口",
    )
    .await
}

async fn request_kuaishou_signed_json(
    url: &str,
    cookie_header: &str,
    referer: &str,
    body: Value,
    timeout: Duration,
    label: &str,
) -> Result<Value, String> {
    let body = kuaishou_signed_body(cookie_header, body)?;
    request_kuaishou_signed_body_json(
        url,
        cookie_header,
        referer,
        body,
        timeout,
        label,
    )
    .await
}

async fn request_kuaishou_signed_body_json(
    url: &str,
    cookie_header: &str,
    referer: &str,
    body: String,
    timeout: Duration,
    label: &str,
) -> Result<Value, String> {
    let signature = generate_kuaishou_sig3(&body)?;
    let signed_url = format!("{url}?__NS_sig3={}", encode_query(&signature));
    let response = platform_http_client()
        .post(signed_url)
        .header("Cookie", cookie_header)
        .header("User-Agent", KUAISHOU_DIRECT_USER_AGENT)
        .header("Accept", PLATFORM_JSON_ACCEPT)
        .header("Accept-Language", PLATFORM_ACCEPT_LANGUAGE)
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header("Origin", "https://cp.kuaishou.com")
        .header("Referer", referer)
        .header("X-Requested-With", "XMLHttpRequest")
        .header("returnSetRootDomainLoginUrl", "true")
        .header("Content-Type", "application/json;charset=UTF-8")
        .timeout(timeout)
        .body(body)
        .send()
        .await
        .map_err(|error| format!("{label}请求失败: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{label}返回 HTTP {status}"));
    }
    response
        .json()
        .await
        .map_err(|error| format!("{label}不是 JSON: {error}"))
}

fn kuaishou_signed_body(cookie_header: &str, mut body: Value) -> Result<String, String> {
    let api_ph = login_cookie_value(cookie_header, KUAISHOU_API_PH_COOKIE_NAME)
        .ok_or_else(|| "快手 Cookie 缺少签名参数，请重新登录后再发布。".to_string())?;
    let object = body
        .as_object_mut()
        .ok_or_else(|| "快手发布参数必须是对象。".to_string())?;
    object.insert(KUAISHOU_API_PH_COOKIE_NAME.to_string(), Value::String(api_ph));
    serde_json::to_string(&body).map_err(|error| format!("快手发布参数序列化失败: {error}"))
}

async fn upload_kuaishou_storage_file(
    path: &str,
    size: u64,
    token: &str,
    endpoints: &[String],
) -> Result<(), String> {
    let endpoint = endpoints
        .iter()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .ok_or_else(|| "快手上传节点为空".to_string())?;
    let endpoint = kuaishou_upload_endpoint_base(endpoint);
    let resume_url = Url::parse_with_params(
        &format!("{endpoint}/api/upload/resume"),
        [("upload_token", token)],
    )
    .map_err(|error| format!("快手上传续传地址无效: {error}"))?;
    ensure_kuaishou_upload_request(
        platform_http_client()
            .get(resume_url)
            .timeout(Duration::from_secs(30)),
        "快手上传续传检查失败",
    )
    .await?;

    let mut file = File::open(path).map_err(|error| format!("打开素材文件失败: {error}"))?;
    let mut start = 0_u64;
    let mut fragment_id = 0_u64;
    let mut buffer = vec![0_u8; KUAISHOU_UPLOAD_CHUNK_SIZE as usize];
    while start < size {
        let chunk_len = (size - start).min(KUAISHOU_UPLOAD_CHUNK_SIZE) as usize;
        file.read_exact(&mut buffer[..chunk_len])
            .map_err(|error| format!("读取素材分片失败: {error}"))?;
        let end = start + chunk_len as u64 - 1;
        let fragment_url = Url::parse_with_params(
            &format!("{endpoint}/api/upload/fragment"),
            [
                ("upload_token", token.to_string()),
                ("fragment_id", fragment_id.to_string()),
            ],
        )
        .map_err(|error| format!("快手上传分片地址无效: {error}"))?;
        ensure_kuaishou_upload_request(
            platform_http_client()
                .post(fragment_url)
                .header("Content-Type", "application/octet-stream")
                .header("Content-Range", format!("bytes {start}-{end}/{size}"))
                .timeout(Duration::from_secs(120))
                .body(buffer[..chunk_len].to_vec()),
            "快手素材分片上传失败",
        )
        .await?;
        start += chunk_len as u64;
        fragment_id += 1;
    }

    let complete_url = Url::parse_with_params(
        &format!("{endpoint}/api/upload/complete"),
        [
            ("fragment_count", fragment_id.to_string()),
            ("upload_token", token.to_string()),
        ],
    )
    .map_err(|error| format!("快手上传完成地址无效: {error}"))?;
    ensure_kuaishou_upload_request(
        platform_http_client()
            .post(complete_url)
            .timeout(Duration::from_secs(60)),
        "快手素材上传完成失败",
    )
    .await
}

async fn ensure_kuaishou_upload_request(
    request: reqwest::RequestBuilder,
    fallback: &str,
) -> Result<(), String> {
    let response = request
        .send()
        .await
        .map_err(|error| format!("{fallback}: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let body = compact_http_body(&body, 300);
        if body.is_empty() {
            return Err(format!("{fallback}: HTTP {status}"));
        }
        return Err(format!("{fallback}: HTTP {status}: {body}"));
    }
    Ok(())
}

fn kuaishou_upload_endpoint_base(endpoint: &str) -> String {
    let endpoint = endpoint.trim().trim_end_matches('/');
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        endpoint.to_string()
    } else {
        format!("https://{endpoint}")
    }
}

#[derive(Debug)]
struct KuaishouMediaMeta {
    name: String,
    mime_type: String,
    size: u64,
}

fn kuaishou_media_meta(media: &PublishWorkMediaRequest) -> Result<KuaishouMediaMeta, String> {
    let local = local_publish_media(media, "快手")?;
    Ok(KuaishouMediaMeta {
        name: local.name,
        mime_type: kuaishou_media_mime(local.path, &media.media_type),
        size: local.size,
    })
}

fn kuaishou_video_media(
    target: &PublishWorkTargetRequest,
) -> Result<&PublishWorkMediaRequest, String> {
    if target.media.len() != 1 {
        return Err("快手视频发布只支持选择一个视频素材。".to_string());
    }
    let media = &target.media[0];
    if media.media_type != "video" {
        return Err("快手视频发布需要选择视频素材。".to_string());
    }
    if media
        .duration
        .filter(|duration| duration.is_finite())
        .is_some_and(|duration| duration > KUAISHOU_MAX_VIDEO_DURATION_SECONDS)
    {
        return Err("快手视频时长最长支持 1 小时。".to_string());
    }
    Ok(media)
}

fn ensure_kuaishou_video_meta(meta: &KuaishouMediaMeta) -> Result<(), String> {
    if meta.size > KUAISHOU_MAX_VIDEO_BYTES {
        return Err("快手视频最大支持 12G。".to_string());
    }
    Ok(())
}

fn kuaishou_image_media(
    target: &PublishWorkTargetRequest,
) -> Result<&[PublishWorkMediaRequest], String> {
    if target.media.is_empty() {
        return Err("快手图文发布需要至少选择一张图片。".to_string());
    }
    if target.media.len() > KUAISHOU_MAX_IMAGE_COUNT {
        return Err(format!("快手图文最多支持 {KUAISHOU_MAX_IMAGE_COUNT} 张图片。"));
    }
    if target.media.iter().any(|media| media.media_type != "image") {
        return Err("快手图文发布只支持图片素材。".to_string());
    }
    Ok(&target.media)
}

fn ensure_kuaishou_image_metas(metas: &[KuaishouMediaMeta]) -> Result<(), String> {
    if let Some(meta) = metas.iter().find(|meta| meta.size > KUAISHOU_MAX_IMAGE_BYTES) {
        return Err(format!("快手图片单张最大支持 15M：{}", meta.name));
    }
    Ok(())
}

fn kuaishou_caption(target: &PublishWorkTargetRequest) -> Result<String, String> {
    let title = target.title.trim();
    let body = target.body.trim();
    let caption = match (title.is_empty(), body.is_empty()) {
        (false, false) => format!("{title}\n{body}"),
        (false, true) => title.to_string(),
        (true, false) => body.to_string(),
        (true, true) => String::new(),
    };
    if caption.is_empty() {
        return Err("请输入快手作品标题或正文。".to_string());
    }
    if caption.chars().count() > 500 {
        return Err("快手作品文案最多 500 个字。".to_string());
    }
    Ok(caption)
}

fn kuaishou_photo_status(visibility: &str) -> i64 {
    match visibility.trim() {
        "private" => 2,
        "friends" => 4,
        _ => 1,
    }
}

fn kuaishou_publish_time(target: &PublishWorkTargetRequest) -> Result<i64, String> {
    if target.schedule_mode.trim() != "scheduled" {
        return Ok(0);
    }
    let value = target
        .scheduled_at
        .as_deref()
        .unwrap_or_default()
        .trim();
    if value.is_empty() {
        return Err("请选择快手定时发布时间。".to_string());
    }
    let timestamp_seconds = if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        parsed.timestamp()
    } else {
        let normalized = value.replace('T', " ");
        let parsed = NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S")
            .or_else(|_| NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M"))
            .map_err(|_| "快手定时发布时间格式不正确。".to_string())?;
        chrono::Local
            .from_local_datetime(&parsed)
            .single()
            .or_else(|| chrono::Local.from_local_datetime(&parsed).earliest())
            .map(|value| value.timestamp())
            .ok_or_else(|| "快手定时发布时间无效。".to_string())?
    };
    let now = Utc::now().timestamp();
    let earliest = now + KUAISHOU_MIN_SCHEDULE_DELAY_SECONDS;
    let latest = now + KUAISHOU_MAX_SCHEDULE_DELAY_SECONDS;
    if timestamp_seconds < now {
        return Err(format!(
            "快手定时发布时间已过期，最早可选 {}。",
            format_kuaishou_publish_time(earliest)
        ));
    }
    if timestamp_seconds < earliest {
        return Err(format!(
            "快手定时发布时间至少需要选择当前 1 小时后，最早可选 {}。",
            format_kuaishou_publish_time(earliest)
        ));
    }
    if timestamp_seconds > latest {
        return Err(format!(
            "快手定时发布时间不能超过 14 天，最晚可选 {}。",
            format_kuaishou_publish_time(latest)
        ));
    }
    Ok(timestamp_seconds)
}

fn format_kuaishou_publish_time(timestamp_seconds: i64) -> String {
    Utc.timestamp_opt(timestamp_seconds, 0)
        .single()
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "合法时间范围内的时间".to_string())
}

fn kuaishou_media_mime(path: &Path, media_type: &str) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "m4v" => "video/x-m4v",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ if media_type == "video" => "video/mp4",
        _ => "image/jpeg",
    }
    .to_string()
}

fn kuaishou_upload_endpoints(value: &Value) -> Option<Vec<String>> {
    ["endPoints", "endpoints"].iter().find_map(|key| {
        value.get(*key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
    })
}

fn kuaishou_value_text(value: &Value, keys: &[&str]) -> Option<String> {
    first_string_deep(value, keys).or_else(|| {
        keys.iter().find_map(|key| {
            value.get(*key)
                .and_then(number_value)
                .map(|value| {
                    if value.fract().abs() < f64::EPSILON {
                        format!("{}", value.round() as i64)
                    } else {
                        trim_number_text(&format!("{value:.6}"))
                    }
                })
        })
    })
}

fn ensure_kuaishou_publish_success(value: &Value, fallback: &str) -> Result<(), String> {
    if kuaishou_response_success(value) {
        Ok(())
    } else {
        let message = kuaishou_error_message(value, fallback);
        if message == fallback || message.contains(fallback) {
            Err(message)
        } else {
            Err(format!("{fallback}: {message}"))
        }
    }
}

fn kuaishou_publish_remote_id(value: &Value) -> Option<String> {
    value
        .get("data")
        .and_then(|data| {
            kuaishou_value_text(
                data,
                &["photoId", "workId", "publishId", "id", "fileId", "atlasId"],
            )
        })
        .or_else(|| {
            kuaishou_value_text(
                value,
                &["photoId", "workId", "publishId", "id", "fileId", "atlasId"],
            )
        })
}

pub(crate) fn kuaishou_statistics_works_body(page: i64, count: i64) -> Value {
    serde_json::json!({
        "page": page,
        "count": count,
        "orderType": 2,
        "sortType": 1,
        "type": 0,
    })
}

async fn request_kuaishou_management_json(
    cookie_header: &str,
    page_key: &str,
) -> Result<Value, String> {
    let api_ph = login_cookie_value(cookie_header, KUAISHOU_API_PH_COOKIE_NAME)
        .ok_or_else(|| "快手 Cookie 缺少签名参数，请重新登录后再同步。".to_string())?;
    let body = kuaishou_management_works_body_json(page_key, &api_ph)?;
    request_kuaishou_signed_body_json(
        ARTICLE_MANAGE_VIDEO_LIST_API,
        cookie_header,
        ARTICLE_MANAGE_VIDEO_URL,
        body,
        Duration::from_secs(18),
        "快手作品管理列表",
    )
        .await
}

fn kuaishou_management_works_body_json(page_key: &str, api_ph: &str) -> Result<String, String> {
    serde_json::to_string(&KuaishouManagementWorksBody {
        query_type: "0",
        cursor: kuaishou_management_cursor_value(page_key),
        start_time: kuaishou_management_start_time_ms(),
        end_time: KUAISHOU_MANAGE_CURSOR_START,
        limit: KUAISHOU_MANAGEMENT_WORKS_PAGE_SIZE,
        time_range_type: KUAISHOU_MANAGE_TIME_RANGE_ALL,
        keyword: "",
        api_ph,
    })
    .map_err(|error| format!("快手作品管理列表参数序列化失败: {error}"))
}

fn kuaishou_management_cursor_value(page_key: &str) -> Value {
    let page_key = page_key.trim();
    if page_key.is_empty() {
        return Value::from(KUAISHOU_MANAGE_CURSOR_START);
    }
    page_key
        .parse::<i64>()
        .map(Value::from)
        .unwrap_or_else(|_| Value::from(page_key.to_string()))
}

fn generate_kuaishou_sig3(body: &str) -> Result<String, String> {
    let input = format!("{:x}", md5::compute(body.as_bytes()));
    run_kuaishou_encoder(&input)
        .map_err(|error| format!("快手签名执行失败，请稍后重试或更新客户端: {error}"))
}

fn run_kuaishou_encoder(input: &str) -> Result<String, String> {
    let input = serde_json::to_string(input)
        .map_err(|error| format!("快手签名输入序列化失败: {error}"))?;
    KUAISHOU_ENCODER_RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        if runtime.is_none() {
            *runtime = Some(KuaishouEncoderRuntime::new()?);
        }
        match runtime.as_ref() {
            Some(runtime) => runtime.encode(&input),
            None => Err("快手签名运行时未初始化".to_string()),
        }
    })
}

impl KuaishouEncoderRuntime {
    fn new() -> Result<Self, String> {
        let runtime = Runtime::new().map_err(|error| format!("创建内置签名运行时失败: {error}"))?;
        let context = Context::full(&runtime)
            .map_err(|error| format!("初始化内置签名运行时失败: {error}"))?;
        context.with(|ctx| {
            let mut script = String::with_capacity(
                KUAISHOU_ENCODER_BOOTSTRAP_PREFIX.len()
                    + KUAISHOU_ENCODER_JS.len()
                    + KUAISHOU_ENCODER_BOOTSTRAP_SUFFIX.len(),
            );
            script.push_str(KUAISHOU_ENCODER_BOOTSTRAP_PREFIX);
            script.push_str(KUAISHOU_ENCODER_JS);
            script.push_str(KUAISHOU_ENCODER_BOOTSTRAP_SUFFIX);
            let mut eval_options = EvalOptions::default();
            eval_options.strict = false;
            ctx.eval_with_options::<(), _>(script, eval_options)
                .catch(&ctx)
                .map_err(|error| error.to_string())
        })?;
        Ok(Self {
            _runtime: runtime,
            context,
        })
    }

    fn encode(&self, input: &str) -> Result<String, String> {
        self.context.with(|ctx| {
            let mut script = String::with_capacity(input.len() + 16);
            script.push_str("__ksEncode(");
            script.push_str(input);
            script.push_str(");");
            let mut eval_options = EvalOptions::default();
            eval_options.strict = false;
            ctx.eval_with_options::<String, _>(script, eval_options)
                .catch(&ctx)
                .map_err(|error| error.to_string())
        })
    }
}

fn kuaishou_management_start_time_ms() -> i64 {
    let Some(tomorrow) = chrono::Local::now()
        .date_naive()
        .checked_add_signed(chrono::Duration::days(1))
    else {
        return 0;
    };
    let Some(midnight) = tomorrow.and_hms_opt(0, 0, 0) else {
        return 0;
    };
    chrono::Local
        .from_local_datetime(&midnight)
        .single()
        .or_else(|| chrono::Local.from_local_datetime(&midnight).earliest())
        .map(|value| value.timestamp_millis() - KUAISHOU_MANAGE_ALL_DAYS * MILLIS_PER_DAY)
        .unwrap_or(0)
}

pub(crate) fn parse_kuaishou_management_works_page(
    value: Value,
    account_id: &str,
    page_key: &str,
) -> Result<ChannelWorksPage, String> {
    let data = kuaishou_management_works_data(&value);
    if data.is_none() && !kuaishou_response_success(&value) {
        eprintln!(
            "[kuaishou:works] management response missing list: {}",
            kuaishou_response_shape(&value)
        );
        return Err(kuaishou_error_message(&value, "快手作品管理列表读取失败"));
    }

    let data = data.unwrap_or_else(|| value.get("data").unwrap_or(&value));
    let works = data
        .get("list")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| parse_kuaishou_work(item, account_id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let next_cursor = data
        .get("nextCursor")
        .and_then(|value| match value {
            Value::String(value) => Some(value.trim().to_string()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty() && value != "no_more");
    let has_more = next_cursor.is_some();

    Ok(ChannelWorksPage {
        account_id: account_id.to_string(),
        platform_id: "kuaishou".to_string(),
        page_key: page_key.trim().to_string(),
        work_type: None,
        next_page_key: next_cursor,
        has_more,
        works,
        updated_at: Some(Utc::now()),
        sync_status: "synced".to_string(),
        error: None,
    })
}

fn kuaishou_management_works_data(value: &Value) -> Option<&Value> {
    if value.get("list").and_then(Value::as_array).is_some() {
        return Some(value);
    }
    if let Some(data) = value
        .get("data")
        .filter(|data| data.get("list").and_then(Value::as_array).is_some())
    {
        return Some(data);
    }
    value
        .get("data")
        .and_then(|data| data.get("data"))
        .filter(|data| data.get("list").and_then(Value::as_array).is_some())
        .or_else(|| {
            value
                .get("result")
                .filter(|data| data.get("list").and_then(Value::as_array).is_some())
        })
}

async fn fetch_kuaishou_latest_work(
    cookie_header: &str,
    account_id: &str,
) -> Result<Option<ChannelContentWork>, String> {
    let value = request_plugin_json_with_body(
        "POST",
        ARTICLE_PHOTO_LIST_API,
        cookie_header,
        STATISTICS_ARTICLE_HEADERS,
        Some(kuaishou_statistics_works_body(0, 1)),
    )
    .await?;
    if !kuaishou_response_success(&value) {
        return Err(kuaishou_error_message(&value, "快手最新作品读取失败"));
    }
    let photo_list = value
        .get("data")
        .and_then(|data| data.get("photoList"))
        .or_else(|| value.get("photoList"));
    let mut work = photo_list
        .and_then(|data| data.get("photoItems"))
        .and_then(Value::as_array)
        .and_then(|items| items.iter().find_map(|item| parse_kuaishou_work(item, account_id)));
    if let Some(work) = work.as_mut() {
        let _ = enrich_kuaishou_latest_work(cookie_header, work).await;
    }
    Ok(work)
}

async fn enrich_kuaishou_latest_work(
    cookie_header: &str,
    work: &mut ChannelContentWork,
) -> Result<(), String> {
    let referer = work
        .link
        .clone()
        .unwrap_or_else(|| STATISTICS_ARTICLE_URL.to_string());
    let detail_headers = [
        ("Origin", "https://cp.kuaishou.com"),
        ("Referer", referer.as_str()),
    ];
    let (info_result, play_result, interact_result) = tokio::join!(
        request_plugin_json_with_body(
            "POST",
            ARTICLE_SINGLE_INFO_API,
            cookie_header,
            &detail_headers,
            Some(kuaishou_single_info_body(&work.id)),
        ),
        request_plugin_json_with_body(
            "POST",
            ARTICLE_SINGLE_OVERVIEW_API,
            cookie_header,
            &detail_headers,
            Some(kuaishou_single_overview_body(&work.id, 1)),
        ),
        request_plugin_json_with_body(
            "POST",
            ARTICLE_SINGLE_OVERVIEW_API,
            cookie_header,
            &detail_headers,
            Some(kuaishou_single_overview_body(&work.id, 2)),
        ),
    );
    let info = info_result?;
    if kuaishou_response_success(&info) {
        apply_kuaishou_single_info(work, &info);
    }

    let play = play_result?;
    let interact = interact_result?;
    apply_kuaishou_single_overview(work, &[play, interact]);
    Ok(())
}

pub(crate) fn kuaishou_single_info_body(photo_id: &str) -> Value {
    serde_json::json!({ "photoId": photo_id, "workId": photo_id })
}

pub(crate) fn kuaishou_single_overview_body(photo_id: &str, tab_type: i64) -> Value {
    serde_json::json!({
        "photoId": photo_id,
        "tabType": tab_type,
        "dataChangeType": 2,
        "timeGranularity": 2,
    })
}

async fn fetch_kuaishou_overview(
    cookie_header: &str,
    account_id: &str,
    period_days: u16,
    time_type: i64,
    now: DateTime<Utc>,
) -> Result<ChannelAccountOverview, String> {
    let value = request_plugin_json_with_body(
        "POST",
        AUTHOR_OVERVIEW_API,
        cookie_header,
        STATISTICS_HEADERS,
        Some(serde_json::json!({ "timeType": time_type })),
    )
    .await
    .map_err(|error| format!("快手总览接口不可用: {error}"))?;
    parse_kuaishou_overview_response(value, account_id, period_days, now)
}

pub(crate) fn parse_kuaishou_overview_response(
    value: Value,
    account_id: &str,
    period_days: u16,
    now: DateTime<Utc>,
) -> Result<ChannelAccountOverview, String> {
    if !kuaishou_response_success(&value) {
        return Err(kuaishou_error_message(&value, "快手总览读取失败"));
    }

    let data = value.get("data").unwrap_or(&value);
    Ok(ChannelAccountOverview {
        account_id: account_id.to_string(),
        platform_id: "kuaishou".to_string(),
        period_days,
        metrics: kuaishou_overview_metrics(data),
        summary: kuaishou_overview_summary(data),
        updated_at: Some(now),
        sync_status: "synced".to_string(),
        error: None,
    })
}

fn kuaishou_overview_metrics(data: &Value) -> Vec<ChannelOverviewMetric> {
    data
        .get("basicData")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(kuaishou_overview_metric).collect())
        .unwrap_or_default()
}

fn kuaishou_overview_metric(item: &Value) -> ChannelOverviewMetric {
    let label = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("数据")
        .to_string();
    let tab = item.get("tab").and_then(Value::as_str).unwrap_or_default();
    let key = kuaishou_overview_key(tab, &label);
    let is_rate = key == "completionRate" || label.contains('率');
    let value = item
        .get("sumCount")
        .and_then(number_value)
        .map(|value| format_kuaishou_metric_value(value, is_rate));
    let yesterday = item.get("endDayCount").and_then(number_value);

    ChannelOverviewMetric {
        key: key.to_string(),
        label,
        value,
        compare_label: Some("昨日".to_string()),
        trend: yesterday.map(|value| {
            if is_rate {
                format!("昨日 {}", format_kuaishou_metric_value(value, true))
            } else {
                format!("昨日 {}", format_signed_kuaishou_count(value))
            }
        }),
        tone: yesterday.map(delta_tone_f64),
    }
}

fn kuaishou_overview_key(tab: &str, label: &str) -> &'static str {
    match tab {
        "PLAY" => "play",
        "LIKE" => "like",
        "PURE_INCREASE_FAN" => "netFollowers",
        "COMPLETE_RATIO" => "completionRate",
        "COMMENT" => "comment",
        "SHARE" => "share",
        "WORKS" => "works",
        _ if label.contains("粉丝") => "netFollowers",
        _ if label.contains("完播") => "completionRate",
        _ if label.contains("评论") => "comment",
        _ if label.contains("点赞") => "like",
        _ if label.contains("分享") => "share",
        _ if label.contains("作品") => "works",
        _ => "metric",
    }
}

fn kuaishou_overview_summary(data: &Value) -> Option<String> {
    data
        .get("dataUpdateTime")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("数据更新至 {}", format_kuaishou_data_date(value)))
}

fn parse_kuaishou_work(item: &Value, account_id: &str) -> Option<ChannelContentWork> {
    let photo_id = first_string(item, &["photoId", "workId", "publishId", "id"])?;
    let title = first_string(item, &["title", "caption", "desc"])
        .unwrap_or_else(|| "快手作品".to_string());
    let cover_url = first_profile_image(item, WORK_COVER_KEYS)
        .map(|value| normalize_platform_image_url("kuaishou", value));
    let views = first_count(item, &["playCount", "play_count", "viewCount", "views"]);
    let likes = first_count(item, &["likeCount", "like_count", "likes"]);
    let comments = first_count(item, &["commentCount", "comment_count", "comments"]);
    let collects = first_count(item, &["collectCount", "collect_count", "collects"]);
    let gained_followers = first_signed_count(item, &["followCount", "follow_count", "fansCount"]);
    let completion_rate = item
        .get("fpr")
        .or_else(|| item.get("finishRate"))
        .and_then(number_value)
        .map(|value| format_kuaishou_metric_value(value, true));
    let work_type = kuaishou_work_type(item).or_else(|| Some("video".to_string()));
    let badges = kuaishou_work_badges(item);

    Some(ChannelContentWork {
        id: photo_id.clone(),
        platform_id: "kuaishou".to_string(),
        account_id: account_id.to_string(),
        title,
        cover_url,
        link: Some(format!("https://cp.kuaishou.com/statistics/article/detail/{photo_id}")),
        published_at: item
            .get("publishTime")
            .or_else(|| item.get("uploadTime"))
            .and_then(kuaishou_datetime),
        status: kuaishou_work_status(&badges).to_string(),
        views,
        impressions: None,
        likes,
        collects,
        comments,
        shares: first_count(item, &["shareCount", "share_count", "shares"]),
        cover_click_rate: None,
        avg_view_time: None,
        gained_followers,
        data_updated_at: Some(Utc::now()),
        metrics: kuaishou_work_metrics(
            views,
            likes,
            comments,
            completion_rate.clone(),
            gained_followers,
            collects,
        ),
        badges,
        work_type,
    })
}

fn kuaishou_work_metrics(
    views: Option<u64>,
    likes: Option<u64>,
    comments: Option<u64>,
    completion_rate: Option<String>,
    gained_followers: Option<i64>,
    collects: Option<u64>,
) -> Vec<ChannelWorkMetric> {
    vec![
        kuaishou_work_metric("play", "播放", views.map(|value| value.to_string())),
        kuaishou_work_metric("like", "点赞", likes.map(|value| value.to_string())),
        kuaishou_work_metric("comment", "评论", comments.map(|value| value.to_string())),
        kuaishou_work_metric("completionRate", "完播率", completion_rate),
        kuaishou_work_metric("followers", "涨粉", gained_followers.map(|value| value.to_string())),
        kuaishou_work_metric("collect", "收藏", collects.map(|value| value.to_string())),
    ]
}

fn kuaishou_work_metric(key: &str, label: &str, value: Option<String>) -> ChannelWorkMetric {
    ChannelWorkMetric {
        key: key.to_string(),
        label: label.to_string(),
        value,
    }
}

fn kuaishou_work_type(item: &Value) -> Option<String> {
    if item.get("showAtlasIcon").and_then(kuaishou_value_to_bool) == Some(true) {
        return Some("article".to_string());
    }
    if item.get("video").and_then(kuaishou_value_to_bool) == Some(false) {
        return Some("article".to_string());
    }
    if item.get("video").and_then(kuaishou_value_to_bool) == Some(true) {
        return Some("video".to_string());
    }
    first_i64(item, &["photoType", "workType", "type"]).and_then(|value| match value {
        2 => Some("article".to_string()),
        1 => Some("video".to_string()),
        _ => None,
    })
}

fn kuaishou_work_badges(item: &Value) -> Vec<String> {
    let mut badges = item
        .get("photoStatusTags")
        .and_then(Value::as_array)
        .map(|tags| {
            tags.iter()
                .filter_map(|tag| tag.get("tagText").and_then(Value::as_str))
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for key in ["promotionDesc", "negativeDesc", "bonusDesc"] {
        if let Some(value) = item.get(key).and_then(Value::as_str).filter(|value| !value.trim().is_empty()) {
            badges.push(value.to_string());
        }
    }
    if item.get("photoTop").and_then(kuaishou_value_to_bool) == Some(true) {
        badges.push("置顶".to_string());
    }
    if let Some(value) = first_i64(item, &["photoStatus"]) {
        match value {
            1 => badges.push("私密".to_string()),
            3 => badges.push("仅好友可见".to_string()),
            _ => {}
        }
    }
    if let Some(value) = first_i64(item, &["publishStatus"]) {
        match value {
            3 | 6 | 9 => badges.push("发布失败".to_string()),
            10 => badges.push("审核中".to_string()),
            11 => badges.push("审核未通过".to_string()),
            15 => badges.push("上传权限封禁".to_string()),
            _ => {}
        }
    }
    badges.sort();
    badges.dedup();
    badges
}

fn kuaishou_work_status(badges: &[String]) -> &'static str {
    if badges.iter().any(|badge| badge.contains("失败") || badge.contains("未通过") || badge.contains("封禁")) {
        "failed"
    } else if badges.iter().any(|badge| badge.contains("审核")) {
        "reviewing"
    } else if badges.iter().any(|badge| badge.contains("草稿")) {
        "draft"
    } else {
        "published"
    }
}

fn apply_kuaishou_single_info(work: &mut ChannelContentWork, value: &Value) {
    let data = value.get("data").unwrap_or(value);
    if let Some(title) = first_string(data, &["title", "caption", "desc"]).filter(|value| !value.trim().is_empty()) {
        work.title = title;
    }
    if let Some(cover) = first_profile_image(data, WORK_COVER_KEYS) {
        work.cover_url = Some(normalize_platform_image_url("kuaishou", cover));
    }
    if let Some(published_at) = data.get("publishTime").and_then(kuaishou_datetime) {
        work.published_at = Some(published_at);
    }
    if let Some(work_type) = kuaishou_work_type(data) {
        work.work_type = Some(work_type);
    }
    let mut badges = work.badges.clone();
    badges.extend(kuaishou_work_badges(data));
    badges.sort();
    badges.dedup();
    work.status = kuaishou_work_status(&badges).to_string();
    work.badges = badges;
}

fn apply_kuaishou_single_overview(work: &mut ChannelContentWork, values: &[Value]) {
    let mut metrics = Vec::new();
    for item in values
        .iter()
        .filter(|value| kuaishou_response_success(value))
        .filter_map(|value| value.get("data").or_else(|| Some(value)))
        .filter_map(|data| data.get("trendList"))
        .filter_map(Value::as_array)
        .flatten()
    {
        let Some(name) = item.get("name").and_then(Value::as_str) else {
            continue;
        };
        let en_name = item.get("enName").and_then(Value::as_str).unwrap_or_default();
        let metric_type = first_i64(item, &["type"]).unwrap_or(1);
        let value = item
            .get("sumCount")
            .and_then(number_value)
            .map(|value| format_kuaishou_detail_metric_value(value, metric_type));
        apply_kuaishou_detail_metric_to_work(work, en_name, item.get("sumCount").and_then(number_value));
        metrics.push(ChannelWorkMetric {
            key: kuaishou_detail_metric_key(en_name, name).to_string(),
            label: name.to_string(),
            value,
        });
    }
    if !metrics.is_empty() {
        metrics.sort_by_key(|metric| kuaishou_detail_metric_order(&metric.key));
        metrics.dedup_by(|left, right| left.key == right.key);
        work.metrics = metrics;
    }
}

fn apply_kuaishou_detail_metric_to_work(work: &mut ChannelContentWork, en_name: &str, value: Option<f64>) {
    let Some(value) = value else {
        return;
    };
    match en_name {
        "PLAY_CNT" => work.views = Some(value.round().max(0.0) as u64),
        "LIKE_CNT" => work.likes = Some(value.round().max(0.0) as u64),
        "COMMENT_CNT" => work.comments = Some(value.round().max(0.0) as u64),
        "SHARE_CNT" => work.shares = Some(value.round().max(0.0) as u64),
        "COLLECT_CNT" => work.collects = Some(value.round().max(0.0) as u64),
        "FOLLOW_CNT" | "FAN_CNT" | "PURE_INCREASE_FAN" => work.gained_followers = Some(value.round() as i64),
        "OUTSIDE_CTR" => work.cover_click_rate = Some(format_kuaishou_detail_metric_value(value, 2)),
        "AVG_PLAY_DURATION" => work.avg_view_time = Some(format_kuaishou_detail_metric_value(value, 4)),
        _ => {}
    }
}

fn kuaishou_detail_metric_key(en_name: &str, name: &str) -> &'static str {
    match en_name {
        "PLAY_CNT" => "play",
        "AVG_PLAY_DURATION" => "avgViewTime",
        "OUTSIDE_CTR" => "coverClickRate",
        "TWO_SECONDS_EXIT" => "twoSecondExitRate",
        "FIVE_SECONDS_FPR" => "fiveSecondCompletionRate",
        "FPR" => "completionRate",
        "LIKE_CNT" => "like",
        "COMMENT_CNT" => "comment",
        "SHARE_CNT" => "share",
        "COLLECT_CNT" => "collect",
        "FOLLOW_CNT" | "FAN_CNT" | "PURE_INCREASE_FAN" => "followers",
        _ if name.contains("播放") => "play",
        _ if name.contains("点赞") => "like",
        _ if name.contains("评论") => "comment",
        _ if name.contains("分享") => "share",
        _ if name.contains("收藏") => "collect",
        _ if name.contains("粉") => "followers",
        _ => "metric",
    }
}

fn kuaishou_detail_metric_order(key: &str) -> u8 {
    match key {
        "play" => 0,
        "avgViewTime" => 1,
        "coverClickRate" => 2,
        "completionRate" => 3,
        "fiveSecondCompletionRate" => 4,
        "twoSecondExitRate" => 5,
        "like" => 6,
        "comment" => 7,
        "collect" => 8,
        "share" => 9,
        "followers" => 10,
        _ => 99,
    }
}

fn format_kuaishou_detail_metric_value(value: f64, metric_type: i64) -> String {
    match metric_type {
        2 => {
            let text = format!("{value:.2}");
            format!("{}%", trim_number_text(&text))
        }
        4 => {
            let text = format!("{:.1}", value / 1000.0);
            format!("{}秒", trim_number_text(&text))
        }
        _ => format_kuaishou_count(value),
    }
}

async fn parse_kuaishou_creator_account(
    value: Value,
    login_cookie: String,
) -> Result<PluginAccountInfo, String> {
    let payload = value.get("data").filter(|data| !data.is_null()).unwrap_or(&value);
    let user_info = value.get("userInfo").filter(|data| !data.is_null());
    let result = first_i64(&value, RESPONSE_CODE_KEYS).unwrap_or(1);
    let uid = user_info
        .and_then(|data| first_string_deep(data, UID_KEYS))
        .or_else(|| first_string_deep(payload, UID_KEYS))
        .or_else(|| {
            first_count(payload, UID_KEYS)
                .filter(|value| *value > 0)
                .map(|value| value.to_string())
        })
        .unwrap_or_default();
    let nickname = user_info
        .and_then(|data| first_string_deep(data, NICKNAME_KEYS))
        .or_else(|| first_string_deep(payload, NICKNAME_KEYS))
        .unwrap_or_else(|| platform_name("kuaishou").to_string());
    let has_profile = !uid.trim().is_empty() || nickname != platform_name("kuaishou");
    #[cfg(debug_assertions)]
    {
        let top_keys = value
            .as_object()
            .map(|object| object.keys().take(8).cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        eprintln!(
            "[plugin-auth:kuaishou] result={result} has_profile={has_profile} keys={top_keys:?}"
        );
    }
    if !has_profile {
        if let Some(account) = kuaishou_account_from_login_cookie(&login_cookie) {
            #[cfg(debug_assertions)]
            eprintln!(
                "[plugin-auth:kuaishou] using login-cookie fallback account={}",
                account.uid
            );
            return Ok(account);
        }
        return Err("请先在打开的快手创作者中心完成登录。".to_string());
    }
    let avatar = user_info
        .and_then(|data| first_profile_image(data, AVATAR_KEYS))
        .or_else(|| first_profile_image(payload, AVATAR_KEYS))
        .unwrap_or_default();
    let avatar = materialize_account_avatar("kuaishou", avatar).await;
    let account = if uid.trim().is_empty() {
        nickname.clone()
    } else {
        uid.clone()
    };
    Ok(PluginAccountInfo {
        uid: account.clone(),
        account,
        nickname,
        avatar,
        fans_count: first_count(payload, FOLLOWER_COUNT_KEYS),
        following_count: first_count(payload, FOLLOWING_COUNT_KEYS),
        like_count: first_count(payload, LIKE_COUNT_KEYS),
        login_cookie,
    })
}

pub(crate) fn kuaishou_account_from_login_cookie(login_cookie: &str) -> Option<PluginAccountInfo> {
    if !login_cookie_has_required_cookie(login_cookie) {
        return None;
    }
    let uid = login_cookie_value(login_cookie, "userId")
        .or_else(|| login_cookie_value(login_cookie, "bUserId"))?;
    let uid = uid.trim().to_string();
    if uid.is_empty() {
        return None;
    }
    let suffix = uid.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>();
    let nickname = if suffix.is_empty() {
        "快手账号".to_string()
    } else {
        format!("快手账号 {suffix}")
    };
    Some(PluginAccountInfo {
        uid: uid.clone(),
        account: uid,
        nickname,
        avatar: String::new(),
        fans_count: None,
        following_count: None,
        like_count: None,
        login_cookie: login_cookie.to_string(),
    })
}

fn kuaishou_profile_is_cookie_fallback(profile: &PluginAccountInfo) -> bool {
    profile.avatar.trim().is_empty()
        && profile.fans_count.is_none()
        && profile.following_count.is_none()
        && profile.like_count.is_none()
        && kuaishou_is_cookie_fallback_nickname(&profile.nickname)
}

fn merge_kuaishou_profiles(
    mut primary: PluginAccountInfo,
    secondary: PluginAccountInfo,
) -> PluginAccountInfo {
    let primary_is_cookie_fallback = kuaishou_profile_is_cookie_fallback(&primary);

    if primary.avatar.trim().is_empty() && !secondary.avatar.trim().is_empty() {
        primary.avatar = secondary.avatar.clone();
    }
    if (primary.nickname.trim().is_empty()
        || primary.nickname == platform_name("kuaishou")
        || primary_is_cookie_fallback)
        && !secondary.nickname.trim().is_empty()
        && secondary.nickname != platform_name("kuaishou")
    {
        primary.nickname = secondary.nickname.clone();
    }
    if (primary.uid.trim().is_empty() || primary_is_cookie_fallback)
        && !secondary.uid.trim().is_empty()
    {
        primary.uid = secondary.uid.clone();
    }
    if (primary.account.trim().is_empty() || primary_is_cookie_fallback)
        && !secondary.account.trim().is_empty()
    {
        primary.account = secondary.account.clone();
    }

    primary.fans_count = primary.fans_count.or(secondary.fans_count);
    primary.following_count = primary.following_count.or(secondary.following_count);
    primary.like_count = primary.like_count.or(secondary.like_count);
    if primary.login_cookie.trim().is_empty() {
        primary.login_cookie = secondary.login_cookie;
    }
    primary
}

fn kuaishou_is_cookie_fallback_nickname(nickname: &str) -> bool {
    nickname == "快手账号"
        || nickname
            .strip_prefix("快手账号 ")
            .map(|suffix| suffix.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(false)
}

fn login_cookie_has_required_cookie(login_cookie: &str) -> bool {
    login_cookie_value(login_cookie, LOGIN_REQUIRED_COOKIE_NAME)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn login_cookie_value(login_cookie: &str, expected_name: &str) -> Option<String> {
    let trimmed = login_cookie.trim();
    if trimmed.starts_with('[') {
        if let Ok(Value::Array(cookies)) = serde_json::from_str::<Value>(trimmed) {
            return cookies.iter().find_map(|cookie| {
                let name = cookie.get("name").and_then(Value::as_str)?;
                if !name.eq_ignore_ascii_case(expected_name) {
                    return None;
                }
                cookie
                    .get("value")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
            });
        }
    }
    trimmed.split(';').find_map(|pair| {
        let (name, value) = pair.trim().split_once('=')?;
        if name.trim().eq_ignore_ascii_case(expected_name) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

fn kuaishou_response_success(value: &Value) -> bool {
    first_i64(value, &["result", "code", "errCode", "errcode"]).unwrap_or(0) == 1
}

fn kuaishou_error_message(value: &Value, fallback: &str) -> String {
    first_string_deep(
        value,
        &[
            "message",
            "msg",
            "errorMessage",
            "error_msg",
            "errorMsg",
            "reason",
            "tips",
        ],
    )
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| {
        first_i64(value, RESPONSE_CODE_KEYS)
            .map(|code| format!("{fallback}: {code}"))
            .unwrap_or_else(|| fallback.to_string())
    })
}

fn kuaishou_response_shape(value: &Value) -> String {
    let keys = value
        .as_object()
        .map(|object| object.keys().take(10).cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let result = first_i64(value, RESPONSE_CODE_KEYS)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".to_string());
    let message = first_string_deep(value, &["message", "msg", "errorMessage", "errorMsg"])
        .unwrap_or_else(|| "-".to_string());
    format!("result={result} keys={keys:?} message={message}")
}

fn kuaishou_datetime(value: &Value) -> Option<DateTime<Utc>> {
    let raw = number_value(value)?;
    let timestamp = raw.round() as i64;
    let millis = if timestamp > 10_000_000_000 {
        timestamp
    } else {
        timestamp.saturating_mul(1000)
    };
    Utc.timestamp_millis_opt(millis).single()
}

fn number_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite())
}

fn first_signed_count(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(number_value))
        .map(|value| value.round() as i64)
}

fn format_kuaishou_metric_value(value: f64, is_rate: bool) -> String {
    if is_rate {
        return format_kuaishou_percent(value);
    }
    format_kuaishou_count(value)
}

fn format_kuaishou_percent(value: f64) -> String {
    let percent = value * 100.0;
    let text = format!("{percent:.2}");
    format!("{}%", trim_number_text(&text))
}

fn format_kuaishou_count(value: f64) -> String {
    let sign = if value < 0.0 { "-" } else { "" };
    let absolute = value.abs();
    if absolute >= 10_000.0 {
        let text = format!("{:.1}", absolute / 10_000.0);
        format!("{sign}{}万", trim_number_text(&text))
    } else if (absolute.fract()).abs() < f64::EPSILON {
        format!("{sign}{}", absolute.round() as i64)
    } else {
        let text = format!("{absolute:.2}");
        format!("{sign}{}", trim_number_text(&text))
    }
}

fn format_signed_kuaishou_count(value: f64) -> String {
    if value > 0.0 {
        format!("+{}", format_kuaishou_count(value))
    } else {
        format_kuaishou_count(value)
    }
}

fn trim_number_text(value: &str) -> String {
    value
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn delta_tone_f64(value: f64) -> String {
    if value > 0.0 {
        "up".to_string()
    } else if value < 0.0 {
        "down".to_string()
    } else {
        "neutral".to_string()
    }
}

fn kuaishou_value_to_bool(value: &Value) -> Option<bool> {
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

fn format_kuaishou_data_date(value: &str) -> String {
    let value = value.trim();
    if value.len() == 8 {
        format!("{}-{}-{}", &value[0..4], &value[4..6], &value[6..8])
    } else {
        value.to_string()
    }
}
