# B：唯一内容工作区与统一模板预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收拢为唯一内容编辑工作区，让用户在模板预制排版中边编辑边看同版本真实预览。

**Architecture:** CMS 服务端按模板精确身份解析 Preview renderer，浏览器只向验证过的 iframe 发送草稿；所有内容操作共用一个本地编辑会话，未保存变更自动更新画布。模板镜像和预览包绑定相同 manifest/source commit，bundle 安装完成后才使 registry 可见。

**Tech Stack:** Node.js 22、TypeScript、Vue 3/Nuxt、Next.js、MongoDB、PostgreSQL、Docker、node:test、Vitest。

**Spec:** `CMS/docs/superpowers/specs/2026-11-06-single-content-workspace-design.md`（2026-11-06 新增需求，编辑入口与交互以此为准）；`CMS/docs/superpowers/specs/2026-10-29-nocode-independent-site-goal.md`；`CMS/docs/superpowers/specs/2026-10-31-template-driven-content-runtime-separation-design.md`；`CMS/docs/verification/2026-11-06-platform-gap-review.md`。任务边界及版本协议见 `2026-11-06-platform-delivery-master.md`。

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

## 文件职责和依赖

内容与导航只在同一 ContentWorkspace 编辑；使用模板预制排版，`LayoutDocument.mode=template`，自由排版不在本期开放。完整站点预览可保留只读检查。富文本和其他已支持字段在工作区内编辑，不能以“完整编辑器”跳转解决。

执行依赖：B1 → B4 → B5 → B6 → B7；B2 在 A2 后开发，最终 bundle/registry 必须包含 B4 的模板声明。B3 Step 1 的浏览器 fixture 可提前建立供 B4–B7 使用，其最终完整验收在 B2/B7 完成后执行。模板版本在全部变更完成后发布一次；若中途已发布，则后续变更另升未占用补丁版本并更新锁文件，禁止覆盖。

文件职责：editor-target 负责入口定位；content-workspace 负责界面编排；structured-field/value 负责复用已有内容控件；editor-session/save-session 负责状态与确认；draft-preview 负责纯草稿转换及请求排序。

依赖 A2 的新版本目录；B1 可独立验证 CMS 接口。`preview-service.ts` 负责远端解析，`template-preview.ts` 负责浏览器身份和消息约束；Preview 的 registry/handler 负责已批准包服务；Templates scripts/workflows 负责构建和登记，不能让浏览器推断模板版本。

### Task B1：提交并打通 CMS 精确版本 resolver

**Files:**
- Create/retain: `CMS/backend/src/storefront/preview-service.ts`、`CMS/backend/src/storefront/preview-service.test.ts`。
- Modify: `CMS/backend/src/config.ts`、`CMS/backend/src/storefront/controller.ts`、`CMS/backend/src/storefront/preset-preview.ts`、`CMS/backend/src/storefront/preset-preview.test.ts`、`CMS/docker-compose.prod.yml`。
- Modify: `CMS/ui/src/util/template-preview.ts`、`CMS/ui/src/components/storefront/page-preview.tsx`、`CMS/ui/src/components/studio/visual-page-editor.tsx`、`CMS/ui/src/views/dashboard/site-preview.tsx`、`CMS/ui/src/views/dashboard/studio.tsx`。
- Test: `CMS/ui/test/template-preview.test.mjs`。
- Modify: `CMS/docs/operations/unified-template-preview.md`。

**Interfaces:**
- Consumes: 已有 `resolvePreviewRuntime(serviceUrl, templateId, templateVersion, fetcher): Promise<PreviewRuntime|null>`；GET `/api/v1/renderers/:id/:version`。
- Produces: 已有 `PreviewRuntime { templateId, templateVersion, protocolVersion:1, digest, url }`；CMS 仅返回当前已授权站点安装版本的 descriptor。现有 controller 路径保持不变，不新增平行 resolver。

- [ ] **Step 1：保留现有测试，并加入协议漂移失败用例。** `preview-service.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreviewRuntime } from './preview-service';
test('rejects renderer downgrade even when the origin is trusted', async () => {
  const fetcher = async () => Response.json({
    templateId: 'aeroframe', templateVersion: '1.0.3', protocolVersion: 1,
    digest: `sha256:${'a'.repeat(64)}`, url: 'https://preview.example/preview/aeroframe/1.0.3/',
  });
  await assert.rejects(resolvePreviewRuntime('https://preview.example', 'aeroframe', '1.0.4', fetcher));
});
```

补充 service 404、503、超时、身份不同、非法 digest、不同 origin、重定向；UI 覆盖旧 iframe 的 ready 消息不能给新站发草稿、切站清理旧 descriptor。
- [ ] **Step 2：运行 CMS 定向测试，记录当前通过项与失败项。**

```sh
TS_NODE_PROJECT=backend/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -r tsconfig-paths/register --test backend/src/storefront/preview-service.test.ts backend/src/storefront/preset-preview.test.ts
node --test ui/test/template-preview.test.mjs
```

已有实现若直接通过，不故意删除代码制造失败；只对新增未满足行为执行红绿循环。
- [ ] **Step 3：完成 controller/UI 接线。** 安装版本从服务端 SiteInstallation 获取；404 显示“该模板版本尚未提供预览”，503 显示“预览服务暂时不可用，可重试”；不借用其他模板。保留 legacy 配置仅作显式迁移路径，统一服务已配置时不得静默降级到错误版本。

```ts
const runtime = await resolvePreviewRuntime(serviceUrl, site.presetId, site.presetVersion);
// site 来自当前请求已验证的 workspace/site，serviceUrl 来自服务端 Config。
if (!runtime) return { status: 'unavailable', templateId: site.presetId, templateVersion: site.presetVersion };
return { status: 'ready', runtime };
```

