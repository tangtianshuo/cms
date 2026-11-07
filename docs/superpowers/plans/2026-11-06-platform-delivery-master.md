# 建站平台交付总计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已实现的跨仓成果交付为可自助建站、可稳定运营且可持续扩展的版本。

**Architecture:** 保留 Templates → CMS → Gateway → Storefront 的现有职责，新增 Preview 只承担私有预览静态产物分发。先收敛版本和运行时，再完成自动开通、真实验收，最后扩展模板迁移和规模化保障。

**Tech Stack:** Node.js 22、TypeScript、Vue 3、Nuxt、Next.js、MongoDB、PostgreSQL、Docker、Nginx、node:test、Vitest。

**Spec:** `CMS/docs/superpowers/specs/2026-11-06-single-content-workspace-design.md`（新增唯一编辑工作区要求）；`CMS/docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`；`CMS/docs/superpowers/specs/2026-10-31-template-driven-content-runtime-separation-design.md`；差距依据 `CMS/docs/verification/2026-11-06-platform-gap-review.md`。

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

## 范围与决策

本轮只产出任务计划，不执行代码整合、部署或数据迁移。六份子计划分别定义独立交付与验收；既有设计和本次审查作为需求基线，不重写整个架构。

选择“复用已有实现并分阶段交付”。不选择从头重写，也不选择直接开始原 RoadMap 的 P6.3/P7：当前三仓尚不互通，后两种路线分别浪费成果或掩盖前置缺口。

- 首次试运营范围：A + B + C + D，以及 F1/F2/F3 的最低运营保障。
- 完整目标范围：再完成 E 和 F4。
- 不包含支付、订单、库存、物流、任意嵌套自由排版、多区域高可用。
- CMS 只保留一处内容编辑：列表、页面、商品、品牌资料、旧完整编辑器深链汇入同一工作区，富文本/媒体/引用内嵌；未保存输入自动更新真实模板画布，不要求点击预览。
- 本期按模板蓝图与声明区块预制排版，保留现有 LayoutDocument 稳定 ID/版本；后续自由排版仍在同一工作区扩展，须单独定义受控布局、迁移与发布兼容。
- 统一保存体验不等于跨集合事务：成功部分确认版本，失败部分保留草稿；只有全部成功才显示已保存。
- 平台默认域名使用一次配置的 `GATEWAY_PLATFORM_DOMAIN`，具体域名由部署环境提供；本地测试固定 `sites.localhost`。不能在计划中虚构生产 DNS 已准备好。
- 默认域名及通配 TLS 由平台运维一次准备；自有域名沿用现有外部 DNS/TLS 管理边界，CMS 展示具体接入要求，Gateway 记录可验证状态。自动购买域名/完整 ACME 平台不列入本期。
- “10 分钟”必须记录真实用户操作耗时；自有域名的外部 DNS 等待另行记录，默认域名支撑即时验收，不把 DNS 等待偷偷从端到端结果中删掉。
- 新模板发布版本规划为 AeroFrame `1.0.4`、FireGuard `1.0.1`。执行 A2 时先核验登记处是否已占用；若已占用，将计划和锁文件一起调整为下一个未发布补丁版，不覆写已有版本。

## 依赖和交付批次

| 批次 | 子计划 / 任务 | 产物 | 放行条件 |
| --- | --- | --- | --- |
| 1 | A1–A4 跨仓整合和运行隔离 | 可重现版本、traffic/ingest 独立进程、模板发布产物 | 干净检出构建、数据库测试及停机演练通过；完整锁文件在 B2 产物齐备后最终化 |
| 2 | B1–B7 唯一编辑工作区与统一预览 | 同版本产物、registry、入口收口、结构化内容、实时草稿会话 | 两模板桌面/移动实时预览、部分保存和旧入口迁移通过 |
| 3 | C1–C4 自动开站和接入 | 幂等开通、持久绑定、恢复任务、默认域名 | 两工作区两站点无需改环境变量即可发布 |
| 4 | F1–F3 最低运营保障 + D1–D2 验收 | 跨仓门禁、备份恢复、告警、真实 UAT | 恢复演练通过、关键用例无失败/阻塞，才可试运营 |
| 5 | E1–E4 模板扩展及迁移 | 第三模板、升级采用、旧站灰度 | 无 CMS 模板特例，升级和迁移可恢复 |
| 6 | F4 发布调度 | 跨站限速、重试、公平调度 | 压力和故障测试通过，健康站点不被异常站点阻塞 |

