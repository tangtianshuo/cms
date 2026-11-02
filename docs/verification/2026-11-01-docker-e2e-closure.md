# 2026-11-01 Docker 闭环验收

本次验收使用隔离 Compose 项目 `cms-e2e-20261028`，运行目录为 `.superpowers/sdd/docker-e2e-20261028/`。没有读取或修改原有开发环境的容器、数据库和数据卷。

## 镜像与运行环境

- CMS、Gateway control、内置 storefront、模板预览和 traffic proxy 均运行在隔离 Compose 项目中。
- Gateway worker 使用本地模板镜像 `local/aeroframe:1.0.3`，最终镜像 digest：`sha256:86b927edabbe53114981a70ed3293fb1e1c0830a1e54dc091039c8c0eccc390a`。
- 模板镜像使用无缓存构建，包含 ContractSnapshotV1 本地读取和 Contract 导航节点兼容逻辑。

## 平台基线

P0.1 的逐路径故障基线见 [2026-11-01-platform-baseline.md](2026-11-01-platform-baseline.md)，可通过 `node ops/e2e/test.mjs platform-baseline` 复跑。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| 模板渲染测试 | 10 passed |
| Gateway worker 单元测试 | 58 passed，10 skipped（数据库集成测试未配置时的既有 skip） |
| CMS → Gateway → Templates contract roundtrip | PASS |
| Gateway 发布、幂等、草稿隔离、过期拒绝、回滚 | PASS |
| Worker 重启恢复 | PASS |
| 容器退役、删除失败重试、当前/上一版本保护 | PASS |
| 容器审计 | `{"total":2,"unreferenced":0,"protected":2}` |

## 浏览器闭环

通过本地 Chrome 完成真实页面交互：

1. 登录 CMS Studio。
2. 从工作台打开“编辑首页”。
3. 修改首页标题为一次性浏览器验收文本并保存草稿。
4. 打开 CMS Studio 内置整站预览 iframe，确认草稿标题显示。
5. 打开“发布更新”，执行“校验发布差异”，确认 4 个页面可发布。
6. 执行“发布新版本”，确认页面显示当前发布版本和“独立站已发布”。
7. 访问内置 storefront 和 Gateway 数据面，均返回 200，并在页面中看到发布后的内容。

截图证据保存在运行目录：

- `browser-login.png`
- `browser-studio-home.png`
- `browser-draft-saved.png`
- `browser-cms-preview-full.png`
- `browser-release-check.png`
- `browser-publish.png`
- `browser-release-final.png`
- `browser-builtin-published.png`
- `browser-gateway-published.png`

## 故障隔离

在已发布路由稳定后停止 CMS 和 Gateway control 容器，Gateway 数据面仍返回 HTTP 200，并能读取已挂载的发布快照。随后重新执行 Compose `up`，CMS health 返回 200，Gateway 数据面恢复为 200。

## 本次修复点

- 模板本地发布读取同时支持 Gateway 已校验的原始 ContractSnapshotV1 和旧信封格式。
- 模板允许 ContractSnapshotV1 的页面操作字段、根级操作字段和完整导航节点，并在渲染边界转换为公开导航字段。
- Gateway worker 在本地 renderer 模式下使用本地镜像身份进行容器退役校验。
- 容器退役安全校验允许唯一的只读发布快照 bind mount，仍拒绝任意 volume、可写挂载、特权和非预期隔离配置。
