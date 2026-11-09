# 2026-11-08 生产发布与 UAT 记录

## 结论

2026-11-09 已完成生产试用环境的补丁发布和两站 UAT 复验。当前状态可以支持继续试运营和人工验收，但不能标记为正式生产门禁通过。

- CMS、Gateway、Preview 和两个独立 Storefront 容器均运行正常。
- AeroFrame `1.0.5` 和 FireGuard `1.0.2` 的镜像、Preview artifact 与 bundle 已发布、登记并安装。
- 两个 UAT 站已显式采用补丁版本，现有模型、页面 ID、条目 ID 和编辑内容均保留。
- 新版本私有预览在真实公网 CMS 中完成握手；未保存输入实时更新，刷新不落库。
- 两个短域名均已配置 HTTPS 并作为 primary domain 使用。

精确发布身份见 [2026-11-08-production-candidate.json](../releases/2026-11-08-production-candidate.json)。

## 发布身份

| 组件 | 远端身份 | 运行状态 |
| --- | --- | --- |
| CMS | `release/v1.1.0` / `ffc7fbd171ec330eb8dcbb3a54e4a6d6c6abc3a1` | healthy |
| Gateway | `release/v1.1.0` / `cf2122aca26da26115864e2c7abf225f51faf398` | control、traffic、ingest healthy；worker running |
| Preview | `release/v1.1.0` / `5ee66507a9da81e262b72e06f213be4a2b34fe42` | healthy |
| AeroFrame `1.0.5` | `release/v1.0.5` / `f714d5050ccee8f48b2738db5ada0f82f9528848` | CI 成功，镜像已预拉取 |
| FireGuard `1.0.2` | `release/v1.0.2` / `ec06c8d577a551de4c600058c142e371ea9a771b` | CI 成功，镜像已预拉取 |

运行镜像：

- CMS：`ghcr.io/tangtianshuo/cms@sha256:8ae04b46484488ae8bfa7ac1011cd0b2ef8b4883d14d24ce33d8cec5419cc0ee`
- Gateway：`ghcr.io/tangtianshuo/independent-website-gateway@sha256:2bccbc3d9bcb8a8ae9b3edcca20e7793b42f3fb49321c693ec5dc60808170587`
- Preview：`ghcr.io/tangtianshuo/independent-website-preview@sha256:fe181b6422554484d6e196219da1eca4c8aa1dee41839d2ed8aa889d5708bb28`

## CI 与自动化验证

