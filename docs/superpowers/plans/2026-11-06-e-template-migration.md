# E：模板扩展、升级与旧站迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 证明新模板无需 CMS 特例，并让升级和旧站迁移可预览、可重试、可回退。

**Architecture:** 用第三种内容模型检验契约通用性；迁移先生成独立候选数据和快照，再通过既有 Gateway 发布协议采用。CMS 当前安装指针仅在 Gateway 确认 active 后切换，历史内容、媒体和发布产物保留到回滚窗口结束。

**Tech Stack:** Node.js 22、TypeScript、Vue/Nuxt、MongoDB、PostgreSQL、Docker、node:test、Vitest；浏览器验收复用 B3 锁定的 Playwright 开发依赖。

**Spec:** `CMS/docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`；`CMS/docs/superpowers/specs/2026-10-31-template-driven-content-runtime-separation-design.md`；`CMS/docs/verification/2026-11-06-platform-gap-review.md`。接口和版本协议见 `2026-11-06-platform-delivery-master.md`。

## Global Constraints

以下条目原文来自现有目标规格及架构设计，适用于每个任务：

- 模板升级不能静默覆盖网站内容。
- 日常内容更新不应要求重新发布模板。
- 非技术用户不应看到 Template、Prop、Release、Docker 或内部服务地址等实现术语。
- 草稿和已发布版本分离；发布操作生成不可变快照。
- Gateway 是发布和部署状态的唯一权威来源。
- 线上运行时不依赖 CMS 或 Gateway 控制面。
- 兼容性由契约测试和跨仓集成测试证明，不以各仓单独测试代替。
- 新用户可以在 10 分钟内创建一个带首页、导航、商品和联系页面的网站。

执行约束：沿用仓库 Node 22、TypeScript、Vue/Nuxt、MongoDB/PostgreSQL 和现有测试工具；不趁机升级依赖。代码实施时使用隔离工作树，保留来源工作树与用户未提交修改。生产切换前必须有固定版本组合、可回退产物及本计划指定验收证据。测试跳过、环境受阻、人工未测分别记录，不计作通过。

路径约定（每个文件列表均使用这些根目录）：

- `CMS/` = `/Users/445101599qq.com/Projects/cms/`
- `Gateway/` = `/Users/445101599qq.com/Projects/Independent-Website-Gateway/`
- `Templates/` = `/Users/445101599qq.com/Projects/Independent-Website-Templates/`
- `Preview/` = `/Users/445101599qq.com/Projects/Independent-Website-Preview/`

执行时用隔离工作树根目录替换上述本地主目录；命令前注明的仓库就是工作目录。本文中的新接口是规划目标，只有标明“已有”的接口可以直接调用。所有凭据通过进程环境或部署 secret 注入，证据文件仅记录标识和摘要。

---

## 文件职责与依赖

依赖 A/B/C；执行生产迁移还依赖 F2。`migration-preview.ts` 只做纯数据投影和差异；`migration-service.ts` 管理持久操作；`migration-source.ts` 把候选数据接到既有 GatewayReleaseSource；旧站迁移复用相同操作状态，不再另造发布协议。

### Task E1：第三个非商品模板检验通用性

**Files:**
- Create: `Templates/templates/service-studio/1.0.0/template.json`、`Templates/templates/service-studio/1.0.0/storefront/`、`Templates/templates/service-studio/1.0.0/contract-tests/`。
- Create: `Templates/test/contract/service-studio.test.mjs`。
- Create: `CMS/ops/e2e/service-template.spec.mjs`。
- Modify: `Templates/schema/template.schema.json`、`Templates/scripts/validate.mjs`、`CMS/backend/src/presets/import.ts`（取消强制商品 demo，改用模型契约默认值）。
- Modify only if generic defect reproduced: `CMS/backend/src/template-contract/editor-schema.ts`、`CMS/backend/src/content-editor/schema-form.ts`、`CMS/backend/src/storefront/preset-preview.ts`、`CMS/backend/src/release-contract/snapshot.ts`。

**Interfaces:**
- Consumes: 已有 TemplateEditorContract/RendererContract、ContractSnapshotV1、B2 preview 包协议。
- Produces: `service-studio@1.0.0`：模型 `service`（title/slug/summary/cover）、`team-member`（name/role/portrait）、`site-settings`；页面 `/`、`/services`、`/services/:slug`、`/team`、`/contact`；区块 `hero`、`service-list`、`team-grid`、`contact-form`。使用现有约定 manifest 字段，不为该 ID 增加 CMS 条件分支。

