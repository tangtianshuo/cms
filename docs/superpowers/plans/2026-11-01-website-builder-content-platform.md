# 建站与内容维护平台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有模板契约、CMS Studio、Gateway 发布和 Storefront 运行时基础上，交付一个边界清晰、可故障隔离、支持单站点建站和内容维护的 MVP，并为多站点运营与模板平台化保留演进路径。

**Architecture:** Templates 发布版本化的内容/编辑/渲染契约；CMS 保存草稿、页面配置和不可变 ReleaseSnapshot，承担 Studio、预览、发布请求和运营看板；Gateway 持有发布、部署、域名和活动版本状态；Storefront 只读取活动发布 artifact 并渲染公开页面。公开请求不依赖 CMS 或 Gateway control 的实时查询。

**Tech Stack:** TypeScript、Node.js、Fastify、Nuxt、Vue/Vite、MongoDB、PostgreSQL、Docker、Nginx/Traefik、Vitest/Node test、Playwright 或现有浏览器验收脚本。

**Spec:** [模板驱动内容与运行时隔离设计](../specs/2026-10-31-template-driven-content-runtime-separation-design.md)

**RoadMap:** [建站与内容维护平台 RoadMap](../../roadmap/2026-11-01-建站与内容维护平台-roadmap.md)

**Existing plan:** [模板驱动内容与 CMS/Gateway/Storefront 边界修复实施计划](2026-10-31-template-driven-content-runtime-separation.md)

## Global Constraints

- Gateway 是发布、部署、域名和活动版本状态的唯一权威。
- Storefront 公开请求不得调用 CMS 草稿/管理接口、CMS 私有媒体接口或 Gateway control API。
- 预览可以使用受保护的 CMS 预览接口，但预览凭证不能复用到公开运行时。
- 模板、manifest、renderer digest、Release artifact 和资源 checksum 不可变。
- CMS 草稿、Gateway 活动版本和运行时 artifact 必须分开建模。
- 第一阶段布局文档固定为 `mode: 'template'`，暂不开放任意代码或自由脚本。
- 所有 CMS 写操作使用 workspace/site 权限和 `expectedUpdatedAt` 乐观并发保护。
- 每个任务必须有最小测试集；每个里程碑必须有跨仓或 Docker E2E 证据。
- 迁移支持旧站点读取、失败回滚和逐站点启用。

## 实施顺序

```text
P0 基线与门禁
  → P1 Storefront 运行时隔离
  → P2 模板契约驱动 CMS
  → P3 Studio 建站编辑 MVP
  → P4 Gateway 发布状态闭环
  → P5 询盘与访问看板
  → P6 多站点、域名和迁移
  → P7 生产化与规模化
```

P1 与 P2 可以并行开发，但 P3 的正式验收依赖 P1 的公开运行时隔离。P4 在任何对外发布前必须完成。P5 可以在 P3 完成后并行。P6 只能在 P1–P5 的故障和权限测试通过后开始。

## Phase P0：基线与门禁

### Task P0.1：冻结当前契约和故障基线

**Files:**

- Modify: `docs/verification/2026-11-01-docker-e2e-closure.md`
- Create: `docs/verification/2026-11-01-platform-baseline.md`
- Modify: `ops/e2e/test.mjs`

**Interfaces:**

- `ContractSnapshotV1`：CMS 生成、Gateway 校验、Templates 渲染的共同输入。
- `FailureMatrix`：记录 CMS、Gateway control、worker、traffic、Storefront、analytics、lead ingest 的停止行为。

**Steps:**

- [x] 收录现有 Contract roundtrip、发布、恢复、退役和浏览器闭环证据。
- [x] 为公开页面、图片、重定向和 sitemap 增加逐项状态记录。
- [x] 为每个故障场景记录请求结果、响应时间、错误代码和是否产生回源请求。
- [x] 将基线文档作为后续阶段的对比入口，禁止使用“服务健康”替代页面可访问性证明。

> 复跑证据：`docs/verification/2026-11-01-platform-baseline.md`。当前隔离环境没有运行中的 Gateway worker，因此 worker 场景记录为“未运行”，待启动宿主 worker 的环境补做暂停/恢复实测。

