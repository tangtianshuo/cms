# P5.2 访问事件与聚合看板验证

日期：2026-11-02

AeroFrame 在客户端挂载后异步调用 Gateway `/api/v1/sites/:siteId/events`，上报页面路径、来源、设备、发布站点和匿名 visitor/session hash。请求失败被吞掉，不影响 SSR、首屏或页面交互。Gateway 将事件写入 `AnalyticsEvent`，CMS 通过带 service secret 的内部接口读取站点级时间窗口聚合，不读取运行实例日志。

事件使用站点范围内的 `eventId` 做幂等写入，重复请求返回 `duplicate`；`purgeAnalyticsEvents` 和 `apps/ingest/retention.ts` 提供有界的保留清理入口，默认保留 365 天，可由 `ANALYTICS_RETENTION_DAYS` 调整。

已验证：

```bash
node --test --experimental-strip-types apps/ingest/events.test.ts apps/ingest/leads.test.ts
npm run typecheck --workspace @gateway/control
npm run build --workspace @gateway/control
npm run build:noEmit --prefix backend
npm run type-check --prefix ui
npm run build-only --prefix ui
npm run build --prefix ../templates-contract-runtime/templates/aeroframe/1.0.3/storefront
```

结果：事件校验、匿名化、幂等和保留清理测试 4/4 通过；询盘测试 3/3 通过；Gateway、CMS 后端、CMS UI、AeroFrame 构建通过。

跨站点 Docker E2E：

```bash
node ops/e2e/test.mjs analytics-isolation
```

结果：`analytics-isolation: PASS`。测试创建临时 workspace 和两个 site，分别写入 `/a`（2 次）与 `/b`（1 次）事件，并验证两个站点的聚合查询只返回自身事件；测试结束后清理临时数据。
