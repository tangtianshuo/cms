# 公开模板 → CMS 编辑 → 独立站发布验收

验收日期：2026-10-27。结果：当前单站点的公开模板采用、内容编辑、UI 发布、状态轮询、失败保留旧站及重复发布流程已完成真实服务器验证。

## 使用入口

- CMS：https://cms.novaintelligent.cn/d/presets
- 独立站：https://shop.novaintelligent.cn/
- 模板发布：https://github.com/tangtianshuo/Independent-Website-Templates/releases/tag/aeroframe-v1.0.1
- 在 CMS 的“工作区与站点”选择 Nova Intelligent，进入“独立站模版”。当前已采用公开 AeroFrame 1.0.1。
- 在建站清单打开对应内容编辑器，修改后点“更新”；页面草稿修改点“保存”。返回“发布独立站”，依次点“校验待发布内容”“发布新版本”，等待“发布成功”后访问站点。
- CMS 登录沿用现有管理员账号。密码保存在受保护的本机配置和服务器文件中，本文不包含密码或 Token。
- 公开的是模板源码、镜像和站点访问；这不等于已提供面向他人的自助注册、多租户托管服务。

## 精确版本

| 组件 | 已部署/已发布版本 |
| --- | --- |
| CMS 应用源码 | `ae325530f4960561bec83908a7dba0ef4c702977` |
| Gateway 应用源码 | `efc9509d0324e657f9c44d23f4d44e13f87aca50` |
| 模板源码/tag | `cad64f168c6167c01250992d147c27c6c7fb1639` / `aeroframe-v1.0.1` |
| 模板版本 | `aeroframe@1.0.1` |
| Manifest checksum | `sha256:cd9903e8adde04efc229c015d1ec16ba9e8fdda896c4b1e28ea0d95e3d421fb8` |
| 镜像 | `ghcr.io/tangtianshuo/independent-website-templates/aeroframe@sha256:931b7e38882216deda60ac4060a9b76bbfb782426a1317c7b842727f0931a80a` |

三个仓库的实现保存在各自 `codex/public-template-flow` 分支。未合并默认分支。模板发布 tag 固定在发布源码 commit，后续文档提交不移动 tag。

部署项目为 `/opt/novaintelligent/deploy` 的 `nova-cms-validation`。最终应用镜像为 `novaintelligent/cms:ae32553`、`novaintelligent/gateway:efc9509`。源码归档位于服务器 `/opt/novaintelligent/sources`。

## 实际验收

1. GitHub workflow `40436497040` 首次发布和第二次重跑均成功；重跑复用已有 digest，公开 registry 未覆盖版本。签名 provenance、发布后精确 digest smoke 与匿名读取检查通过。服务器使用空 Docker 配置匿名拉取公开镜像成功。
2. CMS 的真实公开 catalog 返回 AeroFrame 1.0.1。通过浏览器“采用 v1.0.1”升级。5 个模型的 ID/字段映射、页面、站点名称、主题及所有 Entry 均保持一致。内容 hash 见 `roundtrip-adoption.json`。
3. 通过浏览器将首页 Headline 从 `Built for the missions ahead` 改为 `Nova Intelligent. Built for the missions ahead.`，保存并从 CMS UI 校验/发布。状态轮询到 ready，浏览器公网首页显示新标题。修订号自动从 1 变为 2。
4. 将 worker 注入给候选容器的控制地址临时改为未监听的本机端口，重新从 CMS UI 发布。操作在 revision 3 失败，错误 `CANDIDATE_UNHEALTHY`。活动 Release 与首页 HTML SHA-256 均保持原值；旧站继续 200。随后恢复 worker 配置，重启后的路由恢复正常。
5. 通过浏览器恢复原首页 Headline，再次保存、校验、发布。最终 revision 4 为 ready。与验收前内容逐项比较，除 `updatedAt` 保存时间戳外一致。
6. 对最终请求重放同一个 requestKey，返回相同 Release/operation，未重复发布。四个公开页面 `/`、`/collections`、`/products/featured-product`、`/pages/about` 均通过 HTTPS 返回 200。浏览器确认最终文案恢复。
7. 最终 CMS、Gateway control、Mongo、PostgreSQL 健康；worker、relay、sidecar 运行。已有 sub2api 及其 PostgreSQL/Redis 健康，根站与 CMS HTTPS 均返回 200。

