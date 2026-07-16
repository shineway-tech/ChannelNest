use super::*;

pub(crate) async fn publish_channel_work(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    request: PublishWorkRequest,
) -> Result<PublishWorkResponse, String> {
    let user_id = normalize_user_id(&request.user_id)?;
    if request.targets.is_empty() {
        return Err("请选择至少一个发布账号".to_string());
    }

    let mut results = Vec::with_capacity(request.targets.len());
    for target in request.targets {
        let account_id = target.account_id.clone();
        let (account, saved_login_cookie, _) = match account_with_secrets(
            &app,
            &state,
            &account_id,
            &user_id,
        ) {
            Ok(value) => value,
            Err(error) => {
                results.push(PublishWorkTargetResult {
                    account_id,
                    platform_id: String::new(),
                    status: "failed".to_string(),
                    message: error,
                    remote_id: None,
                });
                continue;
            }
        };

        let platform_id = normalize_platform_id(&account.platform_id);
        if !matches!(account.status, AccountStatus::Active) {
            results.push(publish_target_result(
                &account,
                "failed",
                "账号未登录，请先重新登录后再发布。",
                None,
            ));
            continue;
        }
        if let Some(message) = platform_publish_capability_error(
            &platform_id,
            &request.content_type,
            &target,
        ) {
            results.push(publish_target_result(&account, "unsupported", &message, None));
            continue;
        }
        let Some(login_cookie) = saved_login_cookie
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            results.push(expired_publish_result(&app, &account, &platform_id));
            continue;
        };
        let cookie_header = plugin_cookie_header(&login_cookie);
        if cookie_header.trim().is_empty() {
            results.push(expired_publish_result(&app, &account, &platform_id));
            continue;
        }

        let publish_result = match platform_id.as_str() {
            "douyin" => {
                publish_douyin_work(&cookie_header, &login_cookie, &request.content_type, &target)
                    .await
            }
            "kuaishou" => {
                publish_kuaishou_work(&cookie_header, &request.content_type, &target).await
            }
            "bilibili" => {
                publish_bilibili_work(&cookie_header, &request.content_type, &target).await
            }
            "xiaohongshu" => {
                publish_xhs_work(&cookie_header, &login_cookie, &request.content_type, &target).await
            }
            "wechat-channels" => {
                publish_wx_channels_work(&cookie_header, &request.content_type, &target).await
            }
            _ => unreachable!("publish capability already rejected unknown platform"),
        };

        match publish_result {
            Ok(remote_id) => results.push(publish_target_result(
                &account,
                "success",
                &format!("{}发布已提交。", platform_name(&platform_id)),
                remote_id,
            )),
            Err(error) => {
                if is_login_expired_message(&error) {
                    let _ = mark_account_expired(&app, &account.id);
                }
                results.push(publish_target_result(&account, "failed", &error, None));
            }
        }
    }

    Ok(PublishWorkResponse { targets: results })
}

fn expired_publish_result(
    app: &AppHandle,
    account: &ChannelAccount,
    platform_id: &str,
) -> PublishWorkTargetResult {
    let _ = mark_account_expired(app, &account.id);
    publish_target_result(
        account,
        "failed",
        &format!("{}登录已失效，请重新登录后再发布。", platform_name(platform_id)),
        None,
    )
}

fn platform_publish_capability_error(
    platform_id: &str,
    content_type: &str,
    target: &PublishWorkTargetRequest,
) -> Option<String> {
    let platform_id = normalize_platform_id(platform_id);
    let platform_name = platform_name(&platform_id);
    if !matches!(content_type.trim(), "video" | "article") || !is_publish_platform(&platform_id) {
        return Some(format!("{platform_name}暂不支持当前作品类型。"));
    }
    if target.schedule_mode.trim() == "scheduled"
        && !matches!(platform_id.as_str(), "kuaishou" | "bilibili")
    {
        return Some(format!("{platform_name}定时发布链路还未接入，请先使用立即发布。"));
    }
    None
}

fn is_publish_platform(platform_id: &str) -> bool {
    matches!(
        normalize_platform_id(platform_id).as_str(),
        "kuaishou" | "bilibili" | "xiaohongshu" | "douyin" | "wechat-channels"
    )
}

fn publish_target_result(
    account: &ChannelAccount,
    status: &str,
    message: &str,
    remote_id: Option<String>,
) -> PublishWorkTargetResult {
    PublishWorkTargetResult {
        account_id: account.id.clone(),
        platform_id: normalize_platform_id(&account.platform_id),
        status: status.to_string(),
        message: message.to_string(),
        remote_id,
    }
}
