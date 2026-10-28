# 本地 Docker 三件套验收

本目录只操作独立的 `cms-e2e-20261028` compose 项目、`cms_docker_e2e` Mongo 数据库和 `gateway_e2e` PostgreSQL 数据库。端口只绑定 loopback，不读取仓库原有 `.env`。已有开发容器、数据库、备份和原型继续保留。

## 入口与身份

| 服务 | 本地入口 |
| --- | --- |
| CMS Studio | http://127.0.0.1:18080/ |
| 已发布的 Gateway 网站 | http://shop.localhost:18090/ |
| 内置 storefront 可信入口 | http://127.0.0.1:13001/ |
| AeroFrame 1.0.3 私有渲染器 | http://127.0.0.1:18081/preview |
| Gateway control | http://127.0.0.1:18183/api/v1/health/ready |

账号为 `docker-e2e@acceptance.invalid`，密码随机生成在被 Git 忽略的 `.superpowers/sdd/docker-e2e-20261028/runtime.env`，文件权限 0600。浏览器交付页面已登录。不要提交该文件或输出展开后的 compose 配置。

## 初始化与构建

要求 Docker Desktop、Node 22、三仓已安装的开发依赖。Gateway 与 Templates 默认位于 CMS 的相邻目录，可通过 `E2E_GATEWAY_ROOT`、`E2E_TEMPLATES_ROOT` 覆盖。所有命令在 CMS 根目录执行。

```sh
node ops/e2e/runtime.mjs init
node ops/e2e/build.mjs
node ops/e2e/runtime.mjs up
node ops/e2e/runtime.mjs migrate
node ops/e2e/bootstrap.mjs
node ops/e2e/runtime.mjs up
```

`build.mjs` 从 Git 已跟踪与非忽略的源文件生成独立构建上下文，排除环境文件、密钥、依赖和运行数据，构建 CMS、内置 storefront、Gateway、AeroFrame 四个本地镜像。镜像和日志保持在本机，不推送 registry。

`bootstrap.mjs` 通过真实注册/登录 API 创建一次性管理员、通过真实 API 导入模板。生产模式的域名路由使用明确标记的测试 fixture；不会宣称验证了公网 DNS 或证书。CMS 和 Gateway 的站点 UUID 分别生成，绑定关系写回独立环境文件。第二次 `up` 应用该绑定。

Gateway worker 按项目当前的宿主进程设计运行。在单独终端执行：

```sh
docker network inspect gateway-sites || docker network create gateway-sites
node ops/e2e/runtime.mjs worker
```

ARM Docker Desktop 使用 `GATEWAY_DOCKER_PLATFORM=linux/amd64`，运行公开 registry 批准的原始 1.0.2 digest。候选容器仍使用非 root、只读文件系统、drop capabilities、资源限制和 loopback 端口。Linux 可设置 `DOCKER_SOCKET_PATH=/var/run/docker.sock`。本地 canonical URL 保留 HTTPS，路由数据面通过 HTTP 验证；公网 TLS/ACME 不在此验收范围。

## 私有预览

```sh
node ops/e2e/preview-fixture.mjs
```

1.0.3 在本次验收时尚无公开批准记录。该脚本在独立测试站点使用本地真实 manifest 创建 **仅供私有预览的安装 fixture**，不写入伪造的公开批准记录，也不用于 Gateway 发布。正常跨仓发布使用真实公开的 1.0.2。1.0.2 在 CMS 显示“不支持同版本预览”是已验证的边界。

## 复跑

```sh
node ops/e2e/test.mjs ui
node ops/e2e/test.mjs backend
node ops/e2e/test.mjs gateway
node ops/e2e/test.mjs templates
node ops/e2e/test.mjs image
node ops/e2e/test.mjs builtin
node ops/e2e/test.mjs gateway-e2e
node ops/e2e/test.mjs recovery
node ops/e2e/test.mjs retirement
node ops/e2e/audit-containers.mjs
```

`builtin` 要求默认站点没有发布历史，应在新建的隔离数据库中先执行一次。它会创建并回滚四个版本；不会自动清空已有发布数据。`gateway-e2e` 可重复执行，每次创建三个已发布版本，回滚以新操作重新部署旧快照。`recovery` 会短暂停止本测试 worker，以不可达的候选快照入口注入失败，再恢复正常 worker；结束时保留可用环境。

`templates` 同时运行实际 Docker 镜像 smoke 和已构建的 1.0.3 SSR 测试；后者要求 Templates 的 `templates/aeroframe/1.0.3/storefront/.output` 已构建。后端集成测试各自使用随机独立 Mongo 数据库并在结束后清理，不对 CMS 验收数据库执行 drop。测试日志写入被 Git 忽略的运行目录。

`gateway` 每次创建随机 `gateway_test_*` PostgreSQL 数据库、应用真实迁移，结束后仅删除本次创建的数据库；不与运行中的验收 worker 共享任务队列。control 测试文件顺序执行，文件内部的并发请求和租约测试仍保留并发，避免各文件的全局领取操作误取其他文件的 fixture。

## 自动回收验收

首次审计曾发现 13 个站点容器中有 11 个已无路由引用；此前的手工清理只用于回收测试资源。后续已补齐 worker 自动退役：保留当前/前一恢复路由，保护 pending 发布与活动部署不一致状态，持有 Site 行锁并核验无挂载容器的归属和隔离配置，失败可在下一轮或重启后重试。

`gateway-e2e` 在每次成功发布、回滚后等待并断言站点容器不超过 2 个。`retirement` 安全核验测试 worker 的进程身份后短暂停止它，用现有批准镜像与受限 adapter 创建 3 个残留实例；启动故障代理拒绝 Docker DELETE，确认清理失败时站点仍 200；再次重启并恢复删除，确认 3 个残留自动消失，当前/前一及其他原有容器保留。结束时恢复正常 Docker socket 的 worker。与发布/恢复测试顺序执行，不可并发重启同一 worker。

```sh
node ops/e2e/test.mjs gateway-e2e
node ops/e2e/test.mjs recovery
node ops/e2e/test.mjs retirement
node ops/e2e/audit-containers.mjs
```

审计脚本仍保留 `--prune` 显式维护选项；自动回收验收不调用它。正常最终结果为 `total: 2, unreferenced: 0, protected: 2`。缺少可信记录、存在 pending 或无法恢复活动路由时会保留实例并等待协调；不以删除它们来满足数量断言。

## 停止与保留

`node ops/e2e/runtime.mjs status` 查看容器；前台 worker 用 Ctrl+C 停止。测试启动的后台 worker PID 记录在运行目录 `worker.pid`。可用 `docker compose --env-file .superpowers/sdd/docker-e2e-20261028/runtime.env -f ops/e2e/compose.yml stop` 停止本项目容器，保留数据卷。不要对原来的 `cms-*` 开发环境执行清理。

完整结果与浏览器证据：`docs/verification/2026-10-28-docker-e2e.md`。