| 发布项 | GitHub Actions |
| --- | --- |
| CMS | [run 42537141419](https://github.com/tangtianshuo/cms/actions/runs/42537141419)，成功 |
| AeroFrame `1.0.5` | [run 42492873317](https://github.com/tangtianshuo/Independent-Website-Templates/actions/runs/42492873317)，成功 |
| FireGuard `1.0.2` | [run 42492897501](https://github.com/tangtianshuo/Independent-Website-Templates/actions/runs/42492897501)，成功 |

CMS 最终 CI 覆盖完整 backend、UI、storefront 构建，候选镜像构建、provenance 生成和 provenance 验证。模板 CI 覆盖干净依赖安装、模板清单、当前版本 storefront 测试、生产构建、镜像 smoke test、artifact contract、Preview 打包、匿名镜像拉取、immutable registry 写入和 provenance 校验。

本次补丁额外修复了三个真实问题：

1. CMS 与独立 Preview 在构建时没有固定 admin origin 时，通过受验证的 iframe handshake 协商 origin。
2. 模板锁文件重新生成，移除指向不存在 npm tarball 的条目；全新缓存下的 `npm ci` 可重复成功。
3. 兼容补丁升级不再执行未声明的迁移目标校验，也不进入迁移 staging；采用操作只更新模板安装身份，不重建内容。

本地新增验证：

- `backend/src/presets/import.test.ts`：18/18 通过。
- 后端 TypeScript typecheck 通过。
- 两个 storefront 均用全新 npm 缓存完成 `npm ci`、25/25 测试和生产构建。
- UI 定向预览测试 14/14、全量 UI/storefront 测试 137 通过、1 个既有环境项跳过。

## 公开端点

以下端点返回 HTTP 200：

- `https://cms.novaintelligent.cn/`
- `https://shop.novaintelligent.cn/`
- `https://fire.novaintelligent.cn/`
- `https://aero-uat.novaintelligent.cn/`
- `https://fire-uat.novaintelligent.cn/`
- Aero UAT：首页、`/collections`、`/products/featured-product`、`/pages/about`、UAT 内容页和 `/sitemap.xml`
- Fire UAT：首页、`/collections`、`/products/featured-product`、`/pages/about`、UAT 内容页和 `/sitemap.xml`

Preview 新版本均返回 `no-store`、`noindex, nofollow, noarchive`，CSP 仅允许 `https://cms.novaintelligent.cn` 嵌入。Preview registry 当前有 5 个 renderer：

- AeroFrame `1.0.4`、`1.0.5`
- FireGuard `1.0.1`、`1.0.2`
- Service Studio `1.0.0`

## 域名

请使用以下短域名：

| 站点 | 域名 | 当前角色 |
| --- | --- | --- |
| AeroFrame UAT | `aero-uat.novaintelligent.cn` | primary，HTTPS 验证通过 |
| FireGuard UAT | `fire-uat.novaintelligent.cn` | primary，HTTPS 验证通过 |

TXT 记录用于证明申请人对域名的控制权，防止其他用户把不属于自己的域名绑定到站点。平台会校验 TXT 值与 CMS 生成值一致；归属成功后建议保留记录，便于后续重新验证和续期检查。

## UAT 环境

| 模板 | 工作区 | 站点 | 状态 |
| --- | --- | --- | --- |
| AeroFrame `1.0.5` | `4944bfad-b6d2-451e-bec9-9780efe4651c` | `7146bed0-9bfe-4478-ae8d-949ee8f3a3c3` | ready，5 页，1 商品 |
| FireGuard `1.0.2` | `df25b9f3-0129-4604-ba7e-0bd9b4206249` | `858bc30b-89b8-4d35-8bcd-ef8aef10b78c` | ready，5 页，1 商品 |

两站的 `/api/v4/storefront/preview-runtime` 均返回 `status: ready`、`configured: true`，并准确绑定新 bundle：

- AeroFrame：`sha256:d4145cf70fb0466497dd75172fb9dc6f1aff1ba9d297a9f36dd5d8b33e1237df`
- FireGuard：`sha256:48c9cc77657b28443047147ca10ee803eb228b878e272cbda11e7a7204c57900`

## 本轮 UAT 结果

| ID | 用例 | 结果 | 证据 |
| --- | --- | --- | --- |
| UAT-01 | 管理员登录和工作区加载 | 通过 | 真实公网浏览器登录成功，无页面脚本错误 |
| UAT-02 | 模板导入和 ready 状态 | 通过 | 两站各 5 页，admin 工作区正常 |
| UAT-03 | Preview 精确版本路由 | 通过 | renderer 版本与 bundle digest 完全一致 |
| UAT-04 | 不兼容升级保护 | 通过 | 旧安装未被静默覆盖；新补丁使用明确采用 |
| UAT-05 | 唯一内容工作区 | 通过 | `/d/studio` 同时提供内容编辑、导航和预览 |
| UAT-06 | 未保存输入实时预览 | 通过 | Headline 未保存时在画布实时出现，未出现 “Waiting for a private CMS preview” |
| UAT-07 | 未保存内容不落库 | 通过 | 刷新后恢复已保存标题，临时文本消失 |
| UAT-08 | 桌面和 390px 布局 | 通过 | 外层和 iframe 均无横向溢出 |
| UAT-09 | 补丁采用保留内容 | 通过 | 模型、页面、条目 ID 和可编辑内容深度相等 |
| UAT-10 | 首次发布和二次发布 | 通过 | Gateway operation 达到 ready，公开页面可读取 |
| UAT-11 | 回滚和重新发布 | 通过 | 回滚后旧 Release 可访问，再发布后新版本恢复 |
| UAT-12 | 新内容页、导航和 SEO | 通过 | 两站内容页均进入公开路由和 sitemap |
| UAT-13 | 媒体跨站隔离 | 通过 | AeroFrame 独占媒体不在 FireGuard 素材列表出现 |
| UAT-14 | 草稿冲突保护 | 通过 | stale `expectedUpdatedAt` 返回 409，未覆盖新版本 |
| UAT-15 | 询盘处理和 CSV | 通过 | 两条 UAT 询盘完成状态更新、负责人分配和导出 |
| UAT-16 | 访问统计 | 通过 | 两站 analytics 返回 ready，访问摘要可读取 |
| UAT-17 | worker 故障持续可用 | 通过 | 停 worker 时两个公开站仍返回 200 |
| UAT-18 | CMS 故障持续可用 | 通过 | 停 CMS 时两个公开站仍返回 200 |
| UAT-19 | 新 artifact runtime | 通过 | 新公开站不依赖 control-plane fallback |
| UAT-20 | 备份完整性 | 部分通过 | PostgreSQL/Mongo/上传/路由状态完整性通过；未完成异机恢复 |

真实浏览器证据：

- [browser-verification.json](evidence/2026-11-08-production-uat/browser-verification.json)
- [AeroFrame 桌面实时预览](evidence/2026-11-08-production-uat/aeroframe-desktop-live-preview.png)
- [AeroFrame 390px 预览](evidence/2026-11-08-production-uat/aeroframe-mobile-preview.png)
- [FireGuard 桌面实时预览](evidence/2026-11-08-production-uat/fireguard-desktop-live-preview.png)
- [FireGuard 390px 预览](evidence/2026-11-08-production-uat/fireguard-mobile-preview.png)

公开页头部的模板品牌文字来自导入时保留的 `demo.brand`，因此仍可能显示原站名；CMS 安装版本、Preview runtime 和当前 Release 记录均已是 `1.0.5/1.0.2`。这是内容保留行为，不应通过改数据库强行覆盖。

## 建议的人工 UAT

1. 使用非开发账号，从网站选择开始完成一次新站创建、内容编辑、私有预览和发布。
2. 在 AeroFrame 检查首页标题、移动菜单、商品图片、联系表单和内容页。
3. 在 FireGuard 检查产品列表、主视觉、设备分类、联系表单和移动端文字换行。
4. 记录开始/结束时间、错误文本、求助次数和阻塞点；目标为 10 分钟内完成，DNS 外部等待单独记录。
5. 用一个普通业务用户确认公开页头部的原模板品牌是否需要作为站点内容修改。

## 当前阻塞项

1. 中央 Platform release gate 仍缺专用 self-hosted integration runner 和完整正式证据，本次是用户授权的生产试用发布。
2. 10 分钟真实新用户 UAT 尚未由外部用户完成。
3. 备份未复制到独立异机并完成恢复演练。
4. 外部告警接收方尚未配置，未产生真实送达证据。
5. 演示商品图片仍有空白占位，属于模板视觉完善项。

## 回退点

初始生产切换备份：

`/opt/novaintelligent/backups/platform-release-20261108T100734Z`

CMS 最终补丁切换前 Compose：

`/opt/novaintelligent/backups/cms-compatible-adoption-20261109T000028Z`

traffic 健康检查修复前 Compose：

`/opt/novaintelligent/backups/compose-traffic-health-20261109T000028Z.yaml`

应用回退时先停止当前 `worker traffic ingest preview control`，使用备份 Compose 恢复旧镜像，再启动并验证 control ready、两个公开站 HTML、sitemap 和 route revision。不要执行破坏性数据库 down migration；数据异常时先从备份恢复至隔离数据库并完成页面、商品、图片、跳转和 sitemap 核对，再切换。
