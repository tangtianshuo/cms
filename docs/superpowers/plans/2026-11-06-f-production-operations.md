# F：持续交付与运营保障 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每次发布可验证、运行故障可发现、数据和网站可恢复，并支持多站点公平发布。

**Architecture:** 发布 gate 检查完整版本组合和真实集成结果；备份在所有写入者受控暂停时生成一致恢复点，公开 traffic 保持服务。运行探测关注真实站点与发布状态，队列复用已有 PostgreSQL PublishOperation 和租约，增加限额及重试调度。

**Tech Stack:** Node.js 22、TypeScript、Python 3、GitHub Actions、MongoDB、PostgreSQL、Docker、Nginx、node:test、Vitest。

**Spec:** `CMS/docs/superpowers/specs/2026-10-31-template-driven-content-runtime-separation-design.md`；`CMS/docs/roadmap/2026-11-01-建站与内容维护平台-roadmap.md`；`CMS/docs/verification/2026-11-06-platform-gap-review.md`。版本与证据结构见 `2026-11-06-platform-delivery-master.md`。

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

## 文件职责与交付顺序

F1/F2/F3 是 D2 试运营的前置条件。F4 可在试运营闭环后单独交付，不阻碍先验证少量站点。已有 CMS backup 模块和 Gateway 路由备份函数可以复用，但它们各自成功不代表跨系统一致恢复成功。

### Task F1：固定四仓版本的强制发布门禁

**Files:**
- Create: `CMS/ops/release/verify-platform.mjs`、`CMS/ops/release/verify-platform.test.mjs`、`CMS/.github/workflows/platform-gate.yml`。
- Modify: `CMS/.github/workflows/release.yml`、`CMS/ops/e2e/quality-gate.mjs`、`CMS/ops/e2e/test.mjs`。
- Modify: `Templates/.github/workflows/template-release.yml`、`Preview/.github/workflows/release.yml`、`Gateway/.github/workflows/release.yml`。
- Modify: `CMS/docs/operations/release-cicd.md`。

**Interfaces:**
- Consumes: A4 `validatePlatformLock`、PlatformLock；D1 AcceptanceEvidence；实际 checkout Git SHA。
- Produces: `assertPlatformGate({lock, evidence, actualCommits}): void`，任何关键缺项抛错；`node ops/release/verify-platform.mjs LOCK EVIDENCE` 非零即禁止部署。源码 digest 对应性还需 OCI provenance/registry 验证，不能仅校验字符串格式。

- [ ] **Step 1：加入版本漂移及跳过测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPlatformGate } from './verify-platform.mjs';
test('refuses source drift before considering test results', () => {
  const repositories = Object.fromEntries(['cms','gateway','templates','preview'].map(key => [key,{repository:key,commit:'a'.repeat(40)}]));
  const lock = {schemaVersion:1,contractVersion:1,repositories,templates:[{id:'aeroframe',version:'1.0.4',manifestChecksum:`sha256:${'1'.repeat(64)}`,imageDigest:`sha256:${'2'.repeat(64)}`,previewArtifactDigest:`sha256:${'3'.repeat(64)}`,previewBundleDigest:`sha256:${'4'.repeat(64)}`}]};
  const actualCommits = {cms:'b'.repeat(40),gateway:'a'.repeat(40),templates:'a'.repeat(40),preview:'a'.repeat(40)};
  assert.throws(() => assertPlatformGate({lock,evidence:{cases:[]},actualCommits}), /source_drift/);
});
```

另用完整真实格式 fixture 验证：任何 mandatory case blocked/not-run/failed、lockChecksum 不符、环境不是隔离集成环境、源码脏文件、实际镜像摘要不符均拒绝；全量有效通过。
- [ ] **Step 2：执行 CMS `node --test ops/release/verify-platform.test.mjs`，预期模块缺失失败。**
- [ ] **Step 3：实现组合校验并串入 workflow。** checkout 锁文件声明的四仓完整 commit，在同一父目录布置 repo 或显式传 `E2E_*_ROOT`，npm ci、构建、数据库迁移后跑 A4/D1/B3。生成证据 SHA，并与构建 provenance 绑定。禁止使用个人绝对工作树路径；日志不输出 secrets。

```js
for (const key of ['cms','gateway','templates','preview']) {
  if (actualCommits[key] !== lock.repositories[key].commit) throw new Error(`source_drift:${key}`);
}
if (evidence.cases.some(value => value.status !== 'passed')) throw new Error('acceptance_incomplete');
```

还需验证必需 case 集合完整（复用 D1 的集合导出）、lockChecksum、环境、schema。上例不能单独作为完整 gate，因为空 cases 的 every/some 会误通过。

平台部署 job 必须 `needs: platform-gate`，不得 `continue-on-error`。模板正式 available 登记前运行契约、真实渲染和资源校验；平台锁文件在各候选产物构建后生成，整体 gate 在生产部署前运行。不要让“必须先部署才能生成锁”造成循环依赖。workflow 的源码校验可用候选镜像，正式部署必须使用通过 gate 的相同 digest。
- [ ] **Step 4：执行本地完整 gate，并在测试分支触发 CI。** 故意让 lock 中一个 commit 不匹配或一个用例缺失，确认部署 job 未运行；随后恢复有效输入验证整条链路。测试注入只修改测试分支 fixture，不改真实 registry。
- [ ] **Step 5：提交。** `ci: require versioned cross-repository acceptance before deployment`；将必需检查状态纳入仓库现有分支保护流程，并留存实际检查名称及配置证据。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- ops/release/verify-platform.mjs ops/release/verify-platform.test.mjs .github/workflows/platform-gate.yml .github/workflows/release.yml ops/e2e/quality-gate.mjs ops/e2e/test.mjs docs/operations/release-cicd.md
git diff --cached --check
git commit -m "ci: require versioned cross-repository acceptance before deployment"
```

