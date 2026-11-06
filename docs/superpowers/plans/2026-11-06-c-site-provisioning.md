# C：自动开站与域名接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户新建网站后无需人工填写 Gateway 映射即可完成发布。

**Architecture:** CMS 把站点身份和开通意图一次写入 MongoDB，后台作业用稳定身份向 Gateway 幂等开通。Gateway 事务保存来源工作区/站点映射；后续请求依据已验证 CMS 上下文及来源映射授权，公开域名状态仍由 Gateway 决定。

**Tech Stack:** Node.js 22、TypeScript、Vue 3/Nuxt、Next.js、MongoDB、PostgreSQL、Docker、node:test、Vitest。

**Spec:** `CMS/docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`；`CMS/docs/superpowers/specs/2026-10-31-template-driven-content-runtime-separation-design.md`；`CMS/docs/verification/2026-11-06-platform-gap-review.md`。任务边界及版本协议见 `2026-11-06-platform-delivery-master.md`。

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

## 文件职责与接口边界

依赖 A1 的数据库/发布契约；发布预览流程依赖 B。新增 CMS `site-provisioning/` 只管理开通，不接管发布状态；Gateway `provisioning.ts` 只管理身份及默认域名，不把新站标为 active。保留旧环境绑定，迁移只对明确选定站点生效。

### Task C1：Gateway 幂等开通与跨工作区授权

**Files:**
- Create: `Gateway/apps/control/src/provisioning.ts`、`Gateway/apps/control/src/service-scope.ts`。
- Create: `Gateway/apps/control/app/api/v1/site-provisioning/route.ts`。
- Modify: `Gateway/apps/control/src/auth.ts`、`Gateway/apps/control/src/site-info.ts`、`Gateway/apps/control/src/publish-operation.ts`、`Gateway/apps/control/src/template-pin.ts`、`Gateway/apps/control/src/releases.ts`、`Gateway/apps/control/src/publish.ts`、`Gateway/apps/control/src/domains.ts`、`Gateway/apps/control/src/publication-state.ts`。
- Modify: `Gateway/apps/control/app/api/v1/sites/[siteId]/leads/route.ts`、`Gateway/apps/control/app/api/v1/sites/[siteId]/events/route.ts` 的管理 GET/PATCH。
- Modify: `Gateway/prisma/schema.prisma`。
- Create: `Gateway/prisma/migrations/20261106000000_source_site_bindings/migration.sql`。
- Test: `Gateway/apps/control/test/provisioning.integration.test.ts`、`Gateway/apps/control/test/service-scope.test.ts`。

**Interfaces:**

```ts
interface CmsSourceIdentity { instanceId: string; cmsWorkspaceId: string; cmsSiteId: string }
interface ProvisionInput { cmsWorkspaceId: string; cmsSiteId: string; name: string; requestKey: string }
interface ProvisionResult {
  cmsWorkspaceId: string; cmsSiteId: string;
  workspaceId: string; siteId: string; siteUrl: string;
  status: 'provisioned';
}
// 新增到 provisioning.ts / service-scope.ts：
provisionSite(pool: Pool, instanceId: string, input: ProvisionInput, platformDomain: string): Promise<ProvisionResult>;
authenticateSiteService(request: Request, siteId: string, pool: Pool): Promise<{ workspaceId: string }>;
```

`instanceId` 来自已验证服务身份 `CMS_INSTANCE_ID`，不能由 body 指定。共享服务密钥仍仅保存在 CMS/Gateway 后端。新管理请求包含 `X-CMS-Workspace`、`X-CMS-Site`，值必须由 CMS 已验证 workspaceContext 派生；Gateway 同时验证 instance/source tuple/目标 site 的数据库映射。没有来源头时只允许现有单工作区认证；有任意来源头但映射不匹配时拒绝，不回退旧模式。

