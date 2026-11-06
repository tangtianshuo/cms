# A：跨仓整合与运行时 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把分散的架构代码整合成可从干净源码构建、公开访问不依赖控制面的版本。

**Architecture:** 复用既有 Gateway artifact/traffic、Templates contract/runtime 与 CMS UAT 修复。给 ingest 增加独立运行入口，再通过真实模板故障演练和完整版本锁文件形成可交付基线。

**Tech Stack:** Node.js 22、TypeScript、Vue 3、Nuxt、Next.js、MongoDB、PostgreSQL、Docker、Nginx、node:test、Vitest。

**Spec:** `CMS/docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`；`CMS/docs/superpowers/specs/2026-10-31-template-driven-content-runtime-separation-design.md`；差距依据 `CMS/docs/verification/2026-11-06-platform-gap-review.md`。

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

## 文件职责和前置输入

来源工作树只读保留：

- Gateway 架构：`/Users/445101599qq.com/.codex/worktrees/gateway-contract-runtime`。
- Templates 架构：`/Users/445101599qq.com/.codex/worktrees/templates-contract-runtime`。
- CMS 当前统一预览修改、Templates 当前统一预览修改：见总计划中的主目录。

Gateway contracts 定义边界，control 保存权威发布状态，worker 产出部署并写路由快照，traffic 只读快照，ingest 接收公众数据。Templates 的 `published.mjs` 只读取不可变产物；CMS `release-contract/` 负责投影。

### Task A1：整合 Gateway 契约、数据库与独立流量面

**Files:**
- Modify: `Gateway/packages/contracts/src/release.ts`、`Gateway/packages/contracts/src/index.ts`。
- Modify: `Gateway/apps/control/src/releases.ts`、`Gateway/apps/control/src/publish.ts`、`Gateway/apps/control/src/publication-state.ts`、`Gateway/apps/control/src/published-release.ts`、`Gateway/apps/control/src/domains.ts`、`Gateway/apps/control/src/public-registry.ts`。
- Modify: `Gateway/packages/worker/src/index.ts`、`Gateway/packages/worker/src/runtime.ts`、`Gateway/packages/worker/src/deployment.ts`、`Gateway/packages/worker/src/docker.ts`、`Gateway/packages/worker/src/docker-client.ts`、`Gateway/packages/worker/src/operations.ts`、`Gateway/packages/worker/src/retirement.ts`。
- Create from source worktree: `Gateway/packages/traffic/package.json`、`Gateway/packages/traffic/tsconfig.json`、`Gateway/packages/traffic/src/index.ts`、`Gateway/packages/traffic/src/state.ts` 及对应测试。
- Modify: `Gateway/prisma/schema.prisma`、`Gateway/package-lock.json`。
- Create from source worktree: `Gateway/prisma/migrations/20261031100000_release_artifacts/migration.sql`、`Gateway/prisma/migrations/20261102000000_leads/migration.sql`、`Gateway/prisma/migrations/20261102010000_analytics_events/migration.sql`、`Gateway/prisma/migrations/20261102020000_analytics_event_id/migration.sql`、`Gateway/prisma/migrations/20261102030000_domain_control_plane/migration.sql`。
- Test: `Gateway/packages/contracts/test/release.test.ts`、`Gateway/packages/worker/src/deployment.test.ts`、`Gateway/packages/worker/src/docker.test.ts`、`Gateway/packages/worker/src/runtime.test.ts`、`Gateway/packages/worker/src/operations.integration.test.ts`、`Gateway/packages/worker/src/retirement.test.ts`、`Gateway/packages/worker/src/retirement.integration.test.ts`、`Gateway/apps/control/test/release.integration.test.ts`、`Gateway/apps/control/test/publish.integration.test.ts`、`Gateway/apps/control/test/publication-state.test.ts`、`Gateway/apps/control/test/publication-state.integration.test.ts`、`Gateway/apps/control/test/domains.test.ts`、`Gateway/apps/control/test/domain.integration.test.ts`。

