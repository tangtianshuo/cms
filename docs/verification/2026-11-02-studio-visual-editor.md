# Studio 可视化编辑器验证

日期：2026-11-02

本轮完成 P3.2/P3.3 的 Studio 页面编辑闭环：

- 顶部显示页面标题、脏状态、预览、发布和错误摘要。
- 左栏显示当前页面、区块树和导航树；中栏连接同版本模板 `/preview` 渲染器；右栏编辑区块 JSON 与 SEO。
- 页面创建继续使用 `/api/v4/studio/pages` 的幂等服务端事务，统一创建 Entry、页面和绑定关系。
- 页面设置保存时，导航树变更会按最新站点版本写回设置；页面和设置分别发生冲突时沿用现有错误摘要和刷新策略。
- 属性、SEO 和导航修改会覆盖预览 payload，通过 `postMessage` 刷新渲染器，不写入公开发布路由。
- 预览消息只接受精确 origin、iframe source、page key、node identity 和 template identity。
- 320px 及以上布局增加横向溢出保护，三栏在 1024px 以下折叠为两行，767px 以下堆叠为单列。

验证结果：

```text
npm run type-check --prefix ui                         PASS
npm run build-only --prefix ui                        PASS
node --test ui/test/*.test.mjs                        79 PASS, 1 SKIP
npm run typecheck --prefix storefront                 PASS
npm test --prefix storefront                           23 PASS
node --test -r ts-node/register -r tsconfig-paths/register \
  backend/src/storefront/preset-preview.test.ts       5 PASS
node ops/e2e/runtime.mjs status                        healthy isolated stack
node ops/e2e/test.mjs quality-gate                    PASS
```

后端既有 `pages.test.ts`/`releases.test.ts` 中的旧版 Studio fixture 仍会触发 `Invalid info grid`、缺少旧版必填区块等失败；这些 fixture 与本轮 UI、预览协议和 Gateway 质量门禁无关，已在既有验证记录中单独标注。
