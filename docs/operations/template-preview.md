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

## 同版本草稿预览服务

生产环境优先使用[统一模板预览服务](./unified-template-preview.md)。下面的逐模板
origin 映射仅作为迁移期回退；统一服务解析成功后不再要求 CMS 为每个模板重新构建。

CMS 使用精确的正向映射选择草稿渲染器。构建变量
`VITE_TEMPLATE_PREVIEW_RENDERERS` 必须是 JSON 对象，键为
`templateId@version`，值为不含路径、凭据、查询和片段的规范 HTTP(S)
origin：

```dotenv
VITE_TEMPLATE_PREVIEW_RENDERERS='{"aeroframe@1.0.3":"https://aeroframe-preview.example.com","fireguard@1.0.0":"https://fireguard-preview.example.com"}'
```

使用统一预览服务时，无需配置逐模板映射；只需在后端设置
`STOREFRONT_PREVIEW_SERVICE_URL`，见[统一预览服务配置](./unified-template-preview.md)。

映射项缺失、JSON 无效、键缺少精确版本或 origin 带路径时，预览会失败关闭并显示配置错误，不会借用其他版本或其他行业的渲染器。`VITE_TEMPLATE_PREVIEW_ORIGIN`
仅保留为 AeroFrame 1.0.3 的旧配置兼容项；新模板和新版本应登记到映射中。

每个渲染器还需设置精确的 CMS 管理端 origin，并通过父窗口来源、iframe
来源、模板 ID 和模板版本四项握手校验。公开预览入口为
`<renderer-origin>/preview`，草稿只保存在 iframe 内存中。
