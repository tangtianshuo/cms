# FireGuard 消防设备生产端到端验收

2026-10-29，用户指定的生产主链路已完成：新增模板、生产 CMS 导入、编辑六款产品、生成图片并上传媒体库、内容选择媒体引用、Gateway 发布和公网验收。管理端草稿预览仍有独立兼容性限制，不能据此声明所有管理端功能通过。

生产入口：`https://fire.novaintelligent.cn/`。最终 release `76bf91b5-6710-4600-9bdd-44a873e76a37`，Gateway revision **2**，九个公开页面。首次发布 `0064638e-c1f4-443b-a05b-921d684e627d`；第二次仅更新首页内容绑定及 SEO。最终 CMS 页面显示“发布成功，独立站已更新”。

## 交付与发布

- 独立工作区：`861aee08-fcc2-4b5b-9948-c8a39fd242ad`；CMS/Gateway 站点：`12e0921b-270f-46f4-864c-8b5716178b31`。
- FireGuard **1.0.0** 已合入 Templates 仓库 `master` 并推送，source `6e00925af7d5ebe375ac255d415ff2bf75619369`。master Actions `40818372003`、release Actions `40818378391` 均成功。
- 公开模板镜像：`ghcr.io/tangtianshuo/independent-website-templates/fireguard@sha256:f9ef13e8b78eb0b10247990bdfd9b8ba88ba8791373eb50863633b4d64a64f38`。来源证明、匿名拉取、候选镜像运行检查均通过后登记 immutable registry。
- 模板测试：根测试 32 pass、1 条件 skip、0 fail，含实际 Docker build/smoke；storefront 15 pass；生产构建后的 runtime test 1 pass；manifest checksum/模型/路由验证通过。
- CMS **1.0.5** 已部署，source `0a3b95951a219e3650fd5242b4faa5e71ec73e78`。显式多站点绑定保留商城并加入消防站点。后端含真实 Mongo 测试 153 pass/0 skip，UI 34 pass/1 条件 skip，类型检查通过。
- 用户配置 Cloudflare DNS 后，已验证公网 HTTPS，Gateway Domain 为 verified，证书状态 external。站点入口与发布绑定已生效。

## 内容与图片

通过生产 CMS UI 实际保存六款产品：便携式干粉灭火器、二氧化碳灭火器、消防水带、消火栓箱、烟感报警器、应急照明灯。每款包含独立 slug、介绍、参考价、SKU 和对应媒体图片。首页与设备分类均保存六产品关联，数据库只读复核引用完整。关于页面、站点品牌与首页 SEO 已保存并发布。

七张图片使用用户授权的 imagegen CLI/API 备用方案、`gpt-image-2.5-flare` 生成。产品图实际为 1254×1254，首页图为 1981×793。经视觉检查后转换为 WebP，通过生产 CMS 文件选择器上传；内容编辑器从已有素材中选择引用。公网快照只引用 CMS 媒体地址，没有使用远程占位图。七个公开媒体文件的 SHA-256 均与生成后的本地 WebP 完全一致。

提示词、原始 PNG、WebP 和接触表保留在本地 `output/imagegen/fireguard/`；生成记录与产品文案副本保存在本报告证据目录。API 密钥没有写入仓库或证据。页面说明 AI 展示图片与演示参考价的用途，未声明未经核实的认证或性能。

## 生产验证结果

| 检查 | 结果 |
| --- | --- |
| 首页、目录、六产品详情、关于页 | 九页面 GET 与公开数据 API 均 200，六产品标题与内容匹配 |
| 七张公开媒体 | 全部 200、image/webp，文件哈希与生成资产一致 |
| 无效产品、无效页面、公开 `/preview`、无参数 API、旧示例产品路径 | 五项均 404 |
| 桌面布局 | 1280px 视口，无横向溢出；六产品图全部加载，hero 使用 CMS 媒体 |
| 移动布局与交互 | 390×844 CSS px iframe 直接加载生产站；菜单展开/收起、目录、产品详情、关于页导航通过，已保存截图；非实体手机测试 |
| 草稿隔离 | 保存带“草稿隔离验收”的产品标题后，硬刷新公网仍为原发布标题；随后通过 CMS UI 恢复原草稿 |
| 首页 SEO | 最终公开 title 与 description 均为保存的新值 |
| 原商城 | HTTPS 200，revision 4 与原活动 release `07b1ea4b-6865-497b-bbd5-dd5c084e6ac1` 保持一致 |

## 管理端观察与限制

1. **FireGuard 草稿预览未受 CMS 支持。** 页面明确提示 `fireguard@1.0.0` 不支持同版本预览；未绕过 origin/source 验证、未使用 AeroFrame 冒充预览。本次通过真实生产站验证最终效果。需后续补独立 FireGuard 预览服务及 CMS 身份映射。
2. **媒体页加载观察。** 上传后显示七图，完整导航重新进入时曾显示空列表；服务器确认七图均持久化在正确工作区，Studio 图片选择器可重新加载并绑定，公开图片访问通过。没有重复上传或修改媒体归属；媒体页初始化问题仍需单独修复。
3. **多选关联控件显示问题。** 选择多产品后，控件没有保持可视选中态；只读复核保存数据确认首页及分类均包含六个关联，公网六产品展示通过。
4. **首页故事区内容缺口。** 首页模板的装饰故事区正文/配图未从首页投影提供，实际关于页正文及封面正常。该区域需后续完善内容映射。

## 证据

证据目录：`evidence/2026-10-29-fireguard/`。

- `gateway-final-state.json`：消防最终活动 release、镜像和九页面，以及原商城状态。
- `public-checks.json`、`public-pages.json`：最终页面、公开数据、媒体哈希和 404 检查。
- `draft-isolation.json`、`draft-marker-saved.png`、`public-product-draft-isolated.png`：草稿隔离。
- `release-final.png`、`public-home-desktop.png`、`six-products-saved.png`、`media-seven-uploaded.png`：生产操作与结果截图。
- `mobile-home-390.png`、`mobile-menu-390.png`、`mobile-product-390.png`、`mobile-about-390.png`：实际生产站移动视口检查。
- `template-release.json`、`image-generation-records.json`、`content-records.json`、`progress.json`：发布、生成、内容与范围记录。