**Interfaces:**
- Consumes: 已有 ReleaseInput、PublishOperation、ActiveDeployment、CMS `toContractSnapshot` 输出。
- Produces: 来源工作树已有 `validateContractSnapshotV1(value: unknown): ContractSnapshotV1`、`createTrafficProxy(statePath: string)`、`backupRouteState(sourcePath, backupPath)`、`restoreRouteState(backupPath, destinationPath)`；保留来源代码的确切类型，不重新起名。

- [x] **Step 1：记录并保护来源。** 在主目录与两个来源工作树运行 `git status --short`、`git diff --stat`、`git ls-files --others --exclude-standard`。将清单写入本次运行目录，按 using-git-worktrees 技能建立或复用目标工作树；排除 `.env`、运行凭据、node_modules、构建结果。来源修改不删除、不自动提交。
- [x] **Step 2：复现现有失败。** 在 CMS 执行 `npm run build --prefix backend`，再用目标 Gateway 根目录设置 `E2E_GATEWAY_ROOT`，执行 `node ops/e2e/contract-roundtrip.mjs`。预期当前 Gateway 缺少新校验导出；保存失败输出。该测试已存在，无需增加镜像断言式测试。
- [x] **Step 3：按文件移入来源实现和测试。** 已跟踪文件使用 `git diff --binary HEAD -- <本任务文件>` 导出的补丁在目标目录执行 `git apply --check`，检查通过后 apply；未跟踪文件从上列明确目录逐个复制。冲突按当前主分支加来源功能合并，不整目录覆盖。保留 migration SQL 原始身份。
- [x] **Step 4：验证独立构建及数据库真实路径。** Gateway 执行：

```sh
npm ci
npm run typecheck
npm run build
npm test
```

随后在 CMS 的独立 E2E 数据库启动后执行 `node ops/e2e/runtime.mjs migrate` 和 `node ops/e2e/test.mjs gateway`。预期数据库集成不跳过；worker 不再监听 traffic 对外端口。连接失败属于环境阻塞，不能改成跳过。
- [x] **Step 5：检查 diff 后提交本任务列出的 Gateway 文件及其测试。** 提交信息 `feat: integrate artifact runtime and independent traffic`；记录提交 SHA。涉及 ingest HTTP 入口的新增文件留给 A3，不将“目录已存在”当成独立服务完成。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Gateway：

```sh
git diff --check
git add -- packages/contracts/src/release.ts packages/contracts/src/index.ts apps/control/src/releases.ts apps/control/src/publish.ts apps/control/src/publication-state.ts apps/control/src/published-release.ts apps/control/src/domains.ts apps/control/src/public-registry.ts packages/worker/src/index.ts packages/worker/src/runtime.ts packages/worker/src/deployment.ts packages/worker/src/docker.ts packages/worker/src/docker-client.ts packages/worker/src/operations.ts packages/worker/src/retirement.ts packages/traffic/package.json packages/traffic/tsconfig.json packages/traffic/src/index.ts packages/traffic/src/state.ts prisma/schema.prisma package-lock.json prisma/migrations/20261031100000_release_artifacts/migration.sql prisma/migrations/20261102000000_leads/migration.sql prisma/migrations/20261102010000_analytics_events/migration.sql prisma/migrations/20261102020000_analytics_event_id/migration.sql prisma/migrations/20261102030000_domain_control_plane/migration.sql packages/contracts/test/release.test.ts packages/worker/src/deployment.test.ts packages/worker/src/docker.test.ts packages/worker/src/runtime.test.ts packages/worker/src/operations.integration.test.ts packages/worker/src/retirement.test.ts packages/worker/src/retirement.integration.test.ts apps/control/test/release.integration.test.ts apps/control/test/publish.integration.test.ts apps/control/test/publication-state.test.ts apps/control/test/publication-state.integration.test.ts apps/control/test/domains.test.ts apps/control/test/domain.integration.test.ts
git diff --cached --check
git commit -m "feat: integrate artifact runtime and independent traffic"
```

### Task A2：合并模板契约与预览改动，保留 CMS 修复

