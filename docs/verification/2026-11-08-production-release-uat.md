# 2026-11-08 生产发布与 UAT 记录

## 发布结论

2026-11-08 已完成四个仓库到远端的推送，并在 `ubuntu@101.33.78.203` 上完成生产试用切换：

- CMS 运行 `1.1.0`，源码提交 `48d7a84e1403c69024dcf84301045f5e16e511ab`。
- Gateway 的 control、traffic、ingest 和 worker 分离运行，统一使用 `1.1.0` 镜像，源码提交 `cf2122aca26da26115864e2c7abf225f51faf398`。
- AeroFrame `1.0.4` 与 FireGuard `1.0.1` 的公开不可变镜像、Preview artifact 和 bundle 已登记并安装。
- Preview 服务运行 `1.0.0`，源码提交 `5ee66507a9da81e262b72e06f213be4a2b34fe42`。
- 当前两个公开站继续提供旧内容；系统没有静默升级不兼容模板。发布平台与新模板已部署，但“新模板公开站首批试运营”仍需完成 UAT 站的 Gateway/域名绑定和真实发布。

可复核身份与镜像摘要见 [2026-11-08-production-candidate.json](../releases/2026-11-08-production-candidate.json)。

本次是用户明确授权的生产试用切换。中央 Platform release gate 尚未取得专用 self-hosted runner、隔离 DNS/TLS 输入和完整正式证据，因此没有生成正式 `AcceptanceEvidence`，也没有声称正式门禁回执已通过。

## 推送与 CI