**Test:**

```bash
node ops/e2e/test.mjs contract
node ops/e2e/test.mjs publish
node ops/e2e/test.mjs recovery
```

**Acceptance:** 基线文档能明确区分已验证能力、过渡依赖和未验证能力。

### Task P0.2：建立发布质量门禁

**Files:**

- Modify: `Independent-Website-Templates/.github/workflows/template-release.yml`
- Modify: `Independent-Website-Gateway/package.json`
- Modify: `cms/package.json`
- Modify: `ops/e2e/test.mjs`

**Steps:**

- [x] 将 manifest 校验、契约测试、CMS fixture、Gateway validator 和真实模板 runtime 串成一个门禁命令。
- [x] 失败输出区分 contract invalid、artifact invalid、renderer invalid、runtime unavailable。
- [x] 发布门禁失败时禁止更新 template registry 或 Gateway active release。
- [x] 把门禁结果写入验证目录，并保留 renderer digest、manifest checksum 和 Release checksum。

> 复跑证据：`docs/verification/2026-11-02-quality-gate.md`，命令为 `node ops/e2e/test.mjs quality-gate`。

**Acceptance:** 任意一个模板、契约或 artifact 校验失败时，旧活动版本保持不变。

## Phase P1：Storefront 运行时隔离

### Task P1.1：定义 RuntimeReleaseSource

**Files:**

- Create: `storefront/server/utils/runtime-release.mjs`
- Modify: `storefront/server/utils/release.mjs`
- Modify: `storefront/server/utils/site-context.ts`
- Create: `storefront/test/runtime-release.test.mjs`

**Interfaces:**

```ts
type RuntimeReleaseSource = {
  siteHost: string;
  releaseId: string;
  artifactRoot: string;
  manifestPath: string;
  assetRoot: string;
};

function readRuntimeRelease(source: RuntimeReleaseSource): PublishedSite;
function readRuntimeAsset(source: RuntimeReleaseSource, assetPath: string): Uint8Array;
```

**Steps:**

- [x] 将公开运行时读取逻辑从 CMS origin 查询改为 artifact manifest 和本地资源根目录。
- [x] 校验站点 host、releaseId、templateId、rendererDigest 和 checksum。
- [x] 将 `artifact missing`、`artifact invalid`、`asset missing` 映射为稳定错误码。
- [x] 只允许经过规范化的绝对路径和站点资源路径，拒绝路径穿越。

**Test:**

```bash
npm test --prefix storefront -- runtime-release
```

**Acceptance:** 运行时读取器不需要 `NUXT_CMS_INTERNAL_ORIGIN`，并能拒绝错误站点、错误 checksum 和缺失资源。公开路由接入该读取器由 Task P1.2 完成。

### Task P1.2：拆分预览和公开路由

**Files:**

- Modify: `storefront/server/api/published.get.ts`
- Modify: `storefront/server/routes/sitemap.xml.get.ts`
- Modify: `storefront/app/pages/[...path].vue`
- Modify: `storefront/app/pages/preview.vue`
- Create: `storefront/test/public-runtime-isolation.test.mjs`

**Steps:**

- [x] 公开页面中间件、页面和 sitemap 已统一通过 `loadPublicSite` 选择 artifact 或显式兼容源；产品页仍属于旧产品 API，待 P2 页面模型迁移后接入。
- [x] `/preview` 继续接受 CMS Studio 的短时预览消息，但不向公开路由暴露草稿接口。
- [x] artifact 模式下删除公开请求回退到 CMS 的逻辑；CMS 兼容读取必须显式设置开关。
- [x] 通过 `NUXT_RUNTIME_ARTIFACT_ROOT`、`NUXT_RUNTIME_RELEASE_ID` 和 `NUXT_LEGACY_CMS_PUBLIC_READ` 区分 preview、artifact 和兼容链路。
- [x] 修复 `site-domain` 中间件无条件回源 CMS 导致整页 SSR 502 的问题；artifact 模式下整页 SSR 已可脱离 CMS。

**Acceptance:** artifact 模式下公开路径无 CMS 出站请求；预览可以显示未保存草稿；预览凭证不能访问公开运行时。已通过 CMS 停止后的整页 SSR、发布 API、资源和 sitemap 验证。

