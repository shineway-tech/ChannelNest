use super::*;

pub(super) fn channel_platform(platform_id: &str) -> Result<&'static platforms::ChannelPlatform, String> {
    platforms::platform(platform_id).ok_or_else(|| "当前平台暂不支持".to_string())
}

pub(super) fn account_homepage_url(account: &ChannelAccount) -> Result<String, String> {
    channel_platform(&account.platform_id)?.homepage_url(&account.uid, &account.nickname)
}
