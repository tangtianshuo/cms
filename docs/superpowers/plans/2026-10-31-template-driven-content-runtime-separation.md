# 模板驱动内容与 CMS/Gateway/Storefront 边界修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Templates、CMS、Gateway 和 Storefront 的职责边界，让模板定义数据契约，CMS 只负责编辑与运营控制，Gateway 负责发布状态和流量路由，Storefront 只负责读取自足发布产物并渲染网站；已上线网站在 CMS 或 Gateway 控制面故障时仍能继续访问。

**Architecture:** 以版本化模板契约作为三仓之间的唯一接口。CMS 生成草稿和不可变 ReleaseSnapshot，向 Gateway 提交发布请求；Gateway 持有发布、部署、域名和活动版本状态，并把不可变 artifact 交给流量面。Storefront 只读取本地或独立发布资源中的快照、模板和资源，不在公开请求路径上调用 CMS 编辑接口或 Gateway control API。CMS Studio 可视化页面编辑器使用模板声明生成区块、属性和页面维护界面。

**Tech Stack:** TypeScript、Node.js、Fastify、Next.js、Nuxt、MongoDB、PostgreSQL、Docker、Traefik、Vitest/Node test、Playwright 或现有浏览器验收脚本。

**Spec:** [模板驱动内容与运行时隔离设计](../specs/2026-10-31-template-driven-content-runtime-separation-design.md)

## Global Constraints

- 模板版本、manifest checksum、renderer digest、Release checksum 必须不可变。
- CMS 草稿与 Gateway 活动版本必须分开建模。
- Gateway 是发布、部署、域名和运行状态的唯一权威。
- 运行网站不得依赖 CMS 草稿接口、CMS 私有媒体接口或 Gateway 控制 API 的实时查询。
- 第一阶段布局文档固定为 `mode: 'template'`，通过 `sectionConfigs` 兼容现有模板。
- 所有写操作使用现有 workspace/site 权限和 `expectedUpdatedAt` 乐观并发保护。
- 新契约必须有模板仓库单测、CMS 单测、Gateway 契约测试和至少一个跨仓端到端验证。
- 迁移必须支持旧站点读取、失败回滚和逐站点启用。
- Storefront 的线上请求只能依赖活动路由快照、运行实例和不可变发布 artifact；CMS/Gateway control 只能出现在发布、预览和管理路径。
- CMS 展示 Gateway 状态时必须读取 Gateway 返回的状态和 revision，不能依据本地 Release 字段推断“已上线”。
- 当前 `storefront/server/utils/release.mjs` 对 CMS 发布接口的读取属于过渡兼容路径；新实现不得继续扩大该依赖，切换完成后必须删除或仅保留受保护的预览路径。

## 边界修复判定

| 组件 | 允许承担的职责 | 禁止承担的职责 | 故障时的预期行为 |
| --- | --- | --- | --- |
| Templates | 声明内容模型、编辑 schema、页面蓝图、renderer contract 和迁移 | 直接读写 CMS 数据库、决定发布状态、调用管理接口 | 模板版本不兼容时拒绝发布，不影响当前活动版本 |
| CMS | 内容/页面/导航/SEO 草稿、Studio 编辑、预览、发布请求、状态展示、看板 | 作为线上网站数据源、直接切换活动路由、把本地状态当作发布成功 | CMS 停止时，已发布网站继续访问；编辑和新发布暂不可用 |
| Gateway control | 校验发布 artifact、发布任务、域名、部署、活动版本和回滚 | 承载编辑器状态、保存 CMS 草稿、作为每次页面请求的同步依赖 | control 停止时，已有路由和实例继续服务；新发布进入待处理状态 |
| Gateway traffic/data plane | 读取路由快照、转发访问、提供运行时可读取的发布产物 | 调用 CMS control API 取得页面内容、等待发布 worker 才能响应旧站点 | control/worker 停止时，已有站点仍可访问 |
| Storefront | 按模板渲染快照、SEO、导航、媒体和公开页面 | 调用 CMS 编辑接口、依赖 Gateway control 实时查询、保存内容 | 运行实例只依赖本地/独立 artifact；资源缺失返回可观测错误 |

边界修复完成的必要条件是：公开页面、图片、重定向和 sitemap 的请求链路中没有 CMS 草稿/管理接口，也没有 Gateway control API 的同步调用；发布状态只由 Gateway 返回，CMS 只做投影和展示。

## 当前实现状态与证据

以下工作已经在本地隔离 Docker 环境验证完成，应作为后续任务的基线，不重复实施：