### Task P1.3：发布 artifact 与资源独立化

**Files:**

- Modify: `backend/src/presets/releases.ts`
- Modify: `backend/src/release-contract/assets.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/releases.ts`
- Modify: `Independent-Website-Gateway/packages/worker/src/deployment.ts`
- Modify: `ops/e2e/compose.yml`

**Steps:**

- [x] 发布阶段收集媒体 ID、内容类型、checksum、资源路径和引用关系。
- [x] 将 CMS 媒体 URL 改写为 artifact 内的 `/_assets/*` 地址。
- [x] Gateway 校验快照 checksum、资源清单和 renderer digest。
- [x] worker 以只读方式挂载 artifact；运行实例不访问 CMS 媒体接口。
- [x] 资源复制失败时不切换活动版本，保留旧 artifact。

上述能力已有 Gateway、Templates 和 CMS 跨仓测试覆盖；Storefront artifact 的页面、资源、重定向、sitemap 以及 CMS/control/worker 停止演练见 [runtime isolation verification](../../verification/2026-11-01-runtime-isolation.md)。

**Acceptance:** CMS 停止后页面、图片、重定向和 sitemap 均可访问；资源 checksum 错误会阻止发布。

### Task P1.4：完成故障隔离 E2E

**Files:**

- Modify: `ops/e2e/test.mjs`
- Create: `docs/verification/2026-11-01-runtime-isolation.md`

**Steps:**

- [x] 启动并发布一个包含页面、资源、重定向和 sitemap 的站点 artifact。
- [x] 停止 CMS，验证公开页面、资源、重定向和 sitemap 仍成功。
- [x] 停止 Gateway control，验证已有 artifact 路由继续成功。
- [x] 停止 worker，验证独立 worker 停止后已有 artifact 运行实例继续成功；worker/traffic 持久路由测试通过。
- [x] 使用 network-isolated Storefront 和 CMS 日志窗口验证公开请求没有 CMS 发布接口出站请求。
- [x] 固化“control 停止时新发布进入 pending”的业务状态断言。

**Acceptance:** P1 的公开 artifact 读取、CMS/control/worker 停止后的已有路由可用性、基础出站审计，以及 control 停止时新发布保持 `pending/gateway_unavailable` 均已通过。自动化入口为 `node ops/e2e/test.mjs runtime-isolation`。

## Phase P2：模板契约驱动 CMS

### Task P2.1：模板安装和兼容性模型

**Files:**

- Create: `backend/src/template-contract/model.ts`
- Create: `backend/src/template-contract/registry.ts`
- Create: `backend/src/template-contract/compatibility.ts`
- Modify: `backend/src/presets/registry.ts`
- Modify: `backend/src/presets/installed.ts`
- Modify: `backend/src/presets/import.ts`

**Interfaces:**

- `TemplateContract`: manifest、editor contract、renderer contract、migrations、digest。
- `resolveTemplateCompatibility(installed, requested): 'display-compatible' | 'data-compatible' | 'migration-required' | 'incompatible'`。

**Steps:**

- [x] 保存已安装模板的 manifest、editor contract、renderer contract、source commit 和 digest。
- [x] 将 AeroFrame/FireGuard 的固定分支校验改为通用契约校验。
- [x] 旧站点没有 editor contract 时生成兼容适配器并记录来源。
- [x] 对需要迁移的版本生成 migration plan，不直接覆盖站点配置。

> 复跑证据：`backend/src/template-contract/compatibility.test.ts`、`backend/src/presets/registry.test.ts` 和 `backend/src/presets/import.test.ts`，共 26 项通过。

**Acceptance:** 新模板只提供契约即可被安装；不兼容版本被拒绝且不会修改现有站点。

### Task P2.2：契约驱动内容和页面模型

**Files:**

- Create: `backend/src/template-contract/editor-schema.ts`
- Create: `backend/src/content-editor/schema-form.ts`
- Modify: `backend/src/presets/controller.ts`
- Modify: `backend/src/presets/site-model.ts`
- Modify: `ui/src/sdk/handlers/studio.ts`
- Modify: `ui/src/views/dashboard/studio.tsx`

