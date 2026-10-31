import { computed, defineComponent, ref } from 'vue';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/vue';
import { RouterLink, useRouter } from 'vue-router';
import { StudioIcon } from '../../components/studio/icon';
import { userErrorMessage } from '../../util/user-message';
import { loadSiteChoices, selectSiteAfterNavigation, type SiteChoiceGroup } from './site-picker';

export const SitePicker = defineComponent({
    emits: { selected: () => true },
    setup(_, ctx) {
        const sdk = window.bcms.sdk;
        const router = useRouter();
        const open = ref(false);
        const loading = ref(false);
        const switching = ref(false);
        const error = ref('');
        const search = ref('');
        const groups = ref<SiteChoiceGroup[]>([]);
        const filtered = computed(() => groups.value.map(group => ({ ...group,
            sites: group.sites.filter(site => `${site.name} ${group.name}`.toLowerCase().includes(search.value.trim().toLowerCase())),
        })).filter(group => !search.value.trim() || group.sites.length));
        async function show() {
            open.value = true; loading.value = true; error.value = ''; search.value = ''; groups.value = [];
            try { groups.value = await loadSiteChoices(sdk); }
            catch (cause) { error.value = userErrorMessage(cause); }
            finally { loading.value = false; }
        }
        async function select(workspaceId: string, siteId: string) {
            if (switching.value) return;
            if (sdk.context?.context.workspaceId === workspaceId && sdk.context.context.siteId === siteId) { open.value = false; return; }
            switching.value = true; error.value = '';
            // Leave through the router before retiring the current SDK generation.
            // A cancelled Studio draft guard must leave context and caches intact.
            try {
                open.value = false;
                const selected = await selectSiteAfterNavigation(
                    () => router.push({ path: '/d/workspaces', query: { switchSite: crypto.randomUUID() } }),
                    () => sdk.selectContext({ workspaceId, siteId }, '/d/studio'),
                );
                if (selected) ctx.emit('selected');
            } catch (cause) { error.value = userErrorMessage(cause); open.value = true; }
            finally { switching.value = false; }
        }
        return () => <>
            <button type="button" class="cms-site-picker" aria-label="切换网站" aria-haspopup="dialog" onClick={show} disabled={switching.value}>
                <span class="cms-site-avatar">{sdk.context?.site?.name?.slice(0, 1) || 'W'}</span>
                <span class="cms-site-name">{sdk.context?.site?.name || '选择网站'}<small>{sdk.context?.workspace.name || '查看可访问的网站'}</small></span>
                <StudioIcon name="chevron" size={14} />
            </button>
            <Dialog open={open.value} onClose={() => { if (!switching.value) open.value = false; }} class="cms-site-dialog">
                <div class="cms-site-scrim" aria-hidden="true" />
                <div class="cms-site-dialog-position"><DialogPanel class="cms-site-panel">
                    <div class="cms-site-panel-heading"><DialogTitle>切换网站</DialogTitle><button type="button" class="cms-icon-button" aria-label="关闭网站选择" onClick={() => { open.value = false; }}><StudioIcon name="close" /></button></div>
                    <label class="cms-site-search">搜索网站<input type="search" value={search.value} onInput={event => { search.value = (event.target as HTMLInputElement).value; }} placeholder="输入网站名称…" /></label>
                    {loading.value ? <p role="status">正在加载网站…</p> : error.value ? <div role="alert"><p>{error.value}</p><button type="button" class="cms-admin-text-link" onClick={show}>重新加载</button></div> : <div class="cms-site-choices">
                        {filtered.value.map(group => <section key={group._id}><h3>{group.name}</h3>
                            {group.unavailable ? <p role="status">暂时无法读取此工作区的网站。<button type="button" class="cms-admin-text-link" onClick={show}>重试</button></p> : !group.sites.length ? <p>此工作区暂无网站。</p> : group.sites.map(site => {
                                const current = sdk.context?.context.workspaceId === group._id && sdk.context.context.siteId === site._id;
                                return <button type="button" class="cms-site-choice" key={site._id} aria-current={current ? 'true' : undefined} disabled={switching.value} onClick={() => select(group._id, site._id)}><span class="cms-site-avatar">{site.name.slice(0, 1)}</span><span>{site.name}</span><small>{current ? '当前网站' : '进入网站'}</small></button>;
                            })}
                        </section>)}
                        {!filtered.value.length && <p role="status">没有匹配的网站。</p>}
                    </div>}
                    <div onClick={() => { open.value = false; ctx.emit('selected'); }}><RouterLink class="cms-site-manage" to="/d/workspaces">管理网站与工作区 →</RouterLink></div>
                </DialogPanel></div>
            </Dialog>
        </>;
    },
});