消息接受条件同时检查 origin、iframe.contentWindow、模板 ID/version、protocolVersion；只向 descriptor.url 的 origin 发送快照。服务端报错不附带 secret 或内部 URL。
- [ ] **Step 4：重跑 Step 2，并执行 `npm run build:noEmit --prefix backend` 和 `npm run type-check --prefix ui`。** 预期全部通过；接口状态与 UI 提示一致。
- [ ] **Step 5：提交。** `feat: resolve private preview by exact template version`；更新操作文档，说明后端环境变量生效需要重新部署 CMS 后端。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- backend/src/storefront/preview-service.ts backend/src/storefront/preview-service.test.ts backend/src/config.ts backend/src/storefront/controller.ts backend/src/storefront/preset-preview.ts backend/src/storefront/preset-preview.test.ts docker-compose.prod.yml ui/src/util/template-preview.ts ui/src/components/storefront/page-preview.tsx ui/src/components/studio/visual-page-editor.tsx ui/src/views/dashboard/site-preview.tsx ui/src/views/dashboard/studio.tsx ui/test/template-preview.test.mjs docs/operations/unified-template-preview.md
git diff --cached --check
git commit -m "feat: resolve private preview by exact template version"
```

### Task B2：预览包、OCI 与 registry 原子交付

**Files:**
- Modify/retain: `Templates/scripts/preview-bundle.mjs`、`Templates/scripts/preview-registry.mjs`、`Templates/scripts/preview-release-registry.mjs`、`Templates/scripts/release-registry.mjs`、`Templates/.github/workflows/template-release.yml`、`Templates/.github/workflows/preview-release.yml`。
- Test: `Templates/test/preview-bundle.test.mjs`。
- Create: `Templates/test/preview-release-registry.test.mjs`。
- Modify: `Preview/ops/sync-bundle.sh`、`Preview/src/registry.mjs`、`Preview/src/handler.mjs`。
- Create: `Preview/ops/install-bundle.mjs`、`Preview/test/install-bundle.test.mjs`。

**Interfaces:**
- Consumes: A2 模板 manifest、新版本 static output；Preview 已有 `validatePreviewRegistry` 和 `validPreviewRecord`。
- Produces: `appendPreviewRelease({ registryRoot, record }): Promise<'unchanged'|'written'>`（Templates，新导出）；`installBundle({ stagingDir, bundlesRoot, record }): Promise<'unchanged'|'installed'>`（Preview，新导出）。record 使用现有 registry 的精确字段，不另造第二套格式。

- [ ] **Step 1：加入 registry 根目录和包不可变性测试。** 在临时 registry Git 仓库根下调用新导出，断言只写 `<registryRoot>/preview/index.json`，从该根执行 `git status --porcelain` 能看到 `preview/index.json`；重复同记录 unchanged，不同 digest 拒绝。测试 setup 用 `mkdtemp`、`git init`，通过函数参数注入，不调用生产 git push。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { appendPreviewRelease } from '../scripts/preview-release-registry.mjs';
test('writes relative to the registry checkout and preserves version identity', async () => {
  const registryRoot = await mkdtemp(join(tmpdir(), 'preview-registry-'));
  execFileSync('git', ['init', registryRoot], { stdio:'ignore' });
  const record = {id:'aeroframe',version:'1.0.4',manifestChecksum:`sha256:${'1'.repeat(64)}`,
    sourceCommit:'a'.repeat(40),bundleDigest:`sha256:${'2'.repeat(64)}`,
    artifactDigest:`sha256:${'3'.repeat(64)}`,bundlePath:'templates/aeroframe/1.0.4',
    adapterVersion:'1',protocolVersion:1,status:'available'};
  try {
    assert.equal(await appendPreviewRelease({ registryRoot, record }), 'written');
    const saved = JSON.parse(await readFile(join(registryRoot, 'preview/index.json'), 'utf8'));
    assert.equal(saved.records[0].bundleDigest, record.bundleDigest);
    assert.equal(await appendPreviewRelease({ registryRoot, record }), 'unchanged');
    await assert.rejects(appendPreviewRelease({registryRoot,record:{...record,bundleDigest:`sha256:${'b'.repeat(64)}`}}));
  } finally { await rm(registryRoot,{recursive:true,force:true}); }
});
```

Preview 测试覆盖缺文件、checksum 错、`../` 路径、符号链接、同版本不同内容；任何失败都不得替换原目录或更新 registry。
- [ ] **Step 2：运行 Templates `node --test test/preview-release-registry.test.mjs test/preview-bundle.test.mjs` 和 Preview `node --test test/install-bundle.test.mjs`，记录失败。**
- [ ] **Step 3：实现发布事务。** 将模块拆成可导入纯操作与 CLI 入口，import 不执行 git push；只有直接运行 CLI 才提交/push。registry 文件路径以唯一 checkout 根解析，不混用工作区根和 registry 仓库根；OCI push 在已有登录凭据可见的执行环境完成，若仍用容器化 ORAS，显式只读挂载 Docker auth 配置且不输出内容。两个发布 workflow 共用同一 registry concurrency group；拉取最新 registry，校验旧 revision，禁止覆盖已有身份。

```js
const indexPath = join(registryRoot, 'preview', 'index.json');
// record 经现有 appendPreviewRecord 校验；Git add 相对于 registryRoot。
execFileSync('git', ['-C', registryRoot, 'add', 'preview/index.json']);
```

Preview 安装流程：下载精确 OCI digest → 检查归档路径并安全解包到目标文件系统的 staging 目录 → 对照 manifest 校验每个文件及 bundleDigest → 原子 rename 到版本目录 → 原子更新 registry。目标存在时内容完全相同返回 unchanged，不同返回冲突。进程在任一步终止，旧版本继续可用。
- [ ] **Step 4：重跑测试并实际构建两套静态包。** 在各新版本 storefront 运行 `npm ci`、`npm run build:preview`；运行 `preview-bundle.mjs`，用本地 Preview handler 读取并验证响应。实际 OCI 发布后收集 digest；将它们写入 A4 的完整锁文件，登记前核验镜像/manifest/preview source commit 一致。
- [ ] **Step 5：分别提交 Templates 与 Preview。** `fix: publish preview bundles and registry atomically`、`feat: install verified immutable preview bundles`。发布外部产物时使用已有发布流程，不把写计划视为已获得本次生产切换指令。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Templates：

```sh
git diff --check
git add -- scripts/preview-bundle.mjs scripts/preview-registry.mjs scripts/preview-release-registry.mjs scripts/release-registry.mjs .github/workflows/template-release.yml .github/workflows/preview-release.yml test/preview-bundle.test.mjs test/preview-release-registry.test.mjs
git diff --cached --check
git commit -m "fix: publish preview bundles and registry atomically"
```