- [ ] **Step 1：新建契约 fixture 和测试。** 参考现有 contract fixture 文件格式，使用完全不同的 modelKey；使用既有 validateManifest 和 ContractSnapshotV1 验证器验证，然后通过真实 CMS 安装 API 导入。先检查是否存在必需 `product/home/collection` 的硬编码阻塞。

```js
// 真实安装完成后，从返回的模型数据验证通用性。
assert.deepEqual(site.models.map(model => model.key).sort(), ['service', 'site-settings', 'team-member']);
assert.equal(site.models.some(model => model.key === 'product'), false);
```

`site` 从当前用户安装该模板后的 SiteInstallation API 返回；测试不直接塞入手写 SiteInstallation 跳过安装。
- [ ] **Step 2：运行 Templates `node --test test/contract/service-studio.test.mjs` 和 CMS 新浏览器用例，保留实际安装/投影失败。**
- [ ] **Step 3：实现最小模板与通用修复。** renderer 仅支持上述五页面和四区块，复用 artifact/preview 桥接基础设施。字段映射取 manifest modelKey/fields，页面蓝图取 editor.pages；若现有 demoValues 强制商品结构，改为读取契约声明默认值而非给 service-studio 新建分支。媒体、导航、SEO 走现有契约。
- [ ] **Step 4：执行安装→编辑 service/team→预览→发布→新增页面→导航→内容更新→回滚。** 移除 CMS 运行时对 template ID 的显式枚举限制（保留 Gateway registry 批准控制），执行跨仓契约测试和两旧模板回归。检查 CMS diff 中不存在 `if (id === 'service-studio')` 之类新增特例。
- [ ] **Step 5：提交。** Templates `feat: add service template contract acceptance`；CMS 通用修复如有独立提交并附复现证据。模板按 B2 流程发布，不能将测试 fixture 当成生产 registry 记录。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Templates：

```sh
git diff --check
git add -- templates/service-studio/1.0.0/template.json templates/service-studio/1.0.0/storefront/ templates/service-studio/1.0.0/contract-tests/ test/contract/service-studio.test.mjs schema/template.schema.json scripts/validate.mjs
git diff --cached --check
git commit -m "feat: add service template contract acceptance"
```

CMS：

```sh
git diff --check
git add -- ops/e2e/service-template.spec.mjs backend/src/presets/import.ts backend/src/template-contract/editor-schema.ts backend/src/content-editor/schema-form.ts backend/src/storefront/preset-preview.ts backend/src/release-contract/snapshot.ts
git diff --cached --check
git commit -m "feat: add service template contract acceptance"
```

E1 本地实施及限定复审记录（2026-11-07）：最终 CMS `da238da1d391d5f91f170bf3246998b358a20f67`、Templates `bf11776db84aa97c5eba3f4d538d14682e428469`；Gateway `c5389615772977db5cd1131d3fc312f8b56d1b47`、Preview `5ee66507a9da81e262b72e06f213be4a2b34fe42` 未变。新增 `service-studio@1.0.0`，模型恰为 service/team-member/site-settings，提供五个服务型页面和四个声明区块；CMS 安装、Entry 指针、参数化页面、预览和发布投影改为契约驱动，没有按 `service-studio` ID 分支，AeroFrame/FireGuard 行为保持。

初始审查发现更新/回滚使用独立安装和手工快照切换、服务/团队集合没有读取多条目、以及缺少本地 B2 安装事务。修复后同一 workspace/site 保留两条不可变 release 并调用既有 rollback；实际浏览器验证两个服务、两个团队、动态 slug、导航、第二次发布和回滚；跨仓测试执行已有 Preview bundle/artifact 构建、摘要校验和幂等安装。最终契约 10/10、CMS 定向 64/64、服务 storefront 7/7、同站 Chromium 1/1，后端类型检查通过，两个旧模板契约回归通过。

本地 B2 记录 manifest checksum `sha256:1706f3984d8c708066a7d759062cf493bd16b54fe8abc9514727fb32332d76f6`、bundle digest `sha256:c1c4f5b59ee33e3dccf04c49f877a64e4eb59392de84b1a85dbf59cb658a8c52`、artifact digest `sha256:d7d95e9d1d066c93d21b00ad66f11fd647385e29804b6f244dfac800a2875c9c`；第二次安装返回 `unchanged`。这些是本地包证据，不是公共 OCI/registry 发布。38 个任务文件当前/提交哈希一致，154 个原始来源文件未变化，任务进程/容器/数据库已清理。