- [ ] **Step 1：加入 PostgreSQL 并发测试。** 沿用现有随机测试数据库 fixture，导入 `Pool`、`randomUUID`、Vitest；测试环境的 instance 为 `cms-test`、平台域为 `sites.localhost`：

```ts
const input = { cmsWorkspaceId: randomUUID(), cmsSiteId: randomUUID(), name: '站点 A', requestKey: randomUUID() };
const results = await Promise.all(Array.from({ length: 8 }, () => provisionSite(pool, 'cms-test', input, 'sites.localhost')));
expect(new Set(results.map(value => value.siteId)).size).toBe(1);
expect(results.every(value => value.status === 'provisioned')).toBe(true);
const result = await pool.query('SELECT count(*)::int AS count FROM "SourceSiteBinding" WHERE "instanceId"=$1 AND "cmsSiteId"=$2', ['cms-test', input.cmsSiteId]);
expect(result.rows[0].count).toBe(1);
```

补充同 requestKey 换 source tuple 返回 409；丢失首次响应后重试返回同一身份；工作区 B 无法读取 A 的发布、询盘和统计；伪造 body.workspaceId 无效；没有凭据 401。
- [ ] **Step 2：运行 Gateway `npx vitest run apps/control/test/provisioning.integration.test.ts apps/control/test/service-scope.test.ts`，有测试数据库且新接口未实现时应失败。**
- [ ] **Step 3：实现数据库唯一身份和事务。** 新增 `SourceWorkspaceBinding(instanceId,cmsWorkspaceId,workspaceId)`，唯一 `(instanceId,cmsWorkspaceId)`；`SourceSiteBinding(instanceId,cmsWorkspaceId,cmsSiteId,siteId,requestKey)`，唯一来源三元组、唯一 `(instanceId,requestKey)`、唯一 siteId，关联工作区映射。事务锁来源工作区（`pg_advisory_xact_lock(hashtextextended($1,0))`），先查已有映射，再创建 Workspace/Site/Domain/mapping，最后 COMMIT。冲突整个事务回滚再读取已有精确身份，不生成孤儿站。

```ts
const lockKey = JSON.stringify([instanceId, input.cmsWorkspaceId]);
await client.query('BEGIN');
await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
// client 是 pool.connect() 得到的同一连接；所有查询都在该连接事务中完成。
```

默认域名 `s-<Gateway site UUID 去连字符>.<platformDomain>`，只由服务端生成。Domain 初始未 ready，证书和路由由 C4 探测决定。管理接口统一改用 `authenticateSiteService`；禁止 leads/events 仅验证共享 secret 后按任意 siteId 查询。
- [ ] **Step 4：执行本任务测试和现有 auth/domain/publish 测试。** SQL 集成环境必须运行，不能接受 skip。比较两个工作区的所有管理资源，预期外站请求 404 或 403 且无写入。
- [ ] **Step 5：提交。** `feat: provision gateway sites with scoped source identities`。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Gateway：

```sh
git diff --check
git add -- apps/control/src/provisioning.ts apps/control/src/service-scope.ts apps/control/app/api/v1/site-provisioning/route.ts apps/control/src/auth.ts apps/control/src/site-info.ts apps/control/src/publish-operation.ts apps/control/src/template-pin.ts apps/control/src/releases.ts apps/control/src/publish.ts apps/control/src/domains.ts apps/control/src/publication-state.ts 'apps/control/app/api/v1/sites/[siteId]/leads/route.ts' 'apps/control/app/api/v1/sites/[siteId]/events/route.ts' prisma/schema.prisma prisma/migrations/20261106000000_source_site_bindings/migration.sql apps/control/test/provisioning.integration.test.ts apps/control/test/service-scope.test.ts
git diff --cached --check
git commit -m "feat: provision gateway sites with scoped source identities"
```

### Task C2：CMS 持久映射与所有 Gateway 调用收敛