Preview：

```sh
git diff --check
git add -- ops/sync-bundle.sh src/registry.mjs src/handler.mjs ops/install-bundle.mjs test/install-bundle.test.mjs
git diff --cached --check
git commit -m "fix: publish preview bundles and registry atomically"
```

### Task B3：部署预览并验收草稿与公开内容一致性

**Files:**
- Modify: `Preview/.github/workflows/release.yml`、`Preview/README.md`。
- Create: `Preview/ops/preview.compose.yml`、`Preview/ops/preview.nginx.conf`。
- Modify: `CMS/proxy/nginx.conf`、`CMS/proxy/nginx.prod.conf`、`CMS/docs/operations/unified-template-preview.md`。
- Create: `CMS/ops/e2e/preview-roundtrip.mjs`、`CMS/ops/e2e/preview.spec.mjs`、`CMS/ops/e2e/browser-fixture.mjs`、`CMS/ops/e2e/playwright.config.mjs`、`CMS/docs/verification/2026-11-06-unified-preview.md`。
- Modify: `CMS/package.json`、`CMS/package-lock.json`（仅增加并锁定浏览器测试开发依赖 `@playwright/test`）。

**Interfaces:**
- Consumes: B1/B2 descriptor、完整锁文件、新模板版本；B3 新建的真实浏览器 fixture。当前 `ui/test/studio-visual-editor.e2e.mjs` 实际是源码/消息测试，不能作为真实浏览器证据。
- Produces: `node ops/e2e/preview-roundtrip.mjs`：输出 AcceptanceEvidence，缺任一模板版本或移动断点用例时退出非零。

- [ ] **Step 1：建立浏览器断言。** 先执行 `npm install --save-dev --save-exact @playwright/test` 并提交精确 lock，`npx playwright install chromium`。新增 `browser-fixture.mjs` 导出 `login(page)`：读取 `STOREFRONT_E2E_CMS/EMAIL/PASSWORD`，通过真实登录页面填写凭据并等待工作台；不在证据中保存密码。`playwright.config.mjs` 仅匹配 `ops/e2e/*.spec.mjs`、单 worker、失败保留 screenshot/trace。以下操作在新建隔离站点运行：

```js
// 先从网站内容进入首页条目的编辑表单。
await page.locator('#studio-field-headline').fill('PREVIEW-DRAFT-20261106');
// B7 接入后，不点击预览、不保存，画布自动显示最新输入。
await page.frameLocator('iframe[title="草稿预览"]').getByText('PREVIEW-DRAFT-20261106', { exact: true }).waitFor({ timeout:1000 });
// 浏览器 fixture 提供 siteUrl（已发布站点 URL）；公开站点不得泄漏未保存草稿。
assert.equal((await (await fetch(siteUrl)).text()).includes('PREVIEW-DRAFT-20261106'), false);
```

本用例的输入/实时画布行为依赖 B7；B3 早期只建立 fixture 和服务失败基线，不提前宣称最终预览验收通过。具体控件使用当前可访问名称；若当前名称不同，先从实际 UI 定位并更新测试，不靠 `.nth()` 猜测。增加桌面 1440×900、移动 390×844、页面切换、图片、富文本和保存后发布一致性；两种模板都运行。
- [ ] **Step 2：在尚未安装 bundle 的隔离 Preview 上运行，预期 renderer unavailable；记录失败。`preview-roundtrip.mjs` 使用 `spawnSync` 执行 `npx playwright test --config ops/e2e/playwright.config.mjs ops/e2e/preview.spec.mjs` 并保留非零退出码；成功后才生成通过证据。**
- [ ] **Step 3：配置服务及边缘。** Preview service 仅挂载已批准 registry/bundles，设置 `PREVIEW_PUBLIC_ORIGIN`、`PREVIEW_ADMIN_ORIGIN`；CMS 设置 `STOREFRONT_PREVIEW_SERVICE_URL`。Nginx 代理 `/api/v1/renderers/`、`/preview/`、`/health-check`；CMS frame-src 允许精确 Preview origin，Preview frame-ancestors 只允许 CMS origin。保留 HTML no-store/noindex 和 hash 资源 immutable。
- [ ] **Step 4：部署隔离环境后再执行 Step 1 全矩阵。** 正式域名只读检查：TLS、GET `/health-check`、两个 resolver、对应 HTML 和至少一张实际 hash 资源；HTTP 200 必须伴随正确模板 ID/version/digest。记录生产是否已部署，不能用本机 DNS 结果替代权威 DNS 配置。生产地址沿用现有配置，不新建用户未指定域名。
- [ ] **Step 5：提交配置、测试和证据。** `test: verify unified preview against published templates`。生产切换由 D2 在版本和恢复门槛齐备后执行。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Preview：

```sh
git diff --check
git add -- .github/workflows/release.yml README.md ops/preview.compose.yml ops/preview.nginx.conf
git diff --cached --check
git commit -m "test: verify unified preview against published templates"
```

CMS：

```sh
git diff --check
git add -- proxy/nginx.conf proxy/nginx.prod.conf docs/operations/unified-template-preview.md ops/e2e/preview-roundtrip.mjs ops/e2e/preview.spec.mjs ops/e2e/browser-fixture.mjs ops/e2e/playwright.config.mjs docs/verification/2026-11-06-unified-preview.md package.json package-lock.json
git diff --cached --check
git commit -m "test: verify unified preview against published templates"
```

### Task B4：模板声明驱动区块属性表单

**Files:**
- Create: `CMS/ui/src/components/studio/section-property-fields.tsx`、`CMS/ui/src/components/studio/section-property-state.ts`、`CMS/ui/src/components/studio/section-property-state.test.ts`。
- Modify: `CMS/ui/src/components/studio/visual-page-editor.tsx`、`CMS/ui/src/components/studio/fields.tsx`、`CMS/ui/src/components/studio/studio.css`、`CMS/ui/src/views/dashboard/studio.tsx`。
- Modify: `CMS/backend/src/template-contract/model.ts`、`CMS/backend/src/template-contract/editor-schema.ts`、`CMS/backend/src/storefront/section-schema.ts`、`CMS/backend/src/studio/controller.ts`。
- Modify: `Templates/schema/template.schema.json`、`Templates/templates/aeroframe/1.0.4/template.json`、`Templates/templates/fireguard/1.0.1/template.json` 的 editor section 属性声明。
- Create: `CMS/ops/e2e/section-fields.spec.mjs`。

