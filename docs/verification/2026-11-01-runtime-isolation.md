# 2026-11-01 Storefront Runtime 隔离验证

本次验证使用隔离 Compose 项目 `cms-e2e-20261028`，并启动一个只读挂载 runtime artifact 的独立 Storefront 容器。没有读取或修改原有开发环境的容器、数据库和数据卷。

## 验证配置

- `NUXT_RUNTIME_ARTIFACT_ROOT=/var/lib/runtime`
- `NUXT_LEGACY_CMS_PUBLIC_READ=false`
- artifact 绑定站点：`builtin.localhost`
- artifact 包含首页、重定向、sitemap 路径和 `/_assets/media/logo.txt`
- Storefront 镜像由本地源码重新构建，四个镜像均构建成功
- Gateway control 停止演练使用独立 artifact Storefront 容器
- worker 停止演练使用独立 PostgreSQL 数据库、路由状态目录和 worker 容器
- 自动化入口：`node ops/e2e/test.mjs runtime-isolation`

## 结果

| 请求 | CMS 正常 | CMS 停止后 |
| --- | ---: | ---: |
| `/` | 200 | 200 |
| `/api/published?path=/` | 200 | 200 |
| `/_assets/media/logo.txt` | 200 | 200 |
| `/sitemap.xml` | 200 | 200 |
| `/api/published?path=/legacy-home` | 200（返回 redirect） | 200（返回 redirect） |

页面响应包含 artifact 中的 `Home` 标题和站点内容；资源响应内容为 `published asset from isolated runtime`。CMS 停止后没有改变这些响应结果，证明公开页面、中间件、发布 API、媒体和 sitemap 已经走同一 artifact 读取链路。

Gateway control 停止期间，控制面健康接口不可用（curl 返回 `000`），artifact 页面和发布 API 仍返回 200。worker 使用独立数据库启动成功，容器状态从 `running` 停止为 `exited`；worker 停止后 artifact 页面仍返回 200。worker 的持久路由恢复、租约和失败回滚测试共 59 项通过，traffic 持久路由测试 3 项通过。

自动化演练停止 Gateway control 后，使用真实 CMS 管理 API 发起新的 Gateway 发布。CMS 返回 `status: pending` 和 `failureCode: gateway_unavailable`，并将冻结的 `gatewayPublishIntent` 保留为 `pending`；不会把新版本标记为 `ready`，也不会改变当前活动 release。Gateway control 恢复后，已有 artifact 路由继续返回 200。

出站审计使用 `bridge` 网络启动 Storefront artifact 容器，使其无法访问 Compose 内的 CMS 或 control 服务；页面、发布 API 和资源仍返回 200。该请求窗口内 CMS 日志只出现 Compose health-check，没有出现 `/api/v4/storefront/published` 请求。

## 实施修复

- `site-domain` 中间件改为使用 `loadPublicSite`，不再无条件调用 CMS 发布接口。
- 新增 `/_assets/[...path]` 运行时资源路由，校验站点、release、路径和资源存在性后从 artifact 读取。
- 公开页面的 SSR 内部 `/api/published` 请求继续只转发受信任的 Storefront headers。
- E2E 构建脚本提高 `git ls-files` 输出缓冲上限，避免历史构建目录较多时因 `ENOBUFS` 无法生成镜像。

## 自动化复跑

```sh
node ops/e2e/test.mjs runtime-isolation
```

该套件创建临时 artifact Storefront，验证 CMS 停止、Gateway control 停止、公开页面/资源/重定向/sitemap、CMS 出站日志窗口，以及 control 停止时新发布进入 `pending/gateway_unavailable`。结束时删除临时容器并恢复 Compose 中的 CMS 和 Gateway control。
