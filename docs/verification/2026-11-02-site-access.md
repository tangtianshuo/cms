# P6.1 Workspace/Site/权限隔离验证

日期：2026-11-02

本阶段将请求级 workspace/site 选择校验和站点能力校验收敛到独立模块。服务端通过 `x-bcms-workspace`、`x-bcms-site` 解析成员身份、站点归属和 API key 绑定；路由不把浏览器提交的 ID 当作授权依据。默认 workspace 兼容没有 `workspaceId` 的历史数据，资源 ID、媒体引用和 Release 指针保持不变。

新增 `backend/src/authorization/site-access.ts`，明确以下能力边界：

- `content.read`、`content.write`
- `pages.manage`
- `publish`
- `domains.manage`
- `operations.read`、`operations.manage`

发布、域名、运营看板、询盘修改和相应的 Studio/内容路由分别使用能力检查；管理员拥有全部能力，编辑者只拥有内容读写，查看者只拥有内容读取。能力检查失败时统一返回 403。

已验证：

```bash
npm run build:noEmit --prefix backend
TS_NODE_PROJECT=backend/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 \
  node -r ts-node/register -r tsconfig-paths/register --test \
  backend/src/authorization/site-access.test.ts \
  backend/src/workspaces/context.test.ts
TS_NODE_PROJECT=backend/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 \
  node -r ts-node/register -r tsconfig-paths/register --test \
  backend/src/workspaces/integration.test.ts \
  backend/src/workspaces/content-isolation.test.ts \
  backend/src/studio/integration.test.ts
```

结果：类型检查通过；权限和 selector 单元测试 4/4 通过；Mongo 内容隔离测试 1/1 通过。工作区和 Studio 集成测试能够启动并执行跨站点校验，但当前隔离数据库中的既有 fixture 仍有两个独立基线问题：Studio 页面 fixture 返回 `Invalid info grid`，workspace 集成未开启 `STOREFRONT_ENABLED` 导致发布请求返回 400；两者均发生在本阶段能力检查之前。