**Interfaces:**
- Consumes: 已有 `TemplateEditorContract.sections[].props` 与 VisualNode.props；已有 StudioFields 的媒体/引用选择交互。
- Produces: `SectionPropertyField {key:string;label:string;control:EditorControl;required:boolean;options?:string[];default?:unknown;visibleWhen?:{field:string;equals:unknown}}`；`updateSectionField(values:Record<string,unknown>,field:SectionPropertyField,input:unknown): {values:Record<string,unknown>;error:string|null}`；`SectionPropertyFields` props 为 `fields/values/disabled/onChange`，变更回调 `(key:string,value:unknown)=>void`。
- 后端 section prop 声明增加可选 `label/visibleWhen`；旧声明缺 label 时显示已有人类可读标签或说明，不能显示 undefined。复杂 array/widget/rich-text 由 B6 在同一工作区内嵌既有控件；B4 不新增另一编辑器入口，B6 完成前不得宣称复杂内容编辑已收口。

- [ ] **Step 1：写字段类型和数据保留测试。**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { updateSectionField } from './section-property-state';
test('keeps false and zero and preserves unrelated fields', () => {
  const base = {headline:'原内容',enabled:true,count:2};
  const result = updateSectionField(base,{key:'enabled',label:'显示',control:'boolean',required:false},false);
  assert.deepEqual(result.values,{headline:'原内容',enabled:false,count:2});
  assert.equal(updateSectionField(base,{key:'count',label:'数量',control:'number',required:true},0).values.count,0);
  assert.equal(base.enabled,true);
});
```

补充必填空值、非法数字/枚举、媒体 ID 未授权、条件字段隐藏后保留原值、未知字段保留、未知控件明确禁用。媒体授权仍由服务端验证，浏览器检查不替代权限。
- [ ] **Step 2：执行 UI 新状态测试，预期函数未定义失败；浏览器进入现有属性面板，记录当前 JSON textarea 行为作为基线。**
- [ ] **Step 3：实现控件映射和服务器校验。** text/number/boolean/date/enum 用已有原生控件；media/reference 复用现有选择器；rich-text 在 B6 接入既有富文本组件及结构化保存，不能将结构化富文本转成字符串丢失排版。所有更改走 updateNodeProps，节点 ID 保持不变，实时更新草稿预览；保存仍受 expectedUpdatedAt 和当前站点能力检查。

```tsx
<label for={fieldId}>{field.label}</label>
<input id={fieldId} value={String(value ?? '')} disabled={disabled}
  aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined}
  onInput={event => onChange(field.key,(event.target as HTMLInputElement).value)} />
{error && <p id={`${fieldId}-error`} role="alert">{error}</p>}
```

`fieldId` 使用 `section-${nodeId}-${field.key}`，避免多个区块字段 ID 重复；value/error 来自该字段状态。失败保存聚焦表单顶部错误摘要，摘要链接到字段，输入时不反复抢焦点。移除主操作路径的“区块属性 JSON”输入和“修改 JSON”提示，保持现有三栏样式，不重新设计整站视觉。
- [ ] **Step 4：执行状态测试、backend/UI 类型检查、Playwright section-fields 用例。** 键盘 Tab/Enter 完成标题、按钮链接、开关和图片选择；拖拽有上移/下移等价操作；无权限只读；错误值不保存；保存后刷新与草稿预览一致，显式发布后再比对公开内容；390px 视口无横向溢出。普通用户完成流程不接触 JSON 或内部字段结构。
- [ ] **Step 5：提交。** `feat: edit section properties through template-driven controls`。UI 验收参考 ui-ux-pro-max 的 inline error、focusable summary 规则，保留现有设计体系。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- ui/src/components/studio/section-property-fields.tsx ui/src/components/studio/section-property-state.ts ui/src/components/studio/section-property-state.test.ts ui/src/components/studio/visual-page-editor.tsx ui/src/components/studio/fields.tsx ui/src/components/studio/studio.css ui/src/views/dashboard/studio.tsx backend/src/template-contract/model.ts backend/src/template-contract/editor-schema.ts backend/src/storefront/section-schema.ts backend/src/studio/controller.ts ops/e2e/section-fields.spec.mjs
git diff --cached --check
git commit -m "feat: edit section properties through template-driven controls"
```

Templates：

```sh
git diff --check
git add -- schema/template.schema.json templates/aeroframe/1.0.4/template.json templates/fireguard/1.0.1/template.json
git diff --cached --check
git commit -m "feat: edit section properties through template-driven controls"
```


### Task B5：统一内容路由与可视化工作区

**Files:**
- Create: `CMS/ui/src/components/studio/content-workspace.tsx`、`CMS/ui/src/components/studio/editor-target.ts`、`CMS/ui/test/editor-target.test.mjs`。
- Modify: `CMS/ui/src/router.ts`、`CMS/ui/src/layouts/dashboard/aside-content.tsx`、`CMS/ui/src/layouts/dashboard/navigation.ts`。
- Modify: `CMS/ui/src/views/dashboard/studio.tsx`、`CMS/ui/src/views/dashboard/entry.tsx`、`CMS/ui/src/views/dashboard/entries.tsx`、`CMS/ui/src/views/dashboard/site-onboarding.tsx`。
- Modify: `CMS/ui/src/components/studio/visual-page-editor.tsx`、`CMS/ui/src/components/studio/page-create-wizard.tsx`、`CMS/ui/src/components/studio/studio.css`。
- Create: `CMS/ops/e2e/single-editor.spec.mjs`。

