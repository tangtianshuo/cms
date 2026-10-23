# Storefront Analytics Phase D2 Implementation Plan

> **For agentic workers:** This phase remains planned and requires its own implementation request; the current development scope is D1 and D3.

**Goal:** 为已发布独立站提供浏览流量、来源、页面与商品表现报表，统计故障不影响访客浏览。

**Architecture:** Storefront 在公开页面加载和路由完成时发送轻量事件，服务端通过 D1 的域名解析确定站点。MongoDB 持久化去重事件与可租约重试任务，后台 worker 生成聚合数据，管理端读取有站点授权的报表。与 Cloudflare 边缘流量、平台运行监控及交易统计分别处理。

**Tech Stack:** TypeScript、Fastify、MongoDB、Vue 3、Nuxt 4、Node test runner；首期复用现有基础设施，不新增消息中间件或 ClickHouse。

**Spec:** `docs/architecture/storefront-preset-solution.md` 第 6.2、7 节；D1 计划 `2026-10-23-storefront-domains-phase-d1.md`。

顺序调整：用户本次优先实施 D1 与 D3 多独立站/多工作区。本计划在 D3 后执行，报表、设置、导出和聚合同时使用 workspaceId + siteId 权限边界；共享 Entry 的浏览统计按实际发布站点归属，不能跨工作区自动合并。

## Global Constraints

- 状态：仅规划；依赖 C 验收完成、D1 的受信任域名/站点解析可用。
- 仅统计正式公开页面；管理端、预览、演示站和内部健康请求不计数。
- 服务端推导 siteId，校验 releaseId/pageKey/Entry 归属；不接受任意客户端 siteId。
- 默认关闭采集；站点启用时确定隐私同意策略、统计时区和告知文案。需要同意时，未同意不设置标识、不采集，撤回后停止发送并清除本地标识。
- 不保存完整 IP、完整来源 URL 或 query/hash；不做跨站点、跨设备身份合并。
- 原始事件 30 天、小时聚合 30 天、日聚合 13 个月；以 TTL 和清理作业落实，而非只写在界面。
- 采集、队列和聚合失败不阻塞渲染；浏览器发送失败不无限重试，不作为订单金额或计费依据。
- 报表与导出均按服务端站点权限过滤；多站点开放前补完整租户隔离验收。

## 事件、指标与接口合同

`VisitEvent`：`eventId`、服务端推导的 `siteId/hostname`、`releaseId`、`pageKey`、可选 `entryId`、`path`、`kind: page_view|not_found`、`receivedAt`、有界的 `occurredAt`、可选 `visitorHash/sessionHash`、`referrerHost`、允许的 `utm_source/utm_medium/utm_campaign`、粗粒度设备类型。持久化事件不保存原始访客标识；哈希使用独立站点密钥，保留期间保证去重稳定。

PV：有效 page_view 事件数；404 单独统计，不计成功页面 PV。UV：有同意且有效的访客标识去重数，代表浏览器标识而非真实人数。访问次数：按会话开始时间统计的新会话，连续 30 分钟无活动后开始新会话；跨午夜的一个会话不能重复计作新会话。

日期按站点统计时区分桶，时区更改须显示生效日期并重建保留窗口内数据；旧窗口按原时区标记。过去 30 天范围 UV/会话使用原始事件精确去重；较长时间仅返回每日 UV 和可加总指标，范围 UV 标记为不可用，不能相加每日 UV。渠道使用会话首个事件的来源/UTM；不含标识的聚合模式如需开放须另定义口径。

