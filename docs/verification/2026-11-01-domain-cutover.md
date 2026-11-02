# P6.2 域名接入与路由迁移验证

日期：2026-11-02

本阶段把域名和运行时路由状态的权威读取收敛到 Gateway。CMS 继续负责域名操作入口、归属检查触发和权限校验，但域名归属、DNS、证书、主域/别名、发布 revision、活动 Release、路由健康度由 Gateway 返回投影。

## 已实现

- Gateway `GET /api/v1/sites/:siteId/domains` 按 `siteId + workspaceId` 查询域名与活动部署，返回 ownership、DNS、证书、启用状态、primary/alias、重定向目标和 route revision。
- Gateway 新增域名控制字段：`ownershipStatus`、`dnsStatus`、`enabled`、`isPrimary`、`lastCheckedAt`；迁移会把旧 `status` 投影为兼容的初始状态，并且每个站点最多一个 primary。
- Gateway traffic proxy 和 worker local router 支持 alias 访问返回 301 到 primary，未知 Host 仍返回 404。
- 发布 worker 切换路由时读取已验证、DNS ready、证书 ready 且启用的别名，并把它们写入持久 route snapshot；失败切换使用原 route snapshot 回滚。
- CMS `/api/v4/site-domains` 返回 `gateway` 状态投影，域名页面展示 Gateway 连接、route revision、活动 Host 和运行健康度；Gateway 暂时不可用时保留 CMS 最近域名状态并显示不可用状态。

## 自动化验证

Gateway：

- `npm run typecheck`
- `npm test --workspace @gateway/control -- --run apps/control/test/domains.test.ts`
- `npm test --workspace @gateway/traffic -- --run packages/traffic/src/index.test.ts`
- `npm test --workspace @gateway/worker -- --run packages/worker/src/runtime.test.ts`

覆盖未知 Host 404、域名状态按 workspace/site 隔离、Gateway 状态投影、alias 301、route snapshot 备份恢复、路由切换失败回滚。

CMS：

- `npx ts-node --transpile-only backend/src/site-domains/gateway.test.ts`

该测试验证 CMS 只读取当前 workspace/site 对应的 Gateway binding，并拒绝把其他站点的 Gateway 身份泄露到域名页面。

## Docker 验收入口

在隔离的 `cms-e2e-20261028` compose 项目中运行现有 Gateway/CMS E2E。验收时需要确认：

1. 已验证 primary Host 返回当前活动 Release。
2. 已验证 alias Host 返回 301，`Location` 指向 primary 并保留原 path/query。
3. 未验证 Host、未知 Host、错误 gateway secret 均返回 404。
4. 新 Release 路由切换失败时，旧 route revision 和旧 Host 仍然可访问。
5. CMS 域名页显示 Gateway 的 route revision、活动 Release 和健康状态，而不是把 CMS 本地草稿状态当成线上发布状态。

## 已知限制

公网 DNS、ACME 证书签发和真实公网 TLS 不在本地 Docker 验收范围内；本地验证使用 Gateway 的持久域名状态、HTTP Host 路由和 301 规则。

当前隔离 Docker 项目的 `node ops/e2e/test.mjs gateway-e2e` 在进入业务断言前因既有认证 fixture 失败（`Access token parts length is != 3.`，HTTP 403）而停止；该失败发生在 P6.2 域名/路由断言之前。Gateway 单元、控制面域名 PostgreSQL 集成、traffic proxy 和 worker 路由回滚测试已通过。
