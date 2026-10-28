# CMS UI/UX 与原型统一验收

日期：2026-10-28。本次在现有 codex/cms-studio-p0 工作区实施，保留未提交的 P0 工作。

## 备份与范围

优化前源码备份：`/Users/445101599qq.com/Projects/cms-backups/ui-unification-20261028-104604/cms-source.tar.gz`。

1516 个非忽略文件；排除环境配置、.npmrc、.DS_Store。SHA256：`03ec435874fbc7e622291419bdfb3d68ad11983ecd8c19851afc160f97b4eca4`。已核对归档内容。

依据已批准的 `ui/prototype` 和 `design-system/cms-studio/MASTER.md`，应用 UI/UX Pro Max 的布局、交互、可访问性与 Vue 指导。保留原型和 MASTER。新增实际应用约定于 `design-system/cms-studio/pages/application.md`。

完成全局设计令牌、侧栏、顶栏、移动抽屉、分层导航、默认入口，Studio 全部日常页面，原有高级页面与完整编辑器、认证框架及共享控件的样式统一。保留原服务调用、权限过滤、草稿与发布机制。与备份逐文件比较：本次修改 43 个已有 UI 文件，新增主题、图标、导航及导航测试；后端和 storefront 源码未在本次 UI 工作中修改。`product-preview.tsx`、`storefront/app/pages/preview.vue`、MASTER 与备份字节一致。

## 自动检查

在 `ui` 目录运行：

| 检查 | 结果 |
| --- | --- |
| `npm run build`（包含 vue-tsc） | 通过，exit 0 |
| `node --test test/*.test.mjs` | 32 通过，0 失败，1 跳过 |
| 新增导航行为测试 | 3 通过，覆盖旧 content 链接、非法 query、深层路由和路径边界 |
| `git diff --check` | 通过 |

跳过项为需要指定 Docker 管理服务的 CSP 环境测试。已有 Sass 除法、Browserslist、Tailwind 配置和 bundle 体积警告仍存在。仓库没有 npm test 脚本，使用现有 Node 测试入口。

## 浏览器操作验收

实际 CMS：`http://127.0.0.1:8086/d/studio?section=overview`，本地隔离数据库、Studio 本地验收工作区、FORM Studio 站点。沿用既有验收内容，未重置账号或安装模板。

| 场景 | 实际结果 |
| --- | --- |
| 工作台和导航 | 真实 5 页面、2 商品、0 可访问图片、5 模型；日常操作与高级能力分别可达 |
| 商品搜索 | Lamp 匹配 1 项；无匹配显示空结果；清空恢复 2 项 |
| 编辑与保存 | 修改商品描述后顶部保存按钮生效；刷新重进确认持久化；随后恢复原描述并保存 |
| 页面设置 | 名称、固定路径提示、SEO、绑定内容、区块上下移、导航选项正常呈现 |
| 网站设置 | 名称、四个模板颜色、草稿保存提示和品牌内容入口呈现一致 |
| 发布中心 | 真实校验通过，返回 7 个页面路径和导航变化；未执行发布 |
| 模板与预览 | 模板 iframe 正常加载；整站草稿预览显示已保存的真实品牌、首页和商品描述 |
| 完整编辑器 | 真实条目和富文本可加载；保留语言、分组、状态、更新与预览操作 |
| 完整列表 | 原虚拟表格显示 2 条记录；窄屏页面无横向溢出 |
| 高级管理 | 工作区、域名、资源共享、模型列表、空分组、空组件、空密钥和媒体管理可打开 |
| 弹窗 | 添加用户与媒体上传的统一弹窗正常呈现；背景隔离，键盘焦点留在弹窗，Escape 关闭；键盘触发时返回触发按钮 |
| 手机抽屉 | 背景隔离；Escape 关闭并返回展开按钮；导航后收起 |
| 响应式 | 工作台 320/375/768/1024/1440 宽度无页面横向溢出；375 完整编辑器和表格无页面横向溢出 |
| 深色模式 | 工作台表面、文字、边框和主操作适配；已切回浅色 |

手机完整编辑器旧 utility 曾让操作栏强制纵向排列，已移除冲突并浏览器复验；375px 宽度操作栏高度为 128px。最终浏览器已恢复原视口并停留在工作台。

## 环境说明与边界

本地验收入口原先缺少完整编辑器所需控制器。补充被 Git 忽略的 `.superpowers/sdd/cms-studio-p0/studio-dev.ts`，挂载实际受保护的分组、共享、域名、备份、密钥与模板组织服务，并复用既有隔离数据库；不涉及产品后端代码变更。启动本地 Nuxt 展示服务以验收 iframe。

本轮未创建用户、变更权限、上传文件、修改域名、执行发布/回滚或部署；这些能力复用已有逻辑。本轮浏览器以本地管理员验收主要流程，并非所有角色、所有 CRUD 和所有浏览器的穷举验收。内置 AeroFrame 1.0.0 仍显示“展示预览”能力说明，模板版本能力边界沿用 P0 实现。

## 截图证据

目录：`docs/verification/evidence/2026-10-28-cms-ui-unification/`。

- workbench-desktop.png、workbench-mobile.png、workbench-dark.png
- content-editor.png、full-editor-desktop.png、full-editor-mobile.png
- content-models.png、entries-desktop.png
- site-settings.png、media-upload-modal.png
- templates.png、saved-preview.png、release-check.png
