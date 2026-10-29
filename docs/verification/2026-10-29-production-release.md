# 2026-10-29 生产发布记录

三个仓库均已快进合并到 `master` 并推送远端，三个 master CI 全部通过。随后按 Gateway → Templates → CMS 顺序，从这些提交创建版本发布分支，完成镜像上传、来源证明核验及生产交付。

| 组件 | 版本 | 发布提交 | 成功流水线 |
| --- | --- | --- | --- |
| Gateway | 1.0.1 | `dcbdd2f041c4e0284974cef074a3c17dff0233fb` | [40804008944](https://github.com/tangtianshuo/Independent-Website-Gateway/actions/runs/40804008944) |
| AeroFrame | 1.0.3 | `615959b01136a5aab8628a9588ccf59961c35c45` | [40804585125](https://github.com/tangtianshuo/Independent-Website-Templates/actions/runs/40804585125) |
| CMS | 1.0.3 | `fe6cd2da73810058b2bb6c854d8b8c17805c76e4` | [40804981944](https://github.com/tangtianshuo/cms/actions/runs/40804981944) |

每个发布分支与对应 master 验证提交一致。本文及证据文件属于发布后的审计文档，不改变上述生产镜像的源码提交。

## 服务器交付证据

三个发布任务均返回 `Release delivered <component> <version> <commit>`，版本和提交与上表一致。Gateway 和 CMS 已生成发布前备份；Gateway 的生产迁移检查成功，CMS 的 `cms-gateway-proxy` 已随 CMS 替换而重建并达到 healthy。

| 组件 | 不可变镜像摘要 | 发布前备份 |
| --- | --- | --- |
| Gateway | `sha256:3c62bfb7c2f520145a6a1383a13243a2832a73df6a425e2a6e4b406f12fd8254` | `/opt/novaintelligent/backups/release-gateway-20261029T020654639772Z` |
| AeroFrame | `sha256:42fb56a3f1cc20b4d141d16ce454d4fb128f3bd00b3b5461cdf5c4a89e15e5f4` | 镜像同步，不修改站点数据 |
| CMS | `sha256:b46a37ff90f824ababb9043e5f90e7025ca1ce0a9c6398223833a8665616a5dc` | `/opt/novaintelligent/backups/release-cms-20261029T021820000256Z` |

证据来自成功的 GitHub Actions job、服务器受限部署命令输出和外部 HTTPS 请求。未通过独立管理 SSH 读取服务器状态文件；JSON 中的服务器 receipt 路径按部署脚本约定记录。

## 模板公开登记

AeroFrame 1.0.3 的来源证明、匿名镜像拉取和候选镜像冒烟测试通过，镜像已同步到生产服务器。registry 提交为 `e47062a167fd6d5653646d96e21b5ef4c44c76fb`，1.0.3 状态为 `available`，source commit 和 image digest 与发布一致，规范化 manifest checksum 为 `sha256:1e122ce48c81e8a7438ab2b6148031b9109060ba1b97d7e4491ca4780ca240e6`。

独立复核确认原 1.0.1、1.0.2 记录未改变，公开 raw registry 的字节与该 Git 提交一致。发布流程只登记并同步模板，没有自动改变现有站点采用的模板版本。

## 公网复核

2026-10-29 10:20（Asia/Shanghai）完成最终检查，正常 HTTPS 校验开启：

- CMS 首页、`/d/studio` 页面入口和 `HEAD /api/v4/health-check` 均为 200。
- 商城首页、`/collections`、`/products/featured-product`、`/pages/about` 均为 200。
- 公网主脚本 `index-83b232b7.js` 与发布镜像构建输出一致，完整下载成功，包含 `/d/studio` 和 `StudioView`。
- Studio JS 和 CSS 发布资源可下载，文件名与镜像构建输出一致。

该检查证明页面入口、健康接口和静态资源可用；没有在生产执行新的内容发布、模板采用或回滚操作。业务发布、草稿隔离、失败保护及恢复场景的先行本地验收见 [诊断与复验记录](2026-10-29-template-registry-diagnostics.md)。

## 保留边界

生产镜像构建时 `VITE_TEMPLATE_PREVIEW_ORIGIN` 和 `VITE_STOREFRONT_ORIGIN` 均为空，因此独立的私有预览暂未启用。启用前仍需配置与 1.0.3 匹配的预览 renderer、独立 HTTPS 域名和精确 origin/CSP；不将现有旧版商城地址作为替代预览。

此前间歇性 `invalid_template` 的原始触发原因仍未确认。本次发布包含分阶段诊断及错误分类改进，不能据此宣称原始根因已修复。

## 机器可读证据

- [发布回执及 master CI](evidence/2026-10-29-production-release/release-receipts.json)
- [公开 registry 核验](evidence/2026-10-29-production-release/templates-registry.json)
- [最终公网及资源检查](evidence/2026-10-29-production-release/public-checks.json)

原始 Actions 日志保存在本地忽略目录 `.superpowers/sdd/production-release-20261029/`，未提交凭据或完整运行环境。