**Steps:**

- [x] API 返回字段 key、控件、分组、说明、默认值、条件显示和权限需求。
- [x] UI 根据契约生成文本、数字、枚举、富文本、媒体、引用和数组控件。
- [x] 保存前后执行相同的 schema 校验，错误回链到字段和页面节点。
- [x] 页面蓝图声明绑定模型、固定路径、可用区块和导航规则。
- [x] 内容字段使用稳定 field key，展示标签只来自当前模板版本。

> 复跑证据：`backend/src/content-editor/schema-form.test.ts`、`backend/src/template-contract/editor-schema.test.ts`、Studio controller/UI 定向测试通过。

**Acceptance:** 不修改 CMS 核心分支即可安装新模板并完成一条内容维护闭环。

### Task P2.3：统一 ReleaseSnapshot 投影

**Files:**

- Create: `backend/src/release-contract/project.ts`
- Create: `backend/src/release-contract/validator.ts`
- Modify: `backend/src/presets/releases.ts`
- Modify: `backend/src/presets/gateway-publish.ts`
- Create: `backend/src/release-contract/project.test.ts`

**Steps:**

- [x] 将 CMS 内部文档投影为 ContractSnapshotV1。
- [x] 将 templateVersion、manifestChecksum、rendererDigest 放入固定 metadata。
- [x] 纳入导航、运营配置、layout document、sectionConfigs 和 assets。
- [x] 生成 canonical JSON、checksum、资源清单和 request key。
- [x] 发布前执行模板契约校验和 Gateway validator。
- [x] 保留旧快照读取和旧版本回滚路径。

> 复跑证据：`backend/src/release-contract/project.test.ts`、`backend/src/release-contract/assets.test.ts` 及 Gateway 发布定向测试通过。

**Acceptance:** 同一个草稿生成稳定、可校验、可重放的 ReleaseSnapshot。

## Phase P3：Studio 建站编辑 MVP

### Task P3.1：完成布局和导航纯函数状态

**Files:**

- Modify: `ui/src/components/studio/visual-editor-state.ts`
- Modify: `ui/src/components/studio/drag-tree.tsx`
- Modify: `ui/src/components/studio/navigation-editor.tsx`
- Modify: `ui/src/components/studio/visual-editor-state.test.ts`

**Steps:**

- [x] 支持区块头部、中间、尾部插入。
- [x] 支持区块显示/隐藏、属性更新、撤销前状态恢复。
- [x] 支持导航同级移动、移入分组、移出分组和键盘等价操作。
- [x] 拒绝循环嵌套、重复节点 ID、非法目标和跨页面移动。
- [x] 生成稳定 dirty fingerprint，保存成功后重置脏状态。

> 复跑证据：`ui/src/components/studio/visual-editor-state.ts`、UI type-check 和 Studio UI 定向测试通过；纯函数回归用例位于 `ui/src/components/studio/visual-editor-state.test.ts`。

**Acceptance:** 鼠标和键盘均可完成区块排序和导航调整，取消拖拽不修改草稿。

### Task P3.2：完成三栏编辑器和页面创建

**Files:**

- Modify: `ui/src/views/dashboard/studio.tsx`
- Modify: `ui/src/components/studio/section-editor.tsx`
- Modify: `ui/src/components/studio/navigation-editor.tsx`
- Modify: `ui/src/components/studio/studio.css`
- Create: `ui/src/components/studio/page-create-wizard.tsx`

**Steps:**

- [x] 顶部显示页面标题、保存状态、预览、发布和错误摘要。
- [x] 左栏显示页面、区块和导航树；中栏显示真实模板预览；右栏显示属性和 SEO。
- [x] 页面创建向导通过一个服务端事务创建内容、页面和绑定关系。
- [x] 页面切换、关闭和路由离开时提示未保存修改。
- [x] 权限不足时禁用保存、拖拽、导航和页面创建。
- [x] 适配 375、768、1024、1440 视口，320 视口不得出现页面横向滚动。

**Acceptance:** 运营人员无需修改模板代码即可创建页面、配置区块、编辑 SEO 并保存草稿。

