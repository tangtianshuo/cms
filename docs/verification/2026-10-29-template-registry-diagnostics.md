# 2026-10-29 模板核验诊断与复验

本轮已修复“所有模板核验失败都被归为 `invalid_template`”的诊断缺口，并在本地 Docker 环境加载修复代码。2026-10-28 出现的间歇故障本次没有再次复现，**触发原因仍未确认，不能宣称根因已修复**。未推送、发布远程镜像或部署生产。

## 源码提交

| 仓库 | 提交 | 内容 |
| --- | --- | --- |
| Gateway | `dcbdd2f` | 分阶段错误、受控服务端日志、上游不可用返回 503、回归测试和诊断操作说明 |
| CMS | `97c3377` | 安全传递 `template_registry_unavailable`，界面给出目录暂不可用的中文指引 |
| Templates | `615959b` | 本轮未修改 |

运行代码与四镜像构建上下文 `build-1793237949705/` 对应；之后的 README 与验收文档不改变运行行为。最终 image ID、服务状态与容器审计见 [final-runtime.json](evidence/2026-10-29-template-registry-diagnostics/final-runtime.json)。

## 已确认的问题和改动

原 `loadPublicTemplate` 会抛出请求、JSON、目录及 manifest 校验错误；`template-pin` 边界除“找不到模板”外统一返回 HTTP 400 / `invalid_template`，同时没有记录异常阶段。旧日志只能证明核验失败，无法判断超时、限流或 checksum 错误。新增故障注入在旧代码上产生 13 项预期失败，修复后相关 24 项全部通过。

现在 control 在失败时向 stderr 输出单行 JSON：

```json
{"event":"template_verification_failed","siteId":"<site UUID>","stage":"registry_commit","reason":"timeout","elapsedMs":5000}
```

上例仅说明日志格式，不是本次自然复现。实际部署中已用一条无效版本格式请求验证日志落地：HTTP 400，`stage: identity`、`reason: invalid_identity`；它在访问网络和数据库之前被拒绝，没有改变已批准 pin，原始记录见 [live-diagnostics.json](evidence/2026-10-29-template-registry-diagnostics/live-diagnostics.json)。

| 故障类型 | 服务端日志 | API 行为 |
| --- | --- | --- |
| 请求或读取响应体超时 | 实际阶段 + `timeout` + 耗时 | 503 / `template_registry_unavailable` |
| 网络请求/流读取异常 | 实际阶段 + `network`；已知网络码才记录 | 503 / `template_registry_unavailable` |
| 429，或带明确限流头的 403 | `rate_limited`、HTTP 状态、有效数字限流字段 | 503 / `template_registry_unavailable` |
| 其他非 2xx 响应 | `http_error` 和 HTTP 状态 | 503 / `template_registry_unavailable` |
| JSON/大小/目录/manifest 校验失败 | `invalid_json`、`response_too_large`、`invalid_index`、`checksum_mismatch`、`invalid_manifest` 等 | 400 / `invalid_template` |
| 目录没有该版本 | `registry_index` / `template_not_found` | 400 / `template_not_found` |

阶段依次为 `identity`、`registry_commit`、`registry_index`、`manifest`。日志包含站点 UUID 与阶段耗时，丢弃原始异常文本、响应正文、URL 和凭据；数字以外的限流字段不进入日志。CMS 仅允许新增的固定错误码，界面不显示底层响应详情。固定来源、commit 解析、manifest checksum、兼容性检查、5 秒请求期限和 2 MiB 响应上限继续生效；不在 loader 中增加自动重试或缓存。HTTP 错误和超限响应主动取消未使用的响应体，读取后释放 stream reader。

## 实际执行的验证

| 检查 | 本次结果 |
| --- | --- |
| 变更前宿主机执行实际 loader | 连续 10 次核验成功，0 次失败 |
| 变更前 Gateway 容器执行实际 loader | 连续 10 次核验成功，0 次失败 |
| 最终镜像真实鉴权 template-pin API | 连续 8 次 200 且返回匹配版本；首轮 1392 ms，后续 171–222 ms |
| 分阶段诊断与 API 边界定向测试 | 24 通过；旧代码 13 失败 / 11 通过 |
| Gateway 全量（独立 PostgreSQL 测试库） | control 108 + contracts 2 + worker 67 = 177 通过，0 失败、0 跳过 |
| CMS 后端全量（真实 Mongo/HTTP） | 142 通过，0 失败、0 跳过 |
| UI 全量 | 35 通过，0 失败、0 跳过 |
| Gateway/Backend 类型检查、Next/UI 构建 | 通过 |
| Backend/UI lint | 0 错误；后端既有 184 项 warning |
| 四个本地 Docker 镜像构建及镜像预览 origin 契约 | 构建通过；契约 1 通过 |
| 最终镜像的真实发布/草稿隔离/幂等/过期请求拒绝/回滚 | 连续 2 轮完整场景通过 |
| 候选失败保护及 worker 重启恢复 | 1 场景通过；注入不可达快照入口产生 `CANDIDATE_UNHEALTHY`，原活动站点继续 200 |
| 最终运行与资源审计 | CMS、Gateway ready、公开站点、内置站点、私有预览均 200；worker 正常，2 个受保护实例、0 个无引用 |

定向回归包括三个网络请求阶段、HTTP 403/429/503、响应体超时、无效 JSON、超限响应、无效 commit/index、版本缺失、checksum 与 manifest 兼容性，以及日志和接口的敏感内容隔离。独立复核未发现中高优先级问题。

宿主及容器探针是临时证据采集脚本，只执行现有 loader，并限制为各 10 次；最终 API 探针限制为 8 次，没有故意耗尽 GitHub 配额。没有将故障注入结果当作旧故障的自然复现，也没有把连续成功归因为网络或 registry 已修复。证据副本经过运行凭据精确匹配和常见 token 模式检查，见 [本次证据目录](evidence/2026-10-29-template-registry-diagnostics)。其他原始日志在忽略目录 `.superpowers/sdd/registry-20261029/` 与 `.superpowers/sdd/docker-e2e-20261028/` 保留。

## 剩余边界和下一步

原始间歇故障的确切触发条件仍未知。下一次失败时，用发生时间和站点 UUID 查找 `template_verification_failed`，根据阶段、原因、HTTP 状态及限流字段决定具体修复。超时或连接重置、配额耗尽、目录损坏与 checksum 不符需要不同处理，不预先用重试或延长超时掩盖原因。

此次只完成本地诊断改进和复验。AeroFrame 1.0.3 的真实公开镜像/签名/registry 登记、production 精确预览 origin、目标 Linux 的公网域名与 HTTPS 验收仍待后续发布阶段执行。公开发布场景继续使用真实已批准的 1.0.2，1.0.3 不通过本地 fixture 获得公开批准。