**Interfaces:**
- Consumes: 已有 `StudioState`、`StudioModel`、`PageDraft`、`VisualPageEditor`；通用模型复用当前 EntryView 的授权加载和现有 Entry SDK。依赖 B4 的属性控件；B6/B7 完成后才能整体替换生产编辑入口。
- Produces: `EditorTarget { intent:'create'|'edit'|'page'; workspaceId:string; siteId?:string; templateId:string; modelKey?:string; entryId:string|null; pageKey?:string; language:string; groupId?:string }`；`contentEditorLocation(target:EditorTarget): {path:'/d/studio';query:Record<string,string>}`。intent 区分新增、已有条目和仅页面设置；无绑定条目的页面不能被误当作新建条目。
- Produces: `ContentWorkspace` 唯一编辑组件，props 为 `target:EditorTarget`；内部编排现有字段、画布和 B7 会话。列表、路由与入口不再拥有另一份可写表单状态。
- `contentEditorLocation` 仅生成地址，不提供授权。加载流程先确认 workspace/site 权限，再验证 template/entry/page/language 归属；URL 查询参数不能覆盖服务端已验证上下文。单条内容绑定多个页面时提供“查看页面”选择，切换画布不复制内容草稿。

- [ ] **Step 1：写地址与上下文回归测试。** 在 `ui/test/editor-target.test.mjs` 使用现有 UI node:test 模式导入 TS：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentEditorLocation } from '../src/components/studio/editor-target.ts';
test('old and new entry links carry the same editing identity', () => {
  const target = { intent:'edit', workspaceId:'w1', siteId:'s1', templateId:'t1', modelKey:'product', entryId:'e1', language:'zh', groupId:'g1' };
  const route = contentEditorLocation(target);
  assert.equal(route.path, '/d/studio');
  assert.equal(route.query.section, 'content');
  assert.equal(route.query.siteId, 's1');
  assert.equal(route.query.entryId, 'e1');
  assert.equal(route.query.language, 'zh');
  assert.equal(route.query.group, 'g1');
  assert.equal(contentEditorLocation({ ...target, intent:'create', entryId:null }).query.entryId, 'create');
  assert.equal(contentEditorLocation({ ...target, intent:'page', pageKey:'contact', entryId:null }).query.entryId, undefined);
});
```

浏览器用例实际从侧栏、工作台、首页/商品/页面列表、建站向导、旧 entry URL、旧 pageKey 深链进入，断言只存在一个 `aria-label="内容编辑工作区"`；原 URL 上的 `field` 焦点定位仍有效。补充刷新/前进后退、新建、未安装模型、无权限、跨站参数、缺失条目和无此语言内容。
- [ ] **Step 2：执行 `node --test ui/test/editor-target.test.mjs`，预期新增模块缺失；使用 B3 配置运行 `single-editor.spec.mjs`，记录旧编辑页仍独立存在的失败。**
- [ ] **Step 3：建立唯一入口和工作区外壳。** 地址生成器明确编码全部身份：

```ts
export function contentEditorLocation(target: EditorTarget): { path:'/d/studio'; query:Record<string,string> } {
  const query: Record<string,string> = {
    section:'content', intent:target.intent, workspaceId:target.workspaceId,
    templateId:target.templateId, language:target.language,
  };
  if (target.intent === 'create') query.entryId = 'create';
  else if (target.entryId) query.entryId = target.entryId;
  if (target.siteId) query.siteId = target.siteId;
  if (target.modelKey) query.modelKey = target.modelKey;
  if (target.pageKey) query.pageKey = target.pageKey;
  if (target.groupId) query.group = target.groupId;
  return { path:'/d/studio', query };
}
```

提取 EntryView 中读取模型/语言/状态/分组和已支持控件的逻辑供工作区使用，`entry.tsx` 变为旧地址解析与 `router.replace` 适配；`entries.tsx` 的查看/新增统一使用地址生成器。`aside-content.tsx` 删除“完整内容模型”第二导航，模型列表归入网站内容分类。`studio.tsx` 的 openEntry/openPage、列表、新建成功跳转和 brand/contact 入口统一挂载 ContentWorkspace；内容、页面设置、导航统一进入右侧面板，站点设置页中的这些编辑项改成定位链接。保留域名、权限、发布管理的独立页面。
- [ ] **Step 4：保持既有样式，实现画布持续显示。** `ContentWorkspace` 根为 `<section aria-label="内容编辑工作区">`，顶部同一保存状态区域，右侧提供内容/区块/页面信息分组。复用 VisualPageEditor 的 iframe；不要给条目编辑和页面设置分别创建 iframe。page-create-wizard 只负责选择蓝图及初始化路径，正文输入移入新建状态的同一工作区，首次保存前可预览。通用历史内容无页面绑定时显示明确说明，内容仍可编辑。B6 的复杂控件及 B7 的联动接入此组件，不新建第二工作区。
- [ ] **Step 5：执行路由测试和真实浏览器入口矩阵。** `node --test ui/test/editor-target.test.mjs ui/test/dashboard-navigation.test.mjs`；`npx playwright test --config ops/e2e/playwright.config.mjs ops/e2e/single-editor.spec.mjs`。检查桌面/390px、键盘定位、旧书签、当前站点与语言不丢失；B7 接入后补测未保存状态的路由守卫。B5 的独立交付为入口与组件收口，实时同步的最终放行在 B7/B3。
- [ ] **Step 6：提交入口收口。** 在 CMS 目标工作树执行：

```sh
git diff --check
git add -- ui/src/components/studio/content-workspace.tsx ui/src/components/studio/editor-target.ts ui/test/editor-target.test.mjs ui/src/router.ts ui/src/layouts/dashboard/aside-content.tsx ui/src/layouts/dashboard/navigation.ts ui/src/views/dashboard/studio.tsx ui/src/views/dashboard/entry.tsx ui/src/views/dashboard/entries.tsx ui/src/views/dashboard/site-onboarding.tsx ui/src/components/studio/visual-page-editor.tsx ui/src/components/studio/page-create-wizard.tsx ui/src/components/studio/studio.css ops/e2e/single-editor.spec.mjs
git diff --cached --check
git commit -m "feat: consolidate content editing into one workspace"
```

### Task B6：在唯一工作区补齐结构化内容编辑与保存

**Files:**
- Create: `CMS/ui/src/components/studio/structured-field.tsx`、`CMS/ui/src/components/studio/structured-value.ts`、`CMS/ui/test/structured-value.test.mjs`。
- Modify: `CMS/ui/src/components/studio/fields.tsx`、`CMS/ui/src/components/studio/section-property-fields.tsx`、`CMS/ui/src/components/studio/content-workspace.tsx`、`CMS/ui/src/sdk/handlers/studio.ts`。
- Modify: `CMS/backend/src/studio/business.ts`、`CMS/backend/src/studio/controller.ts`、`CMS/backend/src/entry/controller.ts`、`CMS/backend/src/entry/models/controller.ts`。
- Create: `CMS/backend/src/studio/structured-content.ts`、`CMS/backend/src/studio/structured-content.test.ts`、`CMS/ops/e2e/structured-content.spec.mjs`。
- Test/extend: `CMS/backend/src/studio/entry-cas.test.ts`。

**Interfaces:**
- Consumes: B5 ContentWorkspace；既有 `PropValue`、`PropValueRichTextData`、`EntryContentNode`、`EntryContentEditor`、`EntryMetaEditor` 和 `propsValueCheck`，直接复用其字段/节点模型，不发明 HTML 字符串作为存储格式。
- Produces: `StructuredStudioValue { kind:'prop-data'; data:PropValue['data'] }`；已有 `StudioValue` 联合增加此成员，保留原 string/number/boolean/media/reference 调用兼容。`structuredValue(data:PropValue['data']):StructuredStudioValue` 返回深拷贝；`StructuredField` 接收 `prop:Prop, value:PropValue, entryId:string, languageIndex:number, disabled:boolean, onChange:(data:PropValue['data'])=>void`。
- Produces: `validateStructuredFields(template:Template, props:PropValue[], resources:{widgets:Widget[];groups:Group[];templates:Template[];medias:Media[]}):void`：调用已有 `propsValueCheck` 并抛出具体字段错误；resources 必须已按当前主体/站点授权过滤，引用还需核对条目归属。
- Studio 的 patchEntry 支持修改已有富文本与复杂字段；通用模型仍使用 Entry SDK，但 `EntryUpdateBody` 新增可选 `expectedUpdatedAt:number`，工作区调用必传，服务端传给 `Repo.entry.update` 做 CAS。兼容旧 API 调用，不用前端先读后写冒充 CAS。

- [ ] **Step 1：写结构化值与服务端保真测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredValue } from '../src/components/studio/structured-value.ts';
test('rich content is cloned without flattening marks or lists', () => {
  const data = [{ nodes:[{ type:'paragraph', content:[{ type:'text', text:'正文', marks:[{ type:'bold' }] }] }] }];
  const value = structuredValue(data);
  assert.deepEqual(value, { kind:'prop-data', data });
  value.data[0].nodes[0].content[0].text = '修改';
  assert.equal(data[0].nodes[0].content[0].text, '正文');
});
```