| 仓库 | 远端分支 / 提交 | CI |
| --- | --- | --- |
| CMS | `release/v1.1.0` / `48d7a84e1403c69024dcf84301045f5e16e511ab` | [run 42468843912](https://github.com/tangtianshuo/cms/actions/runs/42468843912)，成功 |
| Gateway | `release/v1.1.0` / `cf2122aca26da26115864e2c7abf225f51faf398` | [run 42469256210](https://github.com/tangtianshuo/Independent-Website-Gateway/actions/runs/42469256210)，成功 |
| Templates / AeroFrame | `release/v1.0.4` / `d099baeb62e7dfab836d58d00fc117a5f192a141` | [run 42468851648](https://github.com/tangtianshuo/Independent-Website-Templates/actions/runs/42468851648)，成功 |
| Templates / FireGuard | `release/v1.0.1` / `f286c2ddf9cb1b31f076860c5449f251b07886c9` | [run 42468931678](https://github.com/tangtianshuo/Independent-Website-Templates/actions/runs/42468931678)，成功 |
| Preview | `release/v1.1.0` / `5ee66507a9da81e262b72e06f213be4a2b34fe42` | [run 42466096216](https://github.com/tangtianshuo/Independent-Website-Preview/actions/runs/42466096216)，成功 |

Templates 的公共交付代码位于 `codex/platform-delivery-2026-11-08`，`31636b963c1cf59c639de64f4db94998b04220c0`。版本发布分支只负责选择不可变模板产物。

## 运行身份与健康

| 服务 | 运行镜像 | 状态 |
| --- | --- | --- |
| CMS | `ghcr.io/tangtianshuo/cms@sha256:275b6b78d542f3b96772351ada013e20ca86304a512a1a47e23048630324c4db` | healthy |
| control | `ghcr.io/tangtianshuo/independent-website-gateway@sha256:2bccbc3d9bcb8a8ae9b3edcca20e7793b42f3fb49321c693ec5dc60808170587` | healthy |
| traffic | 同上 | healthy，2 条活动路由 |
| ingest | 同上 | healthy |
| worker | 同上 | running |
| Preview | `ghcr.io/tangtianshuo/independent-website-preview@sha256:fe181b6422554484d6e196219da1eca4c8aa1dee41839d2ed8aa889d5708bb28` | healthy |

生产的 13 个 Gateway PostgreSQL 迁移均已应用，切换前再次执行 `prisma migrate deploy`，结果为 `No pending migrations to apply`。

以下检查均返回 HTTP 200 且内容类型正确：

- `https://cms.novaintelligent.cn/`
- `https://shop.novaintelligent.cn/`
- `https://shop.novaintelligent.cn/collections`
- `https://shop.novaintelligent.cn/products/featured-product`
- `https://shop.novaintelligent.cn/pages/about`
- `https://fire.novaintelligent.cn/`
- `https://cms.novaintelligent.cn/api/v1/renderers`
- `https://cms.novaintelligent.cn/preview/aeroframe/1.0.4/`
- `https://cms.novaintelligent.cn/preview/fireguard/1.0.1/`

Preview HTML 返回 `no-store`、`noindex`、严格 CSP，并仅允许被 `https://cms.novaintelligent.cn` 嵌入。

询盘与统计入口的 CORS 预检均返回 204，允许 `https://fire.novaintelligent.cn`、`POST` 和 `content-type` 请求。实际询盘写入与后台运营处理留待人工 UAT，避免向生产数据引入测试询盘。

## 自动化验证

- CMS backend：334 项，307 通过，27 个数据库环境条件跳过，0 失败；backend typecheck 通过。
- CMS UI/storefront：串行执行 137 项，136 通过，1 个既有环境跳过，0 失败；UI typecheck 通过。
- Gateway：control 146 项中 89 通过、57 个数据库环境跳过；ingest 24 项中 11 通过、13 跳过；contracts 7/7、traffic 5/5、worker 107 项中 88 通过、19 跳过；typecheck、build 和 Prisma 校验通过。
- Preview：24 项中 23 通过、1 个 Docker 边缘条件跳过，0 失败；语法检查通过。
- Templates：公共 CI 对两版本均成功完成清单、storefront、构建、镜像、Preview bundle 和匿名拉取检查。本机没有可用 Docker daemon，模板本地完整测试中的镜像项无法在本机重跑；该环境限制不计为通过。

首次 UI 并行运行出现测试端口竞争；按仓库约定的串行方式重跑后 136/137 通过。该失败不来自生产候选中可见的功能失败。

## UAT 环境

已创建两个隔离工作区和新站，不影响现有公开站：

| 模板 | 工作区 | 测试站 | 状态 |
| --- | --- | --- | --- |
| AeroFrame `1.0.4` | `UAT AeroFrame 1.0.4 - 2026-11-08` | `7146bed0-9bfe-4478-ae8d-949ee8f3a3c3` | ready，4 页 |
| FireGuard `1.0.1` | `UAT FireGuard 1.0.1 - 2026-11-08` | `858bc30b-89b8-4d35-8bcd-ef8aef10b78c` | ready，4 页 |

工作区 ID 分别为 `4944bfad-b6d2-451e-bec9-9780efe4651c` 和 `df25b9f3-0129-4604-ba7e-0bd9b4206249`。

两个站的 `/api/v4/storefront/preview-runtime` 均返回 `status: ready`、`configured: true`，精确绑定本次 bundle 摘要。管理员浏览器登录、工作区加载、首页内容编辑工作区和 iframe 元素均成功加载，无页面脚本错误。

Gateway 准备阶段首次因 control 缺少 `CMS_INSTANCE_ID` 返回 `gateway_unauthorized`。修复为固定实例标识 `novaintelligent-cms` 并通过官方 retry API 重试后，两站均在第一次重试后进入 ready，默认绑定和 domain 记录已持久化。

用户选择使用短域名。已添加并接入以下自定义域名：

| 测试站 | 自定义域名 | Domain ID | 状态 |
| --- | --- | --- | --- |
| AeroFrame `1.0.4` | `aero-uat.novaintelligent.cn` | `e0183fcb-eb16-44c0-8542-df8410e70ca9` | 等待 DNS/TXT 和环境验证 |
| FireGuard `1.0.1` | `fire-uat.novaintelligent.cn` | `a93473ef-6821-4cf2-ab3b-4c1080d040bf` | 等待 DNS/TXT 和环境验证 |

短域名的所有权 TXT 记录由 CMS 域名页面或 API 返回。必须先完成 TXT 归属验证和 HTTPS 连接验证，再把短域名切换为主域名；不能绕过验证直接修改数据库。

现有 AeroFrame `1.0.3` 和 FireGuard `1.0.0` UAT 站的升级预检均显示结构不兼容且没有可安全采用的迁移，必须新建安装。这是阻止静默覆盖内容的预期行为，不能通过强制修改 Mongo 文档绕过。

### 已完成的内容与隔离测试

- 两个模板的首页标题都完成了“未保存预览不落库、保存后刷新可见、恢复原文成功”的测试。
- 两个模板都完成了 SEO 标题的未保存预览、保存、重新读取和恢复原文测试。
- 两站均通过 stale `expectedUpdatedAt` 写入测试，返回 409，服务器保留先写入版本；随后均成功恢复原值。
- 两站均通过唯一内容页创建；新页面路径和导航关联进入完整站点预览 payload，每站由 4 页增至 5 页。
- AeroFrame 上传的独占媒体只出现在 AeroFrame 素材列表，FireGuard 不可见。
- 新内容页创建和测试写入均使用 UAT 工作区，没有修改现有公开站。

## UAT 执行清单

以下结果分为自动通过和人工待测，不把“页面返回 200”当作完整 UX 通过。

| ID | 用例 | 状态 | 证据或下一步 |
| --- | --- | --- | --- |
| UAT-01 | 管理员登录与三工作区加载 | 通过 | 浏览器登录成功，无页面错误 |
| UAT-02 | 新模板导入与 ready 状态 | 通过 | 两版本各 4 页，桌面/商品/内容模型已生成 |
| UAT-03 | Preview 精确版本路由 | 通过 | 两个 descriptor、artifact、bundle 摘要与发布记录一致 |
| UAT-04 | 不兼容模板升级保护 | 通过 | 两旧站均要求新安装，未修改旧内容 |
| UAT-05 | 唯一内容工作区入口 | 部分通过 | 新 AeroFrame 首页进入 `/d/studio` 同一工作区；人工需确认所有旧深链 |
| UAT-06 | 未保存文本和页面资料预览 | 自动通过，视觉待人工 | 两站标题/SEO 均出现在预览 payload 且未落库；人工仍需确认画布视觉 |
| UAT-07 | 桌面与 390px 移动预览 | 待人工 | 切换两种视口，检查导航、表单、图片和文字溢出 |
| UAT-08 | 草稿保存、刷新和冲突保护 | 自动通过，UI 待人工 | 保存/读取/恢复和 409 冲突均通过；人工验证离开提示 |
| UAT-09 | 新内容页、导航和 SEO | 自动通过，视觉待人工 | 两站各创建一个 UAT 内容页并加入导航；SEO 保存/恢复通过 |
| UAT-10 | 图片上传与跨站隔离 | 自动通过 | AeroFrame 独占媒体可见，FireGuard 不可见 |
| UAT-11 | 首次发布到 Gateway | 阻塞 | UAT 站 `gateway.status=unconfigured`，需先完成默认域名或自定义域名绑定 |
| UAT-12 | 二次更新与回滚 | 阻塞 | 依赖 UAT-11 的不可变 Release |
| UAT-13 | 询盘提交与后台处理 | 待人工 | CORS 预检已通过；提交后核对重复键、处理状态和导出 |
| UAT-14 | 访问统计 | 待人工 | 访问公开 UAT 页后核对事件去重和看板 |
| UAT-15 | worker 故障时站点持续可用 | 通过 | 停止 worker 后两个旧公开站仍为 200 |
| UAT-16 | CMS 故障时站点持续可用 | 通过 | 停止 CMS 后两个旧公开站仍为 200 |
| UAT-17 | 全新 artifact runtime 的 control 隔离 | 待完成 | 旧模板运行时仍会依赖 control；需 UAT-11 后用新版本公开站复测 |
| UAT-18 | 备份完整性 | 通过 | PostgreSQL、Mongo、上传、路由状态 SHA-256 校验及恢复读取预检通过 |
| UAT-19 | 外部告警送达 | 阻塞 | 尚未配置获授权的真实通知接收方 |
| UAT-20 | 10 分钟真实新用户流程 | 阻塞 | 需要非开发和受邀用户参与，并完成公开域名 |

### 人工 UAT 操作顺序

1. 打开 `https://cms.novaintelligent.cn/` 并登录。
2. 在网站选择页进入 `UAT AeroFrame 1.0.4 - 2026-11-08` 工作区，确认工作台显示 4 个页面、1 个商品。
3. 从“编辑首页”进入内容工作区。修改首页标题但不点击保存，确认右侧预览在一个更新周期内出现相同文本。
4. 保持未保存状态切换页面，确认出现离开提示；取消离开后输入仍在。
5. 保存草稿并刷新，确认内容仍在；检查保存期间是否只出现过真实的部分保存/失败提示。
6. 切换桌面与 390px 视口，检查首页、导航、按钮、图片和联系区。
7. 新建唯一路径内容页，设置 SEO，加入导航，并确认预览与编辑器始终在同一工作区。
8. 对 `UAT FireGuard 1.0.1 - 2026-11-08` 重复第 2 至 7 步，重点检查消防产品、设备分类和联系表单布局。
9. 记录每一步开始/结束时间、求助次数、错误文本和阻塞点。目标是从创建向导到默认域名可访问不超过 10 分钟；DNS 外部等待单独记录。
10. 在完成 UAT-11 前不要用“发布成功”作为验收结论。当前 `https://shop.novaintelligent.cn/sitemap.xml` 仍由旧模板返回 404；需用新 artifact runtime 的公开站复验 sitemap，不能在旧站上宣称已修复。

## 当前阻塞项

1. 两个新 UAT 站已绑定 Gateway；短域名的 DNS、TXT 归属和 HTTPS 连接仍待用户完成与平台复核。
2. 默认长域名为不可变平台身份，当前仍为 primary；短域名验证通过后才能显式提升为 primary。
3. 中央 Platform release gate 未运行成功，原因是缺少专用集成 runner 和正式隔离输入；本次人工切换有候选摘要、备份和运行探针，但不替代正式门禁。
4. 外部告警接收方、off-host 备份副本和生产恢复演练尚未配置。
5. 真实用户 10 分钟 UAT 尚未开始。

这些阻塞项不阻止登录、编辑和私有预览 UAT，但阻止把当前状态标记为“试运营就绪”。

## 回退点

切换前数据库、Mongo、上传卷、路由状态、旧 Compose 与代理配置位于：

`/opt/novaintelligent/backups/platform-release-20261108T100734Z`

该目录的 `SHA256SUMS` 已全量校验；PostgreSQL dump 可列出恢复对象，Mongo archive 的 `mongorestore --dryRun` 完成且无失败。更早的完整备份位于：

`/opt/novaintelligent/backups/platform-delivery-2026-11-08-predeploy`

只回退应用代码时：

1. 停止当前 `worker traffic ingest preview control`。
2. 将备份中的旧 `compose.yaml` 作为独立 rollback Compose 文件使用。
3. 恢复旧 CMS/control/worker 镜像并启动，验证 control ready、两站 HTML 和路由 revision。
4. 如回退过程中曾运行新数据库迁移，保留新增列，不执行破坏性 down migration。
5. 数据或媒体异常时停止写入，先从备份恢复到隔离数据库和目标目录，确认页面、商品、图片、跳转及 sitemap 后再切换。
