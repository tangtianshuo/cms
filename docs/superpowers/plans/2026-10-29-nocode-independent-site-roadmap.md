# 非技术人员独立站平台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让非技术人员通过模板、内容配置、预览和发布向导，快速创建独立站并持续运营维护。

**Architecture:** 保留现有 CMS、Storefront、Release 和 Gateway 边界。CMS 管理草稿内容和配置，Storefront 按模板渲染预览与公开页面，Gateway 编排站点发布和域名路由。先完成单站点本地闭环，再把模板和站点发布扩展为可版本化、可回滚的生产流程。

**Tech Stack:** Vue 3 + JSX、Nuxt 4、Fastify、MongoDB、TypeScript、Docker Compose、Node.js test runner。

**Spec:** `docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`

**Execution status (2026-10-29):** 已在 `codex/nocode-independent-sites` 分支完成第一项创建网站向导，后续任务仍待实施。现有未提交修改已保留。

**Task 1 validation:** UI 64 项通过、1 项现有测试跳过；类型检查、生产构建、相关 ESLint 和差异空白检查通过；独立审查通过。已在本地 Docker 页面核对入口、步骤恢复、已有网站内容、真实草稿预览和手机切换。创建／导入／发布行为使用隔离 SDK 边界测试，没有向用户数据库提交实际创建、导入或发布。进度仅保存在当前浏览器；跨设备恢复及创建请求的服务端幂等仍需后续后端工作。

## Global Constraints

- 不让非技术用户接触 Docker、代码、数据库、Template、Prop、Release 等内部术语。
- 内容更新不重新安装模板；模板能力或数据结构变化必须使用新版本并明确采用。
- 预览和发布必须使用同一份页面内容协议。
- 发布失败保留当前线上版本，不能用草稿覆盖已发布版本。
- 所有跨网站读取和发布操作继续使用现有 workspace/site 权限边界。
- 每个任务完成后运行对应测试，再继续下一个任务。

---

### Task 1: 建立创建网站向导

**Files:**
- Modify: `ui/src/views/dashboard/presets.tsx`
- Modify: `ui/src/router.ts`
- Modify: `ui/src/layouts/dashboard/navigation.ts`
- Create: `ui/src/views/dashboard/site-onboarding.tsx`
- Test: `ui/test/site-onboarding.test.mjs`

**Interfaces:**
- Consumes: existing `/api/v4/presets/catalog`, `/api/v4/presets/plan/:presetId`, `/api/v4/presets/import` APIs.
- Produces: `SiteOnboardingState = { step: 'template' | 'identity' | 'content' | 'preview' | 'publish'; presetId: string; siteName: string; includeDemo: boolean }` and a route that resumes the current site import safely.

- [x] **Step 1: Write the failing test** for step order, required site name, selected template persistence, and resume after an import response with `status: 'importing'`.
- [x] **Step 2: Run the focused test** with `cd ui && node --test test/site-onboarding.test.mjs`; confirm it fails because the onboarding state and route do not exist.
- [x] **Step 3: Implement the wizard** as a wrapper around existing preset catalog, import-plan and import calls. Keep the current preset preview iframe and move advanced checklist details below the wizard.
- [x] **Step 4: Add resumable states** so refresh during import restores the selected site and shows the current status instead of starting a second import.
- [x] **Step 5: Run the focused test and UI type-check** with `cd ui && node --test test/site-onboarding.test.mjs && npm run type-check`.

### Task 2: 把平面导航升级为可配置导航树

**Files:**
- Modify: `backend/src/presets/site-model.ts`
- Modify: `backend/src/presets/releases.ts`
- Modify: `backend/src/presets/controller.ts`
- Create: `backend/src/presets/navigation.ts`
- Create: `backend/src/presets/navigation.test.ts`
- Modify: `ui/src/views/dashboard/studio.tsx`
- Create: `ui/src/components/studio/navigation-editor.tsx`
- Modify: `storefront/app/components/PresetDemoPage.vue`
- Modify: `storefront/app/components/AeroPresetPage.vue`
- Modify: `storefront/app/assets/main.css`
- Test: `ui/test/navigation-editor.test.mjs`

**Interfaces:**
- Consumes: page drafts and `site-settings.navigationPages` values.
- Produces: `NavigationNode = { id: string; label: string; href?: string; children: NavigationNode[]; enabled: boolean }`, `normalizeNavigation(nodes): NavigationNode[]`, and Release snapshots with `navigation: NavigationNode[]`.