**Files:**
- Modify: `Templates/schema/template.schema.json`、`Templates/scripts/validate.mjs`、`Templates/package.json`、`Templates/test/validate.test.mjs`。
- Create from source worktree: `Templates/contracts/`、`Templates/test/contract-fixture.mjs`、`Templates/test/contract.test.mjs`、`Templates/test/contract/`。
- Create: `Templates/templates/aeroframe/1.0.4/`、`Templates/templates/fireguard/1.0.1/`，以各自原版为基础。
- Create in both exact version directories: `Templates/templates/aeroframe/1.0.4/template.json`、`Templates/templates/fireguard/1.0.1/template.json`；`Templates/templates/aeroframe/1.0.4/storefront/server/utils/published.mjs`、`Templates/templates/fireguard/1.0.1/storefront/server/utils/published.mjs`；`Templates/templates/aeroframe/1.0.4/storefront/server/utils/published-assets.mjs`、`Templates/templates/fireguard/1.0.1/storefront/server/utils/published-assets.mjs`；`Templates/templates/aeroframe/1.0.4/storefront/server/routes/_assets/`、`Templates/templates/fireguard/1.0.1/storefront/server/routes/_assets/`；`Templates/templates/aeroframe/1.0.4/storefront/shared/snapshot.mjs`、`Templates/templates/fireguard/1.0.1/storefront/shared/snapshot.mjs`；`Templates/templates/aeroframe/1.0.4/storefront/nuxt.config.ts`、`Templates/templates/fireguard/1.0.1/storefront/nuxt.config.ts`、`Templates/templates/aeroframe/1.0.4/storefront/pages/preview.vue`、`Templates/templates/fireguard/1.0.1/storefront/pages/preview.vue` 作为运行配置和预览入口。
- Preserve/verify: `CMS/backend/src/template-contract/compatibility.ts`、`CMS/backend/src/presets/pages.ts`、`CMS/backend/src/storefront/preset-preview.ts`、`CMS/ui/src/views/dashboard/studio.tsx`、`CMS/ui/src/components/storefront/release-manager.tsx` 的 UAT 修复。
- Test: `Templates/templates/aeroframe/1.0.4/storefront/test/render.test.mjs`、`Templates/templates/fireguard/1.0.1/storefront/test/render.test.mjs`、`Templates/templates/aeroframe/1.0.4/storefront/test/preview.test.mjs`、`Templates/templates/fireguard/1.0.1/storefront/test/preview.test.mjs`，以及 `CMS/backend/src/storefront/preset-preview.test.ts`、`CMS/ui/test/publish-status.test.mjs`。

**Interfaces:**
- Consumes: A1 ContractSnapshotV1；现有 TemplateEditorContract、TemplateRendererContract。
- Produces: 新版本 manifest 的 `editor` / `renderer` 字段与真实模板 renderer；公开请求读取同版只读 artifact，预览仅通过消息协议接收草稿。

- [ ] **Step 1：冻结旧版本。** 记录现有 registry 的版本和 digest；比较两个 Templates 工作树的同名文件 diff。旧版本已登记的 manifest/image/bundle 不覆盖。若规划新版本已存在，先更新计划的具体目录和版本，再执行本步骤。
- [ ] **Step 2：用来源测试验证红灯。** 将 `contracts/` 和 `test/contract*` 测试移入目标，加入原来源的 `test:contract` script，执行 Templates `npm run test:contract`。预期未合并契约/renderer 时失败，保留具体失败。
- [ ] **Step 3：创建新版本目录，合并两套行为。** 公开 `published.mjs` 采用架构来源的 artifact 读取，`preview.vue`/消息握手采用统一预览来源；逐个更新 manifest ID/version、renderer 身份、Nuxt base URL 和测试 fixture，不能做全库版本替换。旧公开目录保持可回滚；旧版测试单独归类，不用新架构预期强套旧版本。
- [ ] **Step 4：执行新版本和 CMS 回归。** Templates：

```sh
node scripts/validate.mjs templates/aeroframe/1.0.4/template.json
node scripts/validate.mjs templates/fireguard/1.0.1/template.json
npm run test:contract
npm test --prefix templates/aeroframe/1.0.4/storefront
npm test --prefix templates/fireguard/1.0.1/storefront
```

CMS：

```sh
TS_NODE_PROJECT=backend/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -r tsconfig-paths/register --test backend/src/storefront/preset-preview.test.ts
node --test ui/test/publish-status.test.mjs ui/test/section-editor.test.mjs
```

