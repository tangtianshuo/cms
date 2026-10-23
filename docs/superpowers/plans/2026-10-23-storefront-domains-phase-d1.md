# Storefront Domains Phase D1 Implementation Plan

> **For agentic workers:** Implementation is authorized by the user's follow-up request. Execute with the D3 umbrella plan after verifying phase C; preserve the current publication behavior.

**Goal:** 由 CMS 管理网站与域名的绑定，让外部平台接入的域名访问该站点当前发布的 Release。

**Architecture:** Cloudflare 等外部平台负责 DNS、HTTPS 和 CDN。后端维护全局唯一的 SiteDomain，Storefront 从受信任入口取得域名后解析到站点和当前 Release。主域名、别名与发布内容分别管理；一个 Storefront 服务可接受多个域名。

**Tech Stack:** TypeScript、Fastify、MongoDB、Vue 3、Nuxt 4、Node test runner；不新增 DNS 托管或证书签发依赖。

**Spec:** `docs/architecture/storefront-preset-solution.md` 第 6.1、7 节；`docs/architecture/storefront-platform.md`。

续接：用户已授权在新分支实施本计划，并继续多独立站/多工作区计划 `2026-10-23-storefront-workspaces-phase-d3.md`。D1 单站点兼容能力之后扩展域名解析为 workspaceId + siteId；多工作区开放前完成资源和权限隔离，D2 暂不实施。

## Global Constraints

- 状态：已授权实施，依赖阶段 C 发布基础；D1 首先支持当前单站点绑定多个域名，随后由 D3 开放多站点与工作区。
- 域名注册、DNS 修改、证书签发/续期与 CDN 配置由外部平台维护；首期不需要 Cloudflare API Token。
- CMS 负责归属验证、接入检查、绑定、启停、主域名、操作审计及访问解析。
- 管理操作沿用 ADMIN 权限，并在服务端检查站点归属；不得通过任意传入 siteId 切换租户。
- 未知、未验证、停用域名返回 404；未发布站点不展示草稿。
- 域名变更不修改 Release；内容回滚不恢复旧域名绑定。
- 保持现有单域名环境配置兼容；预览域名和公开域名使用不同授权规则。
- 初期 HTML、发布查询和采集 API 不缓存；Cloudflare 页面缓存清理适配器另属 D4。

## 数据与接口合同

`SiteDomain`：`_id`、`siteId`、规范化的 `hostname`、`isPrimary`、`enabled`、`ownershipStatus: pending|verified`、`connectionStatus: unchecked|ready|error`、`verificationTokenHash`、`verifiedAt`、`lastCheckedAt`、`lastError`、`createdAt`、`updatedAt`。hostname 建全局唯一索引；每站点最多一个主域名，以原子更新的站点主域名指针为准。

域名规范化使用 IDNA ASCII、小写和去尾点；拒绝路径、协议、凭据、端口、IP、通配符及无效标签。localhost/端口仅允许现有开发配置使用，不进入商家域名注册表。

新增 ADMIN 接口，归属从当前已授权站点推导：

- `GET /api/v4/site-domains`：域名列表、主域名及配置指引。
- `POST /api/v4/site-domains`，body `{ hostname }`：创建待验证绑定并返回一次性 TXT 值。
- `POST /api/v4/site-domains/:id/check`：检查 TXT 与外部接入，返回分开的归属/接入状态。
- `POST /api/v4/site-domains/:id/primary`：在已验证且接入成功时原子设为主域名。
- `POST /api/v4/site-domains/:id/state`，body `{ enabled }`：启停；主域名停用前须指定替代主域名。
- `DELETE /api/v4/site-domains/:id`：解绑非主域名并撤销验证凭据。

内部合同：`resolveSiteDomain(hostname)` 返回 `{ siteId, hostname, primaryHostname, bindingRevision } | null`；公开 Release API 使用解析后的 siteId 再检查快照归属。不得把客户端自报的 siteId 当作解析结果。

### Task 1: 域名仓储、授权与迁移

**Files:** Create `backend/src/site-domains/model.ts`、`repo.ts`、`service.ts`、`controller.ts`、`service.test.ts`；Modify `backend/src/repo.ts`、`backend/src/main.ts`、`backend/src/presets/site-model.ts`。

- [ ] 先写并运行失败测试：大小写/IDN/尾点归一、非法输入拒绝、跨站点重复占用、外站点 ID 越权、并发主域名切换。
- [ ] 实现规范化、全局唯一索引、主域名原子指针和审计；竞争写入返回可识别冲突，不能覆盖已有归属。
- [ ] 添加显式迁移：将运维配置的现有生产域名绑定到当前单站点，保留既有开发 host 模式；迁移前后原公开 URL 行为相同，不自动发布内容。
- [ ] 运行 domain 单测和后端类型检查；真实 MongoDB 验证唯一索引和并发更新结果。

### Task 2: 外部配置指引与接入检查

**Files:** Create `backend/src/site-domains/verification.ts`、`verification.test.ts`；Modify `backend/src/site-domains/service.ts`、`controller.ts`、`backend/src/config.ts`；Create `docs/operations/storefront-domain-setup.md`。

