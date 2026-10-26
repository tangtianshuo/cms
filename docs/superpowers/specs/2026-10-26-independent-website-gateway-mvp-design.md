# Independent Website Gateway 单机 MVP 设计

**状态：** 待用户审阅  
**日期：** 2026-10-26  
**目标仓库：** `https://github.com/tangtianshuo/Independent-Website-Gateway`  
**本地目录：** `D:\Projects\Nova\Independent-Website-Gateway`

## 目标与范围

构建一个单机部署的独立站网关 MVP。CMS 通过服务身份认证调用 Gateway API，提交不可变站点 Release、配置域名并创建发布操作。Gateway 持久化期望状态，部署 worker 运行指定模板镜像、验证候选站点并完成流量切换；站点访问不依赖 CMS 在线。

开发环境为 Windows Docker Desktop，生产环境为 Linux Docker。两者共享应用/API/数据库契约和 Compose 服务拓扑；Docker 网络、文件挂载、权限隔离、域名和 ACME 验收以 Linux 为最终生产基准。MVP 是单主机，不承诺多主机调度、高可用集群或自动灾备。

首期包含：Next.js App Router 控制 API、PostgreSQL、独立部署 worker、Traefik 入口、Release 快照接收与校验、站点容器发布/健康检查/切流/失败保留旧版本、多个域名绑定、ACME HTTP-01 证书签发与续期。

首期不包含：多主机调度、任意用户代码上传、订单/支付/会员、CMS 草稿公开预览、DNS-01、通配符证书、用户上传私钥、模板自动升级、平台公共模板目录。模板镜像以经批准的不可变 digest 引用。

## 服务边界

- **Next.js API：** 只负责 CMS 服务 API、身份和请求校验、持久化操作与状态查询。不得访问 Docker Socket。
- **PostgreSQL：** 保存站点/workspace 绑定、模板身份、Release 元数据、域名验证与证书状态、幂等发布操作、期望状态、活动版本和路由修订号。Release 媒体/快照字节存放在 Gateway 管理的持久卷中；数据库记录其地址和校验值。
- **部署 worker：** 独立容器，通过最小权限的 Docker 控制通道管理站点容器。校验镜像 digest allowlist 和站点隔离参数，拉取/启动候选实例、准备 Release、执行健康探测，成功后请求路由变更。CMS、Next.js、Traefik 和站点容器均不挂载 Docker Socket。
- **Traefik：** 作为唯一公网入口，终止 HTTPS，并按已验证 Host 转发到活动站点实例。未知 Host fail closed；不信任客户端提供的站点身份头。HTTP-01 challenge 由 ACME 处理，80/443 端口须对公网开放。
- **站点容器：** 每个站点运行经批准的模板镜像，使用站点级凭据读取本地已发布快照；不得获得其他站点数据、CMS 管理凭据或基础设施秘密。

逻辑服务可在一台主机运行，但以不同容器、网络、凭据和权限隔离。worker 使用 Docker Socket 是单机 MVP 的高权限信任边界；其 API 不对 CMS 或公网开放，并通过镜像 allowlist、固定 digest、资源限制、网络策略和最小化 Docker 操作面降低风险。若无法落实这些限制，不得启用生产发布。

## 核心契约与数据流

### 身份与隔离

CMS 到 Gateway 的请求使用独立的服务身份凭据，凭据只存服务端环境/secret store，不交给浏览器。每个请求均从认证身份取得 workspace，而不是信任请求 body 中的 workspace ID。所有站点、Release、域名、操作和媒体查询均按 workspace/site 约束。跨 workspace ID、伪造 Host 或重复域名绑定不得访问/改变其他租户状态。

### Release 接收

CMS 推送不可变 Release 快照及元数据，至少包含 `siteId`、`releaseId`、内容 checksum、模板 `id/version`、manifest checksum、镜像 digest 和所需媒体清单。Gateway 校验 CMS 身份、站点归属、canonical checksum、模板身份与允许的 digest 格式；对同一 `siteId + releaseId` 只接受完全相同内容，重复请求幂等，内容不同则拒绝。快照写入持久卷时先写临时对象并验证字节 checksum，再原子登记为可用。此阶段不允许 public route 读取草稿或不完整快照。

### 发布与切流

发布请求包含幂等 operation key 和预期活动修订号。Gateway 在数据库事务中校验 revision、记录 operation 与 desired state；同一 key 重放返回原 operation，不同并发 revision 冲突。worker 对指定的已批准镜像 digest 启动候选站点并准备快照，使用分配给该站点的 Host 执行 readiness 与代表性页面探测。仅在候选容器、Release 数据和 Host 检查全部通过后更新活动 tuple `(siteId, imageDigest, releaseId, routeRevision)` 并使路由指向候选实例。确认新路由可用后再进入 ready，过期实例在回滚保留期后清理。