- ContractSnapshotV1 roundtrip、Gateway 发布/恢复/退役和模板渲染回归已通过。
- Gateway 管理的 Storefront 运行实例已支持只读发布快照挂载，并拒绝任意可写或不安全挂载；CMS 仓库内置的 Nuxt Storefront 仍保留 CMS 发布接口兼容读取，正是 Task 1.4 要切断的过渡依赖。
- Gateway traffic proxy 已能在 Gateway control 停止后继续转发已有站点。
- CMS Studio 的首页字段编辑、草稿保存、整站预览、发布和 Gateway 页面检查已通过。
- 验证证据见 [`2026-11-01-docker-e2e-closure.md`](../../verification/2026-11-01-docker-e2e-closure.md)。

尚未完成的 Studio 深度能力仍需单独验收：区块拖拽排序、区块增删、属性面板、页面创建、素材绑定、页面设置、导航编辑和移动端预览。

---

## 交付拆分

本计划分为四条可以独立验收的实施线：

1. **Contract line**：Templates 契约、版本兼容、渲染输入和资源协议。
2. **CMS line**：契约驱动模型、Studio 可视化编辑、发布状态和运营看板。
3. **Gateway line**：状态权威、发布工件、控制面与流量面隔离。
4. **Integration line**：跨仓 fixture、E2E、迁移、故障演练和切换。

每条实施线内部按顺序执行；跨线集成在契约版本稳定后开始。

### 边界修复后的执行顺序

1. **冻结契约与兼容投影**：先保证旧站点、旧 Release 和现有 Studio 能读取新契约。
2. **切断 Storefront 的 CMS 线上依赖**：先让页面、媒体、重定向和 sitemap 从不可变 artifact 或独立发布资源读取。
3. **确立 Gateway 状态权威**：CMS 只提交发布请求和读取状态，活动版本、路由 revision、部署健康状态均由 Gateway 返回。
4. **隔离 Gateway control、traffic 和 worker**：公开请求只依赖流量面和已有运行实例。
5. **补齐 CMS Studio 与运营看板**：编辑器、发布状态、访问数据和询盘数据都通过独立管理接口工作。
6. **按站点灰度迁移并演练故障**：每次切换都必须验证 CMS/control/worker 分别停止后的公开访问。

不得先扩展 Studio 的高级编辑能力，再把 Storefront 继续绑定到 CMS；编辑能力可以并行开发，但运行时依赖切断必须是独立的发布门槛。

## Phase 0：基线、契约冻结和观测

### Task 0.1：建立跨仓契约基线

**Files:**

- Create: `Independent-Website-Templates/contracts/schema-v1/`
- Create: `Independent-Website-Templates/test/contract-fixture.mjs`
- Create: `cms/docs/verification/2026-10-31-contract-baseline.md`
- Modify: `cms/backend/src/presets/releases.ts`
- Modify: `Independent-Website-Gateway/packages/contracts/src/release.ts`

**Interfaces:**

- `ContractSnapshotV1`: CMS 生成、Gateway 校验、Templates 渲染的共同输入。
- `validateContractSnapshotV1(value): ContractSnapshotV1`: 三仓共用同一语义，语言实现可以不同。
- `contractVersion`: 独立于旧 `schemaVersion`，初始值为 `1`.

**Steps:**

- [x] 固定 root 字段：`contractVersion`、`workspaceId`、`siteId`、`language`、`pages`、`navigation`、`redirects`、`operations`、`assets`。
- [x] 固定 page 字段：`path`、`pageKey`、`entryId`、`content`、`layoutDocument?`.
- [x] 固定 content 字段：`kind`、`view`、`preset`、`sections`、`sectionConfigs?`、`seo`、`items?`、`operations?`.
- [x] 明确 `templateId`、`templateVersion`、`manifestChecksum`、`rendererDigest` 的来源和校验位置。
- [x] 用当前 CMS 的真实 `buildRelease` fixture 验证现有 AeroFrame 与 FireGuard 解析器，记录已知字段漂移。
- [x] 为旧 `schemaVersion: 1` 增加兼容读取路径；新契约使用显式 `contractVersion`，不复用含义已漂移的旧字段。
- [x] 运行 CMS release 测试、Gateway contracts 测试和 Templates runtime 测试，保存结果到基线文档。

**Acceptance:**

- 当前生成的快照经过明确投影后能被两个模板解析器接受。
- 新契约字段没有未声明的隐式扩展。
- 旧站点仍可读取。