**Files:**
- Create: `CMS/backend/src/site-provisioning/model.ts`、`CMS/backend/src/site-provisioning/repo.ts`、`CMS/backend/src/site-provisioning/config.ts`、`CMS/backend/src/site-provisioning/config.test.ts`。
- Modify: `CMS/backend/src/repo.ts`、`CMS/backend/src/presets/gateway-client.ts`、`CMS/backend/src/presets/controller.ts`、`CMS/backend/src/presets/release-controller.ts`、`CMS/backend/src/presets/gateway-jobs.ts`。
- Modify: `CMS/backend/src/site-domains/gateway.ts`、`CMS/backend/src/leads/gateway.ts`、`CMS/backend/src/analytics/gateway.ts`。
- Test: `CMS/backend/src/presets/gateway-client.test.ts`、`CMS/backend/src/presets/gateway-jobs.test.ts`。

**Interfaces:**

```ts
interface SiteGatewayBinding {
  cmsWorkspaceId: string; cmsSiteId: string;
  workspaceId: string; siteId: string; siteUrl: string;
  source: 'provisioned'|'legacy';
}
interface BindingReader {
  find(cmsWorkspaceId: string, cmsSiteId: string): Promise<SiteGatewayBinding|null>;
  listProvisioned(): Promise<SiteGatewayBinding[]>;
}
resolveGatewayPublishConfig(env?: NodeJS.ProcessEnv): Promise<GatewayPublishConfig>;
// GatewayPublishConfig 保留现有字段，新增可选 `sourceHeaders?: Record<string,string>`。
// 所有动态站点调用均 await 新接口；旧 gatewayPublishConfig 保留为纯 legacy parser。
```

- [ ] **Step 1：加入动态绑定优先、上下文缺失拒绝和外站隔离测试。** `config.ts` 导出可测试工厂 `createGatewayConfigResolver(reader: BindingReader, context: () => {workspaceId:string;siteId?:string}|undefined)`，返回 `(env?:NodeJS.ProcessEnv)=>Promise<GatewayPublishConfig>`。

```ts
const resolve = createGatewayConfigResolver({
  find: async (workspaceId, siteId) => workspaceId === 'w1' && siteId === 's1'
    ? { cmsWorkspaceId:'w1', cmsSiteId:'s1', workspaceId:'11111111-1111-4111-8111-111111111111', siteId:'22222222-2222-4222-8222-222222222222', siteUrl:'https://s1.sites.example', source:'provisioned' } : null,
  listProvisioned: async () => [],
}, () => ({ workspaceId:'w1', siteId:'s1' }));
const selected = await resolve({ GATEWAY_BASE_URL:'https://gateway.example', CMS_SERVICE_SECRET:'test-only' });
assert.equal(selected.cmsSiteId, 's1');
assert.equal(selected.sourceHeaders?.['X-CMS-Site'], 's1');
```

再证明 context 未选 site 时不能选“唯一站点”；数据库 unavailable 不回退到别站；同 source 的环境和数据库绑定冲突必须报错，不能静默换 Gateway site。
- [ ] **Step 2：CMS 运行 `TS_NODE_PROJECT=backend/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -r tsconfig-paths/register --test backend/src/site-provisioning/config.test.ts`，预期导出不存在失败。**
- [ ] **Step 3：实现独立绑定 repo。** 沿用 createMongoDBRepository 模式，唯一索引 `(cmsWorkspaceId,cmsSiteId)` 与 `(workspaceId,siteId)`；不把密钥放在 SiteInstallation 返回值。`resolveGatewayPublishConfig` 仅从 verified context 读取绑定；legacy 无来源头保持原行为。`gatewayRequest` 在所有管理调用中转发 sourceHeaders，但不得接受浏览器自带覆盖值。

```ts
const headers = new Headers(init.headers); // config 来自服务端 resolver
for (const [name,value] of Object.entries(config.sourceHeaders || {})) headers.set(name,value);
return gatewayRequest(fetch, url, config.serviceSecret, { ...init, headers });
```