B 的开发可在 A2 后启动，内部按 B1 → B4 → B5 → B6 → B7 推进；B2 产物发布包含 B4 变更，B3 fixture 可提前建立，最终浏览器证据在 B2/B7 完成后生成。C 可在 A1 的契约和数据库边界稳定后启动；同一仓库的集成由单一负责人串行合并。E 依赖 A/B/C；F1 可在 A4 后开始；F2/F3 不能拖到试运营之后。F4 可以和 E 分开交付。

## 子计划索引

1. [A：跨仓整合与运行时](2026-11-06-a-cross-repo-runtime.md)：4 个任务。
2. [B：唯一内容工作区与统一模板预览](2026-11-06-b-unified-preview.md)：7 个任务，新增 B5–B7。
3. [C：自动开站与域名](2026-11-06-c-site-provisioning.md)：4 个任务。
4. [D：端到端与生产验收](2026-11-06-d-launch-acceptance.md)：2 个任务。
5. [E：模板升级与旧站迁移](2026-11-06-e-template-migration.md)：4 个任务。
6. [F：持续交付与运营保障](2026-11-06-f-production-operations.md)：4 个任务。

合计 25 个独立验收任务。每个代码任务包括失败用例、实现要点、通过验证与提交；已有实现的整合任务直接使用已有失败测试，不为获得红灯添加无意义测试。2–5 分钟颗粒度针对编辑动作，构建、故障演练、恢复和真实 UAT 的耗时按实际记录。

## 版本与证据协议

A4 生成 `CMS/docs/releases/platform-lock.json`，字段定义：

```ts
interface PlatformLock {
  schemaVersion: 1;
  contractVersion: 1;
  repositories: Record<'cms'|'gateway'|'templates'|'preview', {
    repository: string; commit: string;
  }>;
  templates: Array<{
    id: string; version: string; manifestChecksum: string;
    imageDigest: string; previewArtifactDigest: string; previewBundleDigest: string;
  }>;
}
interface AcceptanceEvidence {
  schemaVersion: 1;
  lockChecksum: string;
  environment: 'isolated'|'staging'|'production';
  startedAt: string; completedAt: string;
  cases: Array<{
    id: string; status: 'passed'|'failed'|'blocked'|'not-run';
    reason: string; artifacts: string[];
  }>;
}
```

所有 SHA 为完整值，所有 digest 以 `sha256:` 开头。以上是格式，不是可发布的示例清单；A4 从实际 Git/OCI/registry 产物读取值，禁止填充虚构 SHA。候选运行前可生成只含源码身份的临时证据，但没有完整 digest 的对象不能通过正式锁文件校验。

避免 CMS commit 自引用：锁文件记录产出 CMS 镜像的提交，随后以单独文档提交保存锁文件；CI 检出锁文件声明的版本执行，不错误要求锁文件提交与镜像源码提交相同。

证据根目录：`CMS/docs/verification/evidence/platform-delivery/<run-id>/`。`<run-id>` 由测试入口生成 UTC 时间戳加随机 ID；屏幕证据和探测结果必须带同一个 lockChecksum。运行目录、凭据、真实询盘内容不进入仓库。

## 需求覆盖表

| 目标/差距 | 实施任务 | 验收任务 |
| --- | --- | --- |
| 跨仓未提交成果与版本漂移 | A1、A2、A4 | A4、F1 |
| CMS/control/worker 故障隔离 | A1、A2、A3 | A4、D1 |
| 同版本真实预览 | B1、B2、B7 | B3、D1 |
| 唯一内容编辑入口与旧书签迁移 | B5 | B5、D1、D2 |
| 富文本/数组/引用在同一工作区编辑 | B4、B6 | B6、D1 |
| 未保存内容实时预览、统一保存与冲突保留 | B7 | B7、B3、D1 |
| 本期模板预制排版、后续自由排版扩展边界 | B4、B5、B7 | B7、D1 |
| 新站自动开通、跨工作区授权 | C1、C2、C3 | C3、D1 |
| 域名、challenge、主域名和回滚 | C4 | C4、D2 |
| 页面/导航/商品/SEO/素材编辑回归 | A2 保留修复、B4–B7 唯一工作区，D1 完整复验 | D1、D2 |
| 发布、第二次更新、失败保护和回滚 | A1、C2 | D1、D2 |
| 询盘、统计及独立入口 | A3 | D1、D2 |
| 第三模板无需 CMS 特例 | E1 | E1 |
| 升级差异、采用、迁移及回滚 | E2、E3 | E3 |
| 旧站灰度和兼容读取退出 | E4 | E4 |
| 备份、恢复、告警和发布门禁 | F1、F2、F3 | F1–F3、D2 |
| 发布队列公平性及失败重试 | F4 | F4 |