### Task 0.2：加入跨仓契约检查入口

**Files:**

- Create: `cms/ops/e2e/contract-roundtrip.mjs`
- Modify: `cms/ops/e2e/test.mjs`
- Modify: `Independent-Website-Templates/package.json`
- Modify: `Independent-Website-Gateway/package.json`

**Steps:**

- [x] 增加命令 `node ops/e2e/test.mjs contract`。
- [x] 从 CMS fixture 生成快照。
- [x] 调用 Gateway contract validator。
- [x] 将快照传入至少一个真实模板 runtime。
- [x] 断言模板身份、页面顺序、导航、主题、媒体和重定向均保持一致。
- [x] 把失败分为 contract invalid、renderer invalid、runtime unavailable，避免把三类问题混为一谈。

## Phase 1：Templates 契约驱动能力

### Task 1.1：定义模板 manifest 扩展

**Files:**

- Modify: `Independent-Website-Templates/schema/template.schema.json`
- Modify: `Independent-Website-Templates/scripts/validate.mjs`
- Modify: `Independent-Website-Templates/templates/aeroframe/1.0.3/template.json`
- Modify: `Independent-Website-Templates/templates/fireguard/1.0.0/template.json`

**Schema:**

- `editor.schemaVersion`
- `editor.models[]`
- `editor.pages[]`
- `editor.sections[]`
- `editor.operations`
- `renderer.contractVersion`
- `renderer.preview`
- `renderer.assets`
- `compatibility.migrations[]`

**Steps:**

- [x] 将字段标签、控件类型、分组、说明、默认值和条件显示放入 manifest。
- [x] 将区块允许位置、必需区块、唯一性和属性 schema 放入 manifest。
- [x] 将蓝图路径规则、是否允许加入导航和绑定模型放入 manifest。
- [x] 将预览握手、快照入口、支持视图和资源读取方式写入 renderer contract。
- [x] 拒绝未声明字段、重复模型、无效路径、无效区块和 renderer/manifest 身份不一致。
- [x] 为每个模板补充 manifest fixture 和校验测试。

### Task 1.2：建立模板契约测试包

**Files:**

- Create: `Independent-Website-Templates/contracts/runner.mjs`
- Create: `Independent-Website-Templates/test/contract/*.test.mjs`
- Modify: `Independent-Website-Templates/.github/workflows/template-release.yml`

**Steps:**

- [x] 用标准 fixture 验证首页、集合页、详情页、内容页。
- [x] 验证 section 顺序、导航树、主题、SEO、重定向和资源引用。
- [x] 验证错误模板身份、错误契约版本、未知区块和未授权资源都会拒绝。
- [x] 将契约测试纳入每个模板发布工作流。
- [x] 发布流程只有在 renderer、manifest 和 contract tests 全部通过后才允许写入 registry。

### Task 1.3：实现运行时自足读取

**Files:**

- Modify: `templates/*/*/storefront/server/utils/published.mjs`
- Modify: `templates/*/*/storefront/server/api/published.get.ts`
- Modify: `templates/*/*/storefront/shared/snapshot.mjs`
- Create: `Independent-Website-Templates/contracts/assets.mjs`

**Steps:**

- [x] 发布快照中的媒体地址改为发布资源地址，不再指向 CMS 私有媒体接口。
- [x] 运行时只读取本地快照、发布资源存储或运行时内置资源入口。
- [x] 保留 checksum、站点身份和模板身份校验。
- [x] 对资源缺失返回可观测的运行时错误，不请求 CMS 作为隐式回退。
- [x] 运行时测试覆盖 CMS 停止、Gateway 控制 API 停止时的页面访问。

### Task 1.4：切断现有 Storefront 到 CMS 的线上请求依赖

**Files:**

- Modify: `storefront/server/utils/release.mjs`
- Modify: `storefront/server/api/published.get.ts`
- Modify: `storefront/server/routes/sitemap.xml.get.ts`
- Modify: `storefront/server/utils/site-context.ts`
- Modify: `storefront/app/pages/[...path].vue`
- Modify: `ops/e2e/compose.yml`
- Create: `storefront/test/runtime-isolation.test.mjs`
- Modify: `docs/verification/2026-11-01-docker-e2e-closure.md`

**Boundary:**

- `preview` 可以继续通过受保护的 CMS 预览接口取得草稿，但只能在 CMS Studio iframe 路径使用。
- 公开页面、产品页、媒体、重定向和 sitemap 必须从 Gateway traffic/data plane 提供的活动 artifact 或运行实例读取。
- Storefront 不能在公开请求失败时回退到 CMS 草稿接口，也不能通过 Gateway control API 查询当前版本。

