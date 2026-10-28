import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/vue';
import { useRoute, RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { DashboardLayoutAsideContent } from './aside-content';
import { studioSection, studioSections } from './navigation';
import { StudioIcon } from '../../components/studio/icon';

export const DashboardLayout = defineComponent({
    setup(_, ctx) {
        const sdk = window.bcms.sdk;
        const route = useRoute();
        const { t } = useI18n();
        const [screen] = window.bcms.useScreenSize();
        const mobileShowNav = ref(false);
        const main = ref<HTMLElement>();
        const section = computed(() => studioSections.find(item => item.key === studioSection(route.query.section))!);
        const pageTitle = computed(() => route.name === 'StudioView' ? section.value.label : route.meta.titleKey ? t(route.meta.titleKey as string) : String(route.meta.title || 'CMS Studio'));
        const template = computed(() => sdk.store.template.items().find(item => item._id === route.params.templateId));
        watch(() => route.fullPath, () => {
            mobileShowNav.value = false;
            main.value?.scrollTo(0, 0);
        });
        watch(() => screen.value.width, width => { if (width >= 1024) mobileShowNav.value = false; });
        async function refreshMediaCapabilities() {
            if (document.visibilityState === 'visible' && sdk.context && sdk.store.media.items().length) {
                try { await sdk.media.getAll(); } catch (cause) { console.error('Could not refresh media access', cause); }
            }
        }
        const mediaRefresh = setInterval(refreshMediaCapabilities, 60000);
        onBeforeUnmount(() => {
            clearInterval(mediaRefresh);
            document.removeEventListener('visibilitychange', refreshMediaCapabilities);
        });
        onMounted(async () => {
            document.addEventListener('visibilitychange', refreshMediaCapabilities);
            await window.bcms.throwable(async () => {
                await sdk.user.get('me');
                if (sdk.context) await sdk.template.getAll();
            });
        });
        return () => <div class="cms-shell">
            <a class="cms-skip-link" href="#cms-main">跳转到主要内容</a>
            <aside class="cms-sidebar cms-sidebar-desktop" aria-label="工作空间导航"><DashboardLayoutAsideContent /></aside>
            <div class="cms-main-shell">
                <header class="cms-topbar">
                    <div class="cms-breadcrumbs">
                        <button class="cms-icon-button cms-mobile-menu" type="button" aria-label="展开导航" aria-expanded={mobileShowNav.value} onClick={() => { mobileShowNav.value = true; }}><StudioIcon name="menu" /></button>
                        <RouterLink to="/d/studio" class="cms-breadcrumb-workspace">{sdk.context?.site?.name || 'CMS Studio'}</RouterLink><StudioIcon name="chevron" size={14} /><span aria-current="page">{pageTitle.value}</span>
                        {template.value && <><StudioIcon name="chevron" size={14} /><span class="cms-breadcrumb-detail">{template.value.label}</span></>}
                    </div>
                    <div class="cms-topbar-actions">
                        {sdk.context?.site && <a class="cms-preview-link" href="/d/presets/site-preview" target="_blank" rel="noopener">预览网站<StudioIcon name="external" size={14} /></a>}
                        <button class="cms-top-avatar" type="button" aria-label="个人设置" onClick={() => window.bcms.modalService.handlers.userAddEdit.open({ data: { userId: sdk.store.user.methods.me()?._id } })}>{sdk.store.user.methods.me()?.username?.slice(0, 1).toUpperCase() || 'U'}</button>
                    </div>
                </header>
                <main id="cms-main" ref={main} tabindex={-1} class={['cms-main', `cms-route-${String(route.name)}`]}>
                    <div class="cms-page-content">{ctx.slots.default?.()}</div>
                    <footer class="cms-footer"><span>CMS Studio <span aria-hidden="true">·</span> 让内容管理回归简单</span><span>{sdk.context?.workspace.name}</span></footer>
                </main>
            </div>
            <Dialog open={mobileShowNav.value} onClose={() => { mobileShowNav.value = false; }} class="cms-mobile-dialog">
                <div class="cms-nav-scrim" aria-hidden="true" />
                <DialogPanel class="cms-sidebar cms-sidebar-mobile"><DialogTitle class="sr-only">工作空间导航</DialogTitle><DashboardLayoutAsideContent mobile onCloseNav={() => { mobileShowNav.value = false; }} /></DialogPanel>
            </Dialog>
        </div>;
    },
});