公共 registry/OCI 制品、已部署 Gateway/公共 HTTPS、生产浏览器验收和真实人工建站时间线仍未执行，因此 Task E1 整体保持未勾选。格式化 diff 噪声和合成预览父页作为测试支持这两个 Minor 留最终审查统一判断。

### Task E2：迁移 dry-run、结构差异和内容校验

**Files:**
- Create: `CMS/backend/src/template-contract/migration-preview.ts`、`CMS/backend/src/template-contract/migration-preview.test.ts`、`CMS/backend/src/template-contract/migration-document.ts`、`CMS/backend/src/template-contract/migration-document.test.ts`。
- Modify: `CMS/backend/src/template-contract/compatibility.ts`、`CMS/backend/src/template-contract/model.ts`、`CMS/backend/src/presets/import.ts`。
- Modify: `CMS/ui/src/views/dashboard/templates.tsx`、`CMS/ui/test/template-upgrade.test.mjs`。

**Interfaces:**

```ts
interface MigrationDocument {
  models: Record<string, Array<{id:string;fields:Record<string,unknown>}>>;
  pages: Array<{id:string;path:string;sections:Array<{id:string;type:string;props:Record<string,unknown>}>}>;
}
type MigrationStep =
  | {op:'rename-field';model:string;from:string;to:string}
  | {op:'set-default';model:string;field:string;value:unknown}
  | {op:'rename-section';from:string;to:string};
interface MigrationPreview {
  document: MigrationDocument;
  changes: Array<{kind:'field'|'section';id:string;from:string;to:string}>;
  issues: Array<{code:string;path:string}>;
}
previewMigration(document:MigrationDocument, steps:MigrationStep[]): MigrationPreview;
```

`migration-document.ts` 导出 `toMigrationDocument(site:SiteInstallation, input:ReleaseInput):MigrationDocument`，使用 site.models 的 propId→field key 映射，不直接把数据库 Entry 当普通 JSON。逆向写入属于 E3；页面与条目 ID 在预览保持稳定。

- [ ] **Step 1：写纯函数数据保护测试。**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { previewMigration } from './migration-preview';
test('renames an existing field without mutating source or overwriting a target', () => {
  const source = { models:{service:[{id:'entry-1',fields:{headline:'A'}}]}, pages:[] };
  const result = previewMigration(source,[{op:'rename-field',model:'service',from:'headline',to:'title'}]);
  assert.deepEqual(result.document.models.service[0].fields,{title:'A'});
  assert.deepEqual(source.models.service[0].fields,{headline:'A'});
  const collision = previewMigration({models:{service:[{id:'entry-1',fields:{headline:'A',title:'B'}}]},pages:[]},[{op:'rename-field',model:'service',from:'headline',to:'title'}]);
  assert.equal(collision.issues[0].code,'target_exists');
});
```

补充保留 false/0/空字符串、未知 op 拒绝、未知 model 拒绝、保留媒体 ID、区块节点 ID 稳定、原型污染 key 拒绝、二次执行结果相同；删除字段和任意脚本不在支持范围，明确返回 unsupported_operation。
- [ ] **Step 2：运行 CMS 新增两个测试文件，预期模块缺失失败。**
- [ ] **Step 3：实现白名单迁移。** clone 输入；按 key 处理，禁止 `__proto__`/`constructor`/`prototype`；rename 目标已存在且源仍存在时报冲突，只有源不存在目标存在才视为已迁移；set-default 仅在属性不存在时写值。最后按目标 manifest 验证必填、类型、媒体、引用、页面路径和区块；任何 issue 禁止采用。

```ts
const has = (value:Record<string,unknown>, key:string) => Object.prototype.hasOwnProperty.call(value,key);
// entry 为候选 clone 中该模型条目，step 是已校验 rename-field。
if (has(entry.fields, step.from) && has(entry.fields, step.to)) {
  issues.push({code:'target_exists',path:`${step.model}/${entry.id}/${step.to}`});
} else if (has(entry.fields, step.from)) {
  entry.fields[step.to] = entry.fields[step.from];
  delete entry.fields[step.from];
}
```

兼容性不再仅因“未声明 migration”就默认展示兼容；比较模型、页面、editor 区块、renderer 能力。升级预览列出字段变化、区块变化、每条内容影响和错误；用户仍需明确采用。
- [ ] **Step 4：重跑新增测试、现有 compatibility/import/upgrade 测试和 backend/UI 类型检查。** 升级预览不得写 Entry、SiteInstallation 或 Gateway active。
- [ ] **Step 5：提交。** `feat: preview safe template data migrations`。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- backend/src/template-contract/migration-preview.ts backend/src/template-contract/migration-preview.test.ts backend/src/template-contract/migration-document.ts backend/src/template-contract/migration-document.test.ts backend/src/template-contract/compatibility.ts backend/src/template-contract/model.ts backend/src/presets/import.ts ui/src/views/dashboard/templates.tsx ui/test/template-upgrade.test.mjs
git diff --cached --check
git commit -m "feat: preview safe template data migrations"
```