**Steps:**

- [ ] 为公开运行时增加明确的 `RuntimeReleaseSource`，输入只包含 `artifactRef`、活动 `releaseId`、站点 host 和本地资源根目录。
- [ ] 将 `fetchPublishedSite` 拆成 preview adapter 和 runtime adapter；runtime adapter 只能读取本地快照或独立发布资源，不能接受 CMS origin。
- [ ] 让 `published.get.ts`、动态页面、媒体和 sitemap 共用 runtime adapter，禁止各路由自行拼接 CMS URL。
- [ ] 对旧站点提供一次性兼容读取开关，默认关闭；开关关闭后 CMS 停止不应改变公开页面响应。
- [ ] 增加请求日志断言：公开请求不得出现 `/api/v4/storefront/published`、CMS 登录接口或 CMS 私有媒体接口的出站请求。
- [ ] 运行隔离 E2E：先缓存/挂载活动 artifact，再停止 CMS；验证页面、图片、重定向、sitemap 均成功，且没有 CMS 出站请求。
- [ ] 删除兼容开关前记录旧站点迁移结果，失败站点继续使用旧路由但不能静默回退到 CMS 草稿数据。

**Acceptance:**

- CMS 停止后，已发布页面、媒体、重定向和 sitemap 仍可访问。
- Gateway control 停止后，Storefront 不发送 control API 请求，已有站点仍可访问。
- 预览路径仍可显示未保存草稿，但预览凭证不能被公开页面复用。
- 运行时测试能区分 `artifact missing`、`artifact invalid` 和 `preview unavailable`，不把三类故障混成 500。

## Phase 2：CMS 契约驱动后台

### Task 2.1：抽离模板契约读取和安装模型

**Files:**

- Create: `backend/src/template-contract/model.ts`
- Create: `backend/src/template-contract/registry.ts`
- Create: `backend/src/template-contract/compatibility.ts`
- Modify: `backend/src/presets/registry.ts`
- Modify: `backend/src/presets/installed.ts`
- Modify: `backend/src/presets/import.ts`

**Steps:**

- [ ] 将当前 `backend/src/presets/registry.ts` 中针对 AeroFrame 的固定模型校验迁移为通用契约校验。
- [ ] 保存已安装模板的 manifest、editor contract、renderer contract、source commit 和 digest。
- [ ] 兼容旧站点的 `presetManifestSnapshot` 和 `publishedTemplateRecord`。
- [ ] 将升级判断分为展示兼容、数据兼容、需要迁移和不兼容。
- [ ] 对需要迁移的版本返回可执行 migration plan，而不是直接要求重建站点。
- [ ] 测试新模板契约不需要修改 CMS 模板分支即可安装。

### Task 2.2：实现契约驱动内容维护

**Files:**

- Create: `backend/src/template-contract/editor-schema.ts`
- Create: `backend/src/content-editor/schema-form.ts`
- Modify: `backend/src/presets/controller.ts`
- Modify: `backend/src/presets/site-model.ts`
- Modify: `ui/src/sdk/handlers/studio.ts`
- Modify: `ui/src/views/dashboard/studio.tsx`

**Steps:**

- [ ] API 返回模型字段、控件、分组、说明、默认值和权限。
- [ ] UI 根据 editor contract 生成文本、数字、枚举、媒体、富文本、引用和数组控件。
- [ ] 字段保存前后执行相同的契约校验。
- [ ] CMS 内部保留稳定 field key，模板展示标签可以随模板版本变化。
- [ ] 旧内置模板没有 editor contract 时使用兼容适配器。
- [ ] 测试动态生成表单保存后能被 buildRelease 读取。

### Task 2.3：修复 ReleaseSnapshot 契约投影

**Files:**

- Modify: `backend/src/presets/releases.ts`
- Modify: `backend/src/presets/gateway-state.ts`
- Modify: `backend/src/presets/gateway-publish.ts`
- Create: `backend/src/release-contract/project.ts`
- Create: `backend/src/release-contract/validator.ts`

**Steps:**

- [ ] 将 CMS 内部文档投影为明确的 `ContractSnapshotV1`。
- [ ] 将 `templateVersion`、`manifestChecksum`、`rendererDigest` 置于固定 metadata，不让模板自行猜测。
- [ ] 将导航树、运营配置、section configs、layout document 和 assets 纳入契约。
- [ ] 生成 canonical JSON、checksum 和资源清单。
- [ ] 发布前执行模板契约校验与 Gateway contract validator。
- [ ] 保留旧快照读取和旧版本回滚路径。