预期未知区块不落入商品字段；未绑定站点不能显示公网发布成功；预览及公开渲染的页面路径与区块一致。
- [ ] **Step 5：提交模板契约和新版本目录。** 提交信息 `feat: deliver contract-based immutable template versions`。CMS 如需适配仅提交本任务实际更改的文件，保留其他统一预览修改供 B1 验收。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Templates：

```sh
git diff --check
git add -- schema/template.schema.json scripts/validate.mjs package.json test/validate.test.mjs contracts/ test/contract-fixture.mjs test/contract.test.mjs test/contract/ templates/aeroframe/1.0.4/ templates/fireguard/1.0.1/
git diff --cached --check
git commit -m "feat: deliver contract-based immutable template versions"
```

CMS：

```sh
git diff --check
git add -- backend/src/template-contract/compatibility.ts backend/src/presets/pages.ts backend/src/storefront/preset-preview.ts ui/src/views/dashboard/studio.tsx ui/src/components/storefront/release-manager.tsx backend/src/storefront/preset-preview.test.ts ui/test/publish-status.test.mjs
git diff --cached --check
git commit -m "feat: deliver contract-based immutable template versions"
```

### Task A3：让询盘与事件真正运行在独立进程

**Files:**
- Create from source worktree: `Gateway/apps/ingest/leads.ts`、`Gateway/apps/ingest/events.ts`、`Gateway/apps/ingest/retention.ts` 及现有测试。
- Modify: `Gateway/package-lock.json`（登记新 workspace，不更新无关依赖）。
- Create: `Gateway/apps/ingest/package.json`、`Gateway/apps/ingest/tsconfig.json`、`Gateway/apps/ingest/server.ts`、`Gateway/apps/ingest/http.ts`、`Gateway/apps/ingest/http.test.ts`。
- Modify: `Gateway/apps/control/app/api/v1/sites/[siteId]/leads/route.ts`、`Gateway/apps/control/app/api/v1/sites/[siteId]/events/route.ts`；保留管理读写，公共 POST/OPTIONS 转移到 ingest。
- Modify: `Templates/templates/aeroframe/1.0.4/storefront/nuxt.config.ts`、`Templates/templates/fireguard/1.0.1/storefront/nuxt.config.ts`。
- Create/modify: `Templates/templates/aeroframe/1.0.4/storefront/components/LeadForm.vue`、`Templates/templates/fireguard/1.0.1/storefront/components/LeadForm.vue`；`Templates/templates/aeroframe/1.0.4/storefront/plugins/analytics.client.ts`、`Templates/templates/fireguard/1.0.1/storefront/plugins/analytics.client.ts`（将现有发送逻辑集中于单一插件，移除重复发送）。
- Modify: `CMS/ops/e2e/compose.yml`、`CMS/ops/e2e/analytics-isolation.mjs`。

**Interfaces:**
- Consumes: 来源已有 `ingestLead(pool, workspaceId, input, options)`、`ingestEvent(pool, workspaceId, input, now)`；数据库 Site/Domain 归属，不能从请求 body 信任 workspaceId。
- Produces: `createIngestHandler(pool: Pool): (request: Request) => Promise<Response>`，`POST /api/v1/sites/:siteId/leads|events`；新模板 `NUXT_PUBLIC_INGEST_ORIGIN`。公众入口不接收管理 Bearer 凭据，CMS 管理查询继续走 control。

- [ ] **Step 1：加入实际 HTTP 行为测试。** `http.test.ts` 使用 Vitest 和临时 PostgreSQL fixture（沿用 control integration 的随机 workspace/site 清理方式）。核心用例：

