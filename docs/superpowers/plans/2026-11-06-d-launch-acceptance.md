# D：端到端及生产验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实用户流程证明固定版本组合能够自助上线与日常维护。

**Architecture:** 先在全新隔离环境自动执行 API/浏览器回归，再部署同一版本组合到受控生产验收站。结果按用例、版本和环境归档，功能测试、外部接入条件和人工体验分别记录。

**Tech Stack:** Node.js 22、TypeScript、Vue/Nuxt、MongoDB、PostgreSQL、Docker、node:test、Vitest；浏览器验收复用 B3 锁定的 Playwright 开发依赖。

新增交互规格：`CMS/docs/superpowers/specs/2026-11-06-single-content-workspace-design.md`，唯一入口、实时预览和保存反馈必须纳入本次验收。

**Spec:** `CMS/docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`；`CMS/docs/superpowers/specs/2026-10-31-template-driven-content-runtime-separation-design.md`；`CMS/docs/verification/2026-11-06-platform-gap-review.md`。接口和版本协议见 `2026-11-06-platform-delivery-master.md`。

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

## 文件职责和入口条件

依赖 A/B/C，生产放行还依赖 F1/F2/F3。B3 提供真实浏览器 fixture，B5–B7 的唯一编辑工作区必须完成，D1 负责整站流程，D2 负责生产验收和用户耗时。旧 UAT 用例继续追踪但重新执行，不能复制旧截图当作新证据。

### Task D1：全新环境、双模板、双站点闭环回归

**Files:**
- Create: `CMS/ops/e2e/launch.spec.mjs`、`CMS/ops/e2e/acceptance-report.mjs`、`CMS/ops/e2e/acceptance-report.test.mjs`。
- Modify: `CMS/ops/e2e/browser-fixture.mjs`、`CMS/ops/e2e/playwright.config.mjs`、`CMS/ops/e2e/bootstrap.mjs`、`CMS/ops/e2e/test.mjs`。
- Create: `CMS/docs/verification/platform-acceptance-cases.md`。

**Interfaces:**
- Consumes: B3 `login(page)`，A4 PlatformLock，C3/C4 自动开通和域名流程。
- Produces: `summarizeAcceptance(cases: AcceptanceEvidence['cases']): { passed:boolean; failed:string[]; blocked:string[]; notRun:string[] }`，缺失必需用例不通过；`node ops/e2e/test.mjs launch` 执行浏览器及 API 流程并输出总计划 AcceptanceEvidence。

必需用例集合为 `CREATE, CONTENT, MEDIA, NAVIGATION, PAGE, SEO, PREVIEW_DESKTOP, PREVIEW_MOBILE, SINGLE_EDITOR, LEGACY_EDITOR_LINKS, STRUCTURED_CONTENT, LIVE_UNSAVED_PREVIEW, PREVIEW_RACE, PARTIAL_SAVE, EDIT_CONFLICT, TEMPLATE_LAYOUT, PUBLISH, UPDATE, ROLLBACK, FAILURE_PRESERVES_ACTIVE, DOMAINS, ISOLATION, LEADS, ANALYTICS`，分别按 `aeroframe`、`fireguard` 前缀生成完整 ID。第三模板属于 E1。

- [ ] **Step 1：先写验收聚合失败测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAcceptance } from './acceptance-report.mjs';
test('a blocked domain case cannot produce a passing launch result', () => {
  const result = summarizeAcceptance([
    { id:'aeroframe/CREATE', status:'passed', reason:'', artifacts:[] },
    { id:'aeroframe/DOMAINS', status:'blocked', reason:'TLS not ready', artifacts:[] },
  ]);
  assert.equal(result.passed, false);
  assert.ok(result.blocked.includes('aeroframe/DOMAINS'));
  assert.ok(result.notRun.includes('fireguard/CREATE'));
});
```

另测重复 ID、未知状态、无锁文件摘要、全部用例有结果才允许通过。
- [ ] **Step 2：CMS 执行 `node --test ops/e2e/acceptance-report.test.mjs`，预期新模块缺失失败。**
- [ ] **Step 3：实现报告与真实流程。** 用 `Map(id,result)` 统计每个必需用例，缺项填 not-run，重复 ID 直接报错。`launch.spec.mjs` 使用 B3 的 login，首次操作必须走 UI 新建站点及选模板，不让 bootstrap 预填 Gateway 绑定。使用唯一内容标识，例如 `runId + templateId`，避免旧站首页 200 造成误判。

逐项执行（所有内容修改只在同一 ContentWorkspace 完成）：名称/品牌 → 首页/商品/图片 → 新内容页和导航下拉 → SEO → 不点击预览即可看到未保存草稿 → 保存发布 → 等待 Gateway active/revision → 公开页面校验 → 修改价格并再次发布 → 回滚。公开 HTTP 验证必须确认唯一内容标识和目标 release 的关联，不能只看状态码。

```js
const publicHtml = await (await fetch(siteUrl)).text();
assert.ok(publicHtml.includes(marker));
assert.equal(publicHtml.includes(otherSiteMarker), false);
assert.equal(publication.active?.releaseId, expectedReleaseId);
```

`siteUrl/marker/otherSiteMarker/expectedReleaseId` 由本次 UI 创建和发布结果收集；`publication` 使用现有 CMS publication 状态 API 解析，不用本地快照状态替代。

新增编辑器验收复用 B5/B6/B7 用例：旧入口进入唯一工作区；富文本结构保留；连续输入/切站/切语言时旧预览不覆盖当前画面；内容保存成功但页面 409 时只显示部分保存、重试不重复新建；未保存离开提示及预览服务故障可恢复。本期只允许 template 布局，structured/非法区块请求被拒绝。LIVE_UNSAVED_PREVIEW 记录最后输入到画布更新耗时（隔离环境目标 ≤1 秒），输入期间无内容写入/发布请求。

单独执行故障用例：不健康候选、CMS/control/worker 停止、ingest 停止；所有清理和服务恢复放 finally。询盘提交后在后台筛选同一 marker、分配、标记处理和导出；统计事件去重后看板更新，错误态不得伪装为零。跨站内容、媒体和运营接口拒绝越权。
- [ ] **Step 4：执行报告测试和 `node ops/e2e/test.mjs launch`。** 两种模板及桌面/移动均通过，截图、浏览器 trace、状态 JSON 与四仓 commit 在同一次运行目录中。运行脚本缺数据库或 Docker 时退出非零并记录 blocked，不降低验收标准。
- [ ] **Step 5：提交。** `test: add complete self-service site acceptance flow`。若发现业务缺陷，按触发用例修复到 A/B/C 对应模块，重新执行受影响用例；不在测试中绕过失败操作。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- ops/e2e/launch.spec.mjs ops/e2e/acceptance-report.mjs ops/e2e/acceptance-report.test.mjs ops/e2e/browser-fixture.mjs ops/e2e/playwright.config.mjs ops/e2e/bootstrap.mjs ops/e2e/test.mjs docs/verification/platform-acceptance-cases.md
git diff --cached --check
git commit -m "test: add complete self-service site acceptance flow"
```