E2 本地实施及两轮修复复审记录（2026-11-07）：最终 CMS `1ef26e76cd43e2e31f8ef9428b7d05e7742c4413`；Gateway `c5389615772977db5cd1131d3fc312f8b56d1b47`、Templates `bf11776db84aa97c5eba3f4d538d14682e428469`、Preview `5ee66507a9da81e262b72e06f213be4a2b34fe42` 未变。实现纯函数 `previewMigration`、安全克隆与白名单 rename/set-default/rename-section、propId→字段文档映射、确定性差异、目标 manifest 全类型/数组/单例/媒体/引用/页面校验，以及只读兼容性和影响预览。

审查修复补全 DATE、ENUMERATION、GROUP_POINTER、WIDGET、数组 shape 和 single-entry 恰一条语义；媒体通过既有同站点授权边界筛选；界面改为人类可读标签/标题/本地化说明，实际 `TemplateUpgradePanel` 由 `PresetsView` 复用，迁移需要前置数据时不开放采用。最终渲染测试 2/2、完整聚焦 38/38、跨仓三模板 10/10，后端与 UI 类型检查通过。预览前后完整 Entry/SiteInstallation/Release/Gateway 状态快照不变；12 个任务文件当前/提交哈希一致，154 个原始来源文件未变化，任务资源已清理。

计划中的 `templates.tsx` 在当前仓库已不存在，实际升级入口是 `presets.tsx`，报告已记录该路径替换。E2 只做预览，候选重建、显式采用、崩溃恢复和回滚由 E3 实现。格式化 diff 噪声与既有 lint 警告继续作为最终审查的 Minor；本任务不执行生产采用或公共发布。

### Task E3：持久升级操作、候选数据和显式采用

**Files:**
- Create: `CMS/backend/src/template-contract/migration-service.ts`、`CMS/backend/src/template-contract/migration-repo.ts`、`CMS/backend/src/template-contract/migration-source.ts`、`CMS/backend/src/template-contract/migration-service.test.ts`、`CMS/backend/src/template-contract/migration.integration.test.ts`。
- Modify: `CMS/backend/src/presets/controller.ts`、`CMS/backend/src/presets/site-repo.ts`、`CMS/backend/src/presets/gateway-jobs.ts`、`CMS/backend/src/repo.ts`。
- Create: `CMS/backend/src/template-contract/site-mutation.ts`、`CMS/backend/src/template-contract/site-mutation.test.ts`。
- Modify: `CMS/backend/src/entry/controller.ts`、`CMS/backend/src/entry/repo.ts`、`CMS/backend/src/studio/controller.ts`、`CMS/backend/src/presets/pages.ts`、`CMS/backend/src/presets/release-controller.ts`（接入同站变更互斥）。
- Modify: `CMS/ui/src/views/dashboard/templates.tsx`。

**Interfaces:**

```ts
interface MigrationOperation {
  id:string; cmsWorkspaceId:string; cmsSiteId:string; requestKey:string;
  expectedUpdatedAt:number; sourceChecksum:string; targetManifestChecksum:string;
  status:'planned'|'staged'|'publishing'|'active'|'failed'|'rolled-back';
  previousSite:SiteInstallation; candidateSite:SiteInstallation;
  previousReleaseId:string; targetReleaseId?:string; targetRouteRevision?:number; errorCode?:string;
}
// migration-source.ts 适配已有发布接口，而不是直接写 active。
createMigrationReleaseSource(operation:MigrationOperation): GatewayReleaseSource;
// migration-service.ts：
adoptMigration(operationId:string, expectedSourceChecksum:string, actorId:string): Promise<MigrationOperation>;
reconcileMigration(operationId:string): Promise<MigrationOperation>;
canFinalizeMigration(targetReleaseId:string,targetRouteRevision:number,state:GatewayState): boolean;
// GatewayState 是 CMS/backend/src/presets/gateway-state.ts 的已有类型。
```