- `POST /api/analytics/events`：Storefront 同源采集入口；限制批量不超过 10 条、body 16 KB，校验 Origin 与受信任域名。正常持久化返回 202，重复 eventId 返回相同接受结果，限流返回 429，存储不可用返回 503；前端均不阻塞页面。
- `GET /api/v4/analytics/overview?from=&to=&granularity=`：ADMIN 报表，返回 PV、每日 UV、可用的范围 UV/访问次数、趋势、统计时区、聚合完成时间与延迟状态。
- `GET /api/v4/analytics/pages`、`/sources`、`/devices`、`/not-found`：有界分页与筛选；商品报表仅使用已验证 product Entry 标识。
- `GET /api/v4/analytics/settings`、`POST /api/v4/analytics/settings`：ADMIN 管理启用、同意规则与统计时区，不接收任意采集脚本。
- 导出首期使用与页面相同的过滤和权限，限制时间范围及行数，不输出访客标识；导出接口随报表任务一起验收。

### Task 1: 采集规则、设置与事件存储

**Files:** Create `backend/src/analytics/model.ts`、`settings.ts`、`repo.ts`、`ingest.ts`、`ingest.test.ts`；Modify `backend/src/repo.ts`、`backend/src/main.ts`。

- [ ] 先写并运行失败测试：未启用/未同意不采集、未知/停用域名、客户端伪造 siteId、外站 Release/Entry、预览路径、非法 eventId、超大批量和过期时间戳。
- [ ] 复用 D1 站点上下文，后端校验发布页身份；404 接收事件须来自已接入且已发布站点，不允许通过不同路径绕过后台/预览排除规则。
- [ ] 仅保存无 query/hash 的页面路径、来源主机名、各不超过 100 字符的允许 UTM 字段；清理控制字符，不接受任意事件属性或用户资料。
- [ ] 建 `(siteId,eventId)` 唯一索引和原始事件 TTL 索引；限流按站点、入口短期请求标识和总吞吐执行，IP 只用于内存中的短期限流，不写事件表。
- [ ] 持久化成功才返回 202；重试相同 eventId 幂等，不静默丢弃后宣称接受。客户端发送的机器人事件仍可能伪造，在报表说明数据限制。
- [ ] 加入基础机器人/内部流量过滤及过滤计数；运行后端单测、类型检查和 MongoDB 唯一索引/TTL 集成验证。

### Task 2: 浏览器采集与同意状态

**Files:** Create `storefront/app/plugins/analytics.client.ts`、`storefront/app/utils/analytics.mjs`、`storefront/test/analytics.test.mjs`；Modify `storefront/app/components/PublishedPage.vue`；Create `storefront/server/api/analytics/events.post.ts`。

- [ ] 先写并运行失败测试：首次加载只发一次、SSR hydration 不重复、客户端页面切换只发一次、query/hash 变化不重复、预览和演示排除、404 分开计数。
- [ ] 实现关闭/等待同意/已同意三种状态；等待同意不创建本地标识或事件队列，同意后只统计当前及后续页面，撤回清除标识并停止发送。
- [ ] 站点隔离的随机访客标识和会话标识仅在已同意时保存；会话基于最近活动，超过 30 分钟更新 sessionId 和会话开始时间；别名先重定向，跳转源页面不计 PV。
- [ ] 从服务端页面上下文获取 releaseId/pageKey/entryId，按成功导航产生 eventId；重试保持同一 eventId，通过 sendBeacon 或 keepalive fetch 异步发送，最多一次有界重试。
- [ ] 同源采集代理使用受信任站点上下文，禁止透传浏览器自报租户/转发头；服务异常、离线或 JS 被拦截时仍可浏览页面。
- [ ] 运行 storefront 单测、类型检查与构建，浏览器验证同意/拒绝/撤回、前进后退和连续导航。

### Task 3: 持久化队列、聚合与保留

**Files:** Create `backend/src/analytics/jobs.ts`、`aggregate.ts`、`aggregate.test.ts`、`retention.ts`；Modify `backend/src/analytics/repo.ts`、`backend/src/main.ts`。

