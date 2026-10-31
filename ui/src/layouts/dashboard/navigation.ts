export const siteSetupHref = '/d/site-setup';
export const studioSections = [
    { key: 'overview', label: '工作台', eyebrow: 'WORKSPACE OVERVIEW', description: '管理内容，掌握网站的每一次更新。', icon: 'overview' },
    { key: 'operations', label: '运营状态', eyebrow: 'SITE OPERATIONS', description: '查看域名、备份、健康和最近发布状态。', icon: 'overview' },
    { key: 'products', label: '网站内容', eyebrow: 'WEBSITE CONTENT', description: '在这里管理页面、商品和品牌资料。', icon: 'products' },
    { key: 'pages', label: '网站内容', eyebrow: 'WEBSITE CONTENT', description: '在这里管理页面、商品和品牌资料。', icon: 'pages' },
    { key: 'media', label: '素材库', eyebrow: 'MEDIA LIBRARY', description: '上传、管理并复用网站素材。', icon: 'media' },
    { key: 'settings', label: '设置', eyebrow: 'SITE SETTINGS', description: '管理网站信息、外观与访问设置。', icon: 'settings' },
    { key: 'release', label: '发布更新', eyebrow: 'PUBLISH', description: '检查本次修改，确认后更新网站。', icon: 'release' },
] as const;
export const primaryNavigation = [
    { label: '工作台', href: '/d/studio?section=overview', icon: 'overview' },
    { label: '运营状态', href: '/d/studio?section=operations', icon: 'overview' },
    { label: '网站内容', href: '/d/studio?section=content', icon: 'pages' },
    { label: '素材库', href: '/d/media', icon: 'media' },
    { label: '设置', href: '/d/studio?section=settings', icon: 'settings' },
] as const;
const modelLabels: Record<string, string> = { product: '商品', collection: '分类', home: '首页', 'content-page': '内容页面', 'site-settings': '品牌与联系' };
export function studioModelLabel(model: { key: string; label: string }): string {
    return modelLabels[model.key] || model.label;
}
export type StudioSection = typeof studioSections[number]['key'];
export function studioSection(value: unknown): StudioSection {
    if (value === 'content') return 'products';
    return studioSections.some(item => item.key === value) ? value as StudioSection : 'overview';
}
export function isDashboardLinkActive(route: { path: string; query: Record<string, unknown> }, href: string): boolean {
    const [path, query = ''] = href.split('?');
    if (path === '/d/media' && route.path === '/d/studio') return studioSection(route.query.section) === 'media';
    if (path === '/d/studio') {
        const target = new URLSearchParams(query).get('section');
        if (route.path !== path) return false;
        const section = studioSection(route.query.section);
        if (target === 'content') return section === 'products' || section === 'pages';
        return section === studioSection(target);
    }
    return route.path === path || route.path.startsWith(`${path}/`);
}
