import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRoute, useRouter } from 'vue-router';
import type { StudioEntry, StudioModel, StudioState } from '../../sdk/handlers/studio';
import type { StudioValue } from '@bcms/selfhosted-backend/studio/business';
import type { PageDraft } from '@bcms/selfhosted-backend/presets/pages';
import type { Media } from '@bcms/selfhosted-backend/media/models/main';
import { StudioFields } from '../../components/studio/fields';
import { ReleaseManager } from '../../components/storefront/release-manager';
import { userErrorMessage } from '../../util/user-message';
import '../../components/studio/studio.css';
import { StudioIcon } from '../../components/studio/icon';
import { studioSection, studioSections } from '../../layouts/dashboard/navigation';

type Section = 'overview' | 'products' | 'pages' | 'media' | 'settings' | 'release';
const sections = studioSections;
function entryTitle(entry: StudioEntry) { return String((entry.fields.title as string[] | undefined)?.[0] || '未命名内容'); }
export const StudioView = defineComponent({
    setup() {
        const sdk = window.bcms.sdk;
        const route = useRoute();
        const router = useRouter();
        const state = ref<StudioState>({ site: null, models: [] });
        const media = ref<Media[]>([]);
        const loading = ref(true);
        const busy = ref(false);
        const error = ref('');
        const notice = ref('');
        const mediaError = ref('');
        const modelKey = ref('product');
        const editor = ref<{ modelKey: string; entry: StudioEntry | null; operationId: string; newPage?: boolean }>();
        const values = ref<Record<string, StudioValue>>({});
        const original = ref('');
        const pageEditor = ref<PageDraft>();
        const pageTitle = ref('');
        const pagePath = ref('');
        const settings = ref({ name: '', background: '', foreground: '', accent: '', muted: '' });
        const settingsOriginal = ref('');
        const currentSection = computed<Section>(() => studioSection(route.query.section));
        const sectionInfo = computed(() => sections.find(item => item.key === currentSection.value)!);
        const contentSearch = ref('');
        const pageSearch = ref('');
        const filteredEntries = computed(() => (selectedModel.value?.entries || []).filter(entry => `${entryTitle(entry)} ${String(entry.fields.slug || '')}`.toLowerCase().includes(contentSearch.value.trim().toLowerCase())));
        const filteredPages = computed(() => (site.value?.pages || []).filter(page => `${page.title} ${page.path}`.toLowerCase().includes(pageSearch.value.trim().toLowerCase())));
        const site = computed(() => state.value.site);
        const selectedModel = computed(() => state.value.models.find(item => item.key === modelKey.value));
        const activeModel = computed(() => state.value.models.find(item => item.key === editor.value?.modelKey));
        const snapshot = () => JSON.stringify({ values: values.value, page: pageEditor.value, title: pageTitle.value, path: pagePath.value });
        const dirty = computed(() => (Boolean(editor.value || pageEditor.value) && snapshot() !== original.value) || (currentSection.value === 'settings' && JSON.stringify(settings.value) !== settingsOriginal.value));
        function canLeave() { return !busy.value && (!dirty.value || window.confirm('有尚未保存的修改。确定放弃这些修改吗？')); }
        function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; } }
        onBeforeRouteLeave(() => canLeave());
        onBeforeRouteUpdate(() => { if (!canLeave()) return false; editor.value = undefined; pageEditor.value = undefined; error.value = ''; });
        onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
        function resetSettings() {
            const current = state.value.site;
            if (current) settings.value = { name: current.name, background: current.theme.background, foreground: current.theme.foreground, accent: current.theme.accent, muted: current.theme.muted };
            settingsOriginal.value = JSON.stringify(settings.value);
        }
        async function loadMedia() {
            mediaError.value = '';
            try { media.value = (await sdk.media.getAll({ skipCache: true })).filter(item => ['IMG', 'SVG', 'GIF'].includes(item.type)); }
            catch (cause) { mediaError.value = userErrorMessage(cause); }
        }
        async function refresh() {
            state.value = await sdk.studio.getSite();
            resetSettings();
            if (!selectedModel.value && state.value.models[0]) modelKey.value = state.value.models[0].key;
        }
        async function run(action: () => Promise<void>) {
            if (busy.value) return;
            busy.value = true; error.value = ''; notice.value = '';
            try { await action(); }
            catch (cause) { error.value = userErrorMessage(cause); }
            finally { busy.value = false; }
        }
        async function reload() {
            if (!canLeave()) return;
            editor.value = undefined; pageEditor.value = undefined;
            await run(async () => { await refresh(); await loadMedia(); notice.value = '已刷新当前网站内容。'; });
        }
        function manageModel(key: string) { if (!canLeave()) return; modelKey.value = key; void router.push({ path: '/d/studio', query: { section: 'products' } }); }
        function selectModel(key: string) { if (!canLeave()) return; modelKey.value = key; contentSearch.value = ''; editor.value = undefined; pageEditor.value = undefined; }
        function openEntry(target: StudioModel, entry: StudioEntry | null, newPage = false) {
            if (!canLeave()) return;
            editor.value = { modelKey: target.key, entry, operationId: crypto.randomUUID(), newPage };
            pageEditor.value = undefined; error.value = ''; notice.value = '';
            values.value = {};
            for (const field of target.fields) {
                const raw = entry?.fields[field.key];
                if (field.type === 'MEDIA' || field.type === 'ENTRY_POINTER') values.value[field.key] = JSON.parse(JSON.stringify(Array.isArray(raw) ? raw : [])) as StudioValue;
                else if (field.editable) values.value[field.key] = Array.isArray(raw) && raw[0] !== undefined ? raw[0] as StudioValue : field.type === 'BOOLEAN' ? false : '';
                else if (!entry && field.type === 'RICH_TEXT') values.value[field.key] = '';
            }
            if (!entry && target.key === 'site-settings') { values.value.title = 'Site settings'; values.value.slug = 'settings'; }
            if (!entry && target.key === 'home') { values.value.title = 'Home'; values.value.slug = 'home'; }
            pageTitle.value = ''; pagePath.value = '/'; original.value = snapshot();
        }
        function openPage(page: PageDraft) {
            if (!canLeave()) return;
            editor.value = undefined; values.value = {}; pageTitle.value = ''; pagePath.value = '';
            pageEditor.value = JSON.parse(JSON.stringify(page)); original.value = snapshot(); error.value = ''; notice.value = '';
        }
        function closeEditor() { if (!canLeave()) return; editor.value = undefined; pageEditor.value = undefined; error.value = ''; }
        function applyDeepLink() {
            const requestedModel = typeof route.query.modelKey === 'string' ? route.query.modelKey : '';
            const requestedEntry = typeof route.query.entryId === 'string' ? route.query.entryId : '';
            const requestedPage = typeof route.query.pageKey === 'string' ? route.query.pageKey : '';
            if (requestedPage) {
                const page = site.value?.pages.find(page => page.key === requestedPage);
                if (page) openPage(page);
                else error.value = '目标页面不存在，或当前网站没有此页面。';
                return;
            }
            if (!requestedModel) return;
            const target = state.value.models.find(model => model.key === requestedModel);
            if (!target) { error.value = '目标内容模型不存在，或你没有访问权限。'; return; }
            modelKey.value = target.key;
            if (requestedEntry) {
                const entry = target.entries.find(entry => entry.id === requestedEntry);
                if (entry) {
                    openEntry(target, entry);
                    if (typeof route.query.field === 'string') void nextTick(() => { const control = document.getElementById(`studio-field-${route.query.field}`); control?.scrollIntoView({ block: 'center' }); control?.focus(); });
                }
                else error.value = '目标内容不存在，或你没有访问权限。';
            }
        }
        watch(error, async message => { if (message) { await nextTick(); const summary = document.getElementById('studio-error-summary'); summary?.focus(); summary?.scrollIntoView({ block: 'center' }); } });
        watch(() => route.fullPath, () => { if (!loading.value) applyDeepLink(); });
        async function saveEntry(event: Event) {
            event.preventDefault();
            const current = editor.value; const target = activeModel.value; const installed = site.value;
            if (!current || !target || !installed) return;
            const oldValues = JSON.parse(original.value).values as Record<string, StudioValue>;
            const changes = Object.fromEntries(Object.entries(values.value).filter(([key, value]) => !current.entry || JSON.stringify(value) !== JSON.stringify(oldValues[key])));
            await run(async () => {
                if (current.newPage) {
                    const blueprint = installed.blueprints.find(item => item.modelKey === target.key);
                    if (!blueprint) throw new Error('当前模板不支持创建此类页面。');
                    await sdk.studio.createPage({ operationId: current.operationId, expectedUpdatedAt: installed.updatedAt, title: pageTitle.value,
                        path: pagePath.value, blueprintKey: blueprint.key, fields: changes });
                } else {
                    await sdk.studio.saveEntry(target.key, { entryId: current.entry?.id, operationId: current.operationId,
                        expectedUpdatedAt: current.entry?.updatedAt, fields: changes });
                }
                editor.value = undefined; pageEditor.value = undefined; await refresh(); notice.value = '草稿已保存。预览检查后，请到发布中心发布。';
            });
        }
        async function savePage(event: Event) {
            event.preventDefault();
            const page = pageEditor.value; const installed = site.value;
            if (!page || !installed) return;
            await run(async () => {
                await sdk.studio.savePage(page.key, { expectedUpdatedAt: installed.updatedAt, title: page.title, path: page.path, seoTitle: page.seoTitle,
                    seoDescription: page.seoDescription, sections: page.sections, entryId: page.entryId, enabled: page.enabled !== false, navigation: page.navigation !== false });
                pageEditor.value = undefined; await refresh(); notice.value = '页面草稿已保存，线上版本将在发布后更新。';
            });
        }
        async function saveSettings(event: Event) {
            event.preventDefault(); if (!site.value) return;
            await run(async () => {
                const { name, ...theme } = settings.value;
                await sdk.studio.saveSettings({ expectedUpdatedAt: site.value!.updatedAt, name, theme });
                await refresh(); notice.value = '网站设置已保存为草稿。';
            });
        }
        onMounted(async () => {
            window.addEventListener('beforeunload', beforeUnload);
            try { await refresh(); await loadMedia(); applyDeepLink(); }
            catch (cause) { error.value = userErrorMessage(cause); }
            finally { loading.value = false; }
        });
        const previewLink = () => <a class="studio-button" href="/d/presets/site-preview" target="_blank" rel="noopener">预览已保存草稿 ↗</a>;
        const entryEditor = () => {
            const current = editor.value!; const target = activeModel.value!;
            const editable = current.entry ? target.canEdit && current.entry.hasLanguage : target.canCreate;
            return <form id="studio-entry-form" onSubmit={saveEntry} class="studio-card studio-editor"><div class="studio-card-heading"><div><p class="studio-eyebrow">{current.newPage ? '新增网站页面' : target.label}</p><h2>基本资料</h2></div><span class="studio-badge muted">{current.entry ? '编辑草稿' : '新增内容'}</span></div>
                <p class="studio-help">当前内容语言：{site.value?.language}。保存后预览确认，再前往发布中心更新网站。</p>
                {current.entry && <RouterLink class="studio-text-link" to={`/d/template/${target.templateId}/entry/${current.entry.id}`}>打开完整编辑器 →</RouterLink>}
                {!editable && <p role="status" class="studio-warning">当前内容没有此语言版本，或你没有编辑权限。请联系管理员或使用完整编辑器。</p>}
                {current.newPage && <div class="studio-fields"><label>页面名称<input required maxlength={120} value={pageTitle.value} disabled={busy.value} onInput={event => { pageTitle.value = (event.target as HTMLInputElement).value; }} /></label><label>页面路径<input required pattern="/[a-z0-9-]+(/[a-z0-9-]+)*" value={pagePath.value} disabled={busy.value} onInput={event => { pagePath.value = (event.target as HTMLInputElement).value; }} /><span class="studio-help">例如 /shipping-policy。页面会绑定本次创建的内容。</span></label></div>}
                <StudioFields model={target} models={state.value.models} values={values.value} media={media.value} isNew={!current.entry} disabled={busy.value || !editable} onChange={(key, value) => { values.value = { ...values.value, [key]: value }; }} />
                {mediaError.value && <p class="studio-warning">素材加载失败：{mediaError.value}。未修改的素材引用将保留。</p>}
                <div class="studio-actions"><button class="primary" type="submit" disabled={busy.value || !editable || (Boolean(current.entry) && !dirty.value)}>{busy.value ? '正在保存…' : '保存草稿'}</button>{previewLink()}<span class="studio-help">{dirty.value ? '有未保存的修改' : '修改后保存'}</span></div>
            </form>;
        };
        const pageForm = () => {
            const page = pageEditor.value!; const options = site.value?.pageOptions[page.key];
            const canBind = page.layout === 'home' || Boolean(page.blueprintKey);
            return <form id="studio-page-form" class="studio-card studio-editor" onSubmit={savePage}><div class="studio-card-heading"><h2>页面资料</h2><span class="studio-badge muted">页面草稿</span></div><fieldset disabled={busy.value || !site.value?.canManage}>
                <div class="studio-fields"><label>页面名称<input required maxlength={120} v-model={page.title} /></label><label>访问路径<input required v-model={page.path} readonly={page.path === '/' || page.path.includes(':')} /><span class="studio-help">主页和动态页面路径由模板固定。</span></label><label>SEO 标题<input maxlength={120} v-model={page.seoTitle} /></label><label>SEO 描述<textarea maxlength={320} rows={3} v-model={page.seoDescription} /></label>
                    {canBind && <label>绑定内容<select v-model={page.entryId}><option value="">{page.blueprintKey ? '请选择内容' : '使用默认主页内容'}</option>{state.value.models.find(model => model.key === page.modelKey)?.entries.map(entry => <option value={entry.id}>{entryTitle(entry)}</option>)}</select></label>}
                    <div><span class="studio-label">页面区块（按当前顺序）</span><div class="studio-section-order">{page.sections.map((name, index) => <div><span>{name}</span><button type="button" aria-label={`上移 ${name}`} disabled={index === 0} onClick={() => { const copy = [...page.sections]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; page.sections = copy; }}>上移</button><button type="button" aria-label={`下移 ${name}`} disabled={index === page.sections.length - 1} onClick={() => { const copy = [...page.sections]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; page.sections = copy; }}>下移</button><button type="button" disabled={name === options?.required} onClick={() => { page.sections = page.sections.filter(section => section !== name); }}>移除</button></div>)}</div>{options?.allowed.filter(name => !page.sections.includes(name)).map(name => <button type="button" onClick={() => { page.sections = [...page.sections, name]; }}>添加 {name}</button>)}</div>
                    <label class="studio-check"><input type="checkbox" disabled={page.layout === 'home'} checked={page.enabled !== false} onChange={event => { page.enabled = (event.target as HTMLInputElement).checked; }} />启用页面</label><label class="studio-check"><input type="checkbox" checked={page.navigation !== false} onChange={event => { page.navigation = (event.target as HTMLInputElement).checked; }} />加入导航</label>
                </div><div class="studio-actions"><button type="submit" class="primary" disabled={!dirty.value || busy.value}>保存页面草稿</button>{previewLink()}</div></fieldset></form>;
        };
        function createPage() {
            const blueprint = site.value?.blueprints[0];
            const target = state.value.models.find(model => model.key === blueprint?.modelKey);
            if (target) openEntry(target, null, true);
        }
        const stepper = () => <ol class="studio-editor-flow" aria-label="内容更新流程">{['编辑内容', '保存草稿', '预览确认', '检查并发布'].map((label, index) => <li class={{ current: index === 0 }}><b>{index + 1}</b><span>{label}</span></li>)}</ol>;
        const emptyState = (title: string, detail: string) => <div class="studio-empty"><span class="studio-empty-icon"><StudioIcon name="pages" size={26} /></span><h3>{title}</h3><p>{detail}</p></div>;
        const listView = () => <>
            <div class="studio-list-toolbar"><div class="studio-model-control"><label for="studio-model">内容类型</label><select id="studio-model" value={modelKey.value} disabled={busy.value} onChange={event => selectModel((event.target as HTMLSelectElement).value)}>{state.value.models.map(model => <option value={model.key}>{model.label}</option>)}</select></div><label class="studio-search"><StudioIcon name="search" /><input type="search" aria-label="搜索商品与内容" placeholder="搜索名称或路径…" value={contentSearch.value} onInput={event => { contentSearch.value = (event.target as HTMLInputElement).value; }} /></label><span class="studio-help">共 {filteredEntries.value.length} 项</span></div>
            <div class="studio-card studio-table-card">{!selectedModel.value ? emptyState('没有可访问的内容模型', '请联系管理员分配内容权限。') : selectedModel.value.entries.length === 0 ? emptyState('还没有内容', '点击右上角「新增内容」，填写资料并保存第一份草稿。') : filteredEntries.value.length === 0 ? emptyState('没有匹配的内容', '尝试其他关键词，或清空搜索查看全部内容。') : <><div class="studio-table-heading"><span>内容名称</span><span>更新记录</span><span>操作</span></div><div class="studio-list">{filteredEntries.value.map(entry => <div class="studio-row studio-content-row"><div class="studio-content-name"><span class="studio-row-icon"><StudioIcon name={selectedModel.value?.key === 'product' ? 'products' : 'pages'} /></span><div><h3>{entryTitle(entry)}</h3><p>/{String((entry.fields.slug as string[] | undefined)?.[0] || '未设置路径')}</p></div></div><span class="studio-row-date">{new Date(entry.updatedAt).toLocaleString()}</span><button class="studio-row-action" onClick={() => openEntry(selectedModel.value!, entry)}>{selectedModel.value!.canEdit ? '编辑草稿' : '查看内容'}<StudioIcon name="arrow" size={14} /></button></div>)}</div></>}</div>
            <p class="studio-help">保存只更新草稿。确认内容后，通过发布中心更新网站。</p>
        </>;
        const pagesView = () => <>
            <div class="studio-list-toolbar"><span class="studio-help">共 {site.value?.pages.length || 0} 个页面</span><label class="studio-search"><StudioIcon name="search" /><input type="search" aria-label="搜索网站页面" placeholder="搜索页面名称或路径…" value={pageSearch.value} onInput={event => { pageSearch.value = (event.target as HTMLInputElement).value; }} /></label></div>
            <div class="studio-card studio-table-card"><div class="studio-table-heading studio-page-table-heading"><span>页面名称 / 访问路径</span><span>操作</span></div><div class="studio-list">{filteredPages.value.map(page => {
                const target = state.value.models.find(model => model.key === page.modelKey);
                const bound = target?.entries.find(entry => entry.id === page.entryId) || (target?.singleEntry ? target.entries[0] : undefined);
                return <div class="studio-row"><div class="studio-content-name"><span class="studio-row-icon"><StudioIcon name="pages" /></span><div><h3>{page.title} <span class={page.enabled === false ? 'studio-badge muted' : 'studio-badge'}>{page.enabled === false ? '已停用' : '草稿配置'}</span></h3><p>{page.path}</p></div></div><div class="studio-actions">{target && <button class="studio-row-action" onClick={() => bound ? openEntry(target, bound) : manageModel(target.key)}>{bound ? '编辑内容' : '管理内容'}</button>}<button disabled={!site.value?.canManage} onClick={() => openPage(page)}>页面设置</button></div></div>;
            })}</div>{!filteredPages.value.length && emptyState('没有匹配的页面', '清空搜索，或创建一个新页面。')}</div>
        </>;
        const overview = () => <>
            <div class="studio-stats">{[
                { label: '网站页面', value: site.value!.pages.length, key: 'pages', icon: 'pages', detail: '管理页面内容' },
                { label: '商品', value: state.value.models.find(model => model.key === 'product')?.entries.length ?? '—', key: 'products', icon: 'products', detail: '管理商品资料' },
                { label: '可访问图片', value: media.value.length, key: 'media', icon: 'media', detail: '查看与复用素材' },
                { label: '内容模型', value: state.value.models.length, key: 'products', icon: 'release', detail: '管理全部网站内容' },
            ].map(stat => <RouterLink class="studio-metric" to={{ path: '/d/studio', query: { section: stat.key } }}><span><StudioIcon name={stat.icon} size={17} />{stat.label}</span><strong>{stat.value}</strong><span class="studio-metric-footer">{stat.detail}<StudioIcon name="arrow" size={14} /></span></RouterLink>)}</div>
            <div class="studio-release-banner"><span class="studio-banner-icon"><StudioIcon name="release" size={24} /></span><div><h2>每一次更新，从草稿开始</h2><p>编辑并保存内容，预览确认后，在发布中心检查和发布。</p></div><RouterLink class="studio-button" to="/d/studio?section=release">检查并发布<StudioIcon name="arrow" size={14} /></RouterLink></div>
            <section class="studio-quick-section"><div class="studio-card-heading"><h2>常用操作</h2><span class="studio-help">从这里开始处理日常内容</span></div><div class="studio-quick-grid">
                <button class="studio-quick-card" disabled={!state.value.models.find(model => model.key === 'home')} onClick={() => { const target = state.value.models.find(model => model.key === 'home'); if (target) openEntry(target, target.entries[0] || null); }}><span class="studio-quick-icon"><StudioIcon name="overview" size={21} /></span><strong>编辑首页</strong><span>更新文案与主视觉</span></button>
                <button class="studio-quick-card" disabled={!state.value.models.find(model => model.key === 'product')?.canCreate} onClick={() => { const target = state.value.models.find(model => model.key === 'product'); if (target) openEntry(target, null); }}><span class="studio-quick-icon peach"><StudioIcon name="products" size={21} /></span><strong>新增商品</strong><span>填写资料，生成详情页</span></button>
                <button class="studio-quick-card" disabled={!site.value?.canManage || !site.value.blueprints.length} onClick={createPage}><span class="studio-quick-icon mint"><StudioIcon name="pages" size={21} /></span><strong>新增页面</strong><span>创建品牌与内容页面</span></button>
                <RouterLink class="studio-quick-card" to="/d/studio?section=media"><span class="studio-quick-icon"><StudioIcon name="media" size={21} /></span><strong>管理素材</strong><span>上传与复用内容图片</span></RouterLink>
            </div></section>
            <div class="studio-overview-grid"><section class="studio-card studio-recent-panel"><div class="studio-card-heading"><div><h2>最近编辑</h2><p class="studio-help">继续处理网站内容</p></div><RouterLink class="studio-text-link" to="/d/studio?section=products">全部内容 →</RouterLink></div><div class="studio-recent-heading"><span>内容名称</span><span>更新时间</span></div>{state.value.models.flatMap(model => model.entries.map(entry => ({ model, entry }))).sort((a, b) => b.entry.updatedAt - a.entry.updatedAt).slice(0, 5).map(({ model, entry }) => <button class="studio-recent-row" onClick={() => openEntry(model, entry)}><span class="studio-content-name"><span class="studio-row-icon"><StudioIcon name={model.key === 'product' ? 'products' : 'pages'} /></span><span><strong>{entryTitle(entry)}</strong><small>{model.label}</small></span></span><span class="studio-recent-time">{new Date(entry.updatedAt).toLocaleDateString()}</span><StudioIcon name="chevron" size={14} /></button>)}{!state.value.models.some(model => model.entries.length) && emptyState('从第一条内容开始', '新增内容后，会在这里显示最近编辑记录。')}</section>
                <section class="studio-card studio-website-card"><div class="studio-card-heading"><h2>当前网站</h2><span class="studio-badge muted">已安装模板</span></div><a class="studio-website-preview" href="/d/presets/site-preview" target="_blank" rel="noopener"><span class="studio-site-monogram">{site.value!.name.slice(0, 1)}</span><span><StudioIcon name="external" size={14} />预览网站草稿</span></a><h3>{site.value!.name}</h3><p class="studio-help">{sdk.context?.workspace.name}</p><dl class="studio-details"><dt>当前模板</dt><dd>{site.value!.presetId}</dd><dt>模板版本</dt><dd>{site.value!.presetVersion}</dd><dt>内容语言</dt><dd>{site.value!.language}</dd><dt>管理权限</dt><dd>{site.value!.canManage ? '网站管理员' : '内容编辑者'}</dd></dl><RouterLink class="studio-button" to="/d/studio?section=settings">管理网站设置<StudioIcon name="arrow" size={14} /></RouterLink></section></div>
            <section class="studio-flow-summary" aria-label="内容更新流程"><strong>内容更新流程</strong>{['编辑内容', '保存草稿', '预览确认', '检查并发布'].map((label, index) => <span><b>{index + 1}</b>{label}</span>)}<RouterLink class="studio-text-link" to="/d/studio?section=release">前往发布中心 →</RouterLink></section>
        </>;
        const settingsView = () => <div class="studio-settings-layout"><form id="studio-settings-form" class="studio-card studio-editor" onSubmit={saveSettings}><div class="studio-card-heading"><h2>基本信息与外观</h2><span class="studio-badge muted">保存为草稿</span></div><p class="studio-help">修改网站名称和模板支持的品牌颜色。</p><fieldset disabled={busy.value || !site.value?.canManage}><div class="studio-fields"><label>网站名称<input required maxlength={80} v-model={settings.value.name} /></label><div class="studio-color-grid">{(['background', 'foreground', 'accent', 'muted'] as const).map(key => <label>{({ background: '背景颜色', foreground: '文字颜色', accent: '强调颜色', muted: '弱化颜色' })[key]}<div class="studio-color"><input type="color" aria-label={`${key} 颜色选择器`} v-model={settings.value[key]} /><input required pattern="#[a-fA-F0-9]{6}" aria-label={`${key} 十六进制颜色`} v-model={settings.value[key]} /></div></label>)}</div></div><div class="studio-actions"><button class="primary" type="submit" disabled={!dirty.value || busy.value}>{busy.value ? '正在保存…' : '保存设置草稿'}</button>{previewLink()}</div></fieldset>{!site.value?.canManage && <p class="studio-warning">网站设置需要管理员权限。</p>}</form><aside class="studio-card studio-settings-guide"><h2>让更新有序生效</h2><p class="studio-help">这里的修改会先保存为草稿。预览确认后，通过发布中心更新网站。</p><div class="studio-nav-divider" /><h3>品牌与联系信息</h3><p class="studio-help">在「商品与内容」的 Site settings 模型中维护。</p><button onClick={() => manageModel('site-settings')}>编辑品牌内容 →</button><details><summary>模板与高级配置</summary><p class="studio-help">模板 {site.value?.presetId} · {site.value?.presetVersion}<br />字体：{site.value?.theme.font}</p><RouterLink class="studio-text-link" to="/d/presets">模板安装与兼容性 →</RouterLink><RouterLink class="studio-text-link" to="/d/domains">域名与访问设置 →</RouterLink></details></aside></div>;
        return () => <div class="cms-studio">
            <header class="studio-header"><div>{(editor.value || pageEditor.value) && <button class="studio-back" type="button" disabled={busy.value} onClick={closeEditor}>← 返回{sectionInfo.value.label}</button>}<p class="studio-eyebrow">{editor.value || pageEditor.value ? 'CONTENT EDITOR' : sectionInfo.value.eyebrow}</p><h1>{editor.value ? editor.value.newPage ? '新增网站页面' : editor.value.entry ? entryTitle(editor.value.entry) : activeModel.value?.key === 'product' ? '新增商品' : '新增内容' : pageEditor.value ? pageEditor.value.title : sectionInfo.value.label}</h1><p class="studio-subtitle">{editor.value || pageEditor.value ? '编辑完成后保存草稿，预览确认，再更新网站。' : currentSection.value === 'overview' ? `欢迎回来，${sdk.store.user.methods.me()?.username || '内容编辑者'}。${sectionInfo.value.description}` : sectionInfo.value.description}</p></div>
                <div class="studio-actions">{editor.value || pageEditor.value ? <><span class="studio-save-state">{busy.value ? '正在保存…' : dirty.value ? '有未保存的修改' : '草稿编辑'}</span>{previewLink()}<button class="primary" type="submit" form={editor.value ? 'studio-entry-form' : 'studio-page-form'} disabled={busy.value || !dirty.value || (editor.value ? editor.value.entry ? !activeModel.value?.canEdit || !editor.value.entry.hasLanguage : !activeModel.value?.canCreate : !site.value?.canManage)}>保存草稿</button></> : <>
                    <button class="studio-icon-refresh" disabled={busy.value || loading.value} onClick={reload}>刷新</button>
                    {site.value && (currentSection.value === 'overview' ? <RouterLink class="studio-button primary" to="/d/studio?section=release"><StudioIcon name="release" size={17} />发布修改</RouterLink> : currentSection.value === 'products' ? <button class="primary" disabled={!selectedModel.value?.canCreate || (selectedModel.value?.singleEntry && selectedModel.value.entries.length > 0)} onClick={() => selectedModel.value && openEntry(selectedModel.value, null)}><StudioIcon name="plus" size={17} />新增内容</button> : currentSection.value === 'pages' ? <button class="primary" disabled={!site.value.canManage || !site.value.blueprints.length} onClick={createPage}><StudioIcon name="plus" size={17} />新增页面</button> : currentSection.value === 'media' ? <RouterLink class="studio-button primary" to="/d/media"><StudioIcon name="plus" size={17} />上传与管理素材</RouterLink> : currentSection.value === 'settings' ? <button class="primary" type="submit" form="studio-settings-form" disabled={!dirty.value || busy.value || !site.value.canManage}>保存设置草稿</button> : previewLink())}
                </>}</div>
            </header>
            {(editor.value || pageEditor.value) && stepper()}
            {error.value && <div id="studio-error-summary" tabindex={-1} role="alert" class="studio-error"><strong>操作未完成</strong><p>{error.value}</p><p>{editor.value || pageEditor.value || dirty.value ? '修改仍保留在表单中。若提示内容冲突，请复制需要保留的修改后刷新。' : '请检查当前权限与网站状态，然后刷新重试。'}</p></div>}{notice.value && <div role="status" class="studio-success">{notice.value}</div>}
            {loading.value ? <div role="status" class="studio-card studio-empty">正在读取当前网站内容…</div> : !site.value ? <div class="studio-card studio-empty"><h2>开始搭建你的网站</h2><p>先选择工作空间与网站，再安装模板，即可开始编辑真实内容。</p><div class="studio-actions"><RouterLink class="studio-button primary" to="/d/workspaces">选择工作空间与网站</RouterLink>{sdk.context?.context.admin && <RouterLink class="studio-button" to="/d/presets">模板安装与管理</RouterLink>}</div><p class="studio-help">当前状态：{state.value.status || '未安装'}</p></div> : <>
                {editor.value && activeModel.value ? entryEditor() : pageEditor.value ? pageForm() : currentSection.value === 'overview' ? overview() : currentSection.value === 'products' ? listView() : currentSection.value === 'pages' ? pagesView()
                : currentSection.value === 'media' ? <section class="studio-card"><div class="studio-card-heading"><div><h2>网站图片</h2><p class="studio-help">在内容编辑器中选择图片，或上传新素材后重复使用。</p></div><span class="studio-help">{media.value.length} 张可用图片</span></div>{mediaError.value && <p role="alert" class="studio-warning">{mediaError.value}</p>}<div class="studio-gallery">{media.value.map(item => <figure><img loading="lazy" src={`${sdk.config.apiOrigin}${sdk.media.toUri({ media: item })}`} alt={item.altText || item.name} /><figcaption><strong>{item.name}</strong><span>{item.width} × {item.height} · {Math.round(item.size / 1024)} KB</span></figcaption></figure>)}</div>{!media.value.length && emptyState('素材库还没有图片', '点击「上传与管理素材」添加图片，然后回到内容编辑器选择使用。')}</section>
                : currentSection.value === 'settings' ? settingsView() : site.value.canManage ? <div class="studio-release-layout"><section class="studio-card studio-release-main"><div class="studio-card-heading"><div><h2>检查与发布</h2><p class="studio-help">对照本次变更，处理检查问题，再确认发布。</p></div><span class="studio-badge muted">真实发布状态</span></div><ReleaseManager onSaved={refresh} /></section><aside class="studio-card studio-release-guide"><h2>发布前，确认这三件事</h2><ol><li>已保存全部内容修改</li><li>已预览页面与导航</li><li>已通过发布检查</li></ol><p class="studio-help">检查问题可直接定位到对应内容。发布结果与版本历史会显示在左侧。</p>{previewLink()}</aside></div> : <section class="studio-card studio-empty"><h2>发布需要网站管理员权限</h2><p>保存内容后，请管理员在发布中心检查并发布。</p></section>}
            </>}
        </div>;
    },
});
export default StudioView;
