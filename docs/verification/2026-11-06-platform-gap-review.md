# CMS / Gateway / Templates 目标差距审查

审查日期：2026-11-06（Asia/Shanghai）。

本次核对本地代码、相关工作树、历史验收记录并运行有限测试；没有重新登录生产后台、核验服务器镜像或执行生产部署。历史公网结果不代表 11 月 6 日的实时状态。

## 结论

核心能力已有较多实现，但还不能把当前版本认定为“非技术人员可自助上线并持续运营的平台”。主要差距依次是：跨仓成果未整合、预览交付未闭环、新站 Gateway 自动开通缺失、生产端到端验收未闭环，以及旧站迁移和生产运维能力不足。

此前“单站点 MVP 已完成”的判断应限定为：部分开发工作树和隔离环境的核心链路有实现及通过记录。这不等同于当前主目录组合、正式发布版本或生产环境已经满足完整目标。

## 目标依据

- `docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`：非技术人员在 10 分钟内创建包含首页、导航、商品、联系页的网站；桌面和移动预览；内容独立发布；模板升级需明确采用。
- `docs/roadmap/2026-11-01-建站与内容维护平台-roadmap.md`：模板契约驱动编辑，Gateway 权威发布状态，公开运行时脱离 CMS/control，询盘统计、多站点和运维闭环。
- 支付、订单、库存、物流不属于当前建站目标；自由嵌套布局也不是当前 template mode MVP 的必要条件。

## 2026-11-06 新增目标与差距：唯一内容编辑工作区

用户新增要求：CMS 收拢为一处内容编辑，边编辑边预览；当前用模板预制排版，后续再开放自由排版。对应 [补充设计](../superpowers/specs/2026-11-06-single-content-workspace-design.md) 与 B5–B7，不属于已实现成果。

代码证据：`ui/src/layouts/dashboard/aside-content.tsx` 同时提供网站内容和“完整内容模型”；`ui/src/router.ts` 仍有独立 EntryView；`ui/src/views/dashboard/studio.tsx` 提供“打开完整编辑器”；`ui/src/components/studio/fields.tsx` 的已有富文本要求跳转完整编辑器。页面内容与页面设置分别渲染表单，VisualPageEditor 目前主要同步区块/导航/SEO，不能据此认定全部内容已能实时预览。

差距拆分：B5 收口路由、侧栏和工作区；B6 在工作区补齐复杂内容编辑与保存；B7 合并本地编辑会话、自动预览及保存反馈。B3/D1/D2 新增旧入口兼容、未保存实时预览、乱序响应、部分保存、冲突及模板布局边界验收。自由排版保留现有布局模型扩展点，本期不开放。

## 一、已确认的阻塞项

### 1. P1：跨仓功能留在未提交工作树，当前组合无法通过契约测试

本次检查的代码位置：

| 仓库 | 当前目录状态 | 其他目录中的成果 |
| --- | --- | --- |
| CMS | `65b30d5`，分支 `codex/unified-template-preview`；有未提交统一预览改动 | 已纳入较多契约、编辑器、运营接口和 UAT 修复 |
| Gateway | 主目录 `master` 为 `dcbdd2f` | `~/.codex/worktrees/gateway-contract-runtime` 同一 HEAD 下有大量未提交改动：artifact、traffic、ingest、域名及数据库迁移 |
| Templates | 主目录 `6e00925`，分支 `codex/unified-preview-bundles`；有未提交预览打包改动 | `~/.codex/worktrees/templates-contract-runtime` 同一 HEAD 下有未提交 contracts、editor、artifact 读取和资源路由 |
| Preview | 独立仓库 `f031349` | 服务及 CI 已存在，不能据此认定生产服务与 bundle 已可用 |

复现：

```sh
node ops/e2e/contract-roundtrip.mjs
```

使用默认相邻仓库失败：`validateContractSnapshotV1 is not a function`。

```sh
E2E_GATEWAY_ROOT=/Users/445101599qq.com/.codex/worktrees/gateway-contract-runtime \
E2E_TEMPLATES_ROOT=/Users/445101599qq.com/.codex/worktrees/templates-contract-runtime \
node ops/e2e/contract-roundtrip.mjs
```