## Phase 3：CMS Studio 可视化页面编辑器

本阶段完整纳入 [CMS Studio 可视化页面编辑器设计](../specs/2026-10-31-visual-page-editor-design.md)。

### Task 3.1：布局文档与兼容投影

**Files:**

- Create: `backend/src/storefront/layout-document.ts`
- Create: `backend/src/storefront/layout-document.test.ts`
- Modify: `backend/src/storefront/section-schema.ts`
- Modify: `backend/src/presets/site-model.ts`
- Modify: `backend/src/presets/pages.ts`
- Modify: `backend/src/presets/releases.ts`

**Interfaces:**

- `layoutFromSectionConfigs(sectionConfigs): LayoutDocument`
- `sectionConfigsFromLayout(layout): SectionConfig[]`
- `validateLayoutDocument(layout, contract): void`
- `normalizeLayoutDocument(layout): LayoutDocument`

**Steps:**

- [x] 旧页面没有 `layoutDocument` 时生成稳定节点 ID。
- [x] 第一阶段只接受 `mode: 'template'` 和扁平 section 节点。
- [x] 拒绝未知布局版本、重复节点 ID、未知区块、重复区块、非法 props 和非法布局值。
- [x] 由布局文档生成现有 `sectionConfigs`，保持旧模板渲染路径。
- [x] 发布快照保存规范化布局文档或明确兼容投影。
- [x] 添加双向转换和语义不变测试。

### Task 3.2：纯函数编辑器状态

**Files:**

- Create: `ui/src/components/studio/visual-editor-state.ts`
- Create: `ui/src/components/studio/visual-editor-state.test.ts`
- Create: `ui/src/components/studio/drag-tree.tsx`

**Interfaces:**

- `moveNode(root, nodeId, target): LayoutNode[]`
- `toggleNode(root, nodeId, enabled): LayoutNode[]`
- `updateNodeProps(root, nodeId, props): LayoutNode[]`
- `moveNavigationNode(root, nodeId, target): NavigationNode[]`
- `dirtyFingerprint(state): string`

**Steps:**

- [ ] 支持头部、中间、尾部插入。
- [ ] 非法目标、循环嵌套、重复节点和跨页面移动返回错误。
- [ ] Escape、取消和拖出编辑器恢复拖拽前状态。
- [ ] 为所有鼠标操作提供上移、下移、移入分组、移出分组的键盘等价操作。
- [x] 拖拽只修改本地状态，保存时才提交服务端。
- [x] 测试顺序、层级、取消、键盘操作和脏状态指纹。

### Task 3.3：Studio 三栏页面编辑器

**Files:**

- Create: `ui/src/components/studio/visual-page-editor.tsx`
- Create: `ui/src/components/studio/page-create-wizard.tsx`
- Modify: `ui/src/views/dashboard/studio.tsx`
- Modify: `ui/src/components/studio/section-editor.tsx`
- Modify: `ui/src/components/studio/navigation-editor.tsx`
- Modify: `ui/src/components/studio/studio.css`

**Steps:**

- [ ] 顶部显示页面标题、草稿状态、保存、预览和发布入口。
- [x] 左栏显示页面、区块和导航树。
- [x] 中栏接入预览 iframe，并支持区块选中消息桥接。
- [x] 右栏根据模板 editor contract 显示区块属性、SEO、绑定内容和显示状态。
- [ ] 保存失败保留本地编辑状态并把焦点移动到错误摘要。
- [ ] 页面切换、路由离开和关闭时提示未保存修改。
- [x] 375、768、1024、1440 像素视口布局和 320 像素横向溢出保护已加入样式。
- [x] 添加页面向导已接入现有事务式创建接口，并保留失败时的编辑状态。

### Task 3.4：预览消息桥接

**Files:**

- Modify: `storefront/app/components/DraftSitePreview.vue`
- Create: `storefront/app/components/LayoutRenderer.vue`
- Modify: `ui/src/util/template-preview.ts`
- Modify: `backend/src/storefront/preset-preview.ts`

**Message contract:**

- CMS -> preview: `{ type: 'studio:select-node', pageKey, nodeId, nodeType }`
- Preview -> CMS: `{ type: 'studio:node-selected', pageKey, nodeId, nodeType }`
- Preview -> CMS: `{ type: 'studio:node-hovered', pageKey, nodeId, nodeType }`