```ts
it('rejects a foreign origin before writing a lead', async () => {
  const { createIngestHandler } = await import('./http');
  const request = new Request(`http://localhost/api/v1/sites/${siteId}/leads`, {
    method: 'POST', headers: { origin: 'https://foreign.example', 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'contact', email: 'visitor@example.test', message: 'hello' }),
  });
  expect((await createIngestHandler(pool)(request)).status).toBe(403);
  expect((await pool.query('SELECT id FROM "Lead" WHERE "siteId"=$1', [siteId])).rowCount).toBe(0);
});
```

fixture 中 `siteId` 属于已启用域名 `owned.example`；补充该域名提交 202、同幂等键再次提交 200、停 control 后仍 202、限制体积 64 KiB 返回 413、限流返回 429、DB 不可用返回 503、未知 site 返回 404。事件重复不重复计数。无 Origin 请求返回 403，不把 CORS 当认证；OPTIONS 不写库。
- [ ] **Step 2：运行 Gateway `npx vitest run apps/ingest/http.test.ts`。** 预期未提供 handler 时失败。
- [ ] **Step 3：实现 handler 和运行入口。** URL 提取 siteId；从数据库查询其 workspaceId 和所有启用域名，校验 HTTPS Origin 属于任一允许域名；本地仅允许明确配置的测试 origin。限制 body 后调用已有校验/写入函数。`server.ts` 用 Node HTTP 转换为 Web Request，传递代理信任规则下的来源 IP，禁用任意 `X-Forwarded-For` 信任。ingest package scripts 定义 `build: tsc --project tsconfig.json`、`start: node dist/server.js`、`test: vitest run`；tsconfig 排除 `*.test.ts` 的生产编译，依赖沿用 Gateway 已有 pg/TypeScript 版本并更新根 lock。独立进程只依赖 PostgreSQL，不请求 control；事件错误不影响页面，询盘错误在表单显示可重试且保留输入。

```ts
// http.ts 的结果分支：传入值来自已验证请求及数据库归属。
const result = await ingestLead(pool, workspaceId, payload, { ip });
return Response.json({ accepted: true, ...result }, {
  status: result.duplicate ? 200 : 202,
  headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, Vary: 'Origin' },
});
```

`workspaceId/payload/ip/origin` 分别由前述查询、64 KiB JSON 解析、受信代理解析、域名白名单校验得到，均不采用 body 中的站点或工作区覆盖值。
- [ ] **Step 4：独立启动 ingest 并复验。** `npm run build --workspace @gateway/ingest`、`npx vitest run apps/ingest/http.test.ts`；CMS 执行 `node ops/e2e/test.mjs analytics-isolation`，将公共发送 origin 指向独立 ingest。用同一页面测试 control 停止仍收件、ingest 停止仍返回公开页面。询盘管理和事件看板的站点授权在 C1 统一补齐。
- [ ] **Step 5：提交。** `feat: run lead and event ingestion independently`；测试证据记录 PID/服务名，避免仅导入函数就声称进程隔离。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Gateway：

```sh
git diff --check
git add -- apps/ingest/leads.ts apps/ingest/events.ts apps/ingest/retention.ts package-lock.json apps/ingest/package.json apps/ingest/tsconfig.json apps/ingest/server.ts apps/ingest/http.ts apps/ingest/http.test.ts 'apps/control/app/api/v1/sites/[siteId]/leads/route.ts' 'apps/control/app/api/v1/sites/[siteId]/events/route.ts'
git diff --cached --check
git commit -m "feat: run lead and event ingestion independently"
```

Templates：

```sh
git diff --check
git add -- templates/aeroframe/1.0.4/storefront/nuxt.config.ts templates/fireguard/1.0.1/storefront/nuxt.config.ts templates/aeroframe/1.0.4/storefront/components/LeadForm.vue templates/fireguard/1.0.1/storefront/components/LeadForm.vue templates/aeroframe/1.0.4/storefront/plugins/analytics.client.ts templates/fireguard/1.0.1/storefront/plugins/analytics.client.ts
git diff --cached --check
git commit -m "feat: run lead and event ingestion independently"
```

CMS：

```sh
git diff --check
git add -- ops/e2e/compose.yml ops/e2e/analytics-isolation.mjs
git diff --cached --check
git commit -m "feat: run lead and event ingestion independently"
```

### Task A4：从干净版本构建、故障演练与锁定组合

**Files:**
- Modify: `CMS/ops/e2e/build.mjs`、`CMS/ops/e2e/runtime.mjs`、`CMS/ops/e2e/compose.yml`、`CMS/ops/e2e/contract-roundtrip.mjs`、`CMS/ops/e2e/runtime-isolation.mjs`、`CMS/ops/e2e/test.mjs`、`CMS/ops/e2e/quality-gate.mjs`。
- Create: `CMS/ops/release/platform-lock.mjs`、`CMS/ops/release/platform-lock.test.mjs`、`CMS/docs/releases/platform-lock.json`。
- Create: `CMS/docs/verification/2026-11-06-cross-repo-integration.md`。

**Interfaces:**
- Consumes: A1/A2/A3 的已提交源码、实际 registry/image digest；总计划 PlatformLock。
- Produces: `validatePlatformLock(value: unknown): PlatformLock`（JS JSDoc 描述类型）；`node ops/release/platform-lock.mjs verify FILE` 返回非零拒绝缺失/伪造格式；故障结果纳入 AcceptanceEvidence。

- [ ] **Step 1：加入锁文件校验测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlatformLock } from './platform-lock.mjs';
test('rejects a lock without all four exact source identities', () => {
  assert.throws(() => validatePlatformLock({ schemaVersion: 1, contractVersion: 1, repositories: {}, templates: [] }));
});
```