服务端复用 entry-cas 的站点/模型 fixture，补测现有 RICH_TEXT 的修改、空正文、数组保留顺序、widget/引用嵌套媒体越权、未知字段拒绝、其他语言/未编辑字段不变、两客户端写入冲突。通用 Entry API 也必须执行并发写入实测，旧无 expectedUpdatedAt 调用兼容策略单独记录。
- [ ] **Step 2：运行 `node --test ui/test/structured-value.test.mjs` 和以下服务端测试，确认新增行为失败。**

```sh
TS_NODE_PROJECT=backend/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -r tsconfig-paths/register --test backend/src/studio/structured-content.test.ts backend/src/studio/entry-cas.test.ts
```

- [ ] **Step 3：实现字段适配与内嵌组件。** `structuredValue` 为 `return { kind:'prop-data', data:structuredClone(data) }`。读取原始 `entry.fields` 时保留完整结构；禁止 `String(nodes)`、只取第一项或保存时用空数组替代未编辑字段。富文本适配使用已有组件的受控 input：

```tsx
<EntryContentEditor entryId={entryId} propPath={propPath} lngIdx={languageIndex}
  nodes={richValue.nodes} disabled={disabled}
  onInput={nodes => onRichTextChange({ nodes })} />
```

这里 `richValue` 为当前数组项的 `PropValueRichTextData`，`onRichTextChange` 仅替换该项并通过 onChange 返回整份 data；`propPath` 取既有元数据路径生成逻辑。模型字段走 StructuredField；区块属性则复用上述 nodes 输入接口并按声明的 section props 格式返回，不把 section data 当作 Entry 元数据写入。不要传 entrySync，不开启实时协作或隐式保存。复杂数组/日期/枚举/分组/widget 复用 EntryMetaEditor/既有 prop 组件及权限控制；嵌入式弹层只修改当前会话，不拥有独立保存入口。正文主内容、语言/状态/分组沿用通用模型能力。未知控件只读保留，已支持控件必须可编辑。移除 fields.tsx 的“请使用完整编辑器”和纯文本创建后跳转提示。
- [ ] **Step 4：实现后端解析及验证。** Zod 联合增加带判别字段的 structured 对象，不能将 unknown data 直接写库。按已安装字段映射转换为 PropValue 后调用 `validateStructuredFields`，其主体调用 `propsValueCheck(template.props, props, 'studio.fields', resources.widgets, resources.groups, resources.templates, resources.medias)`；返回 Error 即抛出。替换前检查必填、节点类型/深度、widget/媒体/引用归属；当前控制器请求限制和模板字段约束仍生效。通过后仍走原先 Entry CAS 和新建 operationId 幂等流程；兼容旧的富文本纯文本新建请求。缺语言版本在同一工作区引导有权限用户创建翻译，禁止后台静默复制其他语言或回退到高级编辑器。
- [ ] **Step 5：运行 Step 2、`npm run build:noEmit --workspace=backend`、`npm run type-check --workspace=ui` 和真实浏览器 `structured-content.spec.mjs`。** 在同一工作区修改已有富文本、链接、列表、图片、引用和数组后保存刷新，逐项比对结构与其他语言；强制 409 时本地节点和焦点保留。创建/编辑均不出现另一编辑器或 JSON 输入。模板要求但无法编辑的必填字段必须阻止创建，不能丢数据后宣称成功。
- [ ] **Step 6：提交内容控件和保存适配。**

```sh
git diff --check
git add -- ui/src/components/studio/structured-field.tsx ui/src/components/studio/structured-value.ts ui/test/structured-value.test.mjs ui/src/components/studio/fields.tsx ui/src/components/studio/section-property-fields.tsx ui/src/components/studio/content-workspace.tsx ui/src/sdk/handlers/studio.ts backend/src/studio/business.ts backend/src/studio/controller.ts backend/src/entry/controller.ts backend/src/entry/models/controller.ts backend/src/studio/structured-content.ts backend/src/studio/structured-content.test.ts backend/src/studio/entry-cas.test.ts ops/e2e/structured-content.spec.mjs
git diff --cached --check
git commit -m "feat: edit structured content inside the unified workspace"
```

