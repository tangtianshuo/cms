# 2026-10-28 三仓发布候选收口

> 2026-10-29 已补齐模板核验分阶段诊断和上游不可用分类，最新复验见 [模板核验诊断与复验](2026-10-29-template-registry-diagnostics.md)。原间歇故障本次未复现，根因仍未确认。

本轮完成本地源码提交、生产构建和隔离 Docker 复验。存在尚未定位的间歇模板核验失败，须在生产发布前继续排查；本记录不作为无条件上线批准。尚未推送代码、发布远程镜像/模板 registry、合并分支或部署生产。此前的 P0 和 Docker 文档保留历史执行结果；当前状态以本记录为准。

## 源码版本

三个仓库均在 `codex/cms-studio-p0` 分支。

| 仓库 | 本轮源码提交 | 范围 |
| --- | --- | --- |
| CMS | `564b332`、`22a934c`、`719d1fb`、`bde8aae` | Studio、持久发布与媒体、原型及设计规则、验收脚本、release 预览配置、可理解的失败提示 |
| Gateway | `79857f4` | 权威活动发布查询、旧容器自动退役、真实数据库和 Docker 回归 |
| Templates | `615959b` | AeroFrame 1.0.3、同版本私有预览、构建及发布准备；1.0.0–1.0.2 目录未改动 |

CMS 的后续文档提交仅补充本验收记录与证据，不改变上述运行代码。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| CMS 后端全量（真实 Mongo/HTTP 条件启用） | 141 通过，0 失败、0 跳过 |
| UI 契约与交互单测 | 35 通过，0 失败、0 跳过 |
| Gateway control / contracts / worker（独立 PostgreSQL 测试库） | 95 + 2 + 67 = 164 通过，0 失败、0 跳过 |
| Templates 根测试（启用构建运行时和本地镜像） | 31 通过，0 失败、0 跳过 |
| AeroFrame 1.0.3 storefront 单测 / Nuxt 构建 | 15 通过 / 构建通过 |
| AeroFrame 构建运行时 / 四版 manifest | 通过；运行时测试已包含在根测试计数内 |
| Backend 类型检查、UI 生产构建、Gateway 各 workspace 类型检查 | 全部通过 |
| Backend / UI lint | 0 错误；后端保留 184 项 warning |
| Studio 原型类型检查和 Vite 构建 | 通过 |
| Python 运维测试 | 11 通过、4 跳过；跳过项需要生产式缓存 origin |
| 四个本地 Docker 镜像 | 最终源码重建通过，包含 `bde8aae`；镜像 ID 见证据 |
| CMS 镜像内精确预览 origin | 1 项通过 |
| Gateway 发布、草稿隔离、再次发布、幂等、过期请求拒绝、回滚 | 1 个完整场景通过 |
| 候选失败保护及 worker 重启恢复 | 1 个场景通过；`CANDIDATE_UNHEALTHY`，原站点 200 |
| 删除失败后的重试及 worker 重启补清 | 1 个场景通过；3 个残留自动删除，2 个受保护容器保留，站点 200 |

场景内部断言不另计测试数量。Backend/UI 在最后诊断修复后重新全量执行；最终镜像重建后再次执行镜像 origin 和 Gateway 发布/回滚场景。恢复及退役场景在同轮最新 Gateway 代码上顺序执行，测试的 finally 已恢复正常 worker。

主要原始输出的脱敏副本位于 [evidence/2026-10-28-release-candidate](evidence/2026-10-28-release-candidate)。其余构建日志保留在忽略目录 `.superpowers/sdd/docker-e2e-20261028/`；最终构建目录为 `build-1793177093304/`。

## 本轮收口修复

- 发布失败界面解释五个已知 worker 失败阶段，并提供错误码与操作 ID 的可展开诊断。
- Gateway HTTP 失败仅转发允许列表内的错误码，UI 给出中文操作指引；未知错误码、原始响应正文和敏感信息不透传。409 的并发冲突行为保持原有语义。新增回归先失败、修复后通过。
- release workflow 增加 `VITE_STOREFRONT_ORIGIN`、`VITE_TEMPLATE_PREVIEW_ORIGIN` 两个构建参数；增加回归测试及生产环境变量说明。远端实际变量尚未配置。
- Gateway 测试不再与正在运行的验收 worker 共用任务队列：每次全量测试创建随机独立 PostgreSQL 库、执行迁移，并只清理自己创建的库；测试文件串行执行，文件内部并发/租约断言继续保留。

恢复场景第一次复跑曾收到 `Gateway request failed (400)`；当时没有下游具体错误码，无法确定根因。同一模板 pin 的后续直接请求返回 200，未修改代码的下一次恢复场景通过。这不构成根因已修复的证据；本轮补充受控错误码传递以弥补诊断缺口。旧原始失败日志已被测试入口的后续复跑覆盖，因此只记录已观察的事实，不将其归因于网络或 registry。

最终镜像第一次发布/回滚复验在回滚的模板 pin 核验处再次出现 400，新诊断明确为 `invalid_template`；该次失败日志已单独保留为 `gateway-e2e-final-first-failure.log`。随后在同一 Gateway 容器内直接加载实际 `public-registry.ts` 和 `canonicalJson` 执行核验，三步请求分别返回 200（commit 705 ms、index 177 ms、manifest 58 ms），manifest 身份与校验和通过。后台重试随后完成了冻结的回滚意图，站点仍为 200，容器恢复为 2 个受保护实例、0 个无引用。没有修改核验代码、放宽校验或替换批准模板。后续完整场景复跑结果另行保留；间歇错误的确切异常和触发条件仍未确认。

独立代码复核未确认新的中高优先级问题。

## 本地运行与保留资料

- Studio：`http://127.0.0.1:18080/d/studio?section=overview`
- 公开站点：`http://shop.localhost:18090/`
- 私有预览 renderer：`http://127.0.0.1:18081/preview`
- 运行环境和随机凭据保留在被忽略、0600 权限的 `runtime.env`；不纳入源码提交。
- 源码备份：`/Users/445101599qq.com/Projects/cms-backups/release-candidate-20261028-162039`。三份归档的 SHA-256 已核对；备份不包含后续少量修复，后续内容由上述 Git 提交保存。此备份不替代数据库或凭据备份。
- 约 188 MB 的手册、构建交付物保留在本地 `deliverables/`、`manual-assets/` 等忽略目录；未纳入源码提交，也未删除。

## 公开发布仍需完成

1. 继续定位 Gateway 模板核验的间歇 `invalid_template`，补充服务端分阶段诊断，明确超时、上游拒绝与校验失败的区分后再决定修复方案；不能以一次复跑通过代替根因分析。
2. 推送并按依赖顺序完成 Gateway、Templates、CMS 的远程发布；AeroFrame 1.0.3 需要真实不可变镜像、签名验证及公开 registry 登记，站点须显式采用该版本。
3. 配置 production 的精确预览 origin、renderer 管理端 origin 和 CSP；本地构建参数不能代替远端环境配置。
4. 在目标 Linux 服务器验证域名所有权、DNS、80/443、HTTPS/ACME 签发和续期、公开媒体及回滚。

公开 Gateway 端到端流程仍使用真实已批准的 AeroFrame 1.0.2；1.0.3 仅完成本地镜像、运行时与私有预览验证，没有伪造公开批准记录。当前单机权威路由设计、HA/灾备和其他后台模块的完整浏览器验收边界继续适用。