**Steps:**

- [x] 所有消息带页面 key、节点 ID 和节点类型。
- [x] 校验 iframe origin、source、节点类型和页面节点存在性；模板身份随消息传递。
- [x] 未知消息被忽略，旧预览版本不造成编辑器异常。
- [x] 预览选中状态与左侧区块列表、右侧属性面板同步。
- [ ] 预览使用保存后的草稿和当前页面覆盖，不改变真实站点路由。
- [ ] 测试错误 origin、错误 source、错误模板身份和混合快照。

## Phase 4：Gateway 发布状态与控制面隔离

### Task 4.1：完善 Gateway 状态模型

**Files:**

- Modify: `Independent-Website-Gateway/prisma/schema.prisma`
- Create: `Independent-Website-Gateway/prisma/migrations/20261031100000_release_artifacts/migration.sql`
- Modify: `Independent-Website-Gateway/apps/control/src/publication-state.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/releases.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/publish-operation.ts`

**Model changes:**

- `ReleaseArtifact)：快照、资源清单、renderer digest、checksum、存储地址。
- `Publication)：目标 release、活动 release、desired revision、route revision。
- `Deployment)：实例、健康状态、host、image digest、artifact ref。
- `Domain)：域名验证、证书和路由状态。

**Steps:**

- [ ] 将快照、资源和运行镜像从单一 Release metadata 中拆成可查询实体。
- [ ] publication-state 只返回 Gateway 权威状态和可验证的 artifact identity。
- [ ] publish-operation 保持幂等、租约、失败代码和回滚能力。
- [ ] 状态接口区分 pending、healthy、active、failed、degraded 和 unknown。
- [ ] 测试控制服务重启、worker 重启和旧活动版本恢复。

### Task 4.1a：建立 CMS 到 Gateway 的状态投影边界

**Files:**

- Modify: `backend/src/presets/gateway-state.ts`
- Modify: `backend/src/presets/gateway-publish.ts`
- Modify: `ui/src/components/storefront/gateway-publication.ts`
- Modify: `ui/src/components/storefront/release-manager.tsx`
- Create: `backend/src/presets/gateway-state.test.ts`
- Create: `ui/test/gateway-state-projection.test.mjs`

**Interfaces:**

- CMS -> Gateway: `submitRelease({ requestKey, siteId, artifactRef, contractVersion, checksum })`。
- Gateway -> CMS: `getPublicationState({ siteId }) -> { desiredReleaseId, activeReleaseId, routeRevision, status, failureCode, updatedAt }`。
- CMS UI 只能展示 Gateway 返回的 `activeReleaseId` 和 `status`，不得把本地草稿或 Release 创建成功当成上线成功。

**Steps:**

- [ ] 将 CMS 本地 `Release` 状态拆成 `draft`, `submitted`, `gateway-pending`, `gateway-active`, `gateway-failed` 投影状态。
- [ ] 发布成功提示只在 Gateway 返回 `activeReleaseId === requestedReleaseId` 且状态为 `active` 时出现。
- [ ] Gateway 失败必须保留失败代码、route revision 和上一活动版本，CMS 显示可重试操作。
- [ ] CMS control API 故障时，Studio 显示状态未知，不覆盖最后一次已确认的 Gateway 状态。
- [ ] 测试重复 request key、Gateway 超时、control 重启、旧活动版本回退和状态延迟。

**Acceptance:**

- CMS 不再自行维护“线上当前版本”这一权威状态。
- Gateway control 停止时，已确认的活动状态仍可展示为最后一次已知状态，但不得伪造新的发布成功。
- 发布状态 UI 能区分草稿保存成功、发布请求已提交、Gateway 已激活和发布失败。

### Task 4.2：拆分控制面、流量面和运行时

**Files:**

- Modify: `Independent-Website-Gateway/packages/worker/src/index.ts`
- Modify: `Independent-Website-Gateway/packages/worker/src/runtime.ts`
- Modify: `Independent-Website-Gateway/packages/worker/src/deployment.ts`
- Create: `Independent-Website-Gateway/packages/traffic/`
- Modify: `Independent-Website-Gateway/docker-compose.prod.yml`
- Modify: `Independent-Website-Gateway/deployment-nginx.conf`

**Steps:**