### Task P3.3：预览联动、素材和移动端验收

**Files:**

- Modify: `storefront/app/components/DraftSitePreview.vue`
- Modify: `storefront/app/components/LayoutRenderer.vue`
- Modify: `ui/src/util/template-preview.ts`
- Modify: `backend/src/storefront/preset-preview.ts`
- Create: `ui/test/studio-visual-editor.e2e.mjs`

**Steps:**

- [x] CMS 发送 `studio:select-node`，Storefront 返回节点选中消息。
- [x] 校验 iframe origin、source、页面 key、节点 ID、节点类型和模板身份。
- [x] 属性面板修改后刷新预览，不修改真实公开路由。
- [x] 素材选择器使用短时预览能力令牌，发布快照保存稳定资源地址。
- [x] 在桌面和移动视口完成区块选择、属性编辑、素材绑定和刷新恢复。

**Acceptance:** 编辑器预览与发布后页面使用同一套契约、布局和导航数据。

## Phase P4：Gateway 发布状态闭环

### Task P4.1：完善 Gateway artifact/publication/deployment 模型

**Files:**

- Modify: `Independent-Website-Gateway/prisma/schema.prisma`
- Create: `Independent-Website-Gateway/prisma/migrations/20261101000000_release_artifacts/migration.sql`
- Modify: `Independent-Website-Gateway/apps/control/src/releases.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/publication-state.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/publish-operation.ts`

**Steps:**

- [x] 将 ReleaseArtifact、Publication、Deployment、Domain 拆成可查询实体。
- [x] publication-state 返回 desired release、active release、route revision、status、failure code 和 artifact identity。
- [x] publish-operation 使用 request key、租约、幂等重放和明确失败代码。
- [x] 状态区分 pending、healthy、active、failed、degraded 和 unknown。
- [x] 控制服务重启、worker 重启和旧活动版本恢复时状态不丢失。

**Acceptance:** Gateway 可以独立解释当前活动版本、候选版本、实例健康和失败原因。

### Task P4.2：实现 CMS 状态投影和发布反馈

**Files:**

- Modify: `backend/src/presets/gateway-state.ts`
- Modify: `backend/src/presets/gateway-publish.ts`
- Modify: `ui/src/components/storefront/gateway-publication.ts`
- Modify: `ui/src/components/storefront/release-manager.tsx`
- Create: `ui/test/gateway-state-projection.test.mjs`

**Interfaces:**

```ts
submitRelease({ requestKey, siteId, artifactRef, contractVersion, checksum })
getPublicationState({ siteId })
// -> { desiredReleaseId, activeReleaseId, routeRevision, status, failureCode, updatedAt }
```

**Steps:**

- [x] CMS 本地状态区分 draft、submitted、gateway-pending、gateway-active、gateway-failed。
- [x] 只有 Gateway 返回 active 且 activeReleaseId 等于请求版本时才显示发布成功。
- [x] Gateway 失败显示失败代码和可重试操作，保留上一活动版本。
- [x] Gateway control 不可用时显示状态未知，不伪造新的发布成功。

**Acceptance:** CMS 不再自行维护或推断线上当前版本。

### Task P4.3：控制面、流量面和 worker 故障演练

**Files:**

- Modify: `Independent-Website-Gateway/packages/worker/src/index.ts`
- Modify: `Independent-Website-Gateway/packages/worker/src/runtime.ts`
- Modify: `Independent-Website-Gateway/packages/worker/src/deployment.ts`
- Modify: `Independent-Website-Gateway/packages/traffic/`
- Modify: `ops/e2e/test.mjs`
- Create: `docs/verification/2026-11-02-publication-control-plane.md`

**Steps:**

- [x] traffic proxy 只读取路由快照和已有实例，不等待 control 或 worker。
- [x] control 停止后已有站点继续访问，新发布进入待处理状态。
- [x] worker 停止后已有实例继续访问，恢复后可以重放未完成任务。
- [x] 候选版本不健康时不替换 active release。
- [x] 回滚只切换到已验证的旧 artifact，不重新读取 CMS 草稿。