Templates：

```sh
git diff --check
git add -- .github/workflows/template-release.yml
git diff --cached --check
git commit -m "ci: require versioned cross-repository acceptance before deployment"
```

Preview：

```sh
git diff --check
git add -- .github/workflows/release.yml
git diff --cached --check
git commit -m "ci: require versioned cross-repository acceptance before deployment"
```

Gateway：

```sh
git diff --check
git add -- .github/workflows/release.yml
git diff --cached --check
git commit -m "ci: require versioned cross-repository acceptance before deployment"
```

F1 本地实施记录（2026-11-07）：CMS `9b784cf9358aa7b66cdc9275ea683b7c2d9ec7a9`、Gateway `74960c7d5c08bd7b7a6718d1bb0839a763990102`、Templates `2f4c35f37f5f33d8d7c9b922c37d7dc4501d4a32`、Preview `5ee66507a9da81e262b72e06f213be4a2b34fe42`。独立审查及三次限定复审已关闭候选输出引用、单仓 CI 测试依赖及 Python 字节码污染问题。本地验证包含 Node68项、模板发布17项，以及修复后的 CMS 单仓隔离14项/4既有跳过、跨仓必跑回归和受控缓存验证。各测试的具体源码范围见交付进展记录，不合并为一次完整链路通过。公开制品/完整锁、实际签名证明、公网 HTTPS、远程 CI 正反向执行、环境与保护配置仍未验收；本计划的正式步骤及整体状态不提前勾选。

### Task F2：一致备份、隔离恢复与运行实例重建

**Files:**
- Create: `CMS/ops/backup/platform_backup.py`、`CMS/ops/restore/platform_restore.py`、`CMS/ops/backup/manifest.py`。
- Create: `CMS/ops/test/test_platform_backup.py`、`CMS/ops/test/test_platform_restore.py`。
- Create: `CMS/ops/e2e/disaster-recovery.mjs`。
- Modify: `Gateway/packages/traffic/src/state.ts`（复用备份/恢复函数，不让路由备份覆盖新 revision）。
- Create: `Gateway/packages/worker/src/restore-deployments.ts`、`Gateway/packages/worker/src/restore-deployments.test.ts`。
- Create: `CMS/docs/operations/platform-backup-restore.md`。

**Interfaces:**

```ts
interface BackupManifest {
  schemaVersion:1; backupId:string; createdAt:string; lockChecksum:string;
  files:Array<{path:string;sha256:string;size:number}>;
  sites:Array<{cmsSiteId:string;gatewaySiteId:string;releaseId:string;routeRevision:number}>;
}
```

Python `verify_backup(root: Path, manifest: dict) -> None` 验证内容和路径。CLI：`python3 ops/backup/platform_backup.py --output DIR`、`python3 ops/restore/platform_restore.py --backup DIR --target isolated`。目标生产恢复必须显式 `--target production` 且走经过审阅的恢复运行单；默认不覆盖现有数据库或媒体目录。

