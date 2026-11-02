# 2026-11-02 发布质量门禁

P0.2 已接入 `node ops/e2e/test.mjs quality-gate`。门禁在本地隔离 Docker 环境执行，结果写入 `.superpowers/sdd/docker-e2e-20261028/quality-gate.json`，不提交运行目录。

## 门禁步骤

1. CMS `ContractSnapshotV1` projection tests。
2. CMS → Gateway → Templates contract roundtrip。
3. 真实 AeroFrame 1.0.3 renderer build。
4. Templates contract tests 和 renderer contract tests。
5. 只读 Release artifact storefront 的逐路径运行时 smoke 与故障基线。
6. active release 状态前后快照保护。

模板仓库原有全量 `npm test` 仍包含旧的“运行时实时请求 Gateway”测试；当前运行时边界已经改为 artifact-only，因此门禁使用模板契约测试、renderer contract 测试和独立 artifact runtime smoke，避免把过渡测试误当成新的公开运行时契约。

## 结果

| 检查 | 结果 |
| --- | --- |
| CMS contract snapshot | PASS |
| CMS → Gateway → Templates roundtrip | PASS |
| AeroFrame renderer build | PASS |
| Templates contract/runtime contract | PASS |
| Artifact runtime + 故障基线 | PASS |
| Active release protection | PASS |

门禁结果为 `PASS`，失败分类集合为空。记录了：

- `manifestChecksum`: `sha256:9fead6ec9510c590195aadf58fda39fd60aa3a6198b8c4b7d532c97025eba5bb`
- `rendererDigest`: `sha256:runtime-e2e`
- `releaseChecksum`: `sha256:e81a406dbc0b49b04f4a7639ebd0740826fcccc853df25403248ab06e0b80ce8`

## 失败保护

门禁失败会返回非零并写入以下分类之一：`contract_invalid`、`artifact_invalid`、`renderer_invalid`、`runtime_unavailable`。运行前后读取 Gateway route/release 快照；如果检测到活动版本变化，门禁直接失败。门禁本身不调用 template registry 更新或 Gateway active release 更新接口，因此失败不会推进活动版本。