### Task D2：生产验收站与 10 分钟目标复验

**Files:**
- Create: `CMS/docs/operations/platform-launch-runbook.md`。
- Create: `CMS/docs/verification/2026-11-06-platform-launch.md`。
- Create: `CMS/ops/e2e/public-probes.mjs`、`CMS/ops/e2e/public-probes.test.mjs`。
- Modify: `CMS/docs/roadmap/2026-11-01-建站与内容维护平台-roadmap.md`（只按证据更新状态）。

**Interfaces:**
- Consumes: 完整 PlatformLock、D1 通过结果、F2 可恢复备份、F3 告警配置；现有发布部署流程。
- Produces: `probePublishedSite({ origin, marker, paths, fetcher }): Promise<Array<{path:string;status:number;markerPresent:boolean}>>`；环境为 production 的 AcceptanceEvidence 和真实人工操作时间线。

- [ ] **Step 1：先证明 200 不等于验收成功。** public-probes.test 使用注入 fetcher：

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { probePublishedSite } from './public-probes.mjs';
test('does not accept the old site homepage as the new site', async () => {
  const result = await probePublishedSite({ origin:'https://site.example', marker:'new-site-marker', paths:['/'], fetcher:async () => new Response('<h1>old site</h1>') });
  assert.equal(result[0].status, 200);
  assert.equal(result[0].markerPresent, false);
});
```

增加 TLS/连接失败、challenge 重定向、商品 404、图片内容类型不匹配；不得使用 `rejectUnauthorized:false`。
- [ ] **Step 2：运行 CMS `node --test ops/e2e/public-probes.test.mjs`；实现显式 timeout、redirect manual、按路径匹配页面/图片/challenge 的探测逻辑，再重跑通过。**
- [ ] **Step 3：准备可审阅的部署单。** runbook 记录四仓 SHA、镜像和 bundle digest、数据库迁移顺序、实际域名/证书、备份 ID、回滚目标、可用容量、验收站点。禁止把已绑定的商用域名悄悄指向测试站；优先独立验收域名。生产发布沿用授权范围；本计划本身不是执行生产切换的指令。
- [ ] **Step 4：执行已授权生产交付。** 顺序为备份 → 向后兼容数据库迁移 → traffic/ingest/control/worker → 模板新版本和 Preview bundle → CMS → 单个验收站。确认 active 后再开启其他站点；任一阶段失败保留旧 active，按 runbook 回退代码或路由，不自动反向删除已迁移数据库列。
- [ ] **Step 5：实际用户完成完整流程并记录耗时。** 从进入创建向导开始，直到默认域名上看到正确首页、商品、导航和联系页；记录步骤耗时、求助次数、错误和外部 DNS 等待。全程使用唯一内容工作区，至少一次保存前观察文本/图片/富文本即时变化；若必须跳转另一内容编辑器、点击预览或先保存才能看效果，则新增要求验收失败。再执行第二次内容更新、回滚、询盘和统计、手机视口、SEO/图片探测。目标 10 分钟不达标则标为未通过，按最耗时步骤生成具体改进任务，不能仅以开发者熟练操作替代用户体验。
- [ ] **Step 6：归档并更新 RoadMap。** 旧 UAT 每条失败项给出本次对应结果；生产证据必须包含实际日期和锁文件摘要。只有关键用例零失败/零阻塞、恢复演练及告警通过，才标记“试运营就绪”。提交 `docs: record versioned production acceptance`。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- docs/operations/platform-launch-runbook.md docs/verification/2026-11-06-platform-launch.md ops/e2e/public-probes.mjs ops/e2e/public-probes.test.mjs 'docs/roadmap/2026-11-01-建站与内容维护平台-roadmap.md'
git diff --cached --check
git commit -m "docs: record versioned production acceptance"
```