- [ ] **Step 1：写失败保护集成测试。** 用完整 SiteInstallation/Entry fixture，创建 planned 操作，然后改变源 updatedAt，采用必须返回冲突，Gateway 不接收发布。再覆盖：候选不健康、CMS 在 Gateway ready 后中断、重复采用同 requestKey、非法媒体引用、迁移期间并发内容编辑、回滚后旧媒体可访问。

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { canFinalizeMigration } from './migration-service';
test('does not finalize a migration without an authoritative active deployment', () => {
  assert.equal(canFinalizeMigration('target-release', 4, { revision:4, active:null }), false);
});
```

集成测试使用现有 release/entry fixtures，记录失败前后的完整 SiteInstallation、Entry ID 集合及 Gateway active tuple；不使用只检查返回值的模拟作为最终验收。

- [ ] **Step 2：运行 `migration-service.test.ts` 和 `migration.integration.test.ts`，预期导出缺失失败。**
- [ ] **Step 3：实现候选 namespace 和原子指针切换。** 根据 E2 结果复制模板/条目到唯一候选 namespace，建立旧 ID→新 ID 映射并重写引用；不覆盖当前条目。candidateSite 持有新 models/pages/manifest，releaseSource 只读取候选数据；保留 CMS workspace/site 身份。候选构建后校验跨模型引用和全部媒体。

采用时获得站点迁移租约并冻结该站点的内容/页面/模板修改（返回明确 409“升级进行中，请稍后重试”）；所有 Entry/页面/模板/发布更新路径在服务端使用同一个 withSiteMutation(siteId, action) 互斥入口；新增 site-mutation.ts 导出 `withSiteMutation<T>(siteId:string, action:()=>Promise<T>):Promise<T>`，先获得站点写锁再执行写入，结束后释放。迁移取得相同锁后重算源内容 checksum，等待现有写操作结束并写入持久 publishing 状态；普通写入遇该状态返回 409。不能只在写入前做一次无锁状态检查。使用已有发布 requestKey 和 Gateway 健康检查。只有权威 active release 等于 targetReleaseId，才通过单文档 CAS 将 SiteInstallation 的 models/pages/manifest 指向 candidateSite 并记录 operation active；中断由 reconciliation 重放。状态未知时保持持久 publishing 编辑阻塞状态并查询，不盲目回退已成功的新版本。canFinalizeMigration 使用经现有 reconcileGatewayState 同等身份/checksum 校验的 GatewayState，要求 active.releaseId 与 active.routeRevision 同时等于该操作记录的目标，不能仅相信 operation ready。

```ts
// 最终化的必要条件，来自 Gateway 权威查询：
if (!operation.targetReleaseId || operation.targetRouteRevision === undefined ||
    !canFinalizeMigration(operation.targetReleaseId, operation.targetRouteRevision, state)) {
  return operation; // 继续 publishing；不更新安装指针
}
```

回滚先调用既有 Gateway 历史 release 回滚，确认旧 active 后恢复 previousSite 指针；若采用后已有新草稿修改，要求先保存草稿副本，不能直接覆盖。媒体和候选数据由引用关系保留，垃圾回收不删除 active/previous/pending 操作引用。
- [ ] **Step 4：验证纯测试、Mongo 集成与 Docker 升级/回滚。** 在各中断点重启 CMS，最终只能收敛到旧完整状态或新完整状态；不能产生新模板配旧字段。演练两个站点同时升级，租约只阻止对应站点编辑。
- [ ] **Step 5：提交。** `feat: adopt and recover staged template migrations`。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- backend/src/template-contract/migration-service.ts backend/src/template-contract/migration-repo.ts backend/src/template-contract/migration-source.ts backend/src/template-contract/migration-service.test.ts backend/src/template-contract/migration.integration.test.ts backend/src/presets/controller.ts backend/src/presets/site-repo.ts backend/src/presets/gateway-jobs.ts backend/src/repo.ts backend/src/template-contract/site-mutation.ts backend/src/template-contract/site-mutation.test.ts backend/src/entry/controller.ts backend/src/entry/repo.ts backend/src/studio/controller.ts backend/src/presets/pages.ts backend/src/presets/release-controller.ts ui/src/views/dashboard/templates.tsx
git diff --cached --check
git commit -m "feat: adopt and recover staged template migrations"
```

### Task E4：旧站迁移、灰度和兼容读取退出

