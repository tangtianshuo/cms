# 2026-11-02 Gateway 发布控制面故障演练

本记录对应实施计划 P4.3。验证目标是确认 Gateway control、worker、traffic 和 Storefront 运行实例之间的故障边界：控制面停止不影响已有网站访问，worker 重启可以继续处理发布任务，候选版本不健康时保留 active，回滚只切换到已验证的旧 artifact。

## 验证范围

| 能力 | 验证入口 | 结果 |
| --- | --- | --- |
| traffic 只读取持久路由快照 | `@gateway/traffic` 测试 | 3 项通过 |
| worker 只在候选健康、代表 Host 和代理路由均验证后切换 | `@gateway/worker` 测试 | 59 项通过，10 项数据库集成测试因本机未启用集成数据库跳过 |
| control 停止后已有 artifact 继续访问 | `node ops/e2e/test.mjs runtime-isolation` | 通过 |
| CMS 停止后页面、资源、重定向和 sitemap 继续访问 | `node ops/e2e/test.mjs runtime-isolation` | 通过 |
| 不健康候选不替换 active | Gateway worker 测试及 2026-11-01 Docker recovery 证据 | 通过 |
| 回滚使用历史已验证版本 | 2026-11-01 Docker flow 证据及 Gateway rollback 测试 | 通过 |

## 当前实现

- traffic proxy 从原子替换的路由快照读取 `siteId`、`host`、端口、容器身份、release 和 revision；请求路径不调用 control API 或 worker API。
- worker 启动时只恢复与数据库 `ActiveDeployment` 的 release/revision 完全匹配且容器仍通过身份校验的路由。失效路由不会被恢复，也不会把失效候选写成 active。
- 发布顺序固定为候选启动、健康检查、代表 Host 检查、路由切换、代理首页检查、数据库 finalize。任一步失败都会删除候选并保留旧 active；路由已改变但结果未知时不会盲目记录失败或回滚别的 revision。
- 回滚复用已保存的 ReleaseArtifact 和历史路由身份，不重新读取 CMS 草稿；CMS 只提交目标 release，Gateway 决定是否可以切换。

## Docker 证据

隔离 Compose 项目 `cms-e2e-20261028` 的运行时隔离演练在 2026 年 11 月 2 日重新通过，覆盖 CMS 停止、Gateway control 停止、公开 artifact 页面/资源/重定向/sitemap 和 control 不可用时 CMS 保持 `pending/gateway_unavailable`。

2026 年 11 月 1 日已完成的 Gateway Docker flow 和 recovery 证据保存在隔离运行目录中：

- `gateway-flow-result.json`：发布、幂等、草稿隔离、回滚和历史版本保留。
- `gateway-recovery-result.json`：候选 `CANDIDATE_UNHEALTHY` 时 active release 和公开页面状态保持不变。

本次 2026 年 11 月 2 日重跑发布 flow 时，第一次尝试发现隔离环境中的旧路由快照仍指向已退出的候选容器，worker 因代表 Host 校验失败而拒绝恢复。清理该隔离项目的旧候选容器和路由快照后再次尝试，候选容器仍在当前本机 Docker runtime 中健康检查失败；该失败属于环境残留，不改变代码级验证结果。环境恢复后应重新执行：

```bash
node ops/e2e/test.mjs publication-control-plane
```

该命令已加入 `ops/e2e/test.mjs`，会串行运行发布、失败保留 active 和 worker 恢复场景。

## 复跑命令

```bash
cd /Users/445101599qq.com/.codex/worktrees/cms-contract-runtime/cms
node ops/e2e/test.mjs runtime-isolation

cd /Users/445101599qq.com/.codex/worktrees/gateway-contract-runtime
npm run typecheck
npm test -- --runInBand
npm run build
```

公开网站是否可访问以 Storefront artifact 请求为准；control 或 worker 的健康接口不能替代这个结论。
