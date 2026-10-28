# CMS Studio SaaS 原型重构验证

日期：2026-10-28。范围：`ui/prototype/` 独立 Vue 3 原型，静态构建写入 `deliverables/cms-studio-prototype/`。

## 安装与备份

- UI/UX Pro Max 已安装到 `/Users/445101599qq.com/.codex/skills/ui-ux-pro-max`。
- 官方仓库 `nextlevelbuilder/ui-ux-pro-max-skill`，版本固定为 `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`；安装时验证 73 个文件的 Git blob SHA-1。
- 重构前保存 `deliverables/cms-studio-prototype-v1-backup-20261027/`，包含原始源码、静态构建、原始截图及计划，共 25 个原始文件。
- 最终交付前重新通过 manifest SHA-256 校验，并生成同名 ZIP。备份目录位于构建输出外，重新构建不会清除。
- 备份不含浏览器个人 localStorage 数据；重构沿用原有存储键和结构，原页面仍保留两项初始待发布修改。

## 构建

以下命令通过：

```sh
./ui/node_modules/.bin/vue-tsc --noEmit -p ui/prototype/tsconfig.json
./ui/node_modules/.bin/vite build --config ui/prototype/vite.config.ts
```

最终构建 18 个模块，CSS 45.21 kB（gzip 9.43 kB），JS 110.51 kB（gzip 42.26 kB），字体和插画均本地打包。

## 浏览器验证

通过 Codex 内置浏览器实际操作，流程测试使用 `localhost:5175` 的独立存储，交付使用原始 `127.0.0.1:5175`。

- 工作台进入首页编辑；清空名称保存，字段旁出现错误并聚焦名称框。
- 修改展示标题，离开编辑触发保存/放弃/留在这里提示；弹窗 Shift+Tab 从首按钮循环至末按钮。
- 保存草稿、选择素材、预览草稿，预览展示最新标题和图片；手机预览切为 390px，按钮 aria-pressed 更新。
- 前往发布，自动检查通过，二次确认、模拟进度和成功反馈正常；线上快照显示新标题。
- 新增商品仅填写名称后保存，发布检查列出缺简介和有效价格两个问题；点击价格问题后焦点位于 `field-price`。
- 补全商品价格和简介后检查通过；刷新后商品草稿仍在。
- 手机导航展开与关闭正常；遮罩不覆盖侧栏的点击区，关闭后保持原页面。
- 手机创建站点向导可填写名称、选择模板并创建；工作台展示上线清单，首页可编辑。
- 工作台在 320、375、768、1024、1440px 均无横向溢出；发布页也在这些尺寸检查，375px 编辑页及创建向导无横向溢出。
- 原页面控制台无 error/warn。新版 5175 和旧版 5176 均返回 HTTP 200。

## 视觉与可访问性

主按钮白字/蓝底对比度 5.17:1；次级正文/白底 5.58:1；正文/页面背景 15.20:1；成功、警示、错误文字对比度分别为 5.36、5.34、6.05:1。

添加键盘跳转、当前导航 aria-current、移动菜单展开状态、字段关联错误、弹窗焦点循环与恢复、隐藏移动导航退出键盘序列。保留减少动态效果规则；未进行完整屏幕阅读器或系统文字缩放专项审计。

截图：
- `deliverables/cms-studio-prototype-v2-review/overview-desktop.png`
- `deliverables/cms-studio-prototype-v2-review/editor-desktop.png`
- `deliverables/cms-studio-prototype-v2-review/overview-mobile.png`

发布、域名、模板均为本地交互演示，不调用真实部署或交易服务。