- [ ] 先写并运行失败测试：重复消费、worker 崩溃后恢复、迟到事件、跨午夜会话、时区/DST、同访客跨日去重、跨站点同 ID、超过保留窗口的查询。
- [ ] 持久化 dirty 时间桶任务并使用原子租约领取；任务包含版本号，事件写入后确保待聚合状态可恢复，定期扫描补漏，不依赖进程内队列保证可靠性。
- [ ] 聚合任务按时间桶读取去重后的原始事件重算并覆盖结果，不在重试时重复累加。结果按 siteId、分桶时间和维度唯一；只在无新版本时完成任务。
- [ ] 支持小时/日 PV、每日 UV、会话开始数、页面/商品、来源/UTM、设备与 404 聚合；记录聚合完成时间及失败重试次数，延迟超过 5 分钟标记“数据延迟”。
- [ ] 范围 UV/会话在 30 天窗口查询原始去重数据；超过窗口返回明确不可用状态。聚合维度限制 top N 和路径基数，防止无限伪造路径耗尽存储。
- [ ] worker 有界批处理、最多 5 次指数退避重试后标记失败并支持人工重跑；清理任务覆盖原始事件、任务、小时桶和过期日桶，站点删除支持级联清理。
- [ ] MongoDB 集成验证并发 worker、任务补漏和重复消费，报告聚合延迟与存储用量。

### Task 4: 报表 API 与管理端

**Files:** Create `backend/src/analytics/controller.ts`、`queries.ts`、`controller.test.ts`、`queries.test.ts`、`ui/src/components/storefront/analytics-dashboard.tsx`；Modify `backend/src/main.ts`、`ui/src/views/dashboard/presets.tsx`、两种语言文件。

- [ ] 先写并运行失败测试：匿名/普通编辑者无权读取、伪造站点参数、非法日期范围、UV 跨日不可相加、翻页/导出权限一致、旧商品已删除仍保留历史指标。
- [ ] 查询从已授权站点确定归属；限制范围最长 13 个月及分页大小。结果包含缺失数据/未启用/空数据/延迟状态，不能把采集关闭显示成确认无人访问。
- [ ] 实现今日、7 天、30 天及自定义范围，PV/UV/访问次数卡片、趋势、热门页面/商品、来源/UTM、设备和 404 列表；提供域名筛选但默认按整个站点汇总。
- [ ] 显示统计时区、最后更新时间、UV 定义、采集/同意限制和 Cloudflare 请求量区别；不提供交易收入或未经服务端验证的成交转化。
- [ ] 导出使用同一查询服务并防止 CSV 公式注入；补中英文文案，生成后端声明，运行 UI 类型检查、构建及浏览器交互验证。

### Task 5: 端到端验收与运维文档

- [ ] 使用独立数据库与受控浏览器事件验证：同意后访问首页/商品/内容页 -> 切换路径 -> 重复发送 -> 查看报表，PV 无重复、UV 和会话口径正确。
- [ ] 切换主域名、发布新 Release 和回滚后，历史仍归属于原 siteId，报表可按域名/Release 分析，不将两个域名浏览器标识强行合并。
- [ ] 模拟采集 429/503、队列积压、worker 重启和 TTL 清理，页面继续可用，后台显示延迟或失败，恢复后不重复累计。
- [ ] 验证关闭采集、拒绝/撤回同意、预览访问和机器人过滤；检查数据库没有完整 IP、敏感 URL 参数及未同意访客标识。
- [ ] 运行后端 analytics 与 storefront 测试及类型检查，storefront/UI 测试、类型检查和构建；执行 `git diff --check`。
- [ ] 编写 `docs/operations/storefront-analytics.md`，记录指标定义、采集限制、保留周期、失败重试/重跑、导出权限、容量与后续扩容触发条件。

## 后续扩展

国家/地区仅在可信入口可提供且隐私规则允许时增加，避免首期为此新增 IP 持久化。订单、支付和营收接入交易服务的服务端事件后再规划；Cloudflare API 流量报表为可选独立数据源，按不同口径标识。只有实测 MongoDB 写入/查询和保留成本达到容量阈值时，才另立 ClickHouse 或消息中间件迁移计划。