**Acceptance:** 发布控制面故障不会中断已有网站访问。traffic、worker 和 control 的代码级测试及 runtime-isolation 已在 2026-11-02 复跑通过；完整 Docker 发布 flow 的最新重跑受隔离环境遗留的已退出候选容器阻断，详见 [publication control-plane verification](../../verification/2026-11-02-publication-control-plane.md)。

## Phase P5：询盘与访问看板

### Task P5.1：询盘接收和处理

**Files:**

- Create: `Independent-Website-Gateway/apps/ingest/leads.ts`
- Create: `cms/backend/src/leads/`
- Create: `cms/ui/src/views/dashboard/leads.tsx`
- Modify: `templates/*/*/storefront/server/api/`

**Steps:**

- [x] 公开页面通过独立入口提交结构化询盘，不要求 CMS 登录。
- [x] 入口写入持久队列或数据库，记录 site、source、createdAt 和 schema version。
- [x] 实现限流、重复提交检测、恶意字段拒绝和通知失败状态。
- [x] CMS 看板支持筛选、分配、标记处理、备注和导出。
- [x] 询盘入口故障时页面仍可访问，提交结果显示可重试状态。

**Acceptance:** 询盘链路可独立部署和恢复，不成为页面渲染同步依赖。Gateway 接收端为权威持久化源，CMS 在已配置 Gateway service binding 时通过内部鉴权 API 读取和更新投影；未配置时保留本地适配器以支持迁移。

### Task P5.2：访问事件和聚合看板

**Files:**

- Create: `Independent-Website-Gateway/apps/ingest/events.ts`
- Create: `cms/backend/src/analytics/`
- Create: `cms/ui/src/views/dashboard/analytics.tsx`
- Modify: `storefront/app/components/PublishedPage.vue`

**Steps:**

- [x] 页面以异步方式发送轻量事件，失败不阻塞首屏。
- [x] 事件包含 site、release、path、referrer、device 和时间。
- [x] 聚合按站点、页面和时间窗口统计 PV/UV/访问次数。
- [x] CMS 查询 Gateway 聚合数据，不直接读取运行实例日志。
- [x] 补充定时保留清理和事件级幂等去重。
- [x] 补充跨站点 Docker E2E，验证两个站点的事件和聚合完全隔离。

**Acceptance:** 统计服务停止时公开页面仍成功；看板能显示指定站点和发布版本的数据。

## Phase P6：多站点、域名和迁移

### Task P6.1：Workspace/Site/权限隔离

**Files:**

- Modify: `backend/src/presets/site-model.ts`
- Modify: `backend/src/studio/controller.ts`
- Modify: `ui/src/sdk/handlers/studio.ts`
- Create: `backend/src/authorization/site-access.ts`
- Create: `backend/src/authorization/site-access.test.ts`

**Steps:**

- [x] 每个请求服务端验证 workspace、site 和成员权限，不能只信任前端 ID。
- [x] 区分内容编辑、页面管理、发布、域名和运营看板权限。
- [x] 旧数据归入默认 workspace，保留 ID、媒体 URL 和已发布 Release。
- [x] 增加跨站点访问拒绝和越权写入测试。

**Acceptance:** 一个站点的内容、媒体、发布和看板数据不会被另一个站点读取或修改。

### Task P6.2：域名接入和路由迁移

**Files:**

- Modify: `Independent-Website-Gateway/apps/control/src/domains.ts`
- Modify: `Independent-Website-Gateway/apps/traffic/`
- Modify: `cms/ui/src/views/dashboard/domains.tsx`
- Create: `docs/verification/2026-11-01-domain-cutover.md`

**Steps:**

- [ ] 支持域名归属验证、主域名、别名和接入检查状态。
- [ ] 未验证域名和未知 host fail closed。
- [ ] 主域名切换保留旧路径 301 规则和回滚信息。
- [ ] 域名、证书和路由状态来源统一为 Gateway。

**Acceptance:** 域名切换可审计、可回滚，未知域名不会访问任意站点。

### Task P6.3：旧站点迁移和灰度

**Files:**

