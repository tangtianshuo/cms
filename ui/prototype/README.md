# CMS Studio 操作简化原型

在 `ui` 目录运行：

```sh
npm run dev -- --port 5174
```

打开 `http://localhost:5174/prototype/`。

独立打包（无需构建正式 CMS）：

```sh
./node_modules/.bin/vue-tsc --noEmit -p prototype/tsconfig.json
./node_modules/.bin/vite build --config prototype/vite.config.ts
```

构建结果位于 `deliverables/cms-studio-prototype/`，可交给任意静态文件服务器运行。所有字体、插画和脚本已包含，无需访问外部 CDN。

原型独立于正式应用入口，无需登录，不调用业务接口。编辑、站点和发布快照保存在当前浏览器的 `cms-studio-prototype-v1` localStorage 中。上传图片保留在本次页面会话，已绑定到内容的图片随草稿保存在浏览器。左下角可重置所有演示内容。

推荐体验：

1. 概览 → 编辑首页 → 改展示标题、替换图片 → 保存草稿 → 预览草稿（桌面/手机）→ 发布修改 → 检查 → 确认 → 查看网站。
2. 网站页面 → 新增页面 → 填名称和正文 → 路径自动生成 → 保存 → 预览与发布。
3. 新增商品 → 只填名称 → 保存 → 发布检查 → 点击价格或简介问题 → 补全 → 保存 → 重新检查与发布。
4. 左上角切换站点，观察内容和发布快照相互独立；创建新站点后按概览中的建站清单操作。
5. 修改表单后切换页面，体验保存草稿、放弃修改、继续编辑三个分支。

发布为模拟行为。域名、模板和高级设置用于呈现操作逻辑，不连接部署、DNS 或交易服务。

## SaaS 重构版（v2）

UI/UX Pro Max 已安装在 `/Users/445101599qq.com/.codex/skills/ui-ux-pro-max`，采用浅色 SaaS 工作台风格。全局设计规则保存在 `design-system/cms-studio/MASTER.md`。

本机预览：新版 `http://127.0.0.1:5175/`，旧版对照 `http://127.0.0.1:5176/`。地址依赖本地静态服务器运行。

旧版源码、静态页面、截图、校验清单及恢复说明：`deliverables/cms-studio-prototype-v1-backup-20261027/`。新版构建不会覆盖该备份。
