# 2026-11-01 平台故障基线

日期：2026-11-02（本地 Docker 复跑）

本基线用于比较模板契约、CMS 内容维护、Gateway 发布控制与 Storefront 运行时在后续改造中的行为。公开请求统一通过只读挂载的 Release artifact storefront 验证，探测路径包括首页、公开页面 API、图片资源、重定向入口和 sitemap。

## 验证入口

```sh
node ops/e2e/test.mjs platform-baseline
```

运行产物保存在隔离运行目录的 `platform-baseline.json`，不包含密码或 token。当前 artifact release 为 `1a1b9632-5a98-4cfd-bd75-00b11b12954f`。

## 当前结果

| 场景 | CMS | Gateway control | worker | Storefront artifact | 5 项公开探测 | CMS 回源 |
| --- | --- | --- | --- | --- | --- | --- |
| healthy | running | running | 未运行 | 可用 | 全部 200 | 否 |
| CMS stopped | stopped | running | 未运行 | 可用 | 全部 200 | 否 |
| Gateway control stopped | running | stopped | 未运行 | 可用 | 全部 200 | 否 |
| worker stopped | running | running | 未运行（没有可安全暂停的 worker 进程） | 可用 | 全部 200 | 否 |
| network-isolated storefront | running | running | 未运行 | bridge 网络、只读 artifact | 全部 200 | 否 |

每项探测均保存 HTTP 状态、耗时、稳定错误码（失败时）和 CMS 回源标记。此次复跑的 25 项公开探测全部为 HTTP 200，耗时约 2–7ms；CMS 日志没有新增 `/api/v4/storefront/published` 请求。

## 证据与边界

已验证：

- 已发布 artifact 的页面、公开页面 API、图片、重定向和 sitemap 不依赖 CMS 或 Gateway control 的实时请求。
- CMS 停止和 Gateway control 停止期间，已有 artifact 仍可访问。
- bridge 网络下的 Storefront 仍能从本地 artifact 渲染，且没有 CMS 回源。
- 每个探测记录都包含 `status`、`durationMs`、`errorCode` 和 `cmsOutbound`。

过渡边界：

- 本次复跑环境没有正在运行的 Gateway worker，因此记录了 worker 停止场景的“未运行”状态；实际 worker 暂停/恢复需要在启动宿主 worker 的验收环境再次执行。
- 该基线证明已有 artifact 的数据面隔离，不证明新发布在 CMS、control 或 worker 全部停止时可以成功。
- 服务健康状态不能替代页面可访问性；后续阶段必须继续使用逐路径探测和故障矩阵。