### Task B7：统一草稿会话、实时预览与可靠保存反馈

**Files:**
- Create: `CMS/ui/src/components/studio/editor-session.ts`、`CMS/ui/src/components/studio/draft-preview.ts`、`CMS/ui/src/components/studio/save-session.ts`、`CMS/ui/test/editor-session.test.mjs`、`CMS/ui/test/draft-preview.test.mjs`、`CMS/ui/test/save-session.test.mjs`。
- Modify: `CMS/ui/src/components/studio/content-workspace.tsx`、`CMS/ui/src/components/studio/visual-page-editor.tsx`、`CMS/ui/src/views/dashboard/studio.tsx`、`CMS/ui/src/sdk/handlers/studio.ts`、`CMS/ui/src/util/template-preview.ts`。
- Create: `CMS/backend/src/studio/draft-preview.ts`、`CMS/backend/src/studio/draft-preview.test.ts`、`CMS/ops/e2e/live-editing.spec.mjs`。
- Modify: `CMS/backend/src/studio/controller.ts`、`CMS/backend/src/studio/page-create.ts`、`CMS/backend/src/presets/pages.ts`。
- Test/extend: `CMS/backend/src/studio/page-create.test.ts`。
- Test/extend: `CMS/ui/test/template-preview.test.mjs`、`CMS/ops/e2e/single-editor.spec.mjs`、`CMS/ops/e2e/preview.spec.mjs`。

**Interfaces:**
- Consumes: B5 `EditorTarget`、B6 `StudioValue`/结构化验证、既有 `PageDraft`、`StudioHandler` 的 saveEntry/createPage/savePage/saveSettings、B1 的 PreviewRuntime 与 iframe 消息校验。
- Produces: `EditorSessionKey {sessionId:string;revision:number;workspaceId:string;siteId:string;language:string}`；`acceptPreview(current:EditorSessionKey,incoming:EditorSessionKey):boolean`，五字段必须全部相同。UI `editor-session.ts` 的本地草稿包含 EditorTarget、字段/正文、页面、站点设置、各部分基线与 dirty 标记；一次只有一个编辑会话。
- Produces: `StudioSettingsDraft {expectedUpdatedAt:number;name:string;theme:{background:string;foreground:string;accent:string;muted:string};navigation?:NavigationNode[];operations?:SiteOperations}`；`StudioDraftOverlay {entry?:{modelKey:string;entryId?:string;operationId:string;fields:Record<string,StudioValue>};page?:PageDraft;settings?:StudioSettingsDraft}`。这两个类型与 EditorSessionKey 定义在 `backend/src/studio/draft-preview.ts`，NavigationNode/SiteOperations 从既有 backend presets 模块引入；UI 只 import type 复用后端类型，服务器不依赖 UI SDK。
- Produces: `POST /api/v4/studio/preview` 接收 `{sessionId,revision,language,overlay:StudioDraftOverlay}`，workspace/site 只从已授权请求上下文获取。返回 `EditorSessionKey & {payload:ReleaseSnapshot & {kind:'preset-site';siteName:string}}`；`buildStudioDraftPreview(input:ReleaseInput,overlay:StudioDraftOverlay):ReleaseSnapshot` 为纯函数，复用 `patchEntry/updatePageDraft/buildRelease`，深拷贝后叠加，不调用存储或发布。新页面预览由既有蓝图规则生成完整 PageDraft 临时对象。
- Produces: `savePage`/`createPage` 返回 `PageDraft & {siteUpdatedAt:number}`，值取现有 saveDraft 成功后写回的 updated.updatedAt，原 PageDraft 字段保留兼容；createStudioPage 同步传递该回执。幂等重放遇到站点已被其他修改推进版本时返回冲突供用户重新核对，不默默采纳其他人的版本。不得另读一次站点并把别人的并发版本作为本次成功版本。
- Produces: `SaveContext {entryId?:string;entryUpdatedAt?:number;siteUpdatedAt:number}`；`SavePart {key:'content'|'page'|'settings';confirms:Array<'content'|'page'|'settings'>;run:(context:SaveContext)=>Promise<SaveContext>}`；`saveSession(parts:SavePart[],context:SaveContext):Promise<{context:SaveContext;completed:SavePart['key'][];failed?:{key:SavePart['key'];error:unknown}}>`。普通操作只 confirms 自身；createPage 的一次操作 confirms content/page，队列不再添加 page 操作。仅提交 dirty 且有权限的部分；顺序执行并在首个失败停止。