- Create: `backend/src/migrations/template-contract.ts`
- Create: `backend/src/migrations/layout-document.ts`
- Create: `Independent-Website-Gateway/apps/control/src/migrations/artifacts.ts`
- Modify: `ops/e2e/bootstrap.mjs`

**Steps:**

- [ ] 旧 preset manifest 生成默认 editor contract。
- [ ] 旧 sectionConfigs 生成稳定 layoutDocument。
- [ ] 旧 ReleaseSnapshot 投影为 ContractSnapshotV1。
- [ ] 旧 Gateway release 生成 ReleaseArtifact 记录。
- [ ] 按 workspace/site 开启新运行时和新契约，记录新旧 artifact 和 route revision。
- [ ] 迁移失败时保留旧活动版本和旧读取器。

**Acceptance:** 迁移可以重复执行，失败不影响线上版本，成功后可回滚到旧 artifact。

## Phase P7：生产化与规模化

### Task P7.1：备份、恢复、监控和告警

**Files:**

- Create: `ops/backup/`
- Create: `ops/restore/`
- Modify: `ops/e2e/test.mjs`
- Modify: `docs/verification/`

**Steps:**

- [ ] 备份 CMS 草稿、Gateway 状态、发布 artifact、资源清单和媒体索引。
- [ ] 提供原子恢复工具，恢复后校验 checksum、route revision 和 active release。
- [ ] 监控 Storefront 5xx、响应时间、发布成功率、域名接入、资源缺失和备份失败。
- [ ] 演练数据库、artifact、路由快照和媒体恢复。

**Acceptance:** 恢复后能重新提供指定站点的已发布页面，且不会把未验证版本切成 active。

### Task P7.2：模板升级和发布队列

**Files:**

- Modify: `backend/src/template-contract/compatibility.ts`
- Create: `backend/src/template-contract/migration-preview.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/publish-operation.ts`
- Modify: `Independent-Website-Templates/.github/workflows/template-release.yml`

**Steps:**

- [ ] 模板升级显示兼容级别、字段变化、区块变化和迁移结果。
- [ ] 迁移先生成预览和新 artifact，健康检查通过后再切换。
- [ ] 发布任务进入持久队列，支持重试、限速和按站点隔离。
- [ ] 模板 registry 只接受通过契约、渲染、资源和安全检查的版本。

**Acceptance:** 模板升级失败时原模板和原活动版本继续服务；升级影响可在 CMS 中解释。

## 验收矩阵

| 类别 | 必须通过的验证 |
| --- | --- |
| 契约 | CMS fixture → Gateway validator → 真实模板 runtime |
| 编辑 | 字段、区块、属性、页面、导航、SEO、素材和移动预览 |
| 发布 | 发布差异、健康检查、活动版本切换、失败保留旧版本、回滚 |
| 隔离 | CMS/control/worker/analytics/lead ingest 分别停止 |
| 安全 | origin、站点隔离、资源授权、幂等、限流、路径穿越 |
| 运营 | 询盘接收、处理、导出、访问聚合和停用降级 |
| 迁移 | 旧站点读取、逐站点灰度、失败恢复、旧版本回滚 |
| 可访问性 | 键盘编辑、焦点、错误摘要、响应式和 reduced motion |

## 里程碑交付门槛

- **M0/P0：** 有契约和故障基线，所有后续结果可对比。
- **M1/P1：** 公开网站不依赖 CMS/control，完成 CMS 停止验证。
- **M2/P2：** 新模板可不改 CMS 核心分支完成安装、编辑和快照生成。
- **M3/P3：** 运营人员可完成单站点页面创建、编辑、预览和保存。
- **M4/P4：** Gateway 权威发布、回滚和状态投影完成。
- **M5/P5：** 询盘和访问数据闭环，数据服务故障不阻塞页面。
- **M6/P6：** 多站点、域名、权限和迁移可重复执行。
- **M7/P7：** 备份恢复、升级迁移、队列和告警具备生产证据。

## 推荐实施方式

优先采用单主线分阶段执行：每完成一个 Phase 就运行该 Phase 的最小测试和对应 E2E，再进入下一 Phase。跨仓改动使用同一个 contract version、manifest checksum 和变更说明；不把未完成的 Studio 高级功能混入运行时隔离验收。