再覆盖 40 位 SHA、64 位 SHA256 digest、非空模板清单、重复模板身份、非法版本，以及完整有效对象通过。测试只证明格式；执行器另用 Git/registry 证据验证值真实性。
- [ ] **Step 2：运行 CMS `node --test ops/release/platform-lock.test.mjs`，预期模块缺失失败。**
- [ ] **Step 3：实现校验、参数化 E2E 和生成清单。** 遍历四仓 key，要求 repository 非空、commit `/^[a-f0-9]{40}$/`；模板四种摘要均校验 `/^sha256:[a-f0-9]{64}$/`，身份唯一。移除 E2E 对 AeroFrame 1.0.3 的固定假设，读取传入的模板 ID/version；traffic 与 control/worker 各自运行，避免共用 CMS network namespace 掩盖停机语义。
- [ ] **Step 4：执行干净构建及真实故障矩阵。** 依次运行 CMS `node --test ops/release/platform-lock.test.mjs`、`node ops/e2e/runtime.mjs init`、`node ops/e2e/build.mjs`、`node ops/e2e/runtime.mjs up`、`node ops/e2e/runtime.mjs migrate`、`node ops/e2e/bootstrap.mjs`；按现有 README 启动独立 worker/traffic/ingest，再执行：

```sh
node ops/e2e/test.mjs contract
node ops/e2e/test.mjs gateway
node ops/e2e/test.mjs publication-control-plane
node ops/e2e/test.mjs runtime-isolation
node ops/e2e/test.mjs analytics-isolation
node ops/e2e/test.mjs quality-gate
```

每个模板覆盖首页、商品/内容页、媒体、重定向、sitemap；分别停止 CMS/control/worker/ingest。使用 try/finally 恢复本次隔离服务。不停止生产服务；预期 active/revision 不因失败改变。B2 产出 preview digest 前只记录源码组合，B2 结束后生成完整 PlatformLock，A4 在那时才能标记“完整锁定”。
- [ ] **Step 5：提交工具和结果记录。** 先提交实现、记录源码 SHA，再单独提交完成的锁文件，避免自引用。提交信息 `test: verify reproducible platform runtime isolation`。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- ops/e2e/build.mjs ops/e2e/runtime.mjs ops/e2e/compose.yml ops/e2e/contract-roundtrip.mjs ops/e2e/runtime-isolation.mjs ops/e2e/test.mjs ops/e2e/quality-gate.mjs ops/release/platform-lock.mjs ops/release/platform-lock.test.mjs docs/verification/2026-11-06-cross-repo-integration.md
git diff --cached --check
git commit -m "test: verify reproducible platform runtime isolation"
```


A4 的源码提交完成、B2 的真实 digest 收齐后，生成完整锁文件再单独提交：

```sh
node ops/release/platform-lock.mjs verify docs/releases/platform-lock.json
git add -- docs/releases/platform-lock.json
git diff --cached --check
git commit -m "docs: lock verified platform source and artifact versions"
```