- [ ] **Step 1：测试损坏备份拒绝。** Python unittest：

```python
import hashlib, tempfile, unittest
from pathlib import Path
from ops.backup.manifest import verify_backup
class BackupIntegrityTest(unittest.TestCase):
    def test_corrupt_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'snapshot.json').write_bytes(b'changed')
            manifest = {'schemaVersion':1, 'backupId':'test-1', 'createdAt':'2026-11-06T00:00:00Z', 'lockChecksum':'sha256:'+'a'*64, 'sites':[], 'files':[{'path':'snapshot.json','sha256':hashlib.sha256(b'original').hexdigest(),'size':8}]}
            with self.assertRaisesRegex(ValueError, "backup_checksum_mismatch"):
                verify_backup(root, manifest)
```

另测缺文件、路径逃逸、符号链接、重复路径、lockChecksum 不一致、恢复目标已有数据。通过用例必须比较实际内容而非仅函数返回。
- [ ] **Step 2：运行 CMS `python3 -m unittest discover -s ops/test -p 'test_platform_*.py' -v`，预期新模块缺失失败。**
- [ ] **Step 3：实现一致备份。** 记录原运行服务集合，在受控维护窗口暂停所有写入者 CMS/control/worker/ingest，等待在途 worker lease/reconciliation 稳定；保持 traffic、已发布 runtime、Preview 运行。若另有数据库写入者或定时任务未纳入暂停，备份拒绝开始。通过 subprocess argv 执行 Mongo dump、PostgreSQL dump，复制 artifact、uploads、路由、域名快照和完整 lock；逐文件 SHA256，全部完成后原子写 manifest。凭据通过环境传递、不进入 manifest/log。

```python
relative = Path(item['path'])
if relative.is_absolute() or '..' in relative.parts:
    raise ValueError('unsafe_backup_path')
root = root.resolve()
candidate = root / relative
for ancestor in [candidate, *candidate.parents]:
    if ancestor == root:
        break
    if ancestor.is_symlink():
        raise ValueError('unsafe_backup_path')
if not candidate.resolve().is_relative_to(root):
    raise ValueError('unsafe_backup_path')
content = candidate.read_bytes()
if len(content) != item['size'] or hashlib.sha256(content).hexdigest() != item['sha256']:
    raise ValueError('backup_checksum_mismatch')
```

manifest.py 中显式导入 `hashlib` 和 `pathlib.Path`；验证文件列表唯一并拒绝非普通文件。任何命令失败不创建完成 manifest；finally 仅恢复此前运行的写入服务。备份维护期间明确返回内容维护/询盘暂不可用，公开网站不得中断。
- [ ] **Step 4：实现隔离恢复和重建部署。** 验证 manifest 后恢复到新随机数据库、新目录和新端口；部署工具从保存的 active release+renderer digest+artifact 重建容器，重新执行健康/Host 检查，再生成当前机器端口和容器身份的路由快照。不能直接恢复旧容器 ID/旧端口并当作健康路由。Gateway active 的逻辑 release/revision 保持一致，物理 deployment 身份重新记录。
- [ ] **Step 5：执行故障演练。** CMS `node ops/e2e/disaster-recovery.mjs`：创建测试站并发布 → 备份 → 停止/移除仅本次隔离站的运行实例 → 在新数据目录恢复 → 探测页面、商品、图片、跳转、sitemap → 恢复后再次发布和回滚。记录备份持续时间、公开页面可用性、恢复耗时和数据时间点；RPO/RTO 初始目标分别为 24 小时/60 分钟，实测未达到则不能标通过。生产备份默认每日，保留最近 7 个日备份和 4 个周备份，额外配置异机副本并验证恢复可读。
- [ ] **Step 6：提交。** `feat: back up and restore consistent platform state`；记录数据库、artifact、媒体、路由各一类损坏时的拒绝/恢复行为。首次生产试运营前至少完成一次异机或独立目录全恢复演练。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- ops/backup/platform_backup.py ops/restore/platform_restore.py ops/backup/manifest.py ops/test/test_platform_backup.py ops/test/test_platform_restore.py ops/e2e/disaster-recovery.mjs docs/operations/platform-backup-restore.md
git diff --cached --check
git commit -m "feat: back up and restore consistent platform state"
```

Gateway：

```sh
git diff --check
git add -- packages/traffic/src/state.ts packages/worker/src/restore-deployments.ts packages/worker/src/restore-deployments.test.ts
git diff --cached --check
git commit -m "feat: back up and restore consistent platform state"
```

### Task F3：真实可用性探测与告警

**Files:**
- Create: `CMS/ops/monitoring/probe.mjs`、`CMS/ops/monitoring/policy.mjs`、`CMS/ops/monitoring/policy.test.mjs`、`CMS/ops/monitoring/config.example.json`。
- Create: `CMS/ops/monitoring/platform-monitor.service`、`CMS/ops/monitoring/platform-monitor.timer`。
- Create: `CMS/docs/operations/platform-alerts.md`。
- Modify: `Gateway/packages/worker/src/operations.ts`、`Gateway/apps/control/src/publication-state.ts`（只增加观测输出，不改变发布判定）。

**Interfaces:**

```ts
interface PlatformHealth {
  siteId:string; publicStatus:number; latencyMs:number; expectedRelease:boolean;
  missingAssets:number; certificateDaysLeft:number; backupAgeHours:number;
  consecutiveFailures:number; publishFailureCount15m:number;
}
interface Alert { key:string; severity:'critical'|'warning'; message:string }
assessHealth(value:PlatformHealth): Alert[];
```

probe 使用 F1 锁定目标/站点实际 release，输出 JSON 与非零状态；调度每 60 秒。告警投递通过已配置运维渠道，执行时先验证用户已授权该渠道；没有配置则明确报告 monitoring-unconfigured，不能宣称通知已送达。

- [ ] **Step 1：测试页面 200 但版本错误也告警。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessHealth } from './policy.mjs';
test('alerts on a wrong active site despite HTTP 200', () => {
  const input = {siteId:'site-a',publicStatus:200,latencyMs:80,expectedRelease:false,missingAssets:0,certificateDaysLeft:30,backupAgeHours:1,consecutiveFailures:3,publishFailureCount15m:0};
  assert.ok(assessHealth(input).some(alert => alert.key === 'site-a:release-mismatch'));
});
```

