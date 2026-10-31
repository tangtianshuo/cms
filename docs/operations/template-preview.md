# 模板升级预览

模板安装完成后，目录中的新版本不会自动覆盖网站。管理员在模板页选择同一模板的新版本时，CMS 会先读取已验证的公开模板记录，并显示兼容性预览。

预览包含两类影响：

- **模板影响**：版本号、模板清单 checksum 和运行镜像 digest 的变化。
- **内容影响**：现有内容、页面路径、导航和主题设置是否保留，以及是否需要新建网站安装。

只有模型字段、页面路由和页面布局签名完全兼容时，预览才会显示可以保留现有内容。管理员仍需点击“采用此版本”明确确认。采用请求携带模板 ID、版本、清单 checksum 和当前网站版本号，服务端会再次校验公开 registry、已安装快照和并发版本；页面内容、内容 ID、导航和草稿不会被模板采用操作重建。

如果字段类型、必填状态、数组设置、引用模型或页面结构发生变化，预览会标记“需要新建网站安装”，采用按钮保持禁用。当前流程不执行隐式数据迁移，也不会把旧站点内容强行映射到新 schema。

模板清单、镜像 digest、已安装快照或公开记录被篡改时，预览和采用都会失败。采用过程使用版本比较和原子 CAS 更新；校验失败、网关发布仍在处理中或并发写入冲突时，旧模板版本和旧 release 保持不变。管理员刷新后可以重新预览，必要时继续使用旧版本发布或回滚。

旧版本的 manifest snapshot 和公开模板记录会随已安装站点保存，因此历史 release 仍能解析其原来的模板版本。升级只更新站点当前采用的模板元数据，不修改历史 release 的模板引用。

本地验证可运行：

```bash
cd backend
npm run build:noEmit
node -r ts-node/register -r tsconfig-paths/register --test src/presets/registry.test.ts src/presets/import.test.ts src/presets/installed.test.ts src/presets/publish-lifecycle.test.ts

cd ../ui
node --test test/template-upgrade.test.mjs
npm run type-check
```