**Files:**
- Create: `CMS/backend/src/migrations/template-contract.ts`、`CMS/backend/src/migrations/layout-document.ts`、`CMS/backend/src/migrations/site-runtime.ts`、`CMS/backend/src/migrations/site-runtime.test.ts`。
- Create: `CMS/ops/migrate-site.mjs`。
- Modify: `CMS/backend/src/presets/site-model.ts`、`CMS/backend/src/presets/site-repo.ts`、`CMS/backend/src/presets/gateway-publish.ts`。
- Create: `Gateway/apps/control/src/migrations/artifacts.ts`、`Gateway/apps/control/test/artifact-migration.integration.test.ts`。
- Modify: `CMS/storefront/server/utils/runtime-release.mjs`。
- Create: `CMS/docs/operations/site-runtime-migration.md`。

**Interfaces:**
- Consumes: 已有 createLegacyEditorAdapter、toContractSnapshot、layoutDocument 规范化；E3 MigrationOperation。
- Produces: `planLegacySiteMigration(site:SiteInstallation,input:ReleaseInput): {candidateSite:SiteInstallation;issues:Array<{code:string;path:string}>}`；`runtimeMode:'legacy'|'artifact'` 为站点显式字段。
- CLI：`node ops/migrate-site.mjs plan|apply|rollback --site SITE_ID --operation OPERATION_ID`。SITE_ID/OPERATION_ID 为操作生成的实际身份，不允许省略 site 或使用默认“全部站点”；apply 必须引用既有 plan 的 checksum。

- [ ] **Step 1：写稳定性和失败保护测试。** 旧 sectionConfigs 输入重复规划两次，节点 ID 相同；媒体缺失/快照不兼容产生 issue；默认只 plan，不更改 active、安装指针或 runtimeMode。

```ts
const first = planLegacySiteMigration(site, input);
const second = planLegacySiteMigration(site, input);
assert.deepEqual(first, second);
assert.equal(site.runtimeMode, 'legacy');
assert.equal(first.candidateSite.pages[0].layoutDocument?.mode, 'template');
```

`site/input` 从现有 release-contract fixture 创建，保留 old sectionConfigs，无 layoutDocument；所有 required 字段使用原 fixture，不手写简化无效 SiteInstallation。
- [ ] **Step 2：运行 CMS `site-runtime.test.ts`、Gateway `artifact-migration.integration.test.ts`，预期迁移函数未实现失败。**
- [ ] **Step 3：实现逐站计划与产物转换。** legacy adapter 生成 editor；节点 ID 基于 site/page/旧节点身份确定，不每次 random；转换 ReleaseSnapshot、复制并校验资源，Gateway 创建不可变 ReleaseArtifact 记录。保存 source checksum、旧 release、旧 route revision、新 artifact 和所有错误。目标 artifact 已存在同 checksum 返回幂等成功，不同 checksum 冲突。

apply 复用 E3 的候选发布/指针切换；只有成功后将该站 runtimeMode 改 artifact。公开 runtime 缺产物时返回明确不可用，不静默回源 CMS。rollback 使用历史完整产物/旧读取方式及旧 route，不改变其他站点模式。
- [ ] **Step 4：隔离环境顺序演练一个 legacy 站与一个 artifact 站。** plan 两次 → apply → CMS 停机验证页面/图片/重定向 → rollback → 再次 apply。注入缺媒体、worker 中断、checksum 错误，旧 active 必须不变。生产只选择单个已备份站，确认后逐步扩大；全量切换无默认入口。
- [ ] **Step 5：提交迁移工具和操作文档。** `feat: migrate legacy sites with per-site rollback`；文档列出每站前后身份和恢复步骤，仅迁移完成站点关闭兼容读取。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- backend/src/migrations/template-contract.ts backend/src/migrations/layout-document.ts backend/src/migrations/site-runtime.ts backend/src/migrations/site-runtime.test.ts ops/migrate-site.mjs backend/src/presets/site-model.ts backend/src/presets/site-repo.ts backend/src/presets/gateway-publish.ts storefront/server/utils/runtime-release.mjs docs/operations/site-runtime-migration.md
git diff --cached --check
git commit -m "feat: migrate legacy sites with per-site rollback"
```

Gateway：

```sh
git diff --check
git add -- apps/control/src/migrations/artifacts.ts apps/control/test/artifact-migration.integration.test.ts
git diff --cached --check
git commit -m "feat: migrate legacy sites with per-site rollback"
```
