import { computed, defineComponent, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Dropdown } from '../../components/dropdown';
import { StudioIcon } from '../../components/studio/icon';
import { isUserAdmin } from '../../util/user-role';
import { getUiLanguage, setUiLanguage } from '../../i18n';
import { studioSections, isDashboardLinkActive } from './navigation';
import type { PluginList } from '@bcms/selfhosted-backend/plugin/models/controller';

export const DashboardLayoutAsideContent = defineComponent({
    props: { mobile: Boolean },
    emits: { closeNav: () => true },
    setup(props, ctx) {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const route = useRoute();
        const theme = window.bcms.useTheme();
        const me = computed(() => sdk.store.user.methods.me());
        const admin = computed(() => isUserAdmin(me.value || undefined));
        const plugins = ref<PluginList>();
        const advanced = computed(() => [
            { title: t('workspace.workspaces'), href: '/d/workspaces', visible: true },
            { title: t('workspace.domains'), href: '/d/domains', visible: true },
            { title: t('workspace.entry-groups'), href: '/d/entry-groups', visible: true },
            { title: t('workspace.shares'), href: '/d/shares', visible: true },
            { title: t('nav.presets'), href: '/d/presets', visible: Boolean(sdk.context?.context.admin) },
            { title: '内容模型结构', href: '/d/template', visible: admin.value },
            { title: t('nav.groups'), href: '/d/group', visible: admin.value },
            { title: t('nav.widgets'), href: '/d/widget', visible: admin.value },
            { title: t('nav.media'), href: '/d/media', visible: admin.value || Boolean(me.value?.customPool.policy.media.get) },
            { title: '成员、语言与备份', href: '/d/settings', visible: admin.value },
            { title: t('nav.apiKeys'), href: '/d/api-key', visible: admin.value },
            { title: '账户概览', href: '/d/overview', visible: true },
        ].filter(item => item.visible));
        const templates = computed(() => sdk.store.template.items().filter(item => admin.value || me.value?.customPool.policy.templates.find(policy => policy._id === item._id)?.get).sort((a,b) => a.label.localeCompare(b.label)));
        const advancedOpen = computed(() => advanced.value.some(item => isDashboardLinkActive(route, item.href) && !['EntriesView', 'EntryView'].includes(String(route.name))));
        onMounted(async () => {
            if (!sdk.context) return;
            await window.bcms.throwable(async () => sdk.plugin.getAll(), async result => { plugins.value = result; });
        });
        function profile() {
            ctx.emit('closeNav');
            window.bcms.modalService.handlers.userAddEdit.open({ data: { userId: me.value?._id } });
        }
        const navLink = (title: string, href: string, icon?: string) => <div onClick={() => ctx.emit('closeNav')}><RouterLink to={href} class={['cms-nav-link', { active: isDashboardLinkActive(route, href) }]} aria-current={isDashboardLinkActive(route, href) ? 'page' : undefined}>{icon && <StudioIcon name={icon} />}<span>{title}</span></RouterLink></div>;
        return () => <>
            <div class="cms-brand-row" onClick={() => ctx.emit('closeNav')}><RouterLink class="cms-wordmark" to="/d/studio"><span class="cms-brand-symbol" aria-hidden="true">c<span /></span><strong>cms<span> studio</span></strong></RouterLink>{props.mobile && <button type="button" class="cms-icon-button" aria-label="关闭导航" onClick={() => ctx.emit('closeNav')}><StudioIcon name="close" /></button>}</div>
            <div class="cms-workspace-label"><span>工作空间</span><span>CMS</span></div>
            <div onClick={() => ctx.emit('closeNav')}><RouterLink class="cms-site-picker" to="/d/workspaces" aria-label="切换工作空间或网站"><span class="cms-site-avatar">{sdk.context?.site?.name?.slice(0, 1) || 'W'}</span><span class="cms-site-name">{sdk.context?.site?.name || t('workspace.chooseSite')}<small>{sdk.context?.workspace.name || t('workspace.recover')}</small></span><StudioIcon name="chevron" size={14} /></RouterLink></div>
            <div class="cms-sidebar-scroll">
                <p class="cms-nav-label">内容管理</p>
                <nav aria-label="主导航">{studioSections.filter(item => item.key !== 'release').map(item => navLink(item.label, `/d/studio?section=${item.key}`, item.icon))}</nav>
                <div class="cms-nav-divider" />
                <nav aria-label="发布">{navLink('发布中心', '/d/studio?section=release', 'release')}</nav>
                <details class="cms-nav-group" open={advancedOpen.value} key={String(advancedOpen.value)}><summary>高级管理<StudioIcon name="chevron" size={13} /></summary><nav aria-label="高级管理">{advanced.value.map(item => navLink(item.title, item.href))}</nav></details>
                {templates.value.length > 0 && <details class="cms-nav-group" open={route.name === 'EntriesView' || route.name === 'EntryView'} key={`models-${String(route.name)}`}><summary>完整内容模型<span class="cms-nav-count">{templates.value.length}</span><StudioIcon name="chevron" size={13} /></summary><nav aria-label="完整内容模型">{templates.value.map(item => navLink(item.label, `/d/template/${item._id}/entry`))}</nav></details>}
                {plugins.value && plugins.value.list.length > 0 && <details class="cms-nav-group" open={route.name === 'PluginView'}><summary>{t('nav.plugins')}<StudioIcon name="chevron" size={13} /></summary><nav aria-label="插件">{plugins.value.list.map(item => navLink(item.name, `/d/plugin/${item.id}`))}</nav></details>}
            </div>
            <div class="cms-sidebar-profile"><button type="button" class="cms-profile-button" onClick={profile}><span class="cms-user-avatar">{me.value?.username?.slice(0, 1).toUpperCase() || 'U'}</span><span><strong>{me.value?.username || '用户'}</strong><small>{me.value?.email}</small></span></button>
                <Dropdown fixed items={[
                    { text: t('userMenu.settings'), icon: '/cog', onClick: profile },
                    { text: theme.active.value === 'light' ? t('userMenu.darkMode') : t('userMenu.lightMode'), onClick: () => { theme.set(theme.active.value === 'light' ? 'dark' : 'light'); } },
                    { text: `${t('language.label')} · ${getUiLanguage() === 'zh-CN' ? '中文' : 'English'}`, onClick: () => setUiLanguage(getUiLanguage() === 'zh-CN' ? 'en' : 'zh-CN') },
                    { text: t('userMenu.support'), onClick: () => { window.open('https://thebcms.com/contact', '_blank', 'noopener'); } },
                    { text: t('userMenu.terms'), onClick: () => { window.open('https://thebcms.com/terms-and-conditions', '_blank', 'noopener'); } },
                    { text: t('userMenu.twitter'), onClick: () => { window.open('https://x.com/@thebcms', '_blank', 'noopener'); } },
                    { text: t('userMenu.logout'), icon: '/sign-out', border: true, onClick: async () => { await window.bcms.throwable(async () => sdk.auth.logout(), async () => { window.location.pathname = '/'; }); } },
                ]} />
            </div>
        </>;
    },
});