- [x] 将流量入口的路由快照读取和网站转发从发布 worker 中移出。
- [x] 流量入口只依赖本地路由/服务发现状态和运行实例。
- [x] 独立 Traffic Proxy 已通过 worker/control 不在请求路径上的路由快照测试。
- [x] Gateway control 停止后，流量入口不再请求 control API。
- [x] 运行实例启动时通过只读 bind mount 加载完整发布 artifact，不实时访问 CMS。
- [x] 增加进程级健康检查和故障恢复测试。
- [x] 明确单机阶段的持久化路由状态、备份和恢复操作，提供原子备份/恢复工具。

### Task 4.3：将发布资源从 CMS 媒体接口迁出

**Files:**

- Modify: `cms/backend/src/presets/releases.ts`
- Create: `cms/backend/src/release-contract/assets.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/releases.ts`
- Modify: `Independent-Website-Gateway/packages/worker/src/deployment.ts`
- Modify: `Independent-Website-Templates/templates/*/*/storefront/server/utils/published.mjs`

**Steps:**

- [x] Release 构建阶段收集媒体 ID、内容类型、checksum、资源路径和内嵌内容。
- [x] CMS 将授权资源复制到发布请求中的不可变 artifact，发布快照中的 CMS 媒体 URL 改写为 `/_assets/*`。
- [x] Gateway 验证资源清单、嵌入内容 checksum 和快照 checksum。
- [x] 运行时从本地 artifact 快照的 `/_assets/*` 入口读取图片，不回源 CMS。
- [x] 资源缺失或内容 checksum 不一致时发布校验失败，不替换活动版本；运行时缺失资源返回 404。
- [x] 运行时资源测试验证页面与媒体只读取本地发布快照，CMS 不在请求路径上。

## Phase 5：运营看板与独立事件链路

### Task 5.1：询盘接收服务

**Files:**

- Create: `cms/backend/src/leads/`
- Create: `cms/ui/src/views/dashboard/leads.tsx`
- Modify: `Independent-Website-Templates/templates/*/*/storefront/server/api/`
- Create: `Independent-Website-Gateway/apps/ingest/`

**Steps:**

- [ ] 网站通过独立的询盘入口提交结构化数据。
- [ ] 入口不要求 CMS 登录，不依赖 Gateway control 查询。
- [ ] 询盘写入持久队列或数据库，带 site、source、createdAt 和 schema version。
- [ ] CMS 看板查询、筛选、分配、标记处理和导出。
- [ ] 限流、重复提交、恶意字段和通知失败都有独立状态。
- [ ] 询盘入口故障不影响静态页面访问。

### Task 5.2：访问事件和统计看板

**Files:**

- Create: `cms/backend/src/analytics/`
- Create: `cms/ui/src/views/dashboard/analytics.tsx`
- Modify: `storefront/app/components/PublishedPage.vue`
- Create: `Independent-Website-Gateway/apps/ingest/src/events.ts`

**Steps:**

- [ ] 页面发送轻量事件，失败时不阻塞渲染。
- [ ] 事件包含 site、release、path、referrer、device 和时间。
- [ ] CMS 查询聚合后的访问数据，不直接读取运行实例日志。
- [ ] 统计服务停用时网站保持可访问。
- [ ] 测试事件延迟、重复、匿名化和写入失败。

## Phase 6：迁移、灰度和故障演练

### Task 6.1：旧站点兼容迁移

**Files:**

- Create: `cms/backend/src/migrations/template-contract.ts`
- Create: `cms/backend/src/migrations/layout-document.ts`
- Create: `Independent-Website-Gateway/apps/control/src/migrations/artifacts.ts`
- Modify: `cms/ops/e2e/bootstrap.mjs`

**Steps:**

- [ ] 旧 preset manifest 生成默认 editor contract。
- [ ] 旧 `sectionConfigs` 生成稳定 `layoutDocument`。
- [ ] 旧 ReleaseSnapshot 投影为 ContractSnapshotV1。
- [ ] 旧 Gateway release 生成 ReleaseArtifact 记录。
- [ ] 每次迁移写入版本、时间、错误和可重试状态。
- [ ] 迁移失败不修改活动线上版本。

### Task 6.2：灰度开关与回滚

**Files:**

- Create: `cms/backend/src/config/feature-flags.ts`
- Modify: `cms/backend/src/presets/gateway-publish.ts`
- Modify: `Independent-Website-Gateway/apps/control/src/publish.ts`
- Modify: `Independent-Website-Templates/.github/workflows/template-release.yml`

**Steps:**