首次发布失败时站点不公开；升级失败时不改变旧活动 tuple。切流失败时恢复旧路由并保留旧实例。操作状态至少包含 `pending`、`ready`、`failed`，失败状态包含可供运维定位的安全错误码/原因，不回显秘密。worker 重启后按数据库 desired state 与实际容器/路由状态协调。显式 rollback 只能指向仍保留且兼容的历史活动 tuple，并再次通过健康检查。

### 域名、DNS 与 TLS

CMS 可为一个站点提交多个 hostname，包括 apex 和子域名。Gateway 规范化 hostname、全局唯一保留，避免大小写/尾随点/IDN 表示绕过冲突检查。域名先进入 pending 状态，不因 CMS 提交即对公网路由。

本 MVP 采用 ACME HTTP-01。CMS 展示需要设置的 DNS 目标及验证状态；每个 hostname 必须解析到该 Gateway 公网入口，且公网 80/443 可达。Gateway 通过 HTTP-01 成功签发并安装证书后才允许 HTTPS 路由激活。多个域名分别校验和签发；HTTP-01 不支持 wildcard，因此首期不支持 `*.example.com` 证书。域名配置或证书签发失败不会改变已有站点活动路由；证书续期失败告警并保留可用域名状态，运维需在到期前处理。删除/替换域名需先确认替代活动 Host 或用户明确解除绑定，避免误删仍在服务的唯一路由。

ACME staging 环境用于开发和自动化测试；生产 issuer、邮箱、rate-limit 策略通过部署配置提供。Windows Docker Desktop 主要验证 API、worker 生命周期和本地路由；公网 DNS 与真实证书签发只能在有可达公网入口的 Linux/受控测试环境验收，不声称可在普通 Windows 本机完整验证 HTTP-01。

## API 与配置边界

Next.js Route Handlers 提供版本化 `/api/v1` CMS 服务接口，最小资源为站点分配、Release 上传/查询、域名添加/验证状态、发布操作创建/查询和回滚。健康探针分开提供 liveness 与 readiness；readiness 检查数据库与必要持久卷，不泄漏配置或凭据。部署 worker 使用内部队列/数据库操作领取持久化操作，避免依赖易丢失的进程内队列。

配置通过环境变量/部署 secrets 提供，包括数据库连接、CMS 服务身份校验配置、镜像 allowlist/registry 读取配置、公开入口域名、ACME issuer/email、持久卷路径和资源限制。不得把长期 registry 写凭据或 Docker 管理接口暴露给 CMS。公开 GHCR 镜像可匿名拉取；部署身份只需按实际仓库策略读取镜像。

## 验证与验收

- 单元/集成测试验证 workspace 越权拒绝、Release checksum 与不可变冲突、operation 幂等/并发 revision 冲突、hostname 规范化与全局唯一、活动 tuple 只有在 readiness 成功后变化。
- 使用 PostgreSQL 集成环境验证事务和 worker 重启后的 operation 恢复，不用 SQLite 替代生产数据库语义。
- 使用本地测试模板镜像和 Traefik 验证首次发布、内容 Release 更新、模板 digest 显式升级、失败升级保留旧站点、显式回滚及未知 Host fail closed。
- Compose 配置扫描确认 Docker Socket 只出现在 worker；CMS/API、Traefik 和站点容器均无 Socket 挂载。验证站点容器之间网络隔离、CPU/内存限制和站点身份隔离。
- Windows Docker Desktop 跑开发 smoke tests；Linux Docker 上执行生产 Compose 验收，包括公网 HTTP-01 staging 签发/续期演练、多个域名绑定、容器重启协调、数据库/快照备份恢复与路由回滚。
- MVP 不满足生产可用条件，直至 Linux 单主机上的公网域名/TLS、备份恢复、容量限制、主机故障恢复及失败切流演练全部通过。

## 已确认的决定与待实现边界

- 用户选择 Next.js，可使用既有 CMS 的 TypeScript 生态；具体 Next.js/Node 版本、ORM/迁移工具和测试工具在实现计划中按仓库兼容性确定。
- 状态库选择 PostgreSQL；入口选择 Traefik；CMS 推送 Release；证书使用 ACME HTTP-01。
- Gateway、worker、Traefik 和 PostgreSQL 同仓 Compose 部署，但运行权限隔离。
- 模板仓库许可证已由用户选择 MIT；该许可证需在模板仓库单独落实，不影响本 Gateway 规格。
- 本规格不代表远端仓库已经发布、生产服务已经部署、真实域名已经验证或任何镜像已经推送。