| 尝试 | Revision | Operation | Release | 结果 |
| --- | --- | --- | --- | --- |
| 首次公开模板发布 | 2 | `dc251513-ea37-4e42-be16-4a89be4f8b96` | `32ad643b-f5f4-43b9-b1df-417601b8d25f` | ready |
| 错误候选地址 | 3 | `8c64ac32-8ebe-49d5-8b1f-bfd2e176677a` | `d0cd4707-3859-4622-a50e-78a75d1c5970` | failed，旧站保持 |
| 恢复文案后发布 | 4 | `716d8610-2707-4a2f-bd74-800e27c7ea35` | `07b1ea4b-6865-497b-bbd5-dd5c084e6ac1` | ready |

## 测试与修复证据

- Gateway：真实 PostgreSQL 18、全部四项 migration；control 73、contracts 2、worker 58，共 133 测试通过，零跳过。类型检查通过。
- CMS 最终后端：65 测试通过，1 项原有本地 Mongo/HTTP integration 未运行；部署后的真实 API/浏览器流程另行完成。类型检查通过。
- CMS UI：稳定发布请求标识 3 测试通过；类型检查及 production build 通过。服务器最终镜像构建成功。
- Templates：27 测试通过，1.0.1 镜像/渲染 smoke、Nuxt 测试与构建通过；两次真实 CI 执行成功。
- Gitleaks：Templates 历史与发布源码扫描无发现；CMS 三项实现提交和 Gateway 实现提交无发现。不是完整安全审计。
- 真联调修复了 registry manifest URL 重复拼接 commit 的问题，已用不同 registry/source commit 的精确 URL 回归测试覆盖。
- CMS 连续 CAS 保存同步实际 DB 时间戳；发布意图冻结快照字节与镜像身份；显式 revision 冲突允许新操作恢复；采用新模板版本后可开始新发布。
- Gateway 修复了租约到期前后切流保护、Docker pull 绝对超时、public pin NULL 降级绕过和 manifest 结构校验。
- Python urllib 的公网请求曾被 Cloudflare 返回 403；浏览器与标准 curl 对四条页面路径均验证为 200。该结果不代表所有自动化客户端均可无条件通过 Cloudflare。

## 运维边界和后续工作

这是 Cloudflare Full(strict) 下的单站点 Linux 公网试运行。以下尚未完成，不能据此宣称全面生产验收：

- 自动 DNS 归属验证、通用多站点/多域名配置、独立生产入口与证书自动化；当前继续使用已有 Nginx/Origin CA 和精确 Host 转发。
- 异地自动备份、恢复演练、容量/压力测试和告警；当前更新前备份仅在同一台主机：`/opt/novaintelligent/backups/public-template-20261027T022520Z`。
- Gateway 历史版本回滚 UI、旧容器保留/清理策略、故障节点替代；当前 worker 与路由同进程、单机部署。
- 草稿预览服务尚未部署；内容编辑器的旧预览入口不属于本次可用性验收。当前通过校验和正式发布后访问验证。
- 只允许固定可信模板仓库和 AeroFrame schema1；通用模板 schema 迁移与自助站点开通不在此实现中。
- 站点保留演示商品、性能指标、示例邮箱和图片；对外商业使用前应换成真实、可核实内容，并确认媒体授权和稳定存储。当前仍保留 noindex 验证配置。
- 模板依赖审计的 node-forge 高风险项位于构建工具链，当前无可用修复版；已确认不在最终 `.output` 运行时产物内，仍应跟踪上游。其余应用依赖需要独立生产安全评估。

`acceptance.py` 仅通过受保护管理员文件登录并保存验收结果；`failure-check.py` 是受控故障验收脚本，不能作为日常启动步骤。`deploy-update.py` 记录本次首次迁移/部署过程；后续运行前应根据当前镜像重新审核。不要执行 `docker compose down -v`。任何 `.env`、管理员文件和数据库备份均不得提交到仓库。