- [ ] 按 workspace/site 开启契约快照、独立资源和新流量面。
- [ ] 支持回退旧 CMS release、旧 Gateway route 和旧模板 renderer。
- [ ] 灰度站点记录新旧 artifact、route revision 和迁移结果。
- [ ] 只在真实回归通过后扩大范围。

### Task 6.3：故障演练

**Scenarios:**

- [ ] CMS 停止：已发布页面、图片、重定向仍返回 200/308。
- [ ] Gateway control 停止：已有网站访问不变；新发布进入待处理状态。
- [ ] 发布 worker 停止：已有流量入口和运行实例不变。
- [ ] 统计服务停止：页面访问成功，事件允许丢弃或延迟。
- [ ] 询盘服务短暂不可用：页面可访问，提交显示可重试状态。
- [ ] 新版本候选不健康：活动版本不变，旧版本继续服务。
- [ ] 资源 checksum 错误：发布拒绝，不替换活动版本。

## 跨仓测试矩阵

| 层级 | 验证内容 |
| --- | --- |
| Templates unit | manifest、editor contract、renderer、snapshot、assets |
| CMS unit | schema form、layout document、release projection、permissions |
| Gateway unit | release validation、publication state、lease、route recovery |
| Cross-repo contract | CMS fixture -> Gateway validator -> real renderer |
| E2E | 新建站点、编辑页面、预览、发布、回滚、域名访问 |
| Failure | CMS/control/worker/analytics/lead service 分别停止 |
| Accessibility | 键盘编辑、屏幕阅读器名称、reduced motion、响应式 |
| Security | origin、身份、站点隔离、资源授权、请求幂等、限流 |

## 交付顺序和里程碑

1. **M0：契约基线**
   完成 ContractSnapshotV1、真实快照投影和跨仓 roundtrip。
2. **M1：模板驱动编辑**
   完成 editor contract、模型表单和旧模板兼容适配。
3. **M2：Studio 可视化编辑器**
   完成布局文档、拖拽区块、导航树、预览桥接和新增页面向导。
4. **M3：可靠发布状态**
   完成 Gateway artifact/publication/deployment 状态模型和 CMS 状态投影。
5. **M4：运行时隔离**
   完成独立资源、运行时自足、控制面和流量面拆分。
6. **M5：运营闭环**
   完成询盘和访问事件入口、CMS 看板和降级策略。
7. **M6：灰度迁移**
   完成旧站点迁移、故障演练、回滚和生产切换。

## 完成定义

- 任意符合模板契约的新模板无需修改 CMS 核心分支即可被安装、编辑、预览和发布。
- Studio 可以完成页面区块排序、区块属性编辑、页面新增和导航维护。
- CMS 生成的快照能通过 Gateway 校验并被真实模板运行时渲染。
- CMS 停止时已发布网站仍可访问。
- Gateway control 和发布 worker 停止时已发布网站仍可访问。
- 新发布失败时活动版本不变。
- 模板升级可以显示兼容性、迁移内容和回滚路径。
- 访问数据和询盘数据可以在后台查看，但相关服务故障不阻断网站访问。
- 每个里程碑都有对应的跨仓测试、迁移记录和故障演练证据。

## 主要风险和处理

| 风险 | 处理 |
| --- | --- |
| 契约过度抽象导致编辑器难用 | 先支持明确字段和区块类型，复杂交互通过受控扩展 |
| 模板自由度不足 | 将能力声明放在模板，CMS 只负责通用解释和安全边界 |
| 旧站点快照不兼容 | 保留旧读取器和显式投影，逐站点迁移 |
| 资源迁移造成存储成本上升 | 资源按 checksum 去重，发布 artifact 只引用不可变对象 |
| 控制面拆分期间状态不一致 | Gateway 保持活动版本和 route revision，采用幂等重放 |
| 可视化编辑器与真实渲染器不一致 | Studio 只编辑契约声明的节点，预览复用真实模板 renderer |
| 询盘和统计链路影响页面 | 使用独立入口、异步写入和失败降级 |
| 运行时仍隐式依赖 CMS | E2E 中明确停止 CMS 后验证页面、图片和重定向 |

## 每个阶段的提交边界

每个任务结束时只提交该任务涉及的文件，并运行该任务的最小测试集。跨仓提交使用相同的契约版本和变更说明：

- Templates：`feat(contract): add editor and renderer contract v1`
- CMS：`feat(studio): drive editing from template contract v1`
- Gateway：`feat(runtime): publish self-contained release artifacts`
- Integration：`test(e2e): verify control-plane outage isolation`