## 任务状态与边界

- [x] A1 Gateway 架构成果整合（Gateway `a3a169e`、`c3d6ee9`；真实 SQL 195 项通过，修复定向 123 项通过、零跳过；独立复审通过。完整目标组合契约由 A2/A4 继续验收）。
- [x] A2 Templates/CMS 整合及新不可变版本（Templates `c0e2e17`、`e1cb6c6`；CMS `0d29068`；实际跨仓与 HTTP 契约 16 项通过、零跳过；独立复审通过。外部产物发布留待 B2）。
- [x] A3 独立询盘/事件服务与授权收口（Gateway `ca3c543`、`f71bbd0`；Templates `57b1233`；CMS `513b994`；真实进程故障演练及定向数据库 23 项通过，复审通过；管理身份授权由 C1 继续完成）。
- [ ] A4 干净构建、运行隔离及组合锁定（本地阶段及修复复审通过：CMS `d68f194`、`c1ab0d1`；Gateway `58e615f`；Templates `ed63e4e`。正式公共产物身份、完整锁文件及公共链路验收待 B2，整项未完成）。
- [x] B1 精确版本 CMS 预览接入（CMS `a3bf2ed`；Templates `0db7ce5`；后端/UI 各 20 项、跨仓 8 项通过，类型检查及独立审查通过；真实浏览器与公共产物由 B2/B3 验收）。
- [ ] B2 预览包和 registry 发布事务（本地阶段及修复复审通过：Templates `9d3687f`、Preview `91683c5`。精确产物重试恢复、安装与两模板浏览器证据通过；外部发布、公共身份与完整锁文件待验收，整项未完成）。
- [ ] B3 预览部署与浏览器一致性（本地阶段及修复复审通过：CMS `acd4125`、`967f88b`；Preview `d54a9ce`。两模板各 14 个矩阵用例通过、2 个发布用例阻塞；真实 HTTPS 图片、安全追踪和 Nginx/TLS 检查通过。正式公共发布比对、完整锁文件及生产 TLS/DNS 仍待验收）。
- [ ] B4 模板声明驱动属性表单（本地实现及两轮修复复审通过：CMS `86e88a63`、`fa6b332`、`67c1a5e`；Templates `4e9d229`、`4a6eb28`、`e24ce083`。两模板真实浏览器验证通过，正式发布比对和图片加载仍待 B2/B3；历史 JSON 浏览器基线缺失已记录）。
- [x] B5 唯一内容工作区、导航收口和旧深链兼容（CMS `c310808`、`53100d4`；实际入口/选择器/授权及修复定向浏览器验证、UI/后端类型检查通过；独立审查及修复复审通过。实时会话留待 B6/B7，既有设置重复保存 400 已交 D1 集成修复）。
- [x] B6 富文本、数组及既有复杂字段内嵌与结构化保存（CMS `7d6fe77`、`bea75a3`；真实编辑/保存回读、结构校验及权限回归通过，独立审查三项 Important 已修复并通过复审。模板富节点渲染与缺路由预览校验继续由 B7 闭合；日志噪声 Minor 保留）。
- [x] B7 未保存内容实时预览、统一会话和部分保存/冲突保护（CMS `830614f`、`62aee66`、`6c2b0dd`、`f2db53e`；Templates `6a2fd46`。两模板各 78 项通过、2 项公开 URL 跳过；复审已闭合页面缓存、首次创建版本和手机光标恢复。公开比对/HTTPS 图片及声明外渲染边界仍留后续验收）。
- [x] C1 Gateway 幂等站点开通与身份映射（Gateway `815b1e3`；15 项真实 PostgreSQL 用例及十一类管理接口授权通过，全仓 243 项通过、1 项 Linux 限定跳过；独立审查通过。CMS 传输与恢复交接 C2/C3，域名就绪交接 C4）。
- [x] C2 CMS 持久绑定和异步配置读取（CMS `e0e1b71`；真实 Mongo 唯一索引/并发持久化、双站点 CMS→Gateway HTTP/SQL 授权通过，最终定向 27 项及修正回归通过；B3 两种绑定模式零写入验证与独立审查通过。完整部署验收仍由后续任务完成）。
- [x] C3 创建向导、后台恢复和状态反馈（CMS `6117b70`、`09b9ec9`；真实创建幂等/租约/权限、全局发布限制、后端 13 项/发布 6 项/UI 35 项通过，繁忙队列修复及实际 main.ts 进程重启恢复通过独立复审。新创建接口要求稳定 requestKey，域名和部署验收交接 C4/D1）。
- [ ] C4 域名接入与首次发布闭环。 Local stage and two fix reviews accepted: CMS `9ad35ef`, Gateway `4033e64`. Automatic provisioning, TLS challenge, two-site Docker publication and recovery verified; formal public-chain/PlatformLock/Internet DNS-TLS acceptance pending.
- [ ] D1 可重复的跨仓浏览器验收（本地实现及两轮修复复审通过：CMS `1637858`、Gateway `7536019`。真实 UI 双站、双向运营、五类故障、两模板当前画布及清理验证通过；正式公共产物/完整锁文件/DNS-TLS 未齐，48 项为 2 blocked、46 not-run，无正式 AcceptanceEvidence）。
- [ ] D2 生产试运营验收与证据归档。
- [ ] E1 非商品型第三模板验证（本地实现及修复复审通过：CMS `da238da`、Templates `bf11776`。service-studio 真实 CMS 安装、五页面、多服务/团队、同站二次发布/回滚及本地 B2 打包安装通过；公共制品/Registry/部署验收待执行）。
- [ ] E2 模板迁移 dry-run 与影响预览（本地实现及两轮修复复审通过：CMS `1ef26e7`。纯迁移预览、完整目标校验、同站媒体边界、人类可读实际 UI 和零写入通过；候选采用/恢复留在 E3）。
- [ ] E3 明确采用、候选发布和升级回滚。
- [ ] E4 旧站迁移和逐站灰度。
- [ ] F1 强制跨仓发布门禁（本地实现及三轮修复复审通过：CMS `9b784cf`、Gateway `74960c7`、Templates `2f4c35f`、Preview `5ee6650`。固定四仓源码、制品签名/摘要及 A4/D1/B3 证据组合与部署依赖已接入；真实公开链路、远程 CI、环境/分支保护配置待执行，整项未完成）。
- [ ] F2 一致备份和隔离恢复（本地实现及修复复审通过：CMS `06ff20e`、Gateway `1c94455`。源站/恢复站共存清理、配置化询盘入口、原生数据库恢复、重新发布和回滚通过；真实公共锁/制品、异机副本、定时保留及生产恢复待验收）。
- [ ] F3 公开探测与运维告警（本地实现及修复复审通过：CMS `bd12cd3`、Gateway `c538961`。真实发布版本/资源/证书/备份/控制面/发布失败探测、持久去重、通知重试和容器故障恢复通过；真实外部接收人、已安装定时器、公共锁/制品及生产监控待验收）。
- [ ] F4 发布队列公平性、配额和重试。