同一测试通过。此命令使用现有 CMS 编译产物，证明所测组合的契约互通，不代替从干净源码重新构建及真实浏览器验收。

需要：整合 Gateway 架构工作树；合并 Templates 契约与统一预览两条改动；保留 CMS UAT 修复；固定四仓 commit、契约版本和镜像 digest；从干净检出构建验证。数据库迁移需随 Gateway 发布，并保留回退方案。

### 2. P1：当前公开模板仍实时依赖 Gateway control，worker 仍承担流量

证据：

- `Independent-Website-Templates/templates/aeroframe/1.0.3/storefront/server/utils/published.mjs:25`：渲染读取 `/api/v1/sites/:siteId/published-release`。
- FireGuard 1.0.0 的同名文件也采用该路径。
- `Independent-Website-Gateway/packages/worker/src/index.ts:64` 创建 router，`:73` 在 worker 内监听代理端口，`:178` worker 退出时关闭 router。

影响：当前这套实现不能保证 control 或 worker 停止后网站仍可正常服务。此前隔离测试通过所用的新实现，不能自动覆盖当前目录版本。

需要：交付已有的独立 traffic 和 artifact 实现；让页面、商品、图片、重定向、sitemap 都读取发布产物；分别停止 CMS、control、worker，验证真实模板仍可访问。还需验证不健康候选和资源损坏不会替换 active。

### 3. P1：新建 CMS 网站不会自动形成可发布的 Gateway 站点

证据：`backend/src/workspaces/controller.ts:223` 的 createSite 只写入 CMS SiteInstallation；`backend/src/presets/gateway-client.ts:47` 从 `GATEWAY_SITE_BINDINGS` 或兼容环境变量选择绑定。

影响：用户能创建网站和内容，但新站上线仍依赖人员补 Gateway 身份和部署配置。只为 UAT 站手工补一个绑定，不能实现以后每个新站都自助上线。

需要：增加服务端幂等开通流程，创建/关联 Gateway workspace/site，持久保存映射和开通状态；支持失败重试及重复请求恢复；提供真实域名接入信息。建议先给新站分配平台默认域名，再引导绑定自有域名，使首次上线不受外部 DNS 生效时间约束。

验收：新建第二个站点无需修改环境变量、数据库或重启服务，即可预览、发布和访问；两站内容、域名、权限隔离。

### 4. P1：统一预览已有实现，但尚缺同版本发布和生产闭环证据

CMS 的 `backend/src/storefront/preview-service.ts` 已能按精确模板 ID/version 解析 renderer；Preview 服务已支持 registry 和 bundle 校验；Templates 主目录已有静态 bundle 和发布流程改动，但相关 CMS/Templates 改动尚未提交。

历史会话仍停留在预览域名连通性确认和 CMS 配置生效环节。不能把该历史 DNS 观测当作当前公网事实。

需要：提交集成改动；为变更的模板分配新补丁版本，避免重写已发布版本；发布并同步 OCI bundle、registry 和服务；核对 DNS、TLS、CSP、CMS origin 与后端配置；验证 FireGuard、AeroFrame 桌面/移动预览、未保存草稿、页面切换及预览与公开渲染一致性。

验收：新增符合规范的模板版本只需发布其产物和登记 registry，无需为每个版本修改 CMS 代码或重新填写独立预览 origin。

### 5. P1：代码测试通过尚未转换为完整的公网验收

11 月 3 日 UAT：38 项中 23 通过、8 失败、4 阻塞、1 未执行。11 月 4 日修复记录表明若干产品缺陷已在代码层修复并通过回归，不能继续把这 8 项全部列为未修复代码问题。

但该记录仍要求完成 Gateway 绑定、HTTPS challenge、域名路由和预览服务部署，再验证公开首页、商品、SEO、询盘和统计；当时 challenge 与 UAT 商品页均为 404。本次没有重新验证生产状态。

需要：在固定发布组合部署后，从新账号/新站重新走一遍完整流程；确认看到的是新站内容及正确 release，不能只凭首页 HTTP 200 判定上线。覆盖编辑、桌面/移动预览、首次发布、第二次内容发布、失败保留旧版、回滚，以及询盘提交到后台和访问事件到看板。