`gatewayRequest` 内部也改为 `const headers = new Headers(init.headers)`，再 `headers.set("Authorization", "Bearer " + secret)` 和 `headers.set("Content-Type", "application/json")`，将 Headers 实例直接传给 fetch；禁止继续用对象展开 Headers 导致来源头丢失。依次更新发布、回滚、状态、域名、询盘、统计与后台恢复调用；`runGatewayRecoveryTick` 的 loadConfigs 类型变为 `()=>Promise<GatewayPublishConfig[]>`，同时枚举动态和旧绑定、按 CMS 身份去重，并为每项建立原有 recovery workspace context。
- [ ] **Step 4：运行配置、Gateway client/publish/jobs、site-domain 测试及 backend typecheck。** 搜索 `gatewayPublishConfig(`，只允许 legacy parser 自身和其专属测试继续调用，生产路径使用 async resolver；不能漏掉 recovery job。
- [ ] **Step 5：提交。** `feat: resolve persisted site bindings across gateway clients`。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- backend/src/site-provisioning/model.ts backend/src/site-provisioning/repo.ts backend/src/site-provisioning/config.ts backend/src/site-provisioning/config.test.ts backend/src/repo.ts backend/src/presets/gateway-client.ts backend/src/presets/controller.ts backend/src/presets/release-controller.ts backend/src/presets/gateway-jobs.ts backend/src/site-domains/gateway.ts backend/src/leads/gateway.ts backend/src/analytics/gateway.ts backend/src/presets/gateway-client.test.ts backend/src/presets/gateway-jobs.test.ts
git diff --cached --check
git commit -m "feat: resolve persisted site bindings across gateway clients"
```

### Task C3：开通意图、恢复作业和创建向导

**Files:**
- Create: `CMS/backend/src/site-provisioning/service.ts`、`CMS/backend/src/site-provisioning/jobs.ts`、`CMS/backend/src/site-provisioning/service.test.ts`、`CMS/backend/src/site-provisioning/integration.test.ts`。
- Modify: `CMS/backend/src/presets/site-model.ts`、`CMS/backend/src/presets/site-repo.ts`、`CMS/backend/src/workspaces/controller.ts`、`CMS/backend/src/main.ts`。
- Modify: `CMS/ui/src/views/dashboard/site-onboarding.tsx`、`CMS/ui/src/views/dashboard/site-onboarding-state.ts`；现有 workspace HTTP 调用处沿用原 SDK 通道。
- Test: `CMS/ui/test/site-onboarding.test.mjs`、`CMS/ui/test/site-onboarding-ui.test.mjs`。

**Interfaces:**

```ts
interface ProvisioningState {
  requestKey: string;
  status: 'pending'|'running'|'ready'|'failed';
  attempts: number; nextAttemptAt: number;
  leaseToken?: string; leaseUntil?: number; lastError?: string;
}
interface ProvisioningStore {
  claim(now: number): Promise<{cmsWorkspaceId:string;cmsSiteId:string;name:string;state:ProvisioningState}|null>;
  complete(siteId:string, leaseToken:string, binding:SiteGatewayBinding): Promise<boolean>;
  defer(siteId:string, leaseToken:string, nextAttemptAt:number, code:string): Promise<boolean>;
}
runProvisioningTick(store:ProvisioningStore, provision:(input:ProvisionInput)=>Promise<ProvisionResult>, now:number): Promise<void>;
```

SiteInstallation 增加可选 `provisioning`，新建时 pending 和 site 同文档原子写入；旧站没有该字段，不自动开新 Gateway 站。用户创建操作的 requestKey 同时用于幂等站点创建，唯一 `(workspaceId,creationRequestKey)`；网络重试不能产生第二个 CMS 站。

- [ ] **Step 1：先测崩溃恢复和重复点击。** service.test 使用真实函数和内存 store 工厂，记录 claim/complete/defer；integration.test 使用 Mongo。断言：两个同时 create 请求同 key 返回同 site；Gateway 已成功但 CMS complete 前故障，重试保持同 Gateway ID；过期 lease 的 complete 不能覆盖新 lease；同一幂等 key 不得用于不同站名/创建参数。

```ts
// Mongo 集成测试复用现有 workspaces fixture 的 authenticatedRequest。
const body = { name: '站点 A', requestKey: 'create-site-test-1' };
const [a, b] = await Promise.all([
  authenticatedRequest('/api/v4/workspaces/current/sites', { method:'POST', body }),
  authenticatedRequest('/api/v4/workspaces/current/sites', { method:'POST', body }),
]);
assert.equal(a._id, b._id);
assert.equal(a.provisioning.status, 'pending');
```

在测试文件内按已有集成 fixture 的实际请求签名定义 `authenticatedRequest` 适配，返回解析的 SiteInstallation，非 2xx 抛错，禁止绕过实际认证调用 handler。
- [ ] **Step 2：运行上述两个新增测试文件，预期 requestKey 幂等或 provisioning 字段缺失失败。**
- [ ] **Step 3：实现有租约的后台恢复。** SiteInstallationSchema 增加字段并明确允许白名单；claim 原子 findOneAndUpdate pending/过期 running，租约 60 秒；请求超时 15 秒，退避 5/15/60/300 秒，最多 8 次后 failed 可手动重试。成功时先 upsert 同身份绑定，再 CAS 更新 ready，重放不能改写不同 Gateway ID。

```ts
const item = await store.claim(now);
if (!item) return;
const token = item.state.leaseToken!;
try {
  const result = await provision({ cmsWorkspaceId:item.cmsWorkspaceId, cmsSiteId:item.cmsSiteId, name:item.name, requestKey:item.state.requestKey });
  await store.complete(item.cmsSiteId, token, { ...result, source:'provisioned' });
} catch {
  const delays = [5000, 15000, 60000, 300000];
  await store.defer(item.cmsSiteId, token, now + delays[Math.min(Math.max(item.state.attempts - 1, 0), 3)], 'gateway_unavailable');
}
```

401/403、身份冲突和配置缺失不得当临时网络错误无限重试：分类为 `gateway_unauthorized`、`binding_conflict`、`configuration_missing`，直接 failed。jobs 沿用 gateway-jobs 的启动/停止模式，每 5 秒尝试，关机清 timer。

向导显示“正在准备发布环境”“发布环境已就绪”“准备失败，重试”；准备期间可以编辑，发布按钮禁用。新增管理员 `POST /api/v4/workspaces/current/sites/:siteId/provisioning/retry` 和只读 status；校验当前 workspace 归属，编辑者不能触发重试。错误不暴露内部服务地址。
- [ ] **Step 4：运行服务、Mongo 集成、onboarding UI 测试和类型检查。** 启动两个后台 tick，确认没有重复映射；重启 CMS，pending 任务继续；仅 readiness 不得显示“网站已上线”。
- [ ] **Step 5：提交。** `feat: recover automatic site provisioning and show progress`。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- backend/src/site-provisioning/service.ts backend/src/site-provisioning/jobs.ts backend/src/site-provisioning/service.test.ts backend/src/site-provisioning/integration.test.ts backend/src/presets/site-model.ts backend/src/presets/site-repo.ts backend/src/workspaces/controller.ts backend/src/main.ts ui/src/views/dashboard/site-onboarding.tsx ui/src/views/dashboard/site-onboarding-state.ts ui/test/site-onboarding.test.mjs ui/test/site-onboarding-ui.test.mjs
git diff --cached --check
git commit -m "feat: recover automatic site provisioning and show progress"
```