覆盖三次连续 5xx、缺图、证书小于 14 天、备份大于 26 小时、15 分钟内发布失败至少 3 次；恢复时产生一次恢复事件；同告警 key 15 分钟内不重复通知。
- [ ] **Step 2：执行 CMS `node --test ops/monitoring/policy.test.mjs`，预期模块缺失失败。**
- [ ] **Step 3：实现探测、去重和定时单元。** 公网页面/代表资源探测超时 10 秒；发布状态来自 control，control 不可用和公开网站不可用分开表示。policy 默认阈值按 Step 1；响应时间大于 3000 ms 且连续 3 次为 warning。公开探测不携带 CMS token，管理探测凭据仅进程读取。状态原子写磁盘，重启保留告警去重信息；通知失败记录独立重试状态，不影响网站。
- [ ] **Step 4：在隔离站注入故障并恢复。** 关测试站容器、使一个资源 404、使用测试证书到期值、构造旧备份时间；确认告警分类、去重和恢复。实际渠道只在已授权测试接收端发送一次演练消息，并记录投递结果；不读取或输出真实询盘内容。
- [ ] **Step 5：提交。** `feat: monitor public sites and platform recovery readiness`。D2 运行单包含告警接收人/渠道和最近一次送达证据。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

CMS：

```sh
git diff --check
git add -- ops/monitoring/probe.mjs ops/monitoring/policy.mjs ops/monitoring/policy.test.mjs ops/monitoring/config.example.json ops/monitoring/platform-monitor.service ops/monitoring/platform-monitor.timer docs/operations/platform-alerts.md
git diff --cached --check
git commit -m "feat: monitor public sites and platform recovery readiness"
```

Gateway：

```sh
git diff --check
git add -- packages/worker/src/operations.ts apps/control/src/publication-state.ts
git diff --cached --check
git commit -m "feat: monitor public sites and platform recovery readiness"
```

### Task F4：队列公平性、配额和失败重试

**Files:**
- Modify: `Gateway/packages/worker/src/claim.ts`、`Gateway/packages/worker/src/operations.ts`、`Gateway/packages/worker/src/index.ts`、`Gateway/apps/control/src/publish.ts`。
- Modify: `Gateway/prisma/schema.prisma`。
- Create: `Gateway/prisma/migrations/20261106010000_publish_scheduling/migration.sql`。
- Create: `Gateway/packages/worker/src/retry-policy.ts`、`Gateway/packages/worker/src/retry-policy.test.ts`、`Gateway/packages/worker/src/claim.integration.test.ts`。
- Create: `CMS/ops/e2e/publish-fairness.mjs`。

