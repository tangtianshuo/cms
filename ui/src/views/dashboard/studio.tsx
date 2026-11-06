import { computed, defineComponent, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { StudioEntry, StudioModel, StudioState } from '../../sdk/handlers/studio';
import type { PageDraft } from '@bcms/selfhosted-backend/presets/pages';
import type { Media } from '@bcms/selfhosted-backend/media/models/main';
import { ContentWorkspace } from '../../components/studio/content-workspace';
import { contentEditorLocation, resolveEditorTarget, type EditorTarget } from '../../components/studio/editor-target';
import { ReleaseManager } from '../../components/storefront/release-manager';
import { userErrorMessage } from '../../util/user-message';
import '../../components/studio/studio.css';
import { StudioIcon } from '../../components/studio/icon';
import { studioSection, studioSections, studioModelLabel, siteSetupHref } from '../../layouts/dashboard/navigation';
import { MediaView } from './media';
import { settingsRequest } from '../../components/studio/settings-request';
import { siteImageOptions } from '../../components/studio/media-options';
import { SiteOperations } from '../../components/studio/site-operations';
import { PageCreateWizard, type PageBlueprintOption } from '../../components/studio/page-create-wizard';
function entryTitle(entry: StudioEntry) { return String((entry.fields.title as string[] | undefined)?.[0] || '未命名内容'); }
export const StudioView = defineComponent({
    setup() {
        const sdk = window.bcms.sdk; const route = useRoute(); const router = useRouter();
        const state = ref<StudioState>({ site: null, models: [] }); const media = ref<Media[]>([]);
        const loading = ref(true); const busy = ref(false); const error = ref(''); const notice = ref('');
        const editorTarget = ref<EditorTarget>(); const pageWizardOpen = ref(false); const modelKey = ref('product');
        const [language] = window.bcms.useLanguage();
        const settings = ref<any>({ name: '', background: '', foreground: '', accent: '', muted: '', navigation: [], operations: {} }); const settingsOriginal = ref('');
        const dirty = computed(() => JSON.stringify(settings.value) !== settingsOriginal.value);
        const currentSection = computed(() => studioSection(route.query.category === 'pages' && route.query.section === 'content' ? 'pages' : route.query.section));
        const sectionInfo = computed(() => studioSections.find(item => item.key === currentSection.value)!);
        const site = computed(() => state.value.site); const selectedModel = computed(() => state.value.models.find(item => item.key === modelKey.value));
        const contentSearch = ref(''); const pageSearch = ref('');
        const siteImages = computed(() => siteImageOptions(media.value, site.value?.id));
        const filteredEntries = computed(() => (selectedModel.value?.entries || []).filter(entry => `${entryTitle(entry)} ${String(entry.fields.slug || '')}`.toLowerCase().includes(contentSearch.value.trim().toLowerCase())));
        const filteredPages = computed(() => (site.value?.pages || []).filter(page => `${page.title} ${page.path}`.toLowerCase().includes(pageSearch.value.trim().toLowerCase())));
        function resetSettings() { const current = site.value; if (current) settings.value = { name: current.name, ...current.theme, navigation: JSON.parse(JSON.stringify(current.navigation || [])), operations: JSON.parse(JSON.stringify(current.operations)) }; settingsOriginal.value = JSON.stringify(settings.value); }
        let sequence = 0;
        async function refresh() {
            const generation = ++sequence; editorTarget.value = undefined; error.value = ''; loading.value = true;
            try {
                const context = await sdk.ensureContext();
                // Do not apply any query selector to the SDK. Existing selected context is authoritative.
                if ((route.query.workspaceId && route.query.workspaceId !== context.context.workspaceId) || (route.query.siteId && route.query.siteId !== context.context.siteId)) throw new Error('目标不属于当前网站，请先选择对应网站。');
                const loaded = await sdk.studio.getSite();
                const templates = await sdk.template.getAll(); const languages = await sdk.language.getAll();
                if (generation !== sequence) return;
                state.value = loaded;
                for (const template of templates.filter(item => !item.siteId && !loaded.models.some(model => model.templateId === item._id))) {
                    const permissions = context.context.templatePermissions?.find(grant => grant._id === template._id);
                    loaded.models.push({ key: template._id, label: template.label, templateId: template._id, singleEntry: template.singleEntry, canCreate: context.context.instanceAdmin || Boolean(permissions?.post), canEdit: context.context.instanceAdmin || Boolean(permissions?.put), fields: [], entries: [] });
                }
                modelKey.value = typeof route.query.modelKey === 'string' ? route.query.modelKey : loaded.models[0]?.key || '';
                const requestedModel = route.query.templateId ? loaded.models.find(model => model.templateId === route.query.templateId) : loaded.models.find(model => model.key === modelKey.value || model.templateId === modelKey.value);
                if (requestedModel) modelKey.value = requestedModel.key;
                const isTarget = Boolean(route.query.entryId || route.query.pageKey || route.query.intent || route.query.templateId || requestedModel?.singleEntry && route.query.modelKey);
                if (requestedModel && !loaded.site?.pages.some(page => page.modelKey === requestedModel.key) && !loaded.models.find(model => model.key === requestedModel.key)?.entries.length && !requestedModel.fields.length) {
                    const entries = await sdk.entry.getAllLiteByTemplateId({ templateId: requestedModel.templateId, skipCache: true });
                    requestedModel.entries = entries.map(entry => ({ id: entry._id, updatedAt: entry.updatedAt, hasLanguage: entry.info.some(info => info.lng === language.value), fields: { title: [entry.info.find(info => info.lng === language.value)?.title || '未命名内容'] } }));
                }
                if (isTarget) {
                    const query = { ...route.query };
                    if (!query.modelKey && !query.pageKey && requestedModel) query.modelKey = requestedModel.key;
                    const resolved = resolveEditorTarget(query, { workspaceId: context.context.workspaceId, siteId: context.context.siteId, language: loaded.site?.language || language.value, languages: languages.map(item => item.code), models: loaded.models, pages: loaded.site?.pages || [] });
                    if (resolved.entryId) {
                        const entry = await sdk.entry.get({ templateId: resolved.templateId, entryId: resolved.entryId, skipCache: true });
                        if (entry.siteId && entry.siteId !== context.context.siteId) throw new Error('目标内容不属于当前网站。');
                    }
                    if (generation !== sequence) return;
                    editorTarget.value = resolved;
                }
                resetSettings();
                media.value = (await sdk.media.getAll()).filter(item => ['IMG','SVG','GIF'].includes(item.type));
            } catch (cause) { if (generation === sequence) error.value = userErrorMessage(cause); }
            finally { if (generation === sequence) loading.value = false; }
        }
        function manageModel(key: string) { void router.push({ path: '/d/studio', query: { section: 'content', modelKey: key } }); }
        function openEntry(model: StudioModel, entry: StudioEntry | null, blueprint?: string) { const context = sdk.context?.context; if (!context) return; void router.push({ ...contentEditorLocation({ intent: entry ? 'edit' : 'create', workspaceId: context.workspaceId, siteId: context.siteId, templateId: model.templateId, modelKey: model.key, entryId: entry?.id || null, language: site.value?.language || language.value }), ...(blueprint ? { query: { ...contentEditorLocation({ intent: 'create', workspaceId: context.workspaceId, siteId: context.siteId, templateId: model.templateId, modelKey: model.key, entryId: null, language: site.value?.language || language.value }).query, blueprint } } : {}) }); }
        function openPage(page: PageDraft, panel?: 'page') { const model = state.value.models.find(model => model.key === page.modelKey); const bound = model?.entries.find(entry => entry.id === page.entryId) || (model?.singleEntry ? model.entries[0] : undefined); const context = sdk.context?.context; if (!context) return; const location = contentEditorLocation({ intent: bound ? 'edit' : 'page', workspaceId: context.workspaceId, siteId: context.siteId, templateId: model?.templateId || '', modelKey: model?.key, entryId: bound?.id || null, pageKey: page.key, language: site.value?.language || language.value }); if (panel) location.query.panel = panel; void router.push(location); }
        function createPage() { pageWizardOpen.value = true; }
        function createPageFromBlueprint(blueprint: PageBlueprintOption) { pageWizardOpen.value = false; const model = state.value.models.find(model => model.key === blueprint.modelKey); if (model) openEntry(model, null, blueprint.key); }
        async function saveSettings(event: Event) { event.preventDefault(); if (!site.value || busy.value) return; busy.value = true; error.value = ''; try { await sdk.studio.saveSettings(settingsRequest(site.value.updatedAt, settings.value)); await refresh(); notice.value = '网站设置已保存为草稿。'; } catch (cause) { error.value = userErrorMessage(cause); } finally { busy.value = false; } }
        watch(() => route.fullPath, refresh); onMounted(refresh);
        const emptyState = (title: string, detail: string) => <div class="studio-empty"><span class="studio-empty-icon"><StudioIcon name="pages" size={26} /></span><h3>{title}</h3><p>{detail}</p></div>;
        const listView = () => <>
            <div class="studio-list-toolbar"><label class="studio-search"><StudioIcon name="search" /><input type="search" aria-label="搜索商品与内容" placeholder="搜索名称或路径…" value={contentSearch.value} onInput={event => { contentSearch.value = (event.target as HTMLInputElement).value; }} /></label><span class="studio-help">共 {filteredEntries.value.length} 项</span></div>
            <div class="studio-card studio-table-card">{!selectedModel.value ? emptyState('没有可访问的内容模型', '请联系管理员分配内容权限。') : selectedModel.value.entries.length === 0 ? emptyState('还没有内容', '点击右上角「新增内容」，填写资料并保存第一份草稿。') : filteredEntries.value.length === 0 ? emptyState('没有匹配的内容', '尝试其他关键词，或清空搜索查看全部内容。') : <><div class="studio-table-heading"><span>内容名称</span><span>更新记录</span><span>操作</span></div><div class="studio-list">{filteredEntries.value.map(entry => <div class="studio-row studio-content-row"><div class="studio-content-name"><span class="studio-row-icon"><StudioIcon name={selectedModel.value?.key === 'product' ? 'products' : 'pages'} /></span><div><h3>{entryTitle(entry)}</h3><p>/{String((entry.fields.slug as string[] | undefined)?.[0] || '未设置路径')}</p></div></div><span class="studio-row-date">{new Date(entry.updatedAt).toLocaleString()}</span><button class="studio-row-action" onClick={() => openEntry(selectedModel.value!, entry)}>{selectedModel.value!.canEdit ? '编辑草稿' : '查看内容'}<StudioIcon name="arrow" size={14} /></button></div>)}</div></>}</div>
            <p class="studio-help">保存后使用右上角「发布更新」同步到网站。</p>
        </>;
        const pagesView = () => <>
            <div class="studio-list-toolbar"><span class="studio-help">共 {site.value?.pages.length || 0} 个页面</span><label class="studio-search"><StudioIcon name="search" /><input type="search" aria-label="搜索网站页面" placeholder="搜索页面名称或路径…" value={pageSearch.value} onInput={event => { pageSearch.value = (event.target as HTMLInputElement).value; }} /></label></div>
            <div class="studio-card studio-table-card"><div class="studio-table-heading studio-page-table-heading"><span>页面名称 / 访问路径</span><span>操作</span></div><div class="studio-list">{filteredPages.value.map(page => {
                const target = state.value.models.find(model => model.key === page.modelKey);
                const bound = target?.entries.find(entry => entry.id === page.entryId) || (target?.singleEntry ? target.entries[0] : undefined);
                return <div class="studio-row"><div class="studio-content-name"><span class="studio-row-icon"><StudioIcon name="pages" /></span><div><h3>{page.title} <span class={page.enabled === false ? 'studio-badge muted' : 'studio-badge'}>{page.enabled === false ? '已停用' : '草稿配置'}</span></h3><p>{page.path}</p></div></div><div class="studio-actions">{target && <button class="studio-row-action" onClick={() => bound ? openPage(page) : manageModel(target.key)}>{bound ? '编辑页面' : '管理内容'}</button>}{!bound && <button disabled={!site.value?.canManage} onClick={() => openPage(page, 'page')}>页面设置</button>}</div></div>;
            })}</div>{!filteredPages.value.length && emptyState('没有匹配的页面', '清空搜索，或创建一个新页面。')}</div>
        </>;
        const overview = () => <>
            <div class="studio-stats">{[
                { label: '网站页面', value: site.value!.pages.length, key: 'pages', icon: 'pages', detail: '管理页面内容' },
                { label: '商品', value: state.value.models.find(model => model.key === 'product')?.entries.length ?? '—', key: 'products', icon: 'products', detail: '管理商品资料' },
                { label: '可访问图片', value: media.value.length, key: 'media', icon: 'media', detail: '查看与复用素材' },
                { label: '内容分类', value: state.value.models.filter(model => !['home', 'content-page'].includes(model.key)).length, key: 'products', icon: 'pages', detail: '管理商品与品牌资料' },
            ].map(stat => <RouterLink class="studio-metric" to={{ path: '/d/studio', query: { section: stat.key } }}><span><StudioIcon name={stat.icon} size={17} />{stat.label}</span><strong>{stat.value}</strong><span class="studio-metric-footer">{stat.detail}<StudioIcon name="arrow" size={14} /></span></RouterLink>)}</div>
            <section class="studio-quick-section"><div class="studio-card-heading"><h2>常用操作</h2>{sdk.context?.context.admin ? <RouterLink class="studio-text-link" to={`${siteSetupHref}?new=1`}>创建新网站 →</RouterLink> : <span class="studio-help">从这里开始处理日常内容</span>}</div><div class="studio-quick-grid">
                <button class="studio-quick-card" disabled={!state.value.models.find(model => model.key === 'home')} onClick={() => { const target = state.value.models.find(model => model.key === 'home'); if (target) openEntry(target, target.entries[0] || null); }}><span class="studio-quick-icon"><StudioIcon name="overview" size={21} /></span><strong>编辑首页</strong><span>更新文案与主视觉</span></button>
                <button class="studio-quick-card" disabled={!state.value.models.find(model => model.key === 'product')?.canCreate} onClick={() => { const target = state.value.models.find(model => model.key === 'product'); if (target) openEntry(target, null); }}><span class="studio-quick-icon peach"><StudioIcon name="products" size={21} /></span><strong>新增商品</strong><span>填写资料，生成详情页</span></button>
                <button class="studio-quick-card" disabled={!site.value?.canManage || !site.value.blueprints.length} onClick={createPage}><span class="studio-quick-icon mint"><StudioIcon name="pages" size={21} /></span><strong>新增页面</strong><span>创建品牌与内容页面</span></button>
                <RouterLink class="studio-quick-card" to="/d/studio?section=media"><span class="studio-quick-icon"><StudioIcon name="media" size={21} /></span><strong>管理素材</strong><span>上传与复用内容图片</span></RouterLink>
            </div></section>
            <div class="studio-overview-grid"><section class="studio-card studio-recent-panel"><div class="studio-card-heading"><div><h2>最近编辑</h2><p class="studio-help">继续处理网站内容</p></div><RouterLink class="studio-text-link" to="/d/studio?section=products">全部内容 →</RouterLink></div><div class="studio-recent-heading"><span>内容名称</span><span>更新时间</span></div>{state.value.models.flatMap(model => model.entries.map(entry => ({ model, entry }))).sort((a, b) => b.entry.updatedAt - a.entry.updatedAt).slice(0, 5).map(({ model, entry }) => <button class="studio-recent-row" onClick={() => openEntry(model, entry)}><span class="studio-content-name"><span class="studio-row-icon"><StudioIcon name={model.key === 'product' ? 'products' : 'pages'} /></span><span><strong>{entryTitle(entry)}</strong><small>{studioModelLabel(model)}</small></span></span><span class="studio-recent-time">{new Date(entry.updatedAt).toLocaleDateString()}</span><StudioIcon name="chevron" size={14} /></button>)}{!state.value.models.some(model => model.entries.length) && emptyState('从第一条内容开始', '新增内容后，会在这里显示最近编辑记录。')}</section>
                <section class="studio-card studio-website-card"><div class="studio-card-heading"><h2>当前网站</h2><span class="studio-badge muted">已安装模板</span></div><a class="studio-website-preview" href="/d/presets/site-preview" target="_blank" rel="noopener"><span class="studio-site-monogram">{site.value!.name.slice(0, 1)}</span><span><StudioIcon name="external" size={14} />预览网站草稿</span></a><h3>{site.value!.name}</h3><p class="studio-help">{sdk.context?.workspace.name}</p><dl class="studio-details"><dt>内容语言</dt><dd>{site.value!.language}</dd><dt>管理权限</dt><dd>{site.value!.canManage ? '网站管理员' : '内容编辑者'}</dd></dl><RouterLink class="studio-button" to="/d/studio?section=settings">管理网站设置<StudioIcon name="arrow" size={14} /></RouterLink></section></div>

        </>;
        const settingsView = () => <div class="studio-settings-layout"><form id="studio-settings-form" class="studio-card studio-editor" onSubmit={saveSettings}><div class="studio-card-heading"><h2>基本信息与外观</h2><span class="studio-badge muted">保存为草稿</span></div><p class="studio-help">修改网站名称和模板支持的品牌颜色。</p><fieldset disabled={busy.value || !site.value?.canManage}><div class="studio-fields"><label>网站名称<input required maxlength={80} v-model={settings.value.name} /></label><div class="studio-color-grid">{(['background', 'foreground', 'accent', 'muted'] as const).map(key => <label>{({ background: '背景颜色', foreground: '文字颜色', accent: '强调颜色', muted: '弱化颜色' })[key]}<div class="studio-color"><input type="color" aria-label={`${key} 颜色选择器`} v-model={settings.value[key]} /><input required pattern="#[a-fA-F0-9]{6}" aria-label={`${key} 十六进制颜色`} v-model={settings.value[key]} /></div></label>)}</div><button type="button" onClick={() => { const home = site.value?.pages.find(page => page.layout === 'home'); if (home) openPage(home, 'page'); }}>编辑网站导航 →</button></div></fieldset>{!site.value?.canManage && <p class="studio-warning">网站设置需要管理员权限。</p>}</form><aside class="studio-card studio-settings-guide"><h2>网站管理</h2><p class="studio-help">资料与外观保存为草稿，通过右上角统一发布。</p><RouterLink class="studio-settings-link" to="/d/domains"><StudioIcon name="external" />域名与访问<StudioIcon name="chevron" size={14} /></RouterLink>{site.value?.canManage && <RouterLink class="studio-settings-link" to="/d/workspaces#workspace-members"><StudioIcon name="settings" />成员与权限<StudioIcon name="chevron" size={14} /></RouterLink>}<div class="studio-nav-divider" /><h3>搜索与分享</h3><label>搜索引擎标题<input maxlength={120} value={settings.value.operations.seoTitle} onInput={event => { settings.value.operations.seoTitle = (event.target as HTMLInputElement).value; }} /></label><label>搜索引擎描述<textarea maxlength={320} rows={3} value={settings.value.operations.seoDescription} onInput={event => { settings.value.operations.seoDescription = (event.target as HTMLTextAreaElement).value; }} /></label>{(['socialImage', 'favicon'] as const).map(key => <label>{key === 'socialImage' ? '社交分享图片' : '网站图标'}<select aria-label={key === 'socialImage' ? '社交分享图片' : '网站图标'} disabled={busy.value || !site.value?.canManage} value={settings.value.operations[key]?._id || ''} onChange={event => { const id = (event.target as HTMLSelectElement).value; settings.value.operations[key] = id ? { _id: id } : undefined; }}><option value="">未设置</option>{settings.value.operations[key]?._id && !media.value.some(item => item._id === settings.value.operations[key]?._id) && <option value={settings.value.operations[key]?._id}>原有图片（素材未加载）</option>}{siteImages.value.map(item => <option value={item._id}>{item.name}</option>)}</select></label>)}<label>统计工具 ID<input value={settings.value.operations.analyticsId || ""} onInput={event => { settings.value.operations.analyticsId = (event.target as HTMLInputElement).value.trim() || undefined; }} /></label><label class="studio-check"><input type="checkbox" disabled={busy.value || !site.value?.canManage || !site.value?.contactDeliveryConfigured} checked={settings.value.operations.contactFormEnabled} onChange={event => { settings.value.operations.contactFormEnabled = (event.target as HTMLInputElement).checked; }} />启用联系表单 <span class="studio-help">{site.value?.contactDeliveryConfigured ? '通过 Gateway 接收询盘' : '请先配置 Gateway 询盘服务'}</span></label><h3>品牌与联系信息</h3><p class="studio-help">更新品牌名称、联系邮箱及网站公告。</p><button onClick={() => manageModel('site-settings')}>编辑品牌与联系资料 →</button><details><summary>模板与高级配置</summary><p class="studio-help">模板 {site.value?.presetId} · {site.value?.presetVersion}<br />字体：{site.value?.theme.font}</p><RouterLink class="studio-text-link" to="/d/presets">模板安装与兼容性 →</RouterLink><RouterLink class="studio-text-link" to="/d/domains">域名与访问设置 →</RouterLink></details></aside></div>;
        const contentNavigation = () => <nav class="studio-content-tabs" aria-label="网站内容分类">
            <RouterLink class={{ active: currentSection.value === 'pages' }} aria-current={currentSection.value === 'pages' ? 'page' : undefined} to="/d/studio?section=pages">页面</RouterLink>
            {state.value.models.filter(model => !['home', 'content-page'].includes(model.key)).map(model => <RouterLink key={model.key} class={{ active: currentSection.value === 'products' && modelKey.value === model.key }} aria-current={currentSection.value === 'products' && modelKey.value === model.key ? 'page' : undefined} to={{ path: '/d/studio', query: { section: 'products', modelKey: model.key } }}>{studioModelLabel(model)}</RouterLink>)}
        </nav>;
        return () => editorTarget.value ? <ContentWorkspace key={`${editorTarget.value.intent}:${editorTarget.value.templateId}:${editorTarget.value.entryId}:${editorTarget.value.pageKey}:${editorTarget.value.language}`} target={editorTarget.value} /> : <div class="cms-studio">
            <header class="studio-header"><div><p class="studio-eyebrow">{sectionInfo.value.eyebrow}</p><h1>{sectionInfo.value.label}</h1><p class="studio-subtitle">{sectionInfo.value.description}</p></div><div class="studio-actions">
                {currentSection.value === 'products' && !selectedModel.value?.singleEntry && <button class="primary" disabled={!selectedModel.value?.canCreate} onClick={() => selectedModel.value && openEntry(selectedModel.value, null)}>新增{selectedModel.value ? studioModelLabel(selectedModel.value) : '内容'}</button>}
                {currentSection.value === 'pages' && <button class="primary" disabled={!site.value?.canManage || !site.value.blueprints.length} onClick={createPage}>新增页面</button>}
                {currentSection.value === 'settings' && <button class="primary" type="submit" form="studio-settings-form" disabled={!dirty.value || busy.value || !site.value?.canManage}>保存设置草稿</button>}
            </div></header>
            {error.value && <div role="alert" class="studio-error"><strong>操作未完成</strong><p>{error.value}</p></div>}{notice.value && <p role="status" class="studio-success">{notice.value}</p>}
            {loading.value ? <div role="status" class="studio-card studio-empty">正在读取当前网站内容…</div> : <>
                <PageCreateWizard open={pageWizardOpen.value} blueprints={(site.value?.blueprints || []) as PageBlueprintOption[]} disabled={busy.value || !site.value?.canManage} onCreate={createPageFromBlueprint} onClose={() => { pageWizardOpen.value = false; }} />
                {['products','pages'].includes(currentSection.value) && contentNavigation()}
                {currentSection.value === 'overview' ? site.value ? overview() : emptyState('开始搭建你的网站', '请选择网站或创建网站。')
                : currentSection.value === 'operations' ? <SiteOperations />
                : currentSection.value === 'products' ? listView()
                : currentSection.value === 'pages' ? pagesView()
                : currentSection.value === 'media' ? <MediaView />
                : currentSection.value === 'settings' ? settingsView()
                : site.value?.canManage ? <ReleaseManager onSaved={refresh} /> : emptyState('发布需要网站管理员权限','请管理员检查并发布。')}
            </>}
        </div>;
    },
});
export default StudioView;