执行中发现实现与文档不一致时，以复现和实际代码为依据修订任务，不将已有勾选记录当作当前发布证据。完成一项只更新该项；不得因单元测试通过提前勾选生产验收。

## 规划自查新增确认

- 现有 visual-page-editor.tsx 的区块属性仍通过 JSON textarea 编辑：由 B4 明确补齐，属于既定非技术用户目标。
- ui/test/studio-visual-editor.e2e.mjs 实际检查源码及消息协议：由 B3 新建真实浏览器 fixture，D1 扩展为完整用户流程。
- Preview registry 的 checkout 根、OCI 凭据可见性和包安装原子性需要可重复测试：由 B2 覆盖，不以 workflow 文件存在作为发布成功。

## 计划自查记录

2026-11-06 已完成本轮文档自查：

- 需求覆盖：原审查差距和新增唯一编辑入口、实时预览、结构化内容及模板排版边界均映射到任务；自由排版明确是后续扩展。
- 文件与链接：7 份计划，25 个唯一任务；Modify 路径已存在于主目录/来源工作树，或由前序任务创建；子计划相对链接可解析。
- 占位扫描：没有未填写的实现占位说明；每个任务有 Files、Interfaces、执行步骤和提交命令。
- 接口一致性：新增 EditorTarget、StructuredStudioValue、EditorSessionKey、SaveContext；B3 最终验收依赖 B7，B6 复用 B4 控件。统一使用总计划 PlatformLock/AcceptanceEvidence；发布最终化使用现有 GatewayState.active，而不是域名查询的 route 对象；CMS 动态绑定的所有消费者包含后台恢复任务。
- 验证边界：以上是计划文档校验，不是代码实现、构建或生产验收通过记录。执行中的所有任务保持未勾选。

执行交接：推荐按任务使用 subagent-driven-development，每项完成后做规格与代码审查；也可使用 executing-plans 在当前会话逐项推进。第一项是 A1，先保护来源工作树，再整合 Gateway，不从生产部署或 P6.3 开始。