**Interfaces:**
- Consumes: 已有 PublishOperation、attempts/leaseOwner/leaseUntil 和 PostgreSQL `SKIP LOCKED`。
- Produces: `retryDelayMs(attempt:number, code:string): number|null`；PublishOperation 新字段 `nextAttemptAt`、`lastFailureCode`；Site 新字段 `lastPublishStartedAt`。
- 初始限制：同站在途 1、同工作区在途 2、全局在途 4；单站 pending 上限 20、工作区 pending 上限 100；每站启动间隔 5 秒。均服务端配置，超限返回 429 和 Retry-After，不替换原活动版本。

- [ ] **Step 1：写重试策略和公平调度测试。**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDelayMs } from './retry-policy.js';
test('retries temporary outages and stops permanent errors', () => {
  assert.equal(retryDelayMs(1,'registry_unavailable'),5000);
  assert.equal(retryDelayMs(8,'registry_unavailable'),null);
  assert.equal(retryDelayMs(1,'invalid_release'),null);
});
```

PostgreSQL 集成：站 A 入队 20 个任务，站 B 入队 1 个；多个 worker 并发领取不得让 A 占满工作区并发，B 在下一可用轮获得任务；每站最多一个有效 lease；旧 lease finalize 不得覆盖新 lease。并发入队 30 个任务时原子配额只接收上限数量。
- [ ] **Step 2：Gateway 执行 worker 测试，开启独立 PostgreSQL 后执行新 claim 集成用例，预期现有 FIFO/无配额行为失败。**
- [ ] **Step 3：实现调度与退避。** 配额检查和入队同事务锁工作区，使用数据库计数；claim 同事务获取短时全局调度锁，计算未过期 lease 配额，再按站点 lastPublishStartedAt 升序、operation createdAt 升序选择可领取记录，更新 lease 和时间戳。发布执行在事务外，锁仅覆盖领取；不持锁等 Docker。

```ts
export function retryDelayMs(attempt:number, code:string):number|null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= 8) return null;
  if (!['registry_unavailable','gateway_unavailable','docker_unavailable'].includes(code)) return null;
  return Math.min(5000 * 2 ** (attempt - 1), 300000);
}
```

从现有错误码显式映射到上述分类；invalid template/checksum/auth 为永久失败。只有确认候选未变 active 才可设置 nextAttemptAt 重试；路由已经切换而结果未知必须先 reconciliation，不能简单再次部署。单次拉镜像预算仍受租约约束。
- [ ] **Step 4：执行压力及恢复验证。** `node ops/e2e/publish-fairness.mjs` 覆盖两个工作区、每区两个站；注入一个站连续拉取失败、worker 重启和过期 lease。记录每站排队等待、成功数、失败原因，健康站不被故障站耗尽执行槽；所有原 active 页面持续服务。
- [ ] **Step 5：提交。** `feat: schedule publish operations fairly with bounded retries`；把指标接入 F3，更新默认配额和调参说明。

执行提交前先核对 staging 只包含本任务；下面命令在各自目标工作树根执行。若列出的规划文件没有生成，先核对任务实现，不用 `git add -A` 绕过。跨仓提交分别记录 SHA。

Gateway：

```sh
git diff --check
git add -- packages/worker/src/claim.ts packages/worker/src/operations.ts packages/worker/src/index.ts apps/control/src/publish.ts prisma/schema.prisma prisma/migrations/20261106010000_publish_scheduling/migration.sql packages/worker/src/retry-policy.ts packages/worker/src/retry-policy.test.ts packages/worker/src/claim.integration.test.ts
git diff --cached --check
git commit -m "feat: schedule publish operations fairly with bounded retries"
```

CMS：

```sh
git diff --check
git add -- ops/e2e/publish-fairness.mjs
git diff --cached --check
git commit -m "feat: schedule publish operations fairly with bounded retries"
```

## 运维放行标准

F1：故意破坏版本/用例时部署被阻止。F2：完整备份可在隔离环境恢复并再次发布。F3：公开故障和恢复能产生并送达正确告警。F4：异常站点不能独占队列，超额请求有明确可重试响应。任何一项缺少实测证据均保持未完成。
