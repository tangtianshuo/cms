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
import { studioSection, studioSections, studioModelLabel, siteSetupHref } from '../../layouts/dashboard/navigation';
import { MediaView } from './media';
import { NavigationEditor } from '../../components/studio/navigation-editor';
import { SectionEditor } from '../../components/studio/section-editor';
import { settingsRequest } from '../../components/studio/settings-request';
import { siteImageOptions } from '../../components/studio/media-options';
import type { NavigationNode } from '../../components/studio/navigation-editor';
import { SiteOperations } from '../../components/studio/site-operations';

type Section = 'overview' | 'operations' | 'products' | 'pages' | 'media' | 'settings' | 'release';
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
        const editorTab = ref<'content' | 'page'>('content');
        const pageTitle = ref('');
        const pagePath = ref('');
        const settings = ref<{ name: string; background: string; foreground: string; accent: string; muted: string; navigation: NavigationNode[]; operations: { seoTitle: string; seoDescription: string; socialImage?: { _id: string }; favicon?: { _id: string }; analyticsId?: string; contactFormEnabled: boolean } }>({ name: '', background: '', foreground: '', accent: '', muted: '', navigation: [], operations: { seoTitle: '', seoDescription: '', contactFormEnabled: false } });
        const settingsOriginal = ref('');
        const currentSection = computed<Section>(() => studioSection(route.query.section));
        const sectionInfo = computed(() => sections.find(item => item.key === currentSection.value)!);
        const contentSearch = ref('');
        const pageSearch = ref('');
        const filteredEntries = computed(() => (selectedModel.value?.entries || []).filter(entry => `${entryTitle(entry)} ${String(entry.fields.slug || '')}`.toLowerCase().includes(contentSearch.value.trim().toLowerCase())));
        const filteredPages = computed(() => (site.value?.pages || []).filter(page => `${page.title} ${page.path}`.toLowerCase().includes(pageSearch.value.trim().toLowerCase())));
        const site = computed(() => state.value.site);
        const siteImages = computed(() => siteImageOptions(media.value, site.value?.id));
        const selectedModel = computed(() => state.value.models.find(item => item.key === modelKey.value));
        const activeModel = computed(() => state.value.models.find(item => item.key === editor.value?.modelKey));
        const snapshot = () => JSON.stringify({ values: values.value, page: pageEditor.value, title: pageTitle.value, path: pagePath.value });
        const entryDirty = computed(() => Boolean(editor.value) && JSON.stringify(values.value) !== (original.value ? JSON.stringify(JSON.parse(original.value).values) : '{}'));
        const pageDirty = computed(() => Boolean(pageEditor.value) && JSON.stringify(pageEditor.value) !== (original.value ? JSON.stringify(JSON.parse(original.value).page) : undefined));
        const dirty = computed(() => (Boolean(editor.value || pageEditor.value) && snapshot() !== original.value) || (currentSection.value === 'settings' && JSON.stringify(settings.value) !== settingsOriginal.value));
        const canUpload = computed(() => sdk.context?.context.role !== 'viewer' && Boolean(sdk.context?.context.instanceAdmin || sdk.context?.context.mediaPermissions?.post));
        function canLeave() { return !busy.value && (!dirty.value || window.confirm('有尚未保存的修改。确定放弃这些修改吗？')); }
        function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; } }
        onBeforeRouteLeave(() => canLeave());
        onBeforeRouteUpdate(() => { if (!canLeave()) return false; editor.value = undefined; pageEditor.value = undefined; error.value = ''; });
        onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
        function resetSettings() {
            const current = state.value.site;
            if (current) settings.value = { name: current.name, background: current.theme.background, foreground: current.theme.foreground, accent: current.theme.accent, muted: current.theme.muted,
                navigation: JSON.parse(JSON.stringify(current.navigation || current.pages.filter(page => page.navigation !== false && page.enabled !== false && !page.path.includes(':')).map(page => ({ id: `page-${page.key}`, label: page.title, href: page.path, children: [], enabled: true })) )) as NavigationNode[], operations: JSON.parse(JSON.stringify(current.operations || { seoTitle: current.name, seoDescription: '', contactFormEnabled: false })) };
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
        function manageModel(key: string) { void router.push({ path: '/d/studio', query: { section: 'products', modelKey: key } }); }
        function uploadMedia() {
            if (!canUpload.value) return;
            window.bcms.modalService.handlers.mediaCreateFile.open({ onDone: async () => { await loadMedia(); } });
        }
        function openEntry(target: StudioModel, entry: StudioEntry | null, newPage = false, checkLeave = true) {
            if (checkLeave && !canLeave()) return false;
            editor.value = { modelKey: target.key, entry, operationId: crypto.randomUUID(), newPage };
            pageEditor.value = undefined; editorTab.value = 'content'; error.value = ''; notice.value = '';
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
            return true;
        }
        function openPage(page: PageDraft, tab: 'content' | 'page' = 'content', checkLeave = true) {
            const target = state.value.models.find(model => model.key === page.modelKey);
            const bound = target?.entries.find(entry => entry.id === page.entryId) || (target?.singleEntry ? target.entries[0] : undefined);
            if (target && bound) { if (!openEntry(target, bound, false, checkLeave)) return; }
            else { if (checkLeave && !canLeave()) return; editor.value = undefined; values.value = {}; pageTitle.value = ''; pagePath.value = ''; }
            pageEditor.value = JSON.parse(JSON.stringify(page)); editorTab.value = editor.value ? tab : 'page';
            original.value = snapshot(); error.value = ''; notice.value = '';
        }
        function closeEditor() { if (!canLeave()) return; editor.value = undefined; pageEditor.value = undefined; error.value = ''; }
        function applyDeepLink() {
            const requestedModel = typeof route.query.modelKey === 'string' ? route.query.modelKey : '';
            const requestedEntry = typeof route.query.entryId === 'string' ? route.query.entryId : '';
            const requestedPage = typeof route.query.pageKey === 'string' ? route.query.pageKey : '';
            if (requestedPage) {
                const page = site.value?.pages.find(page => page.key === requestedPage);
                if (page) openPage(page, 'page');
                else error.value = '目标页面不存在，或当前网站没有此页面。';
                return;
            }
            if (!requestedModel) return;
            const target = state.value.models.find(model => model.key === requestedModel);
            if (!target) { error.value = '目标内容模型不存在，或你没有访问权限。'; return; }
            modelKey.value = target.key;
            contentSearch.value = '';
            if (requestedEntry) {
                const entry = target.entries.find(entry => entry.id === requestedEntry);
                if (entry) {
                    openEntry(target, entry);
                    if (typeof route.query.field === 'string') void nextTick(() => { const control = document.getElementById(`studio-field-${route.query.field}`); control?.scrollIntoView({ block: 'center' }); control?.focus(); });
                }
                else error.value = '目标内容不存在，或你没有访问权限。';
            } else if (target.singleEntry) openEntry(target, target.entries[0] || null);
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
                    const saved = await sdk.studio.saveEntry(target.key, { entryId: current.entry?.id, operationId: current.operationId,
                        expectedUpdatedAt: current.entry?.updatedAt, fields: changes });
                    if (current.entry) {
                        current.entry = { ...current.entry, id: saved.id, updatedAt: saved.updatedAt };
                        const baseline = JSON.parse(original.value); baseline.values = JSON.parse(JSON.stringify(values.value));
                        original.value = JSON.stringify(baseline);
                        await refresh(); notice.value = '内容草稿已保存。使用右上角「发布更新」同步到网站。'; return;
                    }
                }
                editor.value = undefined; pageEditor.value = undefined; await refresh(); notice.value = '草稿已保存。使用右上角「发布更新」同步到网站。';
            });
        }
        async function savePage(event: Event) {
            event.preventDefault();
            const page = pageEditor.value; const installed = site.value;
            if (!page || !installed) return;
            const bindingChanged = page.entryId !== JSON.parse(original.value).page?.entryId;
            if (bindingChanged && entryDirty.value) { error.value = '请先保存页面内容，再修改绑定内容。'; return; }
            await run(async () => {
                await sdk.studio.savePage(page.key, { expectedUpdatedAt: installed.updatedAt, title: page.title, path: page.path, seoTitle: page.seoTitle,
                    seoDescription: page.seoDescription, sections: page.sections, sectionConfigs: page.sectionConfigs, entryId: page.entryId, enabled: page.enabled !== false, navigation: page.navigation !== false });
                const baseline = JSON.parse(original.value); baseline.page = JSON.parse(JSON.stringify(page));
                original.value = JSON.stringify(baseline);
                await refresh(); notice.value = '页面设置已保存。内容标签中未保存的修改仍然保留。';
                if (bindingChanged) {
                    const target = state.value.models.find(model => model.key === page.modelKey);
                    const bound = target?.entries.find(entry => entry.id === page.entryId) || (target?.singleEntry ? target.entries[0] : undefined);
                    // Rebind the editor only when no unsaved content can be displaced.
                    if (target && bound) openPage(page, 'page', false);
                    else { editor.value = undefined; values.value = {}; original.value = snapshot(); }
                }
            });
        }
        async function saveSettings(event: Event) {
            event.preventDefault(); if (!site.value) return;
            await run(async () => {
                await sdk.studio.saveSettings(settingsRequest(site.value!.updatedAt, settings.value));
                await refresh(); notice.value = '网站设置已保存为草稿。';
            });
        }
        onMounted(async () => {
            window.addEventListener('beforeunload', beforeUnload);
            try { await refresh(); await loadMedia(); applyDeepLink(); }
            catch (cause) { error.value = userErrorMessage(cause); }
            finally { loading.value = false; }
        });
        const entryEditor = () => {
            const current = editor.value!; const target = activeModel.value!;
            const editable = current.entry ? target.canEdit && current.entry.hasLanguage : target.canCreate;
            return <form id="studio-entry-form" onSubmit={saveEntry} class="studio-card studio-editor"><div class="studio-card-heading"><div><p class="studio-eyebrow">{current.newPage ? '新增网站页面' : studioModelLabel(target)}</p><h2>基本资料</h2></div><span class="studio-badge muted">{current.entry ? '编辑草稿' : '新增内容'}</span></div>
                <p class="studio-help">保存后可通过右上角预览和发布。当前内容语言：{site.value?.language}。</p>
                {!editable && <p role="status" class="studio-warning">当前内容没有此语言版本，或你没有编辑权限。请联系管理员或使用完整编辑器。</p>}
                {current.newPage && <div class="studio-fields"><label>页面名称<input required maxlength={120} value={pageTitle.value} disabled={busy.value} onInput={event => { pageTitle.value = (event.target as HTMLInputElement).value; }} /></label><label>页面路径<input required pattern="/[a-z0-9-]+(/[a-z0-9-]+)*" value={pagePath.value} disabled={busy.value} onInput={event => { pagePath.value = (event.target as HTMLInputElement).value; }} /><span class="studio-help">例如 /shipping-policy。页面会绑定本次创建的内容。</span></label></div>}
                <StudioFields model={target} models={state.value.models} values={values.value} media={media.value} isNew={!current.entry} disabled={busy.value || !editable} onUpload={canUpload.value ? uploadMedia : undefined} onChange={(key, value) => { values.value = { ...values.value, [key]: value }; }} />
                {mediaError.value && <p class="studio-warning">素材加载失败：{mediaError.value}。未修改的素材引用将保留。</p>}
                {current.entry && <details class="studio-advanced"><summary>高级编辑</summary><RouterLink class="studio-text-link" to={`/d/template/${target.templateId}/entry/${current.entry.id}`}>打开完整编辑器 →</RouterLink></details>}
            </form>;
        };
        const pageForm = () => {
            const page = pageEditor.value!; const options = site.value?.pageOptions[page.key];
            const canBind = page.layout === 'home' || Boolean(page.blueprintKey);
            const sectionAllowed = page.layout === 'home' ? ['hero-carousel', 'info-grid', 'faq'] : page.layout === 'product-detail' ? ['product-gallery', 'product-information', 'product-description', 'faq'] : ['info-grid', 'faq'];
            const legacyConfig = (name: string) => ({ type: name === 'hero' ? 'hero-carousel' : name === 'feature' ? 'info-grid' : name === 'gallery' ? 'product-gallery' : name === 'information' ? 'product-information' : name === 'description' ? 'product-description' : 'faq', enabled: false, data: name === 'hero' ? { slides: [] } : name === 'gallery' ? { images: [] } : name === 'feature' ? { items: [] } : name === 'faq' ? { items: [] } : {} });
            const editorConfigs = page.sectionConfigs || page.sections.map(legacyConfig);
            const supportsConfiguredSections = page.layout === 'home' || page.layout === 'product-detail';
            return <form id="studio-page-form" class="studio-card studio-editor" onSubmit={savePage}><div class="studio-card-heading"><h2>页面资料</h2><span class="studio-badge muted">页面草稿</span></div><fieldset disabled={busy.value || !site.value?.canManage}>
                <div class="studio-fields"><label>页面名称<input required maxlength={120} v-model={page.title} /></label><label>访问路径<input required v-model={page.path} readonly={page.path === '/' || page.path.includes(':')} /><span class="studio-help">主页和动态页面路径由模板固定。</span></label><label>SEO 标题<input maxlength={120} v-model={page.seoTitle} /></label><label>SEO 描述<textarea maxlength={320} rows={3} v-model={page.seoDescription} /></label>
                    {canBind && <label>绑定内容<select disabled={entryDirty.value} v-model={page.entryId}><option value="">{page.blueprintKey ? '请选择内容' : '使用默认主页内容'}</option>{state.value.models.find(model => model.key === page.modelKey)?.entries.map(entry => <option value={entry.id}>{entryTitle(entry)}</option>)}</select>{entryDirty.value && <span class="studio-help">保存页面内容后可更换绑定。</span>}</label>}
                    {supportsConfiguredSections ? <SectionEditor modelValue={editorConfigs as any} allowed={sectionAllowed as any} required={page.layout === 'home' ? ['hero-carousel'] : ['product-gallery', 'product-information', 'product-description']} media={siteImages.value} onUpload={canUpload.value ? uploadMedia : undefined} disabled={busy.value || !site.value?.canManage} onUpdate:modelValue={(value: any) => { page.sectionConfigs = value; }} /> : <div><span class="studio-label">页面区块（按当前顺序）</span><div class="studio-section-order">{page.sections.map((name, index) => <div><span>{name}</span><button type="button" aria-label={`上移 ${name}`} disabled={index === 0} onClick={() => { const copy = [...page.sections]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; page.sections = copy; }}>上移</button><button type="button" aria-label={`下移 ${name}`} disabled={index === page.sections.length - 1} onClick={() => { const copy = [...page.sections]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; page.sections = copy; }}>下移</button><button type="button" disabled={name === options?.required} onClick={() => { page.sections = page.sections.filter(section => section !== name); }}>移除</button></div>)}</div>{options?.allowed.filter(name => !page.sections.includes(name)).map(name => <button type="button" onClick={() => { page.sections = [...page.sections, name]; }}>添加 {name}</button>)}</div>}
                    <label class="studio-check"><input type="checkbox" disabled={page.layout === 'home'} checked={page.enabled !== false} onChange={event => { page.enabled = (event.target as HTMLInputElement).checked; }} />启用页面</label><label class="studio-check"><input type="checkbox" checked={page.navigation !== false} onChange={event => { page.navigation = (event.target as HTMLInputElement).checked; }} />加入导航</label>
                </div>{!editor.value && <p class="studio-help">{page.path.includes(':') ? '此页面按商品或分类自动生成，请到对应内容分类编辑资料。' : '此页面尚未绑定可编辑内容，可在上方绑定内容后保存。'}</p>}</fieldset></form>;
        };
        function createPage() {
            const blueprint = site.value?.blueprints[0];
            const target = state.value.models.find(model => model.key === blueprint?.modelKey);
            if (target) openEntry(target, null, true);
        }

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
        const settingsView = () => <div class="studio-settings-layout"><form id="studio-settings-form" class="studio-card studio-editor" onSubmit={saveSettings}><div class="studio-card-heading"><h2>基本信息与外观</h2><span class="studio-badge muted">保存为草稿</span></div><p class="studio-help">修改网站名称和模板支持的品牌颜色。</p><fieldset disabled={busy.value || !site.value?.canManage}><div class="studio-fields"><label>网站名称<input required maxlength={80} v-model={settings.value.name} /></label><div class="studio-color-grid">{(['background', 'foreground', 'accent', 'muted'] as const).map(key => <label>{({ background: '背景颜色', foreground: '文字颜色', accent: '强调颜色', muted: '弱化颜色' })[key]}<div class="studio-color"><input type="color" aria-label={`${key} 颜色选择器`} v-model={settings.value[key]} /><input required pattern="#[a-fA-F0-9]{6}" aria-label={`${key} 十六进制颜色`} v-model={settings.value[key]} /></div></label>)}</div><NavigationEditor modelValue={settings.value.navigation} pages={site.value?.pages || []} disabled={!site.value?.canManage || busy.value} onUpdate:modelValue={(value: NavigationNode[]) => { settings.value.navigation = value; }} /></div></fieldset>{!site.value?.canManage && <p class="studio-warning">网站设置需要管理员权限。</p>}</form><aside class="studio-card studio-settings-guide"><h2>网站管理</h2><p class="studio-help">资料与外观保存为草稿，通过右上角统一发布。</p><RouterLink class="studio-settings-link" to="/d/domains"><StudioIcon name="external" />域名与访问<StudioIcon name="chevron" size={14} /></RouterLink>{site.value?.canManage && <RouterLink class="studio-settings-link" to="/d/workspaces#workspace-members"><StudioIcon name="settings" />成员与权限<StudioIcon name="chevron" size={14} /></RouterLink>}<div class="studio-nav-divider" /><h3>搜索与分享</h3><label>搜索引擎标题<input maxlength={120} value={settings.value.operations.seoTitle} onInput={event => { settings.value.operations.seoTitle = (event.target as HTMLInputElement).value; }} /></label><label>搜索引擎描述<textarea maxlength={320} rows={3} value={settings.value.operations.seoDescription} onInput={event => { settings.value.operations.seoDescription = (event.target as HTMLTextAreaElement).value; }} /></label>{(['socialImage', 'favicon'] as const).map(key => <label>{key === 'socialImage' ? '社交分享图片' : '网站图标'}<select aria-label={key === 'socialImage' ? '社交分享图片' : '网站图标'} disabled={busy.value || !site.value?.canManage} value={settings.value.operations[key]?._id || ''} onChange={event => { const id = (event.target as HTMLSelectElement).value; settings.value.operations[key] = id ? { _id: id } : undefined; }}><option value="">未设置</option>{settings.value.operations[key]?._id && !media.value.some(item => item._id === settings.value.operations[key]?._id) && <option value={settings.value.operations[key]?._id}>原有图片（素材未加载）</option>}{siteImages.value.map(item => <option value={item._id}>{item.name}</option>)}</select></label>)}<label>统计工具 ID<input value={settings.value.operations.analyticsId || ""} onInput={event => { settings.value.operations.analyticsId = (event.target as HTMLInputElement).value.trim() || undefined; }} /></label><label class="studio-check"><input type="checkbox" disabled />启用联系表单 <span class="studio-help">暂未配置邮件投递服务</span></label><h3>品牌与联系信息</h3><p class="studio-help">更新品牌名称、联系邮箱及网站公告。</p><button onClick={() => manageModel('site-settings')}>编辑品牌与联系资料 →</button><details><summary>模板与高级配置</summary><p class="studio-help">模板 {site.value?.presetId} · {site.value?.presetVersion}<br />字体：{site.value?.theme.font}</p><RouterLink class="studio-text-link" to="/d/presets">模板安装与兼容性 →</RouterLink><RouterLink class="studio-text-link" to="/d/domains">域名与访问设置 →</RouterLink></details></aside></div>;
        const contentNavigation = () => <nav class="studio-content-tabs" aria-label="网站内容分类">
            <RouterLink class={{ active: currentSection.value === 'pages' }} aria-current={currentSection.value === 'pages' ? 'page' : undefined} to="/d/studio?section=pages">页面</RouterLink>
            {state.value.models.filter(model => !['home', 'content-page'].includes(model.key)).map(model => <RouterLink key={model.key} class={{ active: currentSection.value === 'products' && modelKey.value === model.key }} aria-current={currentSection.value === 'products' && modelKey.value === model.key ? 'page' : undefined} to={{ path: '/d/studio', query: { section: 'products', modelKey: model.key } }}>{studioModelLabel(model)}</RouterLink>)}
        </nav>;
        const isEditing = () => Boolean(editor.value || pageEditor.value);
        const editingSettings = () => pageEditor.value && editorTab.value === 'page';
        return () => <div class="cms-studio">
            <header class="studio-header"><div>
                {isEditing() && <button class="studio-back" type="button" disabled={busy.value} onClick={closeEditor}>← 返回{sectionInfo.value.label}</button>}
                <p class="studio-eyebrow">{isEditing() ? 'EDIT CONTENT' : sectionInfo.value.eyebrow}</p>
                <h1>{pageEditor.value ? pageEditor.value.title : editor.value ? editor.value.newPage ? '新增网站页面' : editor.value.entry ? activeModel.value?.singleEntry ? studioModelLabel(activeModel.value) : entryTitle(editor.value.entry) : activeModel.value?.key === 'product' ? '新增商品' : '新增内容' : sectionInfo.value.label}</h1>
                <p class="studio-subtitle">{isEditing() ? '保存草稿后，通过右上角预览和发布。' : currentSection.value === 'overview' ? `欢迎回来，${sdk.store.user.methods.me()?.username || '内容编辑者'}。${sectionInfo.value.description}` : sectionInfo.value.description}</p>
            </div><div class="studio-actions">
                {isEditing() ? <>
                    <span class="studio-save-state">{busy.value ? '正在保存…' : dirty.value ? '有未保存的修改' : '草稿已保存'}</span>
                    <button class="primary" type="submit" form={editingSettings() ? 'studio-page-form' : 'studio-entry-form'} disabled={busy.value || (editingSettings() ? !pageDirty.value || !site.value?.canManage : editor.value?.entry ? !entryDirty.value || !activeModel.value?.canEdit || !editor.value.entry.hasLanguage : !dirty.value || !activeModel.value?.canCreate)}>保存{editingSettings() ? '页面设置' : '草稿'}</button>
                </> : site.value && <>
                    {currentSection.value === 'products' && !selectedModel.value?.singleEntry && <button class="primary" disabled={!selectedModel.value?.canCreate} onClick={() => selectedModel.value && openEntry(selectedModel.value, null)}><StudioIcon name="plus" size={17} />新增{selectedModel.value ? studioModelLabel(selectedModel.value) : '内容'}</button>}
                    {currentSection.value === 'pages' && <button class="primary" disabled={!site.value.canManage || !site.value.blueprints.length} onClick={createPage}><StudioIcon name="plus" size={17} />新增页面</button>}
                    {currentSection.value === 'settings' && <button class="primary" type="submit" form="studio-settings-form" disabled={!dirty.value || busy.value || !site.value.canManage}>保存设置草稿</button>}
                </>}
            </div></header>
            {error.value && <div id="studio-error-summary" tabindex={-1} role="alert" class="studio-error"><strong>操作未完成</strong><p>{error.value}</p><p>{isEditing() || dirty.value ? '修改仍保留在表单中。若提示内容冲突，请复制需要保留的修改后刷新。' : '请检查当前权限与网站状态，然后刷新重试。'}</p></div>}
            {notice.value && <div role="status" class="studio-success">{notice.value}</div>}
            {loading.value ? <div role="status" class="studio-card studio-empty">正在读取当前网站内容…</div> : !site.value ? <div class="studio-card studio-empty"><h2>开始搭建你的网站</h2><p>从左侧选择网站，即可开始管理内容。</p><div class="studio-actions"><RouterLink class="studio-button" to="/d/workspaces">管理网站</RouterLink>{sdk.context?.context.admin && <RouterLink class="studio-button primary" to={siteSetupHref}>开始创建网站</RouterLink>}</div></div> : <>
                {['products', 'pages'].includes(currentSection.value) && contentNavigation()}
                {pageEditor.value && editor.value && <div class="studio-editor-tabs" role="tablist" aria-label="页面编辑">
                    <button id="studio-content-tab" type="button" role="tab" aria-selected={editorTab.value === 'content'} aria-controls="studio-page-panel" onClick={() => { editorTab.value = 'content'; }}>页面内容{entryDirty.value ? ' · 未保存' : ''}</button>
                    <button id="studio-settings-tab" type="button" role="tab" aria-selected={editorTab.value === 'page'} aria-controls="studio-page-panel" onClick={() => { editorTab.value = 'page'; }}>页面设置{pageDirty.value ? ' · 未保存' : ''}</button>
                </div>}
                {isEditing() ? <div id="studio-page-panel" role={pageEditor.value && editor.value ? 'tabpanel' : undefined} aria-labelledby={pageEditor.value && editor.value ? editorTab.value === 'page' ? 'studio-settings-tab' : 'studio-content-tab' : undefined}>{editingSettings() ? pageForm() : editor.value && activeModel.value ? entryEditor() : pageEditor.value ? pageForm() : null}</div>
                : currentSection.value === 'overview' ? overview()
                : currentSection.value === 'operations' ? <SiteOperations />
                : currentSection.value === 'products' ? listView()
                : currentSection.value === 'pages' ? pagesView()
                : currentSection.value === 'media' ? <MediaView />
                : currentSection.value === 'settings' ? settingsView()
                : site.value.canManage ? <section class="studio-card"><div class="studio-card-heading"><div><h2>检查与发布</h2><p class="studio-help">检查本次变更后确认发布，也可在这里查看历史版本。</p></div></div><ReleaseManager onSaved={refresh} /></section>
                : <section class="studio-card studio-empty"><h2>发布需要网站管理员权限</h2><p>保存内容后，请管理员检查并发布。</p></section>}
            </>}
        </div>;
    },
});
export default StudioView;