- [ ] **Step 1：写乱序与部分保存失败测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptPreview } from '../src/components/studio/draft-preview.ts';
import { saveSession } from '../src/components/studio/save-session.ts';
test('only the latest preview in the current site session is accepted', () => {
  const key = { sessionId:'a', revision:2, workspaceId:'w1', siteId:'s1', language:'zh' };
  assert.equal(acceptPreview(key, { ...key, revision:1 }), false);
  assert.equal(acceptPreview(key, { ...key, sessionId:'old' }), false);
  assert.equal(acceptPreview(key, { ...key, siteId:'s2' }), false);
  assert.equal(acceptPreview(key, { ...key }), true);
});
test('a page conflict preserves the acknowledged content and stops settings', async () => {
  const calls = [];
  const result = await saveSession([
    { key:'content', confirms:['content'], run:async c => { calls.push('content'); return { ...c, entryId:'e1', entryUpdatedAt:2 }; } },
    { key:'page', confirms:['page'], run:async () => { calls.push('page'); throw Object.assign(new Error('conflict'), { status:409 }); } },
    { key:'settings', confirms:['settings'], run:async c => { calls.push('settings'); return c; } },
  ], { siteUpdatedAt:1 });
  assert.deepEqual(calls, ['content', 'page']);
  assert.deepEqual(result.completed, ['content']);
  assert.equal(result.context.entryUpdatedAt, 2);
  assert.equal(result.failed.key, 'page');
});
```

将两例分别放入 draft-preview/save-session 测试。增加 siteUpdatedAt 串行传递、首次创建成功后页面失败重试不重复建条目、全成功才清 dirty、输入法组合输入、服务不可用、切语言/站点时取消、相同内容被多个页面引用的覆盖。后端测试对 input 深冻结，验证 buildStudioDraftPreview 不修改输入、保存版本和公开 release；禁止注入别站 entry/media/page，预览端点也执行权限测试。
- [ ] **Step 2：运行 `node --test ui/test/editor-session.test.mjs ui/test/draft-preview.test.mjs ui/test/save-session.test.mjs` 及 backend draft-preview 定向测试，确认模块缺失或新行为失败。** backend 命令使用 B6 相同 TS_NODE 配置，测试文件为 `backend/src/studio/draft-preview.test.ts`。
- [ ] **Step 3：实现内存草稿预览。** 控制器从授权站点加载 ReleaseInput，验证 overlay 各部分和媒体/引用权限；page 只接受现有保存接口的可写字段，身份/布局蓝图从已安装站点重建，不相信前端传入的模板或站点标识。纯函数克隆后按 modelKey/entryId 替换条目，应用页面/设置，再调用 `buildRelease(draftInput,{preserveMediaCapabilities:true})`。临时新条目沿用 pageOperationIds 的稳定 ID；临时页面用 createPageDraft 在内存构造，已有页面才调用 updatePageDraft。无站点/无渲染绑定的通用内容不调用此端点，显示 B5 的无预览原因。因必填未完成无法渲染时返回可定位字段错误；前端保留上次有效画面并明确其状态。响应 `Cache-Control:no-store`；不得把修改发送到 GET 已发布接口或公共缓存。

```ts
export function acceptPreview(current: EditorSessionKey, incoming: EditorSessionKey): boolean {
  return current.sessionId === incoming.sessionId && current.revision === incoming.revision &&
    current.workspaceId === incoming.workspaceId && current.siteId === incoming.siteId &&
    current.language === incoming.language;
}
```

每次有效输入递增 revision，300ms 防抖发 POST；请求返回还须核对当前 EditorTarget 未变化，之后通过 B1 `sendRendererPreview` 发送完整 payload，避免本地拼装遗漏商品列表/全局品牌。切目标生成新 sessionId 并 AbortController 取消旧请求；SDK 不支持 signal 时在 draft-preview 层使用现有授权请求设施加 signal，仍保留响应身份丢弃。iframe 未 ready 时保留最新 payload，ready 后仅发送当前内容；同 iframe 生命周期内沿用有序消息，不改 protocolVersion。
- [ ] **Step 4：实现顺序保存及统一状态。** 保存开始先验证所有 dirty 部分并固定快照；禁用输入及切换直到完成。saveSession 的核心流程：

```ts
export async function saveSession(parts: SavePart[], initial: SaveContext): Promise<{context:SaveContext;completed:SavePart['key'][];failed?:{key:SavePart['key'];error:unknown}}> {
  let context = initial;
  const completed: SavePart['key'][] = [];
  for (const part of parts) {
    try { context = await part.run(context); completed.push(...part.confirms); }
    catch (error) { return { context, completed, failed:{ key:part.key, error } }; }
  }
  return { context, completed };
}
```

content 成功只更新内容基线，page 成功只更新页面基线及 siteUpdatedAt，settings 使用最新 siteUpdatedAt；不要调用现有 refresh/resetSettings 清空尚未保存的其他部分。new-page 的 createPage 已写内容与页面，成功时同时确认两部分，后续仅保存剩余设置；不能再创建一次。失败保留未完成部分、operationId 和确认版本，显示“内容已保存，页面设置未保存”等具体反馈；409 需要显式解决冲突，网络结果未知则用 operationId/已确认版本核对再重试。正常保存后不发布；返回列表、切站、切语言、浏览器关闭共用脏状态守卫。
- [ ] **Step 5：完成真实浏览器与布局边界验证。** 在 `live-editing.spec.mjs` 执行：

```js
await page.locator('#studio-field-headline').fill('LIVE-UNSAVED-20261106');
await expect(page.frameLocator('iframe[title="草稿预览"]').getByText('LIVE-UNSAVED-20261106', { exact:true })).toBeVisible({ timeout:1000 });
await expect(page.getByText('有未保存的修改', { exact:true })).toBeVisible();
assert.equal((await (await fetch(siteUrl)).text()).includes('LIVE-UNSAVED-20261106'), false);
```

`expect` 从 B3 锁定的 Playwright 引入，siteUrl 从 fixture 的本次站点取得。手机折叠布局先切换到画布面板再断言可见；面板切换只改变可见性，不触发预览构建，耗时用输入/渲染事件记录。监控所有写 API，输入期间只允许预览请求、不得保存或发布。延迟旧响应、重载 iframe、断网恢复、内容保存成功后注入 page 409、切站/语言、首次新建未保存预览、桌面与手机全部覆盖。验证模板蓝图/区块预制变体和排序；提交 `mode:'structured'` 或未声明节点必须被后端拒绝。画布/属性切换不得丢焦点，保存冲突不丢正文。执行两模板 `single-editor/structured-content/live-editing/preview` 四个 spec 及 Step 2，最后 backend/UI 类型检查；B3 的最终证据在此之后生成。
- [ ] **Step 6：提交草稿会话与联动。**

```sh
git diff --check
git add -- ui/src/components/studio/editor-session.ts ui/src/components/studio/draft-preview.ts ui/src/components/studio/save-session.ts ui/test/editor-session.test.mjs ui/test/draft-preview.test.mjs ui/test/save-session.test.mjs ui/src/components/studio/content-workspace.tsx ui/src/components/studio/visual-page-editor.tsx ui/src/views/dashboard/studio.tsx ui/src/sdk/handlers/studio.ts ui/src/util/template-preview.ts backend/src/studio/draft-preview.ts backend/src/studio/draft-preview.test.ts backend/src/studio/controller.ts backend/src/studio/page-create.ts backend/src/studio/page-create.test.ts backend/src/presets/pages.ts ui/test/template-preview.test.mjs ops/e2e/single-editor.spec.mjs ops/e2e/preview.spec.mjs ops/e2e/live-editing.spec.mjs
git diff --cached --check
git commit -m "feat: preview unsaved content and track unified draft saves"
```
