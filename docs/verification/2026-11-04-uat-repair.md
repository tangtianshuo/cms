# 2026-11-03 UAT 问题修复记录

日期：2026-11-04

## 根因分类

| UAT 问题 | 根因 | 修复 |
| --- | --- | --- |
| 未绑定 Gateway 时仍提示“独立站已发布” | 本地快照发布复用了公网发布成功文案 | 新增 `snapshot-created` 状态；未绑定时只显示“发布快照已生成”，且不展示公网入口 |
| 自定义内容页被固定路径策略拦截 | 旧公开模板把 layout 名误作区块类型，并把内容页蓝图路径作为固定规则 | 旧清单不再从 layout 推导区块；内容页实例分别校验合法路径、保留路径和真实冲突 |
| 工作台新增页面无反馈 | 页面向导只在页面列表分支渲染 | 将页面向导挂载到 Studio 全局站点区域 |
| 区块名显示 `undefined`，首页落入商品规格编辑 | 旧清单中错误的契约数据触发兜底，且可视化与旧区块编辑器同时渲染 | 页面 API 返回统一标签、必备项和编辑模式；每页只渲染一个编辑器；未知区块明确提示且不再落入商品字段 |
| 统计服务未配置却显示 0 | Controller 用默认零值吞掉了 `unconfigured` | API 返回明确状态；UI 区分 loading、unconfigured、error、successful-empty，只有成功响应可显示 0 |
| FireGuard / AeroFrame 预览不可用 | CMS 仅硬编码允许 AeroFrame 1.0.3，部署也没有通用精确映射 | 新增 `VITE_TEMPLATE_PREVIEW_RENDERERS`，按 `templateId@version` 选择 origin，并动态核验模板身份握手 |
| 首次登录出现通用服务器异常 | 已删除或无权访问的旧 `siteId` 会让工作区上下文初始化整体失败 | 仅在服务端明确返回 `Site not found in workspace` 时清除失效 siteId、保留工作区并重试；权限错误仍失败 |

## 实施结果

- 发布页明确区分 CMS 快照、Gateway 部署和公开站点；未绑定 Gateway 的站点不再显示“已发布”或公网打开入口。
- 内容页实例支持 `/uat-acceptance` 和 `/pages/uat-acceptance`；产品、API、预览等保留路径及真实路由冲突继续拒绝，失败发生在写入 Entry 之前。
- 页面 API 的区块配置包含 `labels`、`requiredSections` 和 `visual`，旧模板继续使用成熟的区块编辑器，契约模板使用可视化编辑器。
- 分析 API 在 Gateway 未配置时返回 `status: unconfigured`，不再伪造 0 访问量。
- CMS 预览支持精确多模板映射，握手校验 origin、iframe source、模板 ID 和模板版本；Docker 构建与 release workflow 已传递映射变量。
- 工作区上下文可恢复陈旧站点选择，并把非陈旧错误的处理保持为失败关闭。

## 回归结果

```text
backend: 191 passed, 0 failed, 16 skipped (207 total)
ui:       88 passed, 0 failed, 1 skipped (89 total)
storefront: 23 passed
FireGuard 1.0.0 renderer: 15 passed
AeroFrame 1.0.3 renderer: 15 passed
CMS UI type-check: passed
CMS UI production build: passed
CMS backend build:noEmit: passed
release deploy metadata tests: 15 passed, 4 live-only skipped
```

## 仍需生产环境完成

2026-11-04 只读复验仍显示：

```text
https://cms.novaintelligent.cn/                                     200
https://shop.novaintelligent.cn/                                    200
https://shop.novaintelligent.cn/.well-known/cms-domain-challenge    404
https://shop.novaintelligent.cn/products/uat-demo-extinguisher-20261103 404
```

首页仍由现有站点返回，说明 `shop.novaintelligent.cn` 尚未切换到 UAT site 的 Gateway
路由。代码修复不能替代以下外部配置：

1. 为 CMS site `d4bc972b-77ad-43ef-8b6c-89a0de564acf` 增加真实 Gateway
   workspace/site 绑定，并保留现有其他站点绑定。
2. 配置域名入口、HTTPS 证书和 `/.well-known/cms-domain-challenge`
   直通，返回 200 且不发生重定向。
3. 部署 FireGuard 1.0.0 和 AeroFrame 1.0.3 预览服务，将精确 origin 写入
   `VITE_TEMPLATE_PREVIEW_RENDERERS`，配置各自 CSP 与 CMS 管理端 origin。
4. 使用修复后的 CMS 镜像重新发布，待 Gateway 状态 ready 后验证首页、商品页、移动布局、SEO、询盘和统计。

在上述环境步骤完成前，UAT 的域名接入、主域名和公网内容用例仍不能判定通过。
