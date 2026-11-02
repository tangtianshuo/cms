# Cross repository contract baseline

日期：2026-10-31

## 已建立的基线

- Gateway `@gateway/contracts` 提供 `ContractSnapshotV1` 类型和 `validateContractSnapshotV1`。
- Templates 提供 `contracts/schema-v1/contract-snapshot.schema.json`、fixture 和 `npm run test:contract`。
- CMS 提供 `toContractSnapshot()`，将内部 `ReleaseSnapshot` 投影为版本化契约，并保留模板渲染所需的 `preset` 数据。
- CMS 提供 `node ops/e2e/test.mjs contract`，执行 CMS -> Gateway -> Templates roundtrip。

## 验证命令

```sh
# CMS worktree
npm run build:backend
node --test backend/test/contract-snapshot.test.mjs
E2E_GATEWAY_ROOT=/Users/445101599qq.com/.codex/worktrees/gateway-contract-runtime \
E2E_TEMPLATES_ROOT=/Users/445101599qq.com/.codex/worktrees/templates-contract-runtime \
node ops/e2e/test.mjs contract

# Gateway worktree
npm test --workspace @gateway/contracts

# Templates worktree
npm run test:contract
```

结果：CMS projection 2/2、Gateway contract 4/4、Templates contract 2/2、跨仓 roundtrip 通过。

## 当前边界

当前投影保留旧 `schemaVersion: 1`，并增加独立的 `contractVersion: 1`。旧模板运行时仍使用旧读取路径；新契约 validator 已能识别 `operations`、导航树、页面布局扩展和发布资源清单。

`assets` 目前由 CMS 投影接口接收，但现有内容构建尚未复制真实媒体文件，也没有切换线上模板的资源读取路径。资源自足发布属于后续 Phase 4.3。

现有 Gateway 发布入口仍接受旧 Release envelope。下一步需要把 `ContractSnapshotV1` 接入 Gateway release validation，并让 Templates 的 runtime contract tests 使用真实 CMS 投影，而不是仅使用独立 fixture。