- [ ] **Step 1: Write backend tests** for stable ordering, disabled nodes, nested children, duplicate links, and rejection of links to unpublished pages.
- [ ] **Step 2: Run `cd backend && node -r ts-node/register -r tsconfig-paths/register --test src/presets/navigation.test.ts`** and confirm the new tests fail.
- [ ] **Step 3: Implement `backend/src/presets/navigation.ts`** and make `buildRelease` convert legacy flat links into one-level nodes so existing releases remain readable.
- [ ] **Step 4: Add the CMS navigation editor** with add group, add page, reorder, enable/disable, and drag-free keyboard controls; keep “加入导航” on page settings for backward compatibility.
- [ ] **Step 5: Render desktop dropdowns and mobile accordions** in both preset renderers, using the same `NavigationNode[]` payload in draft preview and published pages.
- [ ] **Step 6: Run backend tests, UI tests, and storefront type-check**; verify a legacy flat release still renders unchanged.

### Task 3: 建立首页和详情页区块配置

**Files:**
- Modify: `backend/src/presets/catalog.ts`
- Modify: `backend/src/presets/pages.ts`
- Modify: `backend/src/storefront/model.ts`
- Modify: `backend/src/storefront/preset-preview.ts`
- Create: `backend/src/storefront/section-schema.ts`
- Create: `backend/src/storefront/section-schema.test.ts`
- Modify: `ui/src/components/studio/fields.tsx`
- Create: `ui/src/components/studio/section-editor.tsx`
- Modify: `storefront/app/components/PresetDemoPage.vue`
- Modify: `storefront/app/components/AeroPresetPage.vue`
- Create: `storefront/app/components/sections/HeroCarousel.vue`
- Create: `storefront/app/components/sections/InfoGrid.vue`
- Create: `storefront/app/components/sections/FaqSection.vue`
- Modify: `storefront/app/components/theme/ProductPage.vue`
- Modify: `storefront/app/components/theme/ProductGallery.vue`
- Test: `backend/src/storefront/section-schema.test.ts`
- Test: `ui/test/section-editor.test.mjs`

**Interfaces:**
- Consumes: installed preset page layouts, model fields, media references and existing draft preview payloads.
- Produces: `SectionConfig = { type: 'hero-carousel' | 'info-grid' | 'faq' | 'product-gallery' | 'product-information' | 'product-description'; enabled: boolean; data: Record<string, unknown> }` and validated section lists per page layout.

- [ ] **Step 1: Write schema tests** for allowed section types, required section preservation, media references, carousel slide order, and invalid internal links.
- [ ] **Step 2: Run the focused backend tests** and confirm schema validation fails before implementation.
- [ ] **Step 3: Add the minimum section schema** while preserving current `hero`, `feature`, `gallery`, `information`, and `description` behavior for old snapshots.
- [ ] **Step 4: Add the simplified section editor** so a non-technical user can add, remove, enable, disable, and reorder sections without opening raw templates.
- [ ] **Step 5: Implement `HeroCarousel.vue`** with image, title, subtitle, CTA, dots, previous/next controls, autoplay pause on hover, keyboard controls, and mobile layout.
- [ ] **Step 6: Enrich product detail rendering** with multiple images, specifications, related products, FAQ and CTA while keeping product images sourced from the existing media library.
- [ ] **Step 7: Run backend tests, UI tests, `cd storefront && npm run typecheck`, and browser preview checks at desktop and mobile widths.**

### Task 4: 完善素材、SEO 和运营字段

**Files:**
- Modify: `backend/src/presets/catalog.ts`
- Modify: `backend/src/presets/releases.ts`
- Modify: `ui/src/views/dashboard/studio.tsx`
- Modify: `ui/src/components/studio/fields.tsx`
- Modify: `ui/src/views/dashboard/settings.tsx`
- Modify: `storefront/app/pages/[...path].vue`
- Modify: `storefront/app/components/PublishedPage.vue`
- Create: `ui/test/site-operations.test.mjs`
- Create: `backend/src/presets/operations.test.ts`

**Interfaces:**
- Consumes: existing media permissions, page SEO fields, site settings and release snapshots.
- Produces: validated `SiteOperations = { seoTitle: string; seoDescription: string; socialImage?: MediaRef; favicon?: MediaRef; analyticsId?: string; contactFormEnabled: boolean }` with redacted display for secrets.

- [ ] **Step 1: Write tests** for SEO length limits, social image media references, favicon selection, contact form enablement, and permission-dependent visibility.
- [ ] **Step 2: Implement the fields** in the simplified Settings and Website Content flows; leave API keys and technical integrations under Advanced Tools.
- [ ] **Step 3: Include operations data in draft and Release snapshots** and render title, description, canonical URL, Open Graph image and favicon in Storefront pages.
- [ ] **Step 4: Add a basic contact form contract** with spam-safe rate limiting at the backend boundary; keep email provider credentials in gateway/backend configuration, never in page content.
- [ ] **Step 5: Run backend tests, UI tests, and a published-page HTML smoke check.**

### Task 5: 做成可验证的一键发布和回滚流程