### Task C4：默认域名、验证路径与自有域名切换

**Files:**
- Modify: `Gateway/apps/control/src/domains.ts`、`Gateway/packages/traffic/src/index.ts`、`Gateway/packages/traffic/src/state.ts`。
- Create: `Gateway/packages/traffic/src/domain-challenge.ts`、`Gateway/packages/traffic/src/domain-challenge.test.ts`。
- Modify: `CMS/backend/src/site-domains/gateway.ts`、`CMS/ui/src/views/dashboard/domains.tsx`、`CMS/ops/nginx/nova-relay.conf`。
- Create: `CMS/ops/e2e/site-provisioning.mjs`。
- Modify: `CMS/docs/operations/storefront-domain-setup.md`。

**Interfaces:**
- Consumes: C1 default siteUrl、Gateway Domain 状态、已有 CMS `challengeSignature(host, nonce, secret)` 协议。
- Produces: `challengeResponse(host:string, nonce:string, allowedHosts:ReadonlySet<string>, secret:string): string|null`；traffic 本地域名快照 `domains.json` 含已保留但未发布的 hostname；此快照只用于 challenge，不赋予公开内容路由。

- [ ] **Step 1：加入首发前 challenge 测试。**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { challengeResponse } from './domain-challenge.js';
test('reserved hosts can verify without an active deployment; unknown hosts cannot', () => {
  assert.equal(typeof challengeResponse('new.sites.localhost', 'nonce-123', new Set(['new.sites.localhost']), 'test-only'), 'string');
  assert.equal(challengeResponse('foreign.localhost', 'nonce-123', new Set(['new.sites.localhost']), 'test-only'), null);
});
```

再将返回值与 CMS 已有 challengeSignature 同输入结果比对；nonce 超长/非法返回 400；未保留 host 返回 404；没有 active 的 `/` 仍 404，不能通过 challenge 绕过站点路由。
- [ ] **Step 2：运行 Gateway traffic 测试，预期导出缺失失败。**
- [ ] **Step 3：实现独立 challenge 与状态投影。** 域名任务原子落地本地保留域名快照，traffic 在主域名重定向前处理固定 challenge 路径；secret 仅本地服务端。证书有效、HTTPS challenge 通过、域名已归属才允许 ready；平台保留域名使用平台权属，用户自有域名保留 TXT 验证。状态探测不需要先存在 active deployment，避免首发死循环。

Nginx 平台后缀转发到 traffic，未知 Host 仍由 traffic 404；自有域名按明确配置进入同一入口。前端给出实际 A/CNAME 和 TXT 值，证书未准备明确列为接入未完成，不显示空的“向运维索取”作为成功配置。
- [ ] **Step 4：运行 `node ops/e2e/site-provisioning.mjs`。** 创建两个工作区各一个站点，不改环境变量：自动开通 → 默认域名 challenge → 首次发布 → 两站公开内容不同；自有域名绑定 → 归属/HTTPS ready → 切 primary → 旧域名 301 保留 path/query → 失败回滚。未知 Host、外站域名、并发抢占必须拒绝。生产 wildcard DNS/TLS 是一次性平台前置条件，在证据中记录是否已满足。
- [ ] **Step 5：提交。** `feat: complete first-publish domain onboarding`；将测试及部署要求交给 D1/D2，不在该任务自动切换现有生产主域名。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Gateway：

```sh
git diff --check
git add -- apps/control/src/domains.ts packages/traffic/src/index.ts packages/traffic/src/state.ts packages/traffic/src/domain-challenge.ts packages/traffic/src/domain-challenge.test.ts
git diff --cached --check
git commit -m "feat: complete first-publish domain onboarding"
```

CMS：

```sh
git diff --check
git add -- backend/src/site-domains/gateway.ts ui/src/views/dashboard/domains.tsx ops/nginx/nova-relay.conf ops/e2e/site-provisioning.mjs docs/operations/storefront-domain-setup.md
git diff --cached --check
git commit -m "feat: complete first-publish domain onboarding"
```