## 二、距离可持续运营平台的剩余开发

### 6. 模板通用性与升级迁移

CMS 已有 editor contract、兼容适配器、升级预览和明确采用入口；Templates 的新 editor/contract 声明仍主要在架构工作树中。需要用第三个内容结构不同的模板证明“不修改 CMS 核心即可接入”，不能仅以 AeroFrame 与 FireGuard 的已有结构作为完成依据。

`backend/src/presets/import.ts:57` 会比较模型/页面签名并返回升级影响，存在结构差异时仍要求新安装；`createMigrationPlan` 生成迁移步骤，但这不等于执行数据迁移。需要补迁移 dry-run、逐字段/区块差异、新 artifact 预览、管理员采用、失败恢复和升级回滚。

### 7. P6.3 旧站迁移与灰度

已有 legacy adapter 和快照投影函数，但尚缺完整迁移作业、执行记录及逐站点灰度机制。实施计划 P6.3 仍全部未勾选，计划中的 `backend/src/migrations/` 在当前目录不存在。

需要串联旧 manifest、sectionConfigs、快照、资源和路由迁移；记录新旧版本及 route revision；支持 dry-run、幂等重试、单站灰度和失败回退。确认已迁移站点不再依赖 CMS 兼容读取。

### 8. P7 运维与发布门禁

需要形成 CMS 数据、Gateway 数据库、发布 artifact、媒体和路由快照的一致备份及恢复演练，并接入公开站点可用性、5xx、发布失败、证书和备份告警。

Gateway 已有持久 PublishOperation、租约和 `SKIP LOCKED` 领取机制，不能称为“完全没有发布队列”。剩余重点是跨站公平性、限速、配额、重试策略和故障可观测性。

CMS release workflow 已运行本仓测试和构建，但没有串入当前 `contract-roundtrip`、`quality-gate`、真实跨仓故障演练。需要将固定四仓版本的集成验证作为发布门禁，消除依赖个人未提交工作树的通过记录。

## 三、建议执行顺序与退出标准

| 顺序 | 工作包 | 完成标准 |
| --- | --- | --- |
| 1 | 整合四仓版本及旧工作树成果 | 干净检出即可构建，默认目录契约测试通过，数据库迁移和版本清单完整 |
| 2 | 发布统一预览及自足运行时 | 两种模板桌面/移动真实预览；CMS/control/worker 停止后公开页面及资源仍可用 |
| 3 | 新站自动开通与域名接入 | 第二个新站无需人工补绑定；默认域名可访问，自有域名有明确引导和状态 |
| 4 | 重新完成生产 UAT | 非技术用户完成完整建站维护流程；发布/回滚和运营数据闭环有证据 |
| 5 | 第三模板接入、升级迁移与旧站灰度 | 无 CMS 特例代码；升级可预览、可采用、可回退；旧站逐站迁移 |
| 6 | 运营保障与强制发布门禁 | 备份可恢复，故障有告警，每次发布验证固定跨仓组合 |

其中最小备份、告警及发布前验证应随首次试运营部署落实；完整迁移自动化、配额和规模化调度可继续分阶段推进。

## 四、本次实际验证

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| CMS Gateway client/publish、preset preview、preview service | 48 通过 | 定向后端测试 |
| UI preview、publication、template upgrade | 15 通过 | 模块测试，不是浏览器全流程 |
| Preview 服务 | 2 通过 | 本地服务测试 |
| Gateway 主目录 npm test | control 81、contracts 2、worker 57 通过 | 共 37 个数据库集成用例跳过；构建通过 |
| Templates 主目录 npm test | 33 通过、1 跳过、1 失败 | 失败是镜像测试无法连接本机 Docker daemon，不能据此判定模板代码失败 |
| 当前默认三仓契约互通 | 失败 | Gateway 缺少新契约校验导出 |
| 指定两个架构工作树的契约互通 | 通过 | 依赖未提交工作树和现有 CMS 编译产物，不是干净发布验证 |

本次未修改业务代码或部署配置。Gateway 测试自动生成的 next-env.d.ts 路径变动已恢复；新增内容仅为本审查报告。
