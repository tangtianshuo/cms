# Storefront Release Phase C Implementation Plan

> **For agentic workers:** Execute sequentially using the existing workspace and verify each deliverable before proceeding.

**Goal:** Publish the installed preset as an immutable Release, add pages without reinstalling, and restore earlier releases.

**Architecture:** Keep one installed site and one configured language/host. Build validated, fully rendered page snapshots from saved CMS Entries. Store snapshots before atomically changing a server-owned site publication pointer. Public routes, navigation, redirects and sitemap resolve exclusively from that snapshot. Retain the previous snapshot on any validation, storage or activation failure.

**Tech Stack:** TypeScript, Fastify, MongoDB, Vue 3, Nuxt 4, Node test runner.

**Spec:** `docs/architecture/storefront-preset-solution.md`, sections 6–7, stage C.

## 交付进度（2026-10-24）

按用户继续指令恢复开发。阶段 C 功能已实现，三项暂停时记录的问题已分别通过失败测试复现、修复并回归：固定集合页保留描述/封面；只校验参与当前快照的 Entry；删除绑定 Entry 后仍可下线固定页。

已验证：后端完整测试 46 通过、1 项可选数据库测试跳过；数据库 + HTTP + Nuxt SSR 集成测试单独通过；Storefront 11 项、UI 6 项测试通过；后端类型检查、Storefront/UI 类型检查及生产构建通过。独立代码复审无剩余 P1/P2。

浏览器已完成：导入示例站点、首发、选择蓝图新增页面、Entry 绑定、SEO/导航保存、差异校验、发布、公开页面和导航、改路径产生 301、历史回滚。HTTP 验证新增草稿发布前 404、改路径后的 sitemap。数据库测试另外覆盖保存 Entry 不改变线上快照、并发激活及错误域名。

已完成 master 合并推送、Docker 重建，最终镜像的隔离数据库端到端验收、浏览器交互及容器重启持久化检查通过。完整结果记录在 `docs/verification/storefront-phase-c.md`。

集成验证入口：`backend/src/presets/release-integration.test.ts`。在 backend 目录运行：

```sh
STOREFRONT_ENABLED=true STOREFRONT_LANGUAGE=en STOREFRONT_HOST=127.0.0.1:3199 STOREFRONT_TEST_MONGO=mongodb://127.0.0.1:27028 STOREFRONT_TEST_SSR=true node --test -r ts-node/register -r tsconfig-paths/register src/presets/release-integration.test.ts
```

部署测试入口：`backend/test/storefront-deployment.test.mjs`；需设置 `STOREFRONT_E2E_CMS`、`STOREFRONT_E2E_ORIGIN`、`STOREFRONT_E2E_EMAIL`、`STOREFRONT_E2E_PASSWORD`，仅对具有测试管理员及 en 语言的全新隔离数据库运行。

同一 Entry 可同时被默认动态蓝图和新增固定页面引用；停用一个页面定义仅移除其 URL。快照保存 CMS 图片 URL，媒体文件保留与备份由运营保障。

## Global Constraints（阶段 C）

- Preserve existing imports, draft previews and template/field ID mappings.
- Restrict administration to ADMIN and enforce site identity on release lookup and rollback.
- Public responses contain rendered content, never raw Entries or CMS credentials.
- An installed preset takes ownership of the public product path; unpublished preset content returns 404.
- Transactions, multi-domain/multilingual publishing and theme migration remain stage D.
- Snapshot image URLs reference CMS media; file retention and backups remain operational responsibilities.

### Task 1: Incremental page drafts

**Files:** `backend/src/presets/pages.ts`, `site-model.ts`, `pages.test.ts`, `controller.ts`.

- [x] Add failing tests for blueprint-based page creation, binding, reserved routes, collisions and disabling pages.
- [x] Implement stable page IDs, fixed Entry bindings, navigation visibility and draft-only removal.
- [x] Keep older installation defaults and preview support.

### Task 2: Immutable release service and persistence

**Files:** `backend/src/presets/releases.ts`, `releases.test.ts`, `release-repo.ts`, `site-repo.ts`, `backend/src/repo.ts`, `backend/src/main.ts`.

- [x] Test snapshot isolation, required content, mappings/media, route expansion, duplicate slugs, navigation, redirects, rollback boundaries and failed activation.
- [x] Implement preflight with differences, snapshot generation and append-only publication audit.
- [x] Persist before compare-and-swap activation; update drafts without overwriting the active pointer.

### Task 3: Public release routing

**Files:** `backend/src/storefront/controller.ts`, `storefront/server/utils/release.mjs`, public API/page routes, `PresetDemoPage.vue`, storefront tests.

- [x] Test host validation, missing releases, errors and URL handling.
- [x] Render release pages through shared theme components with real navigation, SEO and canonical URLs.
- [x] Add snapshot-only sitemap and permanent redirects; remove legacy product fallback for installed sites.

### Task 4: Administration

**Files:** `ui/src/components/storefront/page-draft-editor.tsx`, new release manager, preset view, English/Chinese translations.

- [x] Add blueprint selection and Entry binding for new pages, draft disabling and navigation options.
- [x] Add publication validation/differences, publish, history, audit errors and rollback controls.
- [x] Regenerate backend declarations and type-check/build the UI.

### Task 5: Verification and documentation

- [x] Run backend/storefront/UI tests and type checks/builds.
- [x] Exercise database persistence and public HTTP routing where local services permit.
- [x] Update solution status and storefront operational documentation; run `git diff --check`.
