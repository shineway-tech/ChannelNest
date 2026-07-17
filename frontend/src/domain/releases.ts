import type { LanguageMode } from "./types";
import type { ReleaseHistoryEntry } from "../pages/releases";

export function releaseHistoryForLanguage(language: LanguageMode): ReleaseHistoryEntry[] {
  if (language === "en") {
    return [
      {
        version: "1.1.3",
        date: "2026.07.17",
        icon: "settings",
        sections: [
          {
            icon: "settings",
            title: "Desktop Update",
            items: [
              "Fixed macOS platform icons appearing washed out on some Apple Silicon devices by adding a CSS fallback for older WebView rendering",
              "Rebuilt the macOS updater archive from the notarized DMG app so automatic updates keep valid Apple signing metadata",
            ],
          },
        ],
      },
      {
        version: "1.1.2",
        date: "2026.07.17",
        icon: "download",
        sections: [
          {
            icon: "download",
            title: "Image Delivery",
            items: [
              "Moved generated image delivery to temporary OSS files to reduce pressure on the application server bandwidth",
              "Removed the previous server-storage download path and added client acknowledgement cleanup for temporary image files",
            ],
          },
        ],
      },
      {
        version: "1.1.1",
        date: "2026.07.17",
        icon: "spark",
        sections: [
          {
            icon: "spark",
            title: "Content Generation",
            items: [
              "Added AI prompt optimization for image generation, charging 2 points per optimization and keeping the selected image controls in the optimization brief",
              "Improved image generation task handling with clearer generated states, reference image cleanup, and generated image saving into the local resource library",
              "Refined image prompt controls, default image type, color options, and resource selection behavior for publishing",
            ],
          },
          {
            icon: "wallet",
            title: "Payments and Account Center",
            items: [
              "Improved the Alipay checkout dialog so the QR code is fully visible and centered on Windows",
              "Refined membership, point ledger, and order history presentation with clearer filtering and pagination",
              "Improved user-facing error prompts for unavailable services and checkout failures",
            ],
          },
          {
            icon: "settings",
            title: "Stability and Polish",
            items: [
              "Fixed reference image removal and stale uploaded reference cleanup after image tasks start",
              "Improved layout stability for image resources, publish media spacing, and light theme publish controls",
              "Optimized several content generation and publishing UI details for a tighter desktop layout",
            ],
          },
        ],
      },
      {
        version: "1.1.0",
        date: "2026.07.16",
        icon: "spark",
        sections: [
          {
            icon: "wallet",
            title: "Membership, Points, and Payments",
            items: [
              "Added membership and points center with membership plans, point packages, point ledger, and order history",
              "Connected Alipay website payment with QR-code checkout, order polling, callback verification, and entitlement delivery",
              "Added email verification registration and sign-in, friendlier error prompts, and in-app message center",
            ],
          },
          {
            icon: "spark",
            title: "Content Generation",
            items: [
              "Added copy generation with streaming output and clearer structured options",
              "Added AI image generation with 1K, 2K, and 4K quality choices, multi-image task handling, and progressive result display",
              "Integrated Baoyu image prompt guidance for general social images and infographic-style assets",
            ],
          },
          {
            icon: "folder",
            title: "Resource Library and Publishing",
            items: [
              "Generated copy and images can be saved into the local resource library and reused in publishing",
              "Improved resource selection, image preview stability, publish media spacing, and image list layout",
              "Refined Bilibili article publishing, visibility settings, scheduled publishing, and cross-platform publish behavior",
            ],
          },
        ],
      },
      {
        version: "1.0.1",
        date: "2026.07.02",
        icon: "spark",
        sections: [
          {
            icon: "activity",
            title: "Creator Center Analytics",
            items: [
              "Connected overview metrics for Xiaohongshu, WeChat Channels, Douyin, Bilibili, and Kuaishou",
              "Added platform-specific periods such as yesterday, recent 7 days, recent 30 days, recent 90 days, and cumulative totals",
              "Cached synced account data locally for faster switching and refreshes",
            ],
          },
          {
            icon: "layers",
            title: "Works Data",
            items: [
              "Added paged works lists, latest work cards, covers, status badges, pinned labels, and content-type labels",
              "Supported separate video and article/image views where the platform creator center exposes them",
              "Improved metric mapping for latest works and detail pages across connected platforms",
            ],
          },
          {
            icon: "settings",
            title: "Experience Improvements",
            items: [
              "Refined the platform account sidebar, search, selected states, loading states, and light theme colors",
              "Reduced refresh flicker and layout jumps while syncing account and works data",
              "Added manual package artifacts for branch-triggered desktop packaging",
            ],
          },
        ],
      },
      {
        version: "1.0.0",
        date: "2026.06.23",
        icon: "spark",
        sections: [
          {
            icon: "lock",
            title: "Account Access",
            items: ["Password sign-in and registration", "Captcha verification", "Profile editing and password change"],
          },
          {
            icon: "layers",
            title: "Platform Accounts",
            items: ["Xiaohongshu, WeChat Channels, Douyin, Bilibili, and Kuaishou sign-in", "Multiple accounts per platform", "Avatar, nickname, followers, and status display"],
          },
          {
            icon: "refresh",
            title: "Account Operations",
            items: ["Refresh account data", "Delete connected accounts", "Open the platform creator homepage"],
          },
          {
            icon: "settings",
            title: "Client Settings",
            items: ["Chinese and English language switch", "Dark and light themes", "Local JSON configuration"],
          },
          {
            icon: "message",
            title: "Feedback",
            items: ["Submit feedback from the client", "Store feedback in the local service"],
          },
        ],
      },
    ];
  }

  return [
    {
      version: "1.1.3",
      date: "2026.07.17",
      icon: "settings",
      sections: [
        {
          icon: "settings",
          title: "桌面端更新",
          items: [
            "修复部分 Apple Silicon 设备上平台图标发白、模糊的问题，为旧版 WebView 增加 CSS 背景兜底",
            "从已公证的 DMG 应用重新生成 macOS 自动更新包，避免更新包丢失 Apple 签名元数据",
          ],
        },
      ],
    },
    {
      version: "1.1.2",
      date: "2026.07.17",
      icon: "download",
      sections: [
        {
          icon: "download",
          title: "图片交付",
          items: [
            "将生成图片交付改为临时 OSS 文件，降低应用服务器带宽压力",
            "移除原有服务器存储下载路径，客户端确认后自动清理临时图片文件",
          ],
        },
      ],
    },
    {
      version: "1.1.1",
      date: "2026.07.17",
      icon: "spark",
      sections: [
        {
          icon: "spark",
          title: "内容生成",
          items: [
            "新增图片生成的 AI 提示词优化能力，每次优化消耗 2 积分，并结合当前图片类型、画幅、风格、布局、配色和参考图设置生成更可用的提示词",
            "优化图片生成任务处理，完善生成中状态、参考图清理和生成图片加入本地资源库流程",
            "优化图片提示词控件、默认图片类型、配色选项和发布时从资源库选择内容的体验",
          ],
        },
        {
          icon: "wallet",
          title: "支付与会员中心",
          items: [
            "优化支付宝扫码支付弹窗，在 Windows 上二维码可以完整显示并保持居中",
            "优化会员、积分记录和订单记录展示，筛选与分页更清晰",
            "完善服务不可用、配置异常和支付失败时的用户提示",
          ],
        },
        {
          icon: "settings",
          title: "稳定性与细节",
          items: [
            "修复图片参考图无法删除和图片任务开始后参考图残留的问题",
            "优化图片资源列表、发布素材间距和浅色模式下的发布控件样式",
            "整理内容生成与发布相关界面，让桌面端布局更紧凑稳定",
          ],
        },
      ],
    },
    {
      version: "1.1.0",
      date: "2026.07.16",
      icon: "spark",
      sections: [
        {
          icon: "wallet",
          title: "会员、积分与支付",
          items: [
            "新增会员与积分中心，支持会员套餐、积分充值、积分记录和订单记录",
            "接入支付宝网站支付，支持二维码支付、订单轮询、异步回调验签和会员/积分发放",
            "新增邮箱验证码注册登录、友好的错误提示和消息中心",
          ],
        },
        {
          icon: "spark",
          title: "内容生成",
          items: [
            "新增文案生成，支持流式输出和更清晰的生成选项",
            "新增 AI 图片生成，支持 1K、2K、4K 质量选项、多图任务和生成结果逐张展示",
            "整合宝玉图片提示词体系，支持通用社媒图片和信息图类型资源生成",
          ],
        },
        {
          icon: "folder",
          title: "资源库与发布",
          items: [
            "生成的文案和图片可保存到本地资源库，并在发布作品时直接使用",
            "优化资源选择、图片预览稳定性、发布素材间距和图片列表布局",
            "完善 B 站图文发布、可见范围、定时发布和多平台发布流程",
          ],
        },
      ],
    },
    {
      version: "1.0.1",
      date: "2026.07.02",
      icon: "spark",
      sections: [
        {
          icon: "activity",
          title: "创作中心数据",
          items: [
            "接入小红书、视频号、抖音、B 站、快手的账号总览数据",
            "支持昨日、近 7 日、近 30 日、近 90 日、历史累计等平台对应周期",
            "同步后的账号数据会分平台缓存在本地，切换账号和刷新更顺手",
          ],
        },
        {
          icon: "layers",
          title: "作品数据",
          items: [
            "新增分页作品列表、最新作品、封面、状态标签、置顶标签和作品类型标签",
            "按平台能力区分视频、图文等作品类型，展示对应创作中心字段",
            "优化各平台最新作品详情数据映射，补齐播放、点赞、评论、收藏、分享等指标",
          ],
        },
        {
          icon: "settings",
          title: "体验优化",
          items: [
            "优化平台账号侧边栏、搜索、选中态、加载态和浅色模式配色",
            "减少刷新和切换作品列表时的抖动，数据同步过程更稳定",
            "完善手动触发桌面端打包时的安装包产物上传",
          ],
        },
      ],
    },
    {
      version: "1.0.0",
      date: "2026.06.23",
      icon: "spark",
      sections: [
        {
          icon: "lock",
          title: "账号体系",
          items: ["账号密码登录与注册", "验证码校验", "个人信息和密码修改"],
        },
        {
          icon: "layers",
          title: "平台账号",
          items: ["小红书、视频号、抖音、哔哩哔哩、快手账号登录", "同一平台支持多个账号", "展示头像、昵称、粉丝数和状态"],
        },
        {
          icon: "refresh",
          title: "账号操作",
          items: ["刷新账号数据", "删除已登录账号", "打开对应平台创作者主页"],
        },
        {
          icon: "settings",
          title: "客户端设置",
          items: ["中文 / 英文切换", "深色 / 浅色主题", "本地 JSON 配置"],
        },
        {
          icon: "message",
          title: "意见反馈",
          items: ["客户端内提交反馈", "反馈内容保存到本地服务"],
        },
      ],
    },
  ];
}