**Files:**
- Modify: `ui/src/components/storefront/release-manager.tsx`
- Modify: `ui/src/views/dashboard/site-preview.tsx`
- Modify: `backend/src/presets/release-controller.ts`
- Modify: `backend/src/presets/gateway-publish.ts`
- Modify: `backend/src/presets/gateway-jobs.ts`
- Modify: `backend/src/presets/gateway-recovery.ts`
- Create: `ui/test/publish-status.test.mjs`
- Create: `backend/src/presets/publish-lifecycle.test.ts`

**Interfaces:**
- Consumes: immutable Release snapshots, gateway publish intents and existing operation IDs.
- Produces: `PublishStatus = 'draft' | 'checking' | 'publishing' | 'ready' | 'failed' | 'rolled-back'` with stable `operationId`, `releaseId`, `activeRevision` and actionable `reason`.

- [ ] **Step 1: Write lifecycle tests** for first publish, content-only publish, repeated operation IDs, failed publish preserving the active release, retry, and rollback.
- [ ] **Step 2: Run focused backend and UI tests** and confirm missing states or retry handling fail.
- [ ] **Step 3: Expose one simplified publish action** in the CMS and map backend states to user-facing Chinese messages.
- [ ] **Step 4: Keep the last verified release active** until the new storefront and snapshot pass readiness checks.
- [ ] **Step 5: Add release diff display** for changed pages, navigation, media and template version before confirmation.
- [ ] **Step 6: Run integration tests and a local Docker publish smoke test** against `http://localhost:8080` and `http://localhost:3000`.

### Task 6: 建立模板版本升级和兼容性流程

**Files:**
- Modify: `backend/src/presets/registry.ts`
- Modify: `backend/src/presets/import.ts`
- Modify: `backend/src/presets/installed.ts`
- Modify: `ui/src/views/dashboard/presets.tsx`
- Create: `ui/test/template-upgrade.test.mjs`
- Modify: `backend/src/presets/import.test.ts`
- Modify: `backend/src/presets/registry.test.ts`
- Modify: `docs/operations/template-preview.md`

**Interfaces:**
- Consumes: template ID/version, manifest checksum, image digest, stored manifest snapshot and existing adoption endpoint.
- Produces: upgrade preview with `compatible`, `requires-new-installation`, `content-impact`, `template-impact`, and explicit adopt operation.

- [ ] **Step 1: Write tests** for compatible visual updates, incompatible schema changes, tampered manifests, interrupted adoption, and preservation of old releases.
- [ ] **Step 2: Implement a human-readable upgrade diff** that says which pages, fields and interactions change.
- [ ] **Step 3: Require explicit adoption** for template code or schema changes; never silently update an installed site from the catalog.
- [ ] **Step 4: Keep old template versions resolvable** for existing releases and rollback.
- [ ] **Step 5: Run registry, import, release and UI upgrade tests.**

### Task 7: 上线和持续运营基础设施

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `proxy/nginx.prod.conf`
- Modify: `backend/src/site-domains/controller.ts`
- Modify: `backend/src/site-domains/trust.ts`
- Modify: `backend/src/backup/controller.ts`
- Create: `docs/operations/non-technical-site-operations.md`
- Create: `backend/src/site-domains/operations.test.ts`

**Interfaces:**
- Consumes: site/workspace identity, Release IDs, gateway publish intents, media authorization and existing domain records.
- Produces: domain verification status, backup/restore status, health status, and operator-readable failure reasons.

- [ ] **Step 1: Write tests** for unknown-host rejection, custom-domain verification, backup creation/restore status, and site-scoped media access.
- [ ] **Step 2: Add the operations panel** for domain, HTTPS, backup, health and recent publish history; keep secrets and raw infrastructure settings hidden.
- [ ] **Step 3: Document local Docker and production deployment** separately, including start, stop, backup, restore, update and rollback commands.
- [ ] **Step 4: Run domain, backup, gateway and Docker smoke tests** before calling the platform ready for pilot users.

## Recommended delivery order

1. Task 1: onboarding.
2. Task 2: navigation tree.
3. Task 3: page sections, carousel and product details.
4. Task 5: publish and rollback UX.
5. Task 4: SEO, forms and operations fields.
6. Task 6: template upgrades.
7. Task 7: production operations.

## Definition of Done

- A new user can create a site, select a template, add navigation pages, configure a carousel, add product media, preview desktop/mobile, and publish from one guided flow.
- The user can change content and publish again without rebuilding the template.
- A template upgrade shows compatibility and impact before adoption.
- A failed publication preserves the previous live release and exposes a retry or rollback action.
- `cd ui && node --test test/*.test.mjs`, `cd backend && npm run build:noEmit`, `cd storefront && npm run typecheck`, `npm run build`, Docker Compose smoke tests and `git diff --check` pass.