- [ ] 先写并运行失败测试：TXT 缺失/错误/过期、代理开启下的接入检查、TLS 错误、超时、重复检查和待验证记录过期清理。
- [ ] 返回 TXT 名称 `_cms-verify.<hostname>` 和随机值；存储摘要、有效期及重试信息，成功后留验证审计。TXT 由商家在外部平台添加。
- [ ] 配置指引使用运维设置的公开入口主机名/IP；分别说明 www CNAME 与根域名 A/ALIAS。Cloudflare 开启代理时不能要求 A 记录等于源站 IP。
- [ ] 将 TXT 所有权验证、DNS 可解析、HTTPS 接入结果分开显示；证书错误只报告，不尝试申请或续期证书。
- [ ] 检查使用固定挑战路径和签名响应；禁止自定义端口、任意 URL/重定向，防止访问私网、环回、链路本地及 DNS 重绑定目标。只有配置明确允许的开发环境可访问本地地址。
- [ ] 对检查接口限流、设短超时，保留最近成功结果和新错误；检查失败不更改原站点主域名或当前 Release。
- [ ] 运行验证单测，以受控 DNS/HTTPS 服务模拟代理和失败状态。

### Task 3: 域名到 Release 的公开路由

**Files:** Modify `backend/src/storefront/published.ts`、`controller.ts`、`storefront/server/utils/release.mjs`、`storefront/server/api/published.get.ts`、`storefront/server/routes/sitemap.xml.get.ts`、`storefront/app/components/PublishedPage.vue`、`deployment-nginx.conf`；Create `storefront/server/utils/site-context.ts`、`storefront/server/middleware/site-domain.ts`；Test `backend/src/storefront/published.test.ts`、`storefront/test/release.test.mjs`。

- [ ] 先写并运行失败测试：两个域名命中同站点、伪造转发头、未知/停用域名、站点未发布、绑定与快照 siteId 不匹配。
- [ ] 提取请求站点上下文，只在请求来自已配置可信网关时接受其原始 Host；网关清除用户传入的同名头并传递真实域名，源站拒绝不受信任的转发信息。
- [ ] 让公开查询按域名解析站点，检查 Release 归属；SSR 内部请求传递已验证站点上下文，浏览器不获得 CMS 长期凭据。
- [ ] 别名对公开页面执行 301 跳转到主域名并保留安全路径与 query；API、挑战、预览和管理端不套用页面重定向，不允许开放重定向。
- [ ] canonical 和 sitemap 使用当前主域名；来源于允许配置的协议/域名，不采信任意 Host 或 proto 头。
- [ ] 域名切换后刷新绑定缓存和 SEO 响应；回滚内容只改变 Release 指针。使用 no-store 并在 Cloudflare 指引中要求公开 HTML/API 绕过缓存。
- [ ] 重跑公开路由与 SSR 测试，验证跨请求站点上下文不会复用或泄漏。

### Task 4: 管理后台域名页面

**Files:** Create `ui/src/components/storefront/domain-manager.tsx`；Modify `ui/src/views/dashboard/presets.tsx`、`ui/src/i18n/locales/en.ts`、`ui/src/i18n/locales/zh-CN.ts`。

- [ ] 实现域名列表、添加、复制配置、检查接入、设主域名、启停、解绑和打开网站；显示归属状态、接入状态、最近检查及可操作错误。
- [ ] 区分“内容已发布”“域名待验证”“外部接入异常”；未发布时提供发布入口，接入失败时显示外部平台配置指引。
- [ ] 对主域名停用/解绑展示替代域名要求；操作完成刷新服务端状态，竞争冲突后要求重新加载，不通过本地状态猜测成功。
- [ ] 补中英文文案，生成后端类型，执行 UI 类型检查与构建；浏览器验证完整操作及错误恢复流程。

### Task 5: 验收与发布衔接

- [ ] 用独立 MongoDB 与模拟入口验证：添加 -> TXT 验证 -> 接入 -> 启用 -> 浏览已发布内容 -> 别名跳转 -> 更换主域名 -> 回滚；草稿始终不公开。
- [ ] 验证新增错误域名不会中断原主域名；解绑后立即不再返回原站内容；重新绑定必须重新验证，不复用旧凭据。
- [ ] 验证不同请求的 canonical、sitemap、重定向与站点身份一致，域名变更保留发布历史。
- [ ] 后端运行 `npm run build:noEmit` 与 domain/storefront 测试；storefront 运行 `npm test`、`npm run typecheck`、`npm run build`；UI 运行 `npm run type-check`、`npm run build-only`。
- [ ] 更新运维指引、配置变量和绑定迁移说明，执行 `git diff --check`，明确 Cloudflare 配置由商家完成；实际生产 DNS、发布与部署按另行指令执行。

## 与 D2 / D3 / D4 的衔接

D3 在 D1 后开放多独立站与多工作区，域名归属同时校验 workspaceId + siteId。D2 复用该站点归属，统计保留 hostname 维度，更换主域名不清空站点历史。D4 再提供 Cloudflare API 可选适配器、自动页面缓存清理及失败重试；开启缓存前验证发布/回滚/切主域名均不会命中其他站点或旧版本。
